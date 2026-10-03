using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.Unicode;
using Microsoft.AspNetCore.Diagnostics;

namespace BassBuild.Server;

/// <summary>Shared HTTP plumbing: JSON options, the error contract and request guards.</summary>
public static class Api
{
    public const long MaxBodyBytes = 4 * 1024 * 1024;

    public static readonly JsonSerializerOptions Json = ConfigureJson(new JsonSerializerOptions(JsonSerializerDefaults.Web));

    static readonly object BadJson = new { error = "bad_json", message = "ข้อมูลไม่ใช่ JSON ที่ถูกต้อง" };
    static readonly object TooLarge = new { error = "too_large", message = "ข้อมูลมีขนาดใหญ่เกิน 4 MB" };

    public static JsonSerializerOptions ConfigureJson(JsonSerializerOptions o)
    {
        o.Encoder = JavaScriptEncoder.Create(UnicodeRanges.All); // keep Thai readable; <, >, &, ' are still escaped
        o.DefaultIgnoreCondition = JsonIgnoreCondition.Never;
        return o;
    }

    public static IResult Invalid(ValidationError e) =>
        Results.BadRequest(new { error = "validation", field = e.Field, message = e.Message });

    public static IResult NotFound(string message) => Results.NotFound(new { error = "not_found", message });

    public static IResult Conflict(string field, string message) =>
        Results.Conflict(new { error = "conflict", field, message });

    /// <summary>Refuses to start on anything but loopback, whatever --urls / ASPNETCORE_URLS say.</summary>
    public static void EnsureLoopback(string? urls)
    {
        foreach (var raw in (urls ?? "").Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var normalized = raw.Replace("://*", "://wildcard.invalid").Replace("://+", "://wildcard.invalid");
            if (!Uri.TryCreate(normalized, UriKind.Absolute, out var uri) || !uri.IsLoopback)
                throw new InvalidOperationException($"Refusing to listen on '{raw}': Bass Build binds to loopback (127.0.0.1) only.");
        }
    }

    /// <summary>Rejects declared oversize bodies early; Kestrel's MaxRequestBodySize still covers chunked uploads.</summary>
    public static Task LimitBodySize(HttpContext ctx, RequestDelegate next) =>
        ctx.Request.ContentLength > MaxBodyBytes ? Write(ctx, StatusCodes.Status413PayloadTooLarge, TooLarge) : next(ctx);

    /// <summary>Exception → JSON error. Never echoes exception text, stack traces or paths; those stay in the log.</summary>
    public static Task HandleException(HttpContext ctx)
    {
        var ex = ctx.Features.Get<IExceptionHandlerFeature>()?.Error;
        (int Status, object Body) result = ex switch
        {
            BadHttpRequestException { StatusCode: StatusCodes.Status413PayloadTooLarge } => (413, TooLarge),
            BadHttpRequestException { StatusCode: StatusCodes.Status415UnsupportedMediaType } =>
                (415, new { error = "unsupported_media_type", message = "ต้องส่งข้อมูลแบบ application/json" }),
            // Minimal APIs only raise 400 here when the body is missing or cannot be read as the expected JSON.
            BadHttpRequestException { StatusCode: StatusCodes.Status400BadRequest } => (400, BadJson),
            BadHttpRequestException b => (b.StatusCode, new { error = "bad_request", message = "คำขอไม่ถูกต้อง" }),
            _ => (500, new { error = "internal", message = "เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์" }),
        };
        return Write(ctx, result.Status, result.Body);
    }

    static Task Write(HttpContext ctx, int status, object body)
    {
        ctx.Response.StatusCode = status;
        return ctx.Response.WriteAsJsonAsync(body, Json);
    }
}
