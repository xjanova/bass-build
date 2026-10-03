using System.Data;
using System.Globalization;
using System.Text.Json.Serialization;
using Dapper;
using Microsoft.Data.Sqlite;

namespace BassBuild.Server;

/// <summary>Request body for POST/PUT /api/drivers and the shape of seed entries.</summary>
public class DriverInput
{
    public string? Brand { get; set; }
    public string? Model { get; set; }
    public string? Category { get; set; }
    public string? KindTh { get; set; }
    public double? SizeIn { get; set; }
    public double? Fs { get; set; }
    public double? Qts { get; set; }
    public double? Qes { get; set; }
    public double? Qms { get; set; }
    public double? VasL { get; set; }
    public double? Re { get; set; }
    public double? LeMh { get; set; }
    public double? Bl { get; set; }
    public double? MmsG { get; set; }
    public double? CmsMmPerN { get; set; }
    public double? Rms { get; set; }
    public double? SdCm2 { get; set; }
    public double? XmaxMm { get; set; }
    public double? XmechMm { get; set; }
    public double? PeW { get; set; }
    public double? SplDb { get; set; }
    public double? ZNom { get; set; }
    public string? Coil { get; set; }
    public double? CutoutMm { get; set; }
    public double? OuterMm { get; set; }
    public double? DepthMm { get; set; }
    public double? DisplacementL { get; set; }
    public double? RthVc { get; set; }
    public double? TauVc { get; set; }
    public double? RthMag { get; set; }
    public double? TauMag { get; set; }
    public string? SourceKind { get; set; }
    public string? SourceUrl { get; set; }
    public bool? Verified { get; set; }
    public string? Notes { get; set; }

    public void Normalize()
    {
        Brand = Validation.Clean(Brand);
        Model = Validation.Clean(Model);
        Category = Validation.Clean(Category);
        KindTh = Validation.Clean(KindTh);
        Coil = Validation.Clean(Coil);
        SourceKind = Validation.Clean(SourceKind) ?? "user";
        SourceUrl = Validation.Clean(SourceUrl);
        Notes = Validation.Clean(Notes);
        Verified ??= false;
    }
}

/// <summary>Driver as returned by the API (verified is never null once stored).</summary>
public sealed class Driver : DriverInput
{
    [JsonPropertyOrder(-1)] public long Id { get; set; }
    [JsonPropertyOrder(1)] public string CreatedAt { get; set; } = "";
    [JsonPropertyOrder(1)] public string UpdatedAt { get; set; } = "";
}

public static class DriverEndpoints
{
    static readonly string[] Columns =
        ["brand", "model", "category", "kind_th", "size_in", "fs", "qts", "qes", "qms", "vas_l", "re", "le_mh", "bl",
         "mms_g", "cms_mm_per_n", "rms", "sd_cm2", "xmax_mm", "xmech_mm", "pe_w", "spl_db", "z_nom", "coil",
         "cutout_mm", "outer_mm", "depth_mm", "displacement_l", "rth_vc", "tau_vc", "rth_mag", "tau_mag",
         "source_kind", "source_url", "verified", "notes"];

    static readonly string InsertSql = Db.InsertSql("drivers", [.. Columns, "created_at", "updated_at"]) + " RETURNING *";
    static readonly string UpdateSql =
        $"UPDATE drivers SET {string.Join(", ", Columns.Select(c => $"{c} = {Db.Param(c)}"))}, updated_at = @UpdatedAt WHERE id = @Id RETURNING *";

    public static void Map(IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/drivers");
        g.MapGet("", Search);
        g.MapGet("/{id:long}", (long id, Db db) =>
            db.Query<Driver>("SELECT * FROM drivers WHERE id = @id", new { id }).FirstOrDefault() is { } d ? Results.Ok(d) : NotFound());
        g.MapPost("", Create);
        g.MapPut("/{id:long}", Update);
        g.MapDelete("/{id:long}", (long id, Db db) =>
        {
            using var c = db.Open();
            return c.Execute("DELETE FROM drivers WHERE id = @id", new { id }) > 0 ? Results.NoContent() : NotFound();
        });
    }

    internal static Driver Insert(SqliteConnection c, DriverInput d, string now, IDbTransaction? tx = null) =>
        c.QuerySingle<Driver>(InsertSql, Params(d, now), tx);

    static IResult Search(string? q, string? category, string? sizeIn, Db db)
    {
        category = Validation.Clean(category);
        if (category is not null && !Validation.Categories.Contains(category))
            return Api.Invalid(new("category", $"ประเภทลำโพงต้องเป็นหนึ่งใน {string.Join(", ", Validation.Categories)}"));

        double? size = null;
        if (Validation.Clean(sizeIn) is { } raw)
        {
            if (!double.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out var v) || !double.IsFinite(v))
                return Api.Invalid(new("sizeIn", "ขนาดลำโพงต้องเป็นตัวเลข เช่น 12 หรือ 6.5"));
            size = v;
        }

        return Results.Ok(db.Query<Driver>("""
            SELECT * FROM drivers
            WHERE (@q IS NULL OR brand LIKE @q ESCAPE '\' OR model LIKE @q ESCAPE '\' OR kind_th LIKE @q ESCAPE '\')
              AND (@category IS NULL OR category = @category)
              AND (@size IS NULL OR size_in = @size)
            ORDER BY size_in, model
            """, new { q = LikeContains(q), category, size }));
    }

    static IResult Create(DriverInput input, Db db)
    {
        input.Normalize();
        if (Validation.Driver(input) is { } error) return Api.Invalid(error);
        using var c = db.Open();
        try
        {
            var d = Insert(c, input, Db.Now());
            return Results.Created($"/api/drivers/{d.Id}", d);
        }
        catch (SqliteException e) when (Db.IsUniqueViolation(e))
        {
            return Duplicate();
        }
    }

    static IResult Update(long id, DriverInput input, Db db)
    {
        input.Normalize();
        if (Validation.Driver(input) is { } error) return Api.Invalid(error);
        var p = Params(input, Db.Now());
        p.Add("Id", id);
        using var c = db.Open();
        try
        {
            return c.QuerySingleOrDefault<Driver>(UpdateSql, p) is { } d ? Results.Ok(d) : NotFound();
        }
        catch (SqliteException e) when (Db.IsUniqueViolation(e))
        {
            return Duplicate();
        }
    }

    static DynamicParameters Params(DriverInput d, string now)
    {
        var p = new DynamicParameters(d);
        p.Add("CreatedAt", now);
        p.Add("UpdatedAt", now);
        return p;
    }

    /// <summary>"%term%" with LIKE wildcards escaped, so user input only ever matches literally.</summary>
    static string? LikeContains(string? q) => Validation.Clean(q) is { } t
        ? "%" + t.Replace(@"\", @"\\").Replace("%", @"\%").Replace("_", @"\_") + "%"
        : null;

    static IResult NotFound() => Api.NotFound("ไม่พบลำโพงนี้");

    static IResult Duplicate() => Api.Conflict("model", "มีลำโพงยี่ห้อนี้และรุ่นนี้อยู่แล้ว");
}
