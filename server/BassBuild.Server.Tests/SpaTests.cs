using System.Net;
using System.Text;
using Microsoft.AspNetCore.Hosting;

namespace BassBuild.Server.Tests;

/// <summary>App with a fake built frontend (BassBuild:WebDist) in a temp folder.</summary>
public sealed class SpaFactory : ApiFactory
{
    public string Dist { get; } = Path.Combine(Path.GetTempPath(), $"bassbuild-dist-{Guid.NewGuid():N}");

    public SpaFactory()
    {
        Directory.CreateDirectory(Path.Combine(Dist, "assets"));
        File.WriteAllText(Path.Combine(Dist, "index.html"), "<!doctype html><title>spa-index</title>");
        File.WriteAllText(Path.Combine(Dist, "assets", "app.js"), "console.log('app')");
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.UseSetting("BassBuild:WebDist", Dist);
    }

    public override async ValueTask DisposeAsync()
    {
        await base.DisposeAsync();
        Directory.Delete(Dist, recursive: true);
    }
}

public sealed class SpaTests(SpaFactory factory) : IClassFixture<SpaFactory>
{
    readonly HttpClient _client = factory.CreateClient();

    [Theory]
    [InlineData("/")]
    [InlineData("/designs/42")]
    public async Task Client_routes_get_index_html(string path)
    {
        var res = await _client.GetAsync(path);
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Equal("text/html", res.Content.Headers.ContentType?.MediaType);
        Assert.Contains("spa-index", await res.Content.ReadAsStringAsync(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Static_assets_are_served_and_missing_ones_404()
    {
        Assert.Equal("console.log('app')", await _client.GetStringAsync("/assets/app.js"));
        Assert.Equal(HttpStatusCode.NotFound, (await _client.GetAsync("/assets/missing.js")).StatusCode);
    }

    [Fact]
    public async Task Api_paths_never_fall_back_to_index()
    {
        var unknown = await _client.GetAsync("/api/nope");
        Assert.Equal(HttpStatusCode.NotFound, unknown.StatusCode);
        Assert.Equal("not_found", (await unknown.Json()).GetProperty("error").GetString());

        Assert.True((await (await _client.GetAsync("/api/health")).Json()).GetProperty("ok").GetBoolean());

        var wrongType = await _client.PostAsync("/api/drivers", new StringContent("x", Encoding.UTF8, "text/plain"));
        Assert.Equal(HttpStatusCode.UnsupportedMediaType, wrongType.StatusCode);
    }
}
