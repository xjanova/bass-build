using System.Net;
using System.Net.Http.Json;

namespace BassBuild.Server.Tests;

public sealed class MediaTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    readonly HttpClient _client = factory.CreateClient();

    // Smallest real files of each type (headers are what the server checks).
    static readonly byte[] Jpeg = [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0xFF, 0xD9];
    static readonly byte[] Png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D];

    async Task<long> NewDriver(string model)
    {
        var res = await _client.PostAsJsonAsync("/api/drivers", Http.ValidDriver(model));
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        return (await res.Json()).GetProperty("id").GetInt64();
    }

    [Fact]
    public async Task Shape_and_image_link_roundtrip_and_are_checked()
    {
        var ok = await _client.PostAsJsonAsync("/api/drivers", new
        {
            brand = "X", model = "SHAPE-1", category = "sub", fs = 30,
            imageUrl = "https://example.com/a.jpg",
            shape = new { coneMm = 260.0, surroundMm = 30.0, dustcapMm = 110.0, magnetMm = 180.0, magnetHeightMm = 50.0, boltHoles = 8 }
        });
        Assert.Equal(HttpStatusCode.Created, ok.StatusCode);
        var d = await ok.Json();
        Assert.Equal("https://example.com/a.jpg", d.GetProperty("imageUrl").GetString());
        Assert.Equal(260, d.GetProperty("shape").GetProperty("coneMm").GetDouble());

        var badKey = await _client.PostAsJsonAsync("/api/drivers", new { brand = "X", model = "SHAPE-2", category = "sub", fs = 30, shape = new { colour = 1 } });
        Assert.Equal("shape", (await badKey.Json()).GetProperty("field").GetString());
        var badRange = await _client.PostAsJsonAsync("/api/drivers", new { brand = "X", model = "SHAPE-3", category = "sub", fs = 30, shape = new { coneMm = 5000 } });
        Assert.Equal("shape", (await badRange.Json()).GetProperty("field").GetString());
        var badUrl = await _client.PostAsJsonAsync("/api/drivers", new { brand = "X", model = "SHAPE-4", category = "sub", fs = 30, imageUrl = "javascript:alert(1)" });
        Assert.Equal("imageUrl", (await badUrl.Json()).GetProperty("field").GetString());
    }

    [Fact]
    public async Task Photo_upload_replace_read_and_delete()
    {
        var id = await NewDriver("MEDIA-1");
        var marks = new { circle = new[] { new[] { 10.0, 20.0 }, new[] { 30.0, 40.0 }, new[] { 50.0, 20.0 } } };
        var put = await _client.PutAsJsonAsync($"/api/drivers/{id}/media/front", new { mime = "image/jpeg", data = Convert.ToBase64String(Jpeg), marks });
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);
        Assert.Equal(Jpeg.Length, (await put.Json()).GetProperty("bytes").GetInt64());

        var list = await (await _client.GetAsync($"/api/drivers/{id}/media")).Json();
        Assert.Equal(1, list.GetArrayLength());
        Assert.Equal(3, list[0].GetProperty("marks").GetProperty("circle").GetArrayLength());

        var img = await _client.GetAsync($"/api/drivers/{id}/media/front");
        Assert.Equal("image/jpeg", img.Content.Headers.ContentType?.MediaType);
        Assert.Equal("nosniff", img.Headers.GetValues("X-Content-Type-Options").Single());
        Assert.Equal(Jpeg, await img.Content.ReadAsByteArrayAsync());

        // Same angle again replaces the photo.
        await _client.PutAsJsonAsync($"/api/drivers/{id}/media/front", new { mime = "image/png", data = Convert.ToBase64String(Png) });
        Assert.Equal("image/png", (await _client.GetAsync($"/api/drivers/{id}/media/front")).Content.Headers.ContentType?.MediaType);

        Assert.Equal(HttpStatusCode.NoContent, (await _client.DeleteAsync($"/api/drivers/{id}/media/front")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await _client.GetAsync($"/api/drivers/{id}/media/front")).StatusCode);
    }

    [Fact]
    public async Task Rejects_unknown_angles_fake_images_and_missing_drivers()
    {
        var id = await NewDriver("MEDIA-2");
        var html = Convert.ToBase64String("<html><script>alert(1)</script></html>"u8.ToArray());
        var fake = await _client.PutAsJsonAsync($"/api/drivers/{id}/media/front", new { mime = "image/jpeg", data = html });
        Assert.Equal("data", (await fake.Json()).GetProperty("field").GetString());
        var svg = await _client.PutAsJsonAsync($"/api/drivers/{id}/media/front", new { mime = "image/svg+xml", data = html });
        Assert.Equal("mime", (await svg.Json()).GetProperty("field").GetString());
        var angle = await _client.PutAsJsonAsync($"/api/drivers/{id}/media/top", new { mime = "image/jpeg", data = Convert.ToBase64String(Jpeg) });
        Assert.Equal("angle", (await angle.Json()).GetProperty("field").GetString());
        var nobody = await _client.PutAsJsonAsync("/api/drivers/999999/media/front", new { mime = "image/jpeg", data = Convert.ToBase64String(Jpeg) });
        Assert.Equal(HttpStatusCode.NotFound, nobody.StatusCode);
    }

    [Fact]
    public async Task Deleting_a_driver_deletes_its_photos()
    {
        var id = await NewDriver("MEDIA-3");
        await _client.PutAsJsonAsync($"/api/drivers/{id}/media/rear", new { mime = "image/jpeg", data = Convert.ToBase64String(Jpeg) });
        Assert.Equal(HttpStatusCode.NoContent, (await _client.DeleteAsync($"/api/drivers/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await _client.GetAsync($"/api/drivers/{id}/media/rear")).StatusCode);
    }
}
