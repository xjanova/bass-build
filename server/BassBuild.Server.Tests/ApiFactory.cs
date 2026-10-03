using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;

namespace BassBuild.Server.Tests;

/// <summary>Boots the real app against a throwaway SQLite file. xUnit creates one per test class (IClassFixture).</summary>
public class ApiFactory : WebApplicationFactory<Program>
{
    public ApiFactory() : this(TempDb.NewPath()) { }

    internal ApiFactory(string dbPath) => DbPath = dbPath;

    public string DbPath { get; }

    /// <summary>Set when the test owns the file's lifetime (e.g. two app instances on one database).</summary>
    public bool KeepDatabase { get; init; }

    protected override void ConfigureWebHost(IWebHostBuilder builder) => builder.UseSetting("BassBuild:DbPath", DbPath);

    public SqliteConnection OpenDb()
    {
        var c = new SqliteConnection($"Data Source={DbPath}");
        c.Open();
        return c;
    }

    public override async ValueTask DisposeAsync()
    {
        await base.DisposeAsync();
        if (!KeepDatabase) TempDb.Delete(DbPath);
    }
}

public static class TempDb
{
    public static string NewPath() => Path.Combine(Path.GetTempPath(), $"bassbuild-test-{Guid.NewGuid():N}.db");

    public static void Delete(string path)
    {
        SqliteConnection.ClearAllPools(); // pooled handles would keep the file locked on Windows
        foreach (var file in new[] { path, path + "-wal", path + "-shm" })
            File.Delete(file);
    }

    public static string SeedDir => Path.Combine(Db.FindRepoRoot(AppContext.BaseDirectory), "data", "seed");
}

public static class Http
{
    public static async Task<JsonElement> Json(this HttpResponseMessage response) =>
        await response.Content.ReadFromJsonAsync<JsonElement>();

    public static object ValidDriver(string model, double fs = 30) => new
    {
        brand = "Test Brand",
        model,
        category = "sub",
        sizeIn = 12.0,
        fs,
        qts = 0.4,
        vasL = 50.0,
        re = 3.5,
        sdCm2 = 500.0,
        xmaxMm = 12.0,
        peW = 500.0,
    };
}
