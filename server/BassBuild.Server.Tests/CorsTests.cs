using System.Net;

namespace BassBuild.Server.Tests;

public sealed class CorsTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    readonly HttpClient _client = factory.CreateClient();

    Task<HttpResponseMessage> Preflight(string origin)
    {
        var req = new HttpRequestMessage(HttpMethod.Options, "/api/drivers");
        req.Headers.Add("Origin", origin);
        req.Headers.Add("Access-Control-Request-Method", "POST");
        req.Headers.Add("Access-Control-Request-Headers", "content-type");
        return _client.SendAsync(req);
    }

    [Theory]
    [InlineData("http://localhost:5173")]
    [InlineData("http://127.0.0.1:5173")]
    public async Task Preflight_from_vite_dev_server_is_allowed(string origin)
    {
        var res = await Preflight(origin);
        Assert.Equal(HttpStatusCode.NoContent, res.StatusCode);
        Assert.Equal(origin, Assert.Single(res.Headers.GetValues("Access-Control-Allow-Origin")));
        Assert.Contains("POST", string.Join(",", res.Headers.GetValues("Access-Control-Allow-Methods")), StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("http://evil.example")]
    [InlineData("http://localhost:5174")]
    public async Task Preflight_from_other_origins_is_not_allowed(string origin)
    {
        var res = await Preflight(origin);
        Assert.False(res.Headers.Contains("Access-Control-Allow-Origin"));
    }

    [Fact]
    public async Task Error_responses_still_carry_cors_headers()
    {
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/drivers")
        {
            Content = new StringContent("{ broken", System.Text.Encoding.UTF8, "application/json"),
        };
        req.Headers.Add("Origin", "http://localhost:5173");
        var res = await _client.SendAsync(req);
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.Equal("http://localhost:5173", Assert.Single(res.Headers.GetValues("Access-Control-Allow-Origin")));
    }
}
