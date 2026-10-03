using System.Net;
using System.Net.Http.Json;
using System.Text;

namespace BassBuild.Server.Tests;

public sealed class DriverTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    readonly HttpClient _client = factory.CreateClient();

    async Task AssertValidation(HttpResponseMessage res, string field, string? message = null)
    {
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        var body = await res.Json();
        Assert.Equal("validation", body.GetProperty("error").GetString());
        Assert.Equal(field, body.GetProperty("field").GetString());
        if (message is not null) Assert.Equal(message, body.GetProperty("message").GetString());
    }

    [Fact]
    public async Task Post_with_negative_fs_is_rejected_on_fs()
    {
        var res = await _client.PostAsJsonAsync("/api/drivers", Http.ValidDriver("NEG-FS", fs: -1));
        await AssertValidation(res, "fs", "ค่า Fs ต้องอยู่ระหว่าง 1 ถึง 20000 Hz");
    }

    [Fact]
    public async Task Post_reports_first_invalid_field()
    {
        await AssertValidation(await _client.PostAsJsonAsync("/api/drivers", new { brand = "X", category = "sub", fs = 30 }), "model", "ต้องกรอกชื่อรุ่น");
        await AssertValidation(await _client.PostAsJsonAsync("/api/drivers", new { brand = "X", model = "Y", category = "horn", fs = 30 }), "category");
        await AssertValidation(await _client.PostAsJsonAsync("/api/drivers", new { brand = "X", model = "Y", category = "sub", sourceKind = "guess", fs = 30 }), "sourceKind");
        await AssertValidation(await _client.PostAsJsonAsync("/api/drivers", new { brand = "X", model = "Y", category = "sub" }), "fs", "ต้องกรอกค่า Fs");
        await AssertValidation(await _client.PostAsJsonAsync("/api/drivers", new { brand = new string('b', 121), model = "Y", category = "sub", fs = 30 }), "brand");
        await AssertValidation(await _client.PostAsJsonAsync("/api/drivers", new { brand = "X", model = "Y", category = "sub", fs = 30, notes = new string('n', 2001) }), "notes");
        await AssertValidation(await _client.PostAsJsonAsync("/api/drivers", new { brand = "X", model = "Y", category = "sub", fs = 30, qts = 0.01 }), "qts");
        await AssertValidation(await _client.PostAsJsonAsync("/api/drivers", new { brand = "X", model = "Y", category = "sub", fs = 30, sizeIn = 40 }), "sizeIn");
        await AssertValidation(await _client.PostAsJsonAsync("/api/drivers", new { brand = "X", model = "Y", category = "sub", fs = 30, sourceUrl = "javascript:alert(1)" }), "sourceUrl");
    }

    [Fact]
    public async Task Crud_roundtrip_maintains_defaults_and_timestamps()
    {
        var created = await _client.PostAsJsonAsync("/api/drivers", Http.ValidDriver("CRUD-1"));
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var d = await created.Json();
        var id = d.GetProperty("id").GetInt64();
        Assert.Equal($"/api/drivers/{id}", created.Headers.Location?.ToString());
        Assert.Equal("user", d.GetProperty("sourceKind").GetString());
        Assert.False(d.GetProperty("verified").GetBoolean());
        var createdAt = d.GetProperty("createdAt").GetString()!;
        Assert.Matches(@"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$", createdAt);
        Assert.Equal(createdAt, d.GetProperty("updatedAt").GetString());

        var got = await (await _client.GetAsync($"/api/drivers/{id}")).Json();
        Assert.Equal("CRUD-1", got.GetProperty("model").GetString());

        await Task.Delay(5);
        var put = await _client.PutAsJsonAsync($"/api/drivers/{id}", Http.ValidDriver("CRUD-1", fs: 41));
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);
        var updated = await put.Json();
        Assert.Equal(41, updated.GetProperty("fs").GetDouble());
        Assert.Equal(createdAt, updated.GetProperty("createdAt").GetString());
        Assert.True(string.CompareOrdinal(updated.GetProperty("updatedAt").GetString(), createdAt) > 0);

        Assert.Equal(HttpStatusCode.NoContent, (await _client.DeleteAsync($"/api/drivers/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await _client.GetAsync($"/api/drivers/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await _client.DeleteAsync($"/api/drivers/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await _client.PutAsJsonAsync($"/api/drivers/{id}", Http.ValidDriver("CRUD-1"))).StatusCode);
    }

    [Fact]
    public async Task Duplicate_brand_and_model_is_409_on_post_and_put()
    {
        Assert.Equal(HttpStatusCode.Created, (await _client.PostAsJsonAsync("/api/drivers", Http.ValidDriver("DUP-1"))).StatusCode);
        var dup = await _client.PostAsJsonAsync("/api/drivers", Http.ValidDriver("DUP-1"));
        Assert.Equal(HttpStatusCode.Conflict, dup.StatusCode);
        Assert.Equal("conflict", (await dup.Json()).GetProperty("error").GetString());

        var other = await (await _client.PostAsJsonAsync("/api/drivers", Http.ValidDriver("DUP-2"))).Json();
        var rename = await _client.PutAsJsonAsync($"/api/drivers/{other.GetProperty("id").GetInt64()}", Http.ValidDriver("DUP-1"));
        Assert.Equal(HttpStatusCode.Conflict, rename.StatusCode);
    }

    [Theory]
    [InlineData("{ \"brand\": ")]
    [InlineData("not json")]
    [InlineData("[1, 2]")]
    [InlineData("{ \"fs\": \"abc\" }")]
    [InlineData("")]
    public async Task Malformed_json_is_bad_json(string raw)
    {
        var res = await _client.PostAsync("/api/drivers", new StringContent(raw, Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        var body = await res.Json();
        Assert.Equal("bad_json", body.GetProperty("error").GetString());
        Assert.Equal("ข้อมูลไม่ใช่ JSON ที่ถูกต้อง", body.GetProperty("message").GetString());
    }

    [Fact]
    public async Task Overflowing_number_is_rejected_as_not_finite()
    {
        var raw = "{\"brand\":\"X\",\"model\":\"INF\",\"category\":\"sub\",\"fs\":1e999}";
        var res = await _client.PostAsync("/api/drivers", new StringContent(raw, Encoding.UTF8, "application/json"));
        await AssertValidation(res, "fs", "ค่า Fs ต้องเป็นตัวเลขที่ถูกต้อง");
    }

    [Fact]
    public async Task Wrong_method_on_known_route_is_405_not_404()
    {
        Assert.Equal(HttpStatusCode.MethodNotAllowed, (await _client.PatchAsync("/api/drivers", null)).StatusCode);
    }

    [Fact]
    public async Task Body_over_4mb_is_rejected()
    {
        var huge = "{\"notes\":\"" + new string('x', 4 * 1024 * 1024 + 10) + "\"}";
        var res = await _client.PostAsync("/api/drivers", new StringContent(huge, Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, res.StatusCode);
        Assert.Equal("too_large", (await res.Json()).GetProperty("error").GetString());
    }

    [Fact]
    public async Task Non_json_content_type_is_415()
    {
        var res = await _client.PostAsync("/api/drivers", new StringContent("brand=x", Encoding.UTF8, "text/plain"));
        Assert.Equal(HttpStatusCode.UnsupportedMediaType, res.StatusCode);
    }
}
