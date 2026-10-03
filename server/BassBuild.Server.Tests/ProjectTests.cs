using System.Net;
using System.Net.Http.Json;
using Dapper;
using Microsoft.AspNetCore.Hosting;

namespace BassBuild.Server.Tests;

public sealed class ProjectTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task Create_update_lists_one_revision_and_delete_cascades()
    {
        var created = await _client.PostAsJsonAsync("/api/projects", new
        {
            name = "ตู้ซับ 12 นิ้ว",
            modelCode = "BB-12",
            data = new { volumeL = 50, ports = new[] { new { d = 100 } } },
        });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var p = await created.Json();
        var id = p.GetProperty("id").GetInt64();
        Assert.Equal("A", p.GetProperty("revision").GetString());
        Assert.Equal(50, p.GetProperty("data").GetProperty("volumeL").GetInt32()); // object, not a string

        var put = await _client.PutAsJsonAsync($"/api/projects/{id}", new { name = "ตู้ซับ 12 นิ้ว v2", modelCode = "BB-12", revision = "B", data = new { volumeL = 55 } });
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);
        var updated = await put.Json();
        Assert.Equal("B", updated.GetProperty("revision").GetString());
        Assert.Equal(55, updated.GetProperty("data").GetProperty("volumeL").GetInt32());

        var revisions = await (await _client.GetAsync($"/api/projects/{id}/revisions")).Json();
        Assert.Equal(1, revisions.GetArrayLength());
        Assert.Equal("A", revisions[0].GetProperty("revision").GetString());
        Assert.False(revisions[0].TryGetProperty("data", out _));

        var list = await (await _client.GetAsync("/api/projects")).Json();
        var item = list.EnumerateArray().Single(x => x.GetProperty("id").GetInt64() == id);
        Assert.False(item.TryGetProperty("data", out _));

        // The stored snapshot is the pre-update data.
        using (var c = factory.OpenDb())
            Assert.Contains("\"volumeL\":50", c.ExecuteScalar<string>("SELECT data FROM project_revisions WHERE project_id = @id", new { id }), StringComparison.Ordinal);

        Assert.Equal(HttpStatusCode.NoContent, (await _client.DeleteAsync($"/api/projects/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await _client.GetAsync($"/api/projects/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await _client.GetAsync($"/api/projects/{id}/revisions")).StatusCode);
        using (var c = factory.OpenDb())
            Assert.Equal(0L, c.ExecuteScalar<long>("SELECT COUNT(*) FROM project_revisions WHERE project_id = @id", new { id }));
    }

    [Fact]
    public async Task Put_without_revision_keeps_current_and_missing_project_is_404()
    {
        var p = await (await _client.PostAsJsonAsync("/api/projects", new { name = "Keep", revision = "C", data = new { } })).Json();
        var id = p.GetProperty("id").GetInt64();
        var updated = await (await _client.PutAsJsonAsync($"/api/projects/{id}", new { name = "Keep", data = new { x = 1 } })).Json();
        Assert.Equal("C", updated.GetProperty("revision").GetString());

        Assert.Equal(HttpStatusCode.NotFound, (await _client.PutAsJsonAsync("/api/projects/999999", new { name = "X", data = new { } })).StatusCode);
    }

    [Theory]
    [InlineData("{\"data\":{}}", "name")]
    [InlineData("{\"name\":\"   \",\"data\":{}}", "name")]
    [InlineData("{\"name\":\"X\"}", "data")]
    [InlineData("{\"name\":\"X\",\"data\":null}", "data")]
    [InlineData("{\"name\":\"X\",\"data\":[1,2]}", "data")]
    [InlineData("{\"name\":\"X\",\"data\":\"{}\"}", "data")]
    public async Task Invalid_project_is_rejected(string json, string field)
    {
        var res = await _client.PostAsync("/api/projects", new StringContent(json, System.Text.Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        var body = await res.Json();
        Assert.Equal("validation", body.GetProperty("error").GetString());
        Assert.Equal(field, body.GetProperty("field").GetString());
    }

    [Fact]
    public async Task Corrupt_row_gives_generic_500_without_stack_or_paths_in_production()
    {
        long id;
        using (var c = factory.OpenDb())
            id = c.ExecuteScalar<long>("INSERT INTO projects(name, data, created_at, updated_at) VALUES ('Broken', '{not json', 'x', 'x') RETURNING id");

        var client = factory.WithWebHostBuilder(b => b.UseEnvironment("Production")).CreateClient();
        var res = await client.GetAsync($"/api/projects/{id}");
        Assert.Equal(HttpStatusCode.InternalServerError, res.StatusCode);
        var text = await res.Content.ReadAsStringAsync();
        Assert.Equal("internal", (await res.Json()).GetProperty("error").GetString());
        // Ordinal on purpose: xUnit's default string search is culture-aware (ICU) and false-matches punctuation.
        Assert.DoesNotContain(" at ", text, StringComparison.Ordinal);
        Assert.DoesNotContain(":\\", text, StringComparison.Ordinal);
        Assert.DoesNotContain("Exception", text, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Project_data_over_2mb_is_rejected()
    {
        var res = await _client.PostAsJsonAsync("/api/projects", new { name = "Big", data = new { blob = new string('x', 2 * 1024 * 1024) } });
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.Equal("data", (await res.Json()).GetProperty("field").GetString());
    }
}
