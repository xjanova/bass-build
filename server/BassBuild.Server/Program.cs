using BassBuild.Server;
using Microsoft.Extensions.FileProviders;

var builder = WebApplication.CreateBuilder(args);
var repoRoot = Db.FindRepoRoot(builder.Environment.ContentRootPath);

Api.EnsureLoopback(builder.Configuration["Urls"]);
builder.WebHost.ConfigureKestrel(k => k.Limits.MaxRequestBodySize = Api.MaxBodyBytes);
builder.Services.ConfigureHttpJsonOptions(o => Api.ConfigureJson(o.SerializerOptions));
// Bad request bodies become exceptions so Api.HandleException can answer with the JSON error contract.
builder.Services.Configure<RouteHandlerOptions>(o => o.ThrowOnBadRequest = true);
builder.Services.AddCors(o => o.AddDefaultPolicy(p => p
    .WithOrigins("http://127.0.0.1:5173", "http://localhost:5173")
    .AllowAnyMethod()
    .AllowAnyHeader()));
// Resolved after Build() so configuration overrides (tests, env) are already applied.
builder.Services.AddSingleton(sp => new Db(Db.ResolvePath(sp.GetRequiredService<IConfiguration>(), repoRoot)));

var app = builder.Build();

var db = app.Services.GetRequiredService<Db>();
app.Logger.LogInformation("Database: {DbPath}", db.FilePath);
db.Migrate();
var seedDir = app.Configuration["BassBuild:SeedDir"];
db.Seed(string.IsNullOrWhiteSpace(seedDir) ? Path.Combine(repoRoot, "data", "seed") : seedDir, app.Logger);

app.UseCors();
app.UseExceptionHandler(new ExceptionHandlerOptions
{
    ExceptionHandler = Api.HandleException,
    SuppressDiagnosticsCallback = c => c.Exception is BadHttpRequestException, // client mistakes, not server faults
});
app.Use(Api.LimitBodySize);
// Unmatched /api paths get a JSON 404 here rather than via MapFallback: a fallback endpoint would also
// win over the 405/415 endpoints routing selects for a known path with the wrong method or content type.
app.Use((ctx, next) => ctx.GetEndpoint() is null && ctx.Request.Path.StartsWithSegments("/api")
    ? Api.NotFound("ไม่พบ API นี้").ExecuteAsync(ctx)
    : next(ctx));

var webDist = app.Configuration["BassBuild:WebDist"];
var dist = string.IsNullOrWhiteSpace(webDist) ? Path.Combine(repoRoot, "apps", "web", "dist") : webDist;
if (File.Exists(Path.Combine(dist, "index.html")))
{
    var files = new PhysicalFileProvider(Path.GetFullPath(dist));
    app.UseDefaultFiles(new DefaultFilesOptions { FileProvider = files });
    app.UseStaticFiles(new StaticFileOptions { FileProvider = files });
    // SPA fallback: extension-less GETs that matched no endpoint and no file get index.html (/api never gets here).
    app.Use((ctx, next) =>
    {
        if (ctx.GetEndpoint() is not null || !HttpMethods.IsGet(ctx.Request.Method) || Path.HasExtension(ctx.Request.Path.Value))
            return next(ctx);
        ctx.Response.ContentType = "text/html; charset=utf-8";
        return ctx.Response.SendFileAsync(files.GetFileInfo("index.html"));
    });
}

var api = app.MapGroup("/api");
CatalogEndpoints.Map(api);
DriverEndpoints.Map(api);
MediaEndpoints.Map(api);
ProjectEndpoints.Map(api);
SettingsEndpoints.Map(api);

app.Run();
