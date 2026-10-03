using Dapper;

namespace BassBuild.Server;

public sealed record SettingInput(string? Value);

public sealed class Setting
{
    public string Key { get; set; } = "";
    public string? Value { get; set; }
}

public static class SettingsEndpoints
{
    public static void Map(IEndpointRouteBuilder api)
    {
        api.MapGet("/settings/{key}", (string key, Db db) =>
            db.Query<Setting>("SELECT key, value FROM settings WHERE key = @key", new { key }).FirstOrDefault() is { } s
                ? Results.Ok(s)
                : Api.NotFound("ไม่พบการตั้งค่านี้"));

        api.MapPut("/settings/{key}", (string key, SettingInput input, Db db) =>
        {
            if (Validation.Setting(key, input) is { } error) return Api.Invalid(error);
            using var c = db.Open();
            c.Execute("INSERT INTO settings(key, value) VALUES (@key, @value) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                new { key, value = input.Value });
            return Results.Ok(new Setting { Key = key, Value = input.Value });
        });
    }
}
