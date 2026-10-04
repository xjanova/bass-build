using System.Net;
using System.Text.Json;
using Dapper;

namespace BassBuild.Server.Tests;

public sealed class MigrationTests : IDisposable
{
    readonly string _path = TempDb.NewPath();

    public void Dispose() => TempDb.Delete(_path);

    [Fact]
    public void Migrate_twice_is_a_noop()
    {
        var db = new Db(_path);
        var expected = Db.LoadMigrations().Count();
        Assert.True(expected >= 1);

        Assert.Equal(expected, db.Migrate());
        Assert.Equal(0, db.Migrate());

        using var c = db.Open();
        Assert.Equal(expected, c.ExecuteScalar<long>("SELECT COUNT(*) FROM schema_migrations"));
        var tables = c.Query<string>("SELECT name FROM sqlite_master WHERE type = 'table'").ToHashSet();
        foreach (var t in new[] { "drivers", "panel_materials", "damping_materials", "hardware", "projects",
                     "project_revisions", "measurements", "assets", "settings", "schema_migrations" })
            Assert.Contains(t, tables);
    }

    [Fact]
    public void Connections_enable_foreign_keys_and_wal()
    {
        var db = new Db(_path);
        using var c = db.Open();
        Assert.Equal(1L, c.ExecuteScalar<long>("PRAGMA foreign_keys"));
        Assert.Equal("wal", c.ExecuteScalar<string>("PRAGMA journal_mode"));
    }

    [Fact]
    public void Seed_matches_seed_files_and_is_idempotent()
    {
        var db = new Db(_path);
        db.Migrate();
        db.Seed(TempDb.SeedDir);
        db.Seed(TempDb.SeedDir);

        using var materials = JsonDocument.Parse(File.ReadAllText(Path.Combine(TempDb.SeedDir, "materials.json")));
        using var drivers = JsonDocument.Parse(File.ReadAllText(Path.Combine(TempDb.SeedDir, "drivers.sample.json")));
        using var datasheet = JsonDocument.Parse(File.ReadAllText(Path.Combine(TempDb.SeedDir, "drivers.json")));
        int FileCount(JsonDocument d, string prop) => d.RootElement.GetProperty(prop).GetArrayLength();

        using var c = db.Open();
        long Rows(string table) => c.ExecuteScalar<long>($"SELECT COUNT(*) FROM {table}");

        Assert.Equal(FileCount(materials, "panelMaterials"), Rows("panel_materials"));
        Assert.Equal(FileCount(materials, "dampingMaterials"), Rows("damping_materials"));
        Assert.Equal(FileCount(materials, "hardware"), Rows("hardware"));
        Assert.Equal(FileCount(drivers, "drivers") + FileCount(datasheet, "drivers"), Rows("drivers"));
        Assert.Equal((16L, 9L, 10L), (Rows("panel_materials"), Rows("damping_materials"), Rows("hardware")));
        Assert.Equal("[9,12,15,16,18,19,25]", c.ExecuteScalar<string>("SELECT thicknesses_mm FROM panel_materials WHERE key = 'mdf'"));
    }

    [Fact]
    public async Task App_startup_twice_on_one_database_is_a_noop()
    {
        string Snapshot()
        {
            using var c = new Db(_path).Open();
            return string.Join(",", new[] { "schema_migrations", "drivers", "panel_materials", "damping_materials", "hardware" }
                .Select(t => c.ExecuteScalar<long>($"SELECT COUNT(*) FROM {t}")));
        }

        string first;
        await using (var app = new ApiFactory(_path) { KeepDatabase = true })
        {
            Assert.Equal(HttpStatusCode.OK, (await app.CreateClient().GetAsync("/api/health")).StatusCode);
            first = Snapshot();
        }
        await using (var app = new ApiFactory(_path) { KeepDatabase = true })
        {
            Assert.Equal(HttpStatusCode.OK, (await app.CreateClient().GetAsync("/api/health")).StatusCode);
        }
        Assert.Equal(first, Snapshot());
    }
}
