using System.Data;
using System.Globalization;
using System.Text.Json;
using Dapper;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging.Abstractions;

namespace BassBuild.Server;

/// <summary>SQLite access, embedded migrations and first-run seeding.</summary>
/// <remarks>Microsoft.Data.Sqlite's async methods complete synchronously, so the sync API is used throughout.</remarks>
public sealed class Db
{
    const string MigrationPrefix = "Migrations/";

    static readonly string[] PanelColumns =
        ["key", "name", "name_th", "category", "density_kg_m3", "e_gpa", "e_cross_gpa", "poisson", "loss_factor",
         "thicknesses_mm", "sheet_w_mm", "sheet_h_mm", "price_per_sheet_thb", "notes"];
    static readonly string[] DampingColumns =
        ["key", "name", "name_th", "kind", "density_kg_m3", "flow_resistivity_min", "flow_resistivity_max",
         "fill_g_per_l_min", "fill_g_per_l_max", "porosity", "notes"];
    static readonly string[] HardwareColumns = ["key", "kind", "name", "od_mm", "id_mm", "verified", "notes"];

    static Db()
    {
        DefaultTypeMap.MatchNamesWithUnderscores = true; // size_in -> SizeIn, e_gpa -> EGpa, ...
        SqlMapper.AddTypeHandler(new JsonDoubleArrayHandler());
        SqlMapper.AddTypeHandler(new JsonElementHandler());
    }

    public Db(string filePath)
    {
        FilePath = Path.GetFullPath(filePath);
        Directory.CreateDirectory(Path.GetDirectoryName(FilePath)!);
        ConnectionString = new SqliteConnectionStringBuilder { DataSource = FilePath }.ToString();
    }

    public string FilePath { get; }
    public string ConnectionString { get; }

    public static string Now() => DateTime.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);

    /// <summary>Walks up from <paramref name="start"/> to the folder holding data/seed; falls back to <paramref name="start"/>.</summary>
    public static string FindRepoRoot(string start)
    {
        for (var dir = new DirectoryInfo(start); dir is not null; dir = dir.Parent)
            if (Directory.Exists(Path.Combine(dir.FullName, "data", "seed")))
                return dir.FullName;
        return start;
    }

    /// <summary>Config BassBuild:DbPath, then env BASSBUILD_DB, then &lt;repo&gt;/data/bassbuild.db. Relative paths resolve against the repo root.</summary>
    public static string ResolvePath(IConfiguration config, string repoRoot)
    {
        var path = config["BassBuild:DbPath"];
        if (string.IsNullOrWhiteSpace(path)) path = Environment.GetEnvironmentVariable("BASSBUILD_DB");
        if (string.IsNullOrWhiteSpace(path)) path = Path.Combine(repoRoot, "data", "bassbuild.db");
        return Path.GetFullPath(path, repoRoot);
    }

    public SqliteConnection Open()
    {
        var c = new SqliteConnection(ConnectionString);
        c.Open();
        c.Execute("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;");
        return c;
    }

    public List<T> Query<T>(string sql, object? param = null)
    {
        using var c = Open();
        return c.Query<T>(sql, param).AsList();
    }

    /// <summary>snake_case column → Dapper parameter named after the PascalCase property (kind_th → @KindTh).</summary>
    public static string Param(string column) =>
        "@" + string.Concat(column.Split('_').Select(part => char.ToUpperInvariant(part[0]) + part[1..]));

    public static string InsertSql(string table, IReadOnlyList<string> columns) =>
        $"INSERT INTO {table} ({string.Join(", ", columns)}) VALUES ({string.Join(", ", columns.Select(Param))})";

    public static bool IsUniqueViolation(SqliteException e) => e.SqliteExtendedErrorCode == 2067; // SQLITE_CONSTRAINT_UNIQUE

    public static IEnumerable<(string Version, string Sql)> LoadMigrations()
    {
        var asm = typeof(Db).Assembly;
        var names = asm.GetManifestResourceNames()
            .Where(n => n.StartsWith(MigrationPrefix, StringComparison.Ordinal) && n.EndsWith(".sql", StringComparison.Ordinal))
            .Order(StringComparer.Ordinal);
        foreach (var name in names)
        {
            using var reader = new StreamReader(asm.GetManifestResourceStream(name)!);
            yield return (Path.GetFileNameWithoutExtension(name[MigrationPrefix.Length..]), reader.ReadToEnd());
        }
    }

    /// <summary>Applies pending migrations in order, each in its own transaction. Returns how many ran.</summary>
    public int Migrate()
    {
        using var c = Open();
        c.Execute("CREATE TABLE IF NOT EXISTS schema_migrations(version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
        var applied = c.Query<string>("SELECT version FROM schema_migrations").ToHashSet(StringComparer.Ordinal);
        var ran = 0;
        foreach (var (version, sql) in LoadMigrations())
        {
            if (applied.Contains(version)) continue;
            using var tx = c.BeginTransaction();
            c.Execute(sql, transaction: tx);
            c.Execute("INSERT INTO schema_migrations(version, applied_at) VALUES (@version, @now)", new { version, now = Now() }, tx);
            tx.Commit();
            ran++;
        }
        return ran;
    }

    /// <summary>Fills each reference table from the seed JSON only while that table is empty.</summary>
    public void Seed(string seedDir, ILogger? log = null)
    {
        log ??= NullLogger.Instance;
        using var c = Open();
        using var tx = c.BeginTransaction();

        var materials = ReadJson(Path.Combine(seedDir, "materials.json"), log);
        SeedTable<PanelMaterial>(c, tx, "panel_materials", PanelColumns, materials, "panelMaterials", log);
        SeedTable<DampingMaterial>(c, tx, "damping_materials", DampingColumns, materials, "dampingMaterials", log);
        SeedTable<Hardware>(c, tx, "hardware", HardwareColumns, materials, "hardware", log);

        if (IsEmpty(c, tx, "drivers"))
        {
            var now = Now();
            var count = 0;
            foreach (var d in Items<DriverInput>(ReadJson(Path.Combine(seedDir, "drivers.sample.json"), log), "drivers"))
            {
                d.Normalize();
                if (Validation.Driver(d) is { } err)
                {
                    log.LogWarning("Skipping seed driver {Brand} {Model}: invalid {Field}", d.Brand, d.Model, err.Field);
                    continue;
                }
                DriverEndpoints.Insert(c, d, now, tx);
                count++;
            }
            log.LogInformation("Seeded {Count} rows into {Table}", count, "drivers");
        }

        tx.Commit();
    }

    static void SeedTable<T>(SqliteConnection c, IDbTransaction tx, string table, string[] columns, JsonElement? root, string property, ILogger log)
    {
        if (!IsEmpty(c, tx, table)) return;
        var count = c.Execute(InsertSql(table, columns), Items<T>(root, property), tx);
        log.LogInformation("Seeded {Count} rows into {Table}", count, table);
    }

    static bool IsEmpty(SqliteConnection c, IDbTransaction tx, string table) =>
        c.ExecuteScalar<long>($"SELECT COUNT(*) FROM {table}", transaction: tx) == 0;

    static JsonElement? ReadJson(string path, ILogger log)
    {
        if (!File.Exists(path))
        {
            log.LogWarning("Seed file {File} not found; skipping", Path.GetFileName(path));
            return null;
        }
        using var doc = JsonDocument.Parse(File.ReadAllText(path));
        return doc.RootElement.Clone();
    }

    static List<T> Items<T>(JsonElement? root, string property) =>
        root is { ValueKind: JsonValueKind.Object } r && r.TryGetProperty(property, out var items) && items.ValueKind == JsonValueKind.Array
            ? items.Deserialize<List<T>>(Api.Json) ?? []
            : [];

    /// <summary>Stores number[] columns (thicknesses_mm) as JSON text.</summary>
    sealed class JsonDoubleArrayHandler : SqlMapper.TypeHandler<double[]>
    {
        public override void SetValue(IDbDataParameter parameter, double[]? value) =>
            parameter.Value = value is null ? DBNull.Value : JsonSerializer.Serialize(value);

        public override double[]? Parse(object value) => value is string s ? JsonSerializer.Deserialize<double[]>(s) : null;
    }

    /// <summary>Reads JSON text columns (projects.data) back as a JSON value, not a string.</summary>
    sealed class JsonElementHandler : SqlMapper.TypeHandler<JsonElement>
    {
        public override void SetValue(IDbDataParameter parameter, JsonElement value) => parameter.Value = value.GetRawText();

        public override JsonElement Parse(object value)
        {
            using var doc = JsonDocument.Parse((string)value);
            return doc.RootElement.Clone();
        }
    }
}
