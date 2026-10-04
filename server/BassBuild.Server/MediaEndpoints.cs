using System.Text.Json;
using Dapper;

namespace BassBuild.Server;

/// <summary>Body of PUT /api/drivers/{id}/media/{angle}: the image as base64 plus its alignment marks.</summary>
public sealed record MediaInput(string? Mime, string? Data, JsonElement? Marks);

public sealed class MediaInfo
{
    public string Angle { get; set; } = "";
    public string Mime { get; set; } = "";
    public long Bytes { get; set; }
    public JsonElement? Marks { get; set; }
    public string UpdatedAt { get; set; } = "";
}

/// <summary>The user's photos of a driver, one per angle the 3D model needs.</summary>
public static class MediaEndpoints
{
    public static void Map(IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/drivers/{id:long}/media");

        g.MapGet("", (long id, Db db) =>
        {
            using var c = db.Open();
            if (!DriverExists(c, id)) return NotFound();
            return Results.Ok(c.Query<MediaInfo>(
                "SELECT angle, mime, length(data) AS bytes, marks, updated_at FROM driver_media WHERE driver_id = @id ORDER BY angle", new { id }).AsList());
        });

        g.MapGet("/{angle}", (long id, string angle, Db db, HttpContext ctx) =>
        {
            using var c = db.Open();
            var row = c.QueryFirstOrDefault<(string Mime, byte[] Data)>("SELECT mime, data FROM driver_media WHERE driver_id = @id AND angle = @angle", new { id, angle });
            if (row.Data is null) return Api.NotFound("ไม่พบรูปมุมนี้");
            // Stored bytes were checked to be the image type they claim; never let a browser guess otherwise.
            ctx.Response.Headers.XContentTypeOptions = "nosniff";
            ctx.Response.Headers.CacheControl = "no-cache";
            return Results.Bytes(row.Data, row.Mime);
        });

        g.MapPut("/{angle}", (long id, string angle, MediaInput input, Db db) =>
        {
            if (Validation.Media(angle, input, out var bytes, out var marks) is { } error) return Api.Invalid(error);
            using var c = db.Open();
            if (!DriverExists(c, id)) return NotFound();
            var now = Db.Now();
            c.Execute("""
                INSERT INTO driver_media(driver_id, angle, mime, data, marks, created_at, updated_at)
                VALUES (@id, @angle, @Mime, @bytes, @marks, @now, @now)
                ON CONFLICT(driver_id, angle) DO UPDATE SET mime = excluded.mime, data = excluded.data, marks = excluded.marks, updated_at = excluded.updated_at
                """, new { id, angle, input.Mime, bytes, marks, now });
            return Results.Ok(c.QuerySingle<MediaInfo>(
                "SELECT angle, mime, length(data) AS bytes, marks, updated_at FROM driver_media WHERE driver_id = @id AND angle = @angle", new { id, angle }));
        });

        g.MapDelete("/{angle}", (long id, string angle, Db db) =>
        {
            using var c = db.Open();
            return c.Execute("DELETE FROM driver_media WHERE driver_id = @id AND angle = @angle", new { id, angle }) > 0
                ? Results.NoContent()
                : Api.NotFound("ไม่พบรูปมุมนี้");
        });
    }

    static bool DriverExists(Microsoft.Data.Sqlite.SqliteConnection c, long id) =>
        c.ExecuteScalar<long>("SELECT COUNT(*) FROM drivers WHERE id = @id", new { id }) > 0;

    static IResult NotFound() => Api.NotFound("ไม่พบลำโพงนี้");
}
