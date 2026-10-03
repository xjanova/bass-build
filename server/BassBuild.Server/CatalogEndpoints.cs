using Dapper;

namespace BassBuild.Server;

public sealed class PanelMaterial
{
    public long Id { get; set; }
    public string Key { get; set; } = "";
    public string Name { get; set; } = "";
    public string? NameTh { get; set; }
    public string? Category { get; set; }
    public double? DensityKgM3 { get; set; }
    public double? EGpa { get; set; }
    public double? ECrossGpa { get; set; }
    public double? Poisson { get; set; }
    public double? LossFactor { get; set; }
    public double[]? ThicknessesMm { get; set; }
    public double? SheetWMm { get; set; }
    public double? SheetHMm { get; set; }
    public double? PricePerSheetThb { get; set; }
    public string? Notes { get; set; }
}

public sealed class DampingMaterial
{
    public long Id { get; set; }
    public string Key { get; set; } = "";
    public string Name { get; set; } = "";
    public string? NameTh { get; set; }
    public string? Kind { get; set; }
    public double? DensityKgM3 { get; set; }
    public double? FlowResistivityMin { get; set; }
    public double? FlowResistivityMax { get; set; }
    public double? FillGPerLMin { get; set; }
    public double? FillGPerLMax { get; set; }
    public double? Porosity { get; set; }
    public string? Notes { get; set; }
}

public sealed class Hardware
{
    public long Id { get; set; }
    public string Key { get; set; } = "";
    public string Kind { get; set; } = "";
    public string Name { get; set; } = "";
    public double? OdMm { get; set; }
    public double? IdMm { get; set; }
    public bool Verified { get; set; }
    public string? Notes { get; set; }
}

/// <summary>Health plus the read-only reference catalogs.</summary>
public static class CatalogEndpoints
{
    public const string Version = "0.1.0";

    public static void Map(IEndpointRouteBuilder api)
    {
        api.MapGet("/health", (Db db) =>
        {
            using var c = db.Open();
            return new { ok = true, version = Version, drivers = c.ExecuteScalar<long>("SELECT COUNT(*) FROM drivers") };
        });
        api.MapGet("/materials/panels", (Db db) => db.Query<PanelMaterial>("SELECT * FROM panel_materials ORDER BY id"));
        api.MapGet("/materials/damping", (Db db) => db.Query<DampingMaterial>("SELECT * FROM damping_materials ORDER BY id"));
        api.MapGet("/hardware", (Db db) => db.Query<Hardware>("SELECT * FROM hardware ORDER BY id"));
    }
}
