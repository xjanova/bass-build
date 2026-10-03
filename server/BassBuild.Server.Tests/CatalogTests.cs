using System.Net;
using System.Text.Json;

namespace BassBuild.Server.Tests;

/// <summary>Read-only checks against the seeded catalog (this class never writes).</summary>
public sealed class CatalogTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    readonly HttpClient _client = factory.CreateClient();

    async Task<JsonElement> GetJson(string url)
    {
        var res = await _client.GetAsync(url);
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        return await res.Json();
    }

    async Task<string[]> Models(string query) =>
        (await GetJson("/api/drivers" + query)).EnumerateArray().Select(d => d.GetProperty("model").GetString()!).ToArray();

    [Fact]
    public async Task Health_reports_ok_version_and_driver_count_only()
    {
        var body = await GetJson("/api/health");
        Assert.Equal(["ok", "version", "drivers"], body.EnumerateObject().Select(p => p.Name).ToArray());
        Assert.True(body.GetProperty("ok").GetBoolean());
        Assert.Equal("0.1.0", body.GetProperty("version").GetString());
        Assert.Equal(8, body.GetProperty("drivers").GetInt32());
    }

    [Fact]
    public async Task Seeded_catalogs_have_expected_counts_and_shapes()
    {
        var panels = await GetJson("/api/materials/panels");
        Assert.Equal(16, panels.GetArrayLength());
        var mdf = panels.EnumerateArray().Single(p => p.GetProperty("key").GetString() == "mdf");
        Assert.Equal([9, 12, 15, 16, 18, 19, 25], mdf.GetProperty("thicknessesMm").EnumerateArray().Select(t => t.GetDouble()).ToArray());
        Assert.Equal(3.5, mdf.GetProperty("eGpa").GetDouble());
        Assert.Equal(JsonValueKind.Null, mdf.GetProperty("pricePerSheetThb").ValueKind); // nulls are serialized, not dropped

        var damping = await GetJson("/api/materials/damping");
        Assert.Equal(9, damping.GetArrayLength());
        Assert.True(damping[0].TryGetProperty("fillGPerLMin", out _));

        var hardware = await GetJson("/api/hardware");
        Assert.Equal(10, hardware.GetArrayLength());
        Assert.Equal(JsonValueKind.False, hardware[0].GetProperty("verified").ValueKind);
        Assert.Equal(60, hardware[0].GetProperty("odMm").GetDouble());
    }

    [Fact]
    public async Task Driver_dto_uses_seed_property_names()
    {
        var d = (await GetJson("/api/drivers?q=PA-18"))[0];
        foreach (var name in new[] { "id", "brand", "model", "category", "kindTh", "sizeIn", "fs", "qts", "vasL", "leMh", "cmsMmPerN",
                     "sdCm2", "zNom", "rthVc", "sourceKind", "sourceUrl", "verified", "notes", "createdAt", "updatedAt" })
            Assert.True(d.TryGetProperty(name, out _), $"missing {name}");
        Assert.Equal("sample", d.GetProperty("sourceKind").GetString());
        Assert.Equal(JsonValueKind.False, d.GetProperty("verified").ValueKind);
    }

    [Fact]
    public async Task Search_q_PA_returns_two()
    {
        Assert.Equal(["PA-18", "PA-21"], await Models("?q=PA"));
    }

    [Theory]
    [InlineData("%")]
    [InlineData("_")]
    [InlineData("\\")]
    [InlineData("%%")]
    public async Task Search_treats_like_wildcards_literally(string q)
    {
        Assert.Empty(await Models("?q=" + Uri.EscapeDataString(q)));
    }

    [Fact]
    public async Task Search_matches_thai_kind()
    {
        Assert.Equal(4, (await Models("?q=" + Uri.EscapeDataString("ซับ"))).Length);
    }

    [Fact]
    public async Task List_is_ordered_by_size_then_model_and_filters_combine()
    {
        Assert.Equal(["FR-5", "HF-8", "HF-10", "SPL-12", "SQ-12", "SPL-15", "PA-18", "PA-21"], await Models(""));
        Assert.Equal(["HF-10", "SPL-12", "SQ-12", "SPL-15"], await Models("?category=sub"));
        Assert.Equal(["SPL-12", "SQ-12"], await Models("?category=sub&sizeIn=12"));
        Assert.Equal(["FR-5"], await Models("?sizeIn=5"));
    }

    [Theory]
    [InlineData("?sizeIn=abc", "sizeIn")]
    [InlineData("?category=bogus", "category")]
    public async Task Search_rejects_bad_filters(string query, string field)
    {
        var res = await _client.GetAsync("/api/drivers" + query);
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        var body = await res.Json();
        Assert.Equal("validation", body.GetProperty("error").GetString());
        Assert.Equal(field, body.GetProperty("field").GetString());
    }

    [Fact]
    public async Task Unknown_api_route_is_json_404()
    {
        var res = await _client.GetAsync("/api/nope");
        Assert.Equal(HttpStatusCode.NotFound, res.StatusCode);
        Assert.Equal("not_found", (await res.Json()).GetProperty("error").GetString());
    }
}
