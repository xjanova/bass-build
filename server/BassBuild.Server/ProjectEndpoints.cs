using System.Text.Json;
using System.Text.Json.Serialization;
using Dapper;

namespace BassBuild.Server;

public sealed record ProjectInput(string? Name, string? ModelCode, string? Revision, JsonElement? Data);

/// <summary>Validated project fields; <see cref="Data"/> is the serialized JSON object.</summary>
public sealed record ProjectValues(string Name, string? ModelCode, string? Revision, string Data);

public class ProjectSummary
{
    public long Id { get; set; }
    public string Name { get; set; } = "";
    public string? ModelCode { get; set; }
    public string Revision { get; set; } = "A";
    public string CreatedAt { get; set; } = "";
    public string UpdatedAt { get; set; } = "";
}

public sealed class ProjectDetail : ProjectSummary
{
    [JsonPropertyOrder(1)] public JsonElement Data { get; set; }
}

public sealed class ProjectRevision
{
    public long Id { get; set; }
    public long ProjectId { get; set; }
    public string Revision { get; set; } = "";
    public string CreatedAt { get; set; } = "";
}

public static class ProjectEndpoints
{
    public static void Map(IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/projects");

        g.MapGet("", (Db db) => db.Query<ProjectSummary>(
            "SELECT id, name, model_code, revision, created_at, updated_at FROM projects ORDER BY updated_at DESC, id DESC"));

        g.MapGet("/{id:long}", (long id, Db db) =>
            db.Query<ProjectDetail>("SELECT * FROM projects WHERE id = @id", new { id }).FirstOrDefault() is { } p ? Results.Ok(p) : NotFound());

        g.MapPost("", (ProjectInput input, Db db) =>
        {
            if (Validation.Project(input, out var v) is { } error) return Api.Invalid(error);
            using var c = db.Open();
            var p = c.QuerySingle<ProjectDetail>("""
                INSERT INTO projects(name, model_code, revision, data, created_at, updated_at)
                VALUES (@Name, @ModelCode, COALESCE(@Revision, 'A'), @Data, @now, @now) RETURNING *
                """, new { v.Name, v.ModelCode, v.Revision, v.Data, now = Db.Now() });
            return Results.Created($"/api/projects/{p.Id}", p);
        });

        g.MapPut("/{id:long}", (long id, ProjectInput input, Db db) =>
        {
            if (Validation.Project(input, out var v) is { } error) return Api.Invalid(error);
            var now = Db.Now();
            using var c = db.Open();
            using var tx = c.BeginTransaction();
            // Snapshot the row being overwritten first; zero rows copied means the project does not exist.
            var copied = c.Execute("""
                INSERT INTO project_revisions(project_id, revision, data, created_at)
                SELECT id, revision, data, @now FROM projects WHERE id = @id
                """, new { id, now }, tx);
            if (copied == 0) return NotFound();
            var p = c.QuerySingle<ProjectDetail>("""
                UPDATE projects SET name = @Name, model_code = @ModelCode, revision = COALESCE(@Revision, revision),
                    data = @Data, updated_at = @now
                WHERE id = @id RETURNING *
                """, new { id, v.Name, v.ModelCode, v.Revision, v.Data, now }, tx);
            tx.Commit();
            return Results.Ok(p);
        });

        g.MapDelete("/{id:long}", (long id, Db db) =>
        {
            using var c = db.Open();
            return c.Execute("DELETE FROM projects WHERE id = @id", new { id }) > 0 ? Results.NoContent() : NotFound();
        });

        g.MapGet("/{id:long}/revisions", (long id, Db db) =>
        {
            using var c = db.Open();
            if (c.ExecuteScalar<long>("SELECT COUNT(*) FROM projects WHERE id = @id", new { id }) == 0) return NotFound();
            return Results.Ok(c.Query<ProjectRevision>(
                "SELECT id, project_id, revision, created_at FROM project_revisions WHERE project_id = @id ORDER BY id DESC", new { id }).AsList());
        });
    }

    static IResult NotFound() => Api.NotFound("ไม่พบโปรเจกต์นี้");
}
