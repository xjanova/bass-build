using System.Net;
using System.Net.Http.Json;

namespace BassBuild.Server.Tests;

public sealed class SettingsTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task Missing_setting_is_404_then_put_and_overwrite()
    {
        Assert.Equal(HttpStatusCode.NotFound, (await _client.GetAsync("/api/settings/units")).StatusCode);

        Assert.Equal(HttpStatusCode.OK, (await _client.PutAsJsonAsync("/api/settings/units", new { value = "metric" })).StatusCode);
        Assert.Equal("metric", (await (await _client.GetAsync("/api/settings/units")).Json()).GetProperty("value").GetString());

        var res = await _client.PutAsJsonAsync("/api/settings/units", new { value = "ไทย" });
        Assert.Equal("ไทย", (await res.Json()).GetProperty("value").GetString());
        Assert.Equal("ไทย", (await (await _client.GetAsync("/api/settings/units")).Json()).GetProperty("value").GetString());
    }

    [Fact]
    public async Task Put_without_value_is_rejected()
    {
        var res = await _client.PutAsJsonAsync("/api/settings/lang", new { });
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.Equal("value", (await res.Json()).GetProperty("field").GetString());
    }
}
