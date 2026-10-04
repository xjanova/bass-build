using System.Globalization;
using System.Reflection;
using System.Text;
using System.Text.Json;

namespace BassBuild.Server;

public sealed record ValidationError(string Field, string Message);

/// <summary>Input rules. Messages are Thai because they are shown to the user as-is.</summary>
public static class Validation
{
    public static readonly string[] Categories = ["sub", "woofer", "mid", "fullrange", "pa", "tweeter"];
    public static readonly string[] SourceKinds = ["datasheet", "measured", "user", "estimated", "sample"];
    public static readonly string[] CoilWirings = ["series", "parallel"];
    public static readonly string[] MediaAngles = ["front", "side", "rear", "angle"];
    public static readonly string[] MediaTypes = ["image/jpeg", "image/png", "image/webp"];
    public const int MaxMediaBytes = 3_000_000;

    /// <summary>Measured driver geometry, mm (bolt holes as a count).</summary>
    public static readonly Dictionary<string, (string Label, double Min, double Max)> ShapeRanges = new()
    {
        ["coneMm"] = ("เส้นผ่านศูนย์กลางกรวย", 10, 1500),
        ["surroundMm"] = ("ความกว้างขอบยาง", 1, 200),
        ["dustcapMm"] = ("เส้นผ่านศูนย์กลางฝาครอบ", 5, 600),
        ["coneDepthMm"] = ("ความลึกกรวย", 1, 600),
        ["flangeMm"] = ("ความหนาขอบโครง", 1, 60),
        ["magnetMm"] = ("เส้นผ่านศูนย์กลางแม่เหล็ก", 10, 800),
        ["magnetHeightMm"] = ("ความสูงแม่เหล็ก", 5, 400),
        ["boltHoles"] = ("จำนวนรูน็อต", 0, 32),
        ["boltCircleMm"] = ("วงรูน็อต", 10, 1600),
    };
    public const int MaxProjectDataBytes = 2 * 1024 * 1024;

    // Label already carries its spacing so Thai and Latin labels both read naturally.
    static readonly (string Field, Func<DriverInput, double?> Get, string Label, double Min, double Max, string Unit)[] DriverRanges =
    [
        ("fs", d => d.Fs, "ค่า Fs ", 1, 20000, " Hz"),
        ("qts", d => d.Qts, "ค่า Qts ", 0.05, 10, ""),
        ("qes", d => d.Qes, "ค่า Qes ", 0.05, 10, ""),
        ("qms", d => d.Qms, "ค่า Qms ", 0.2, 100, ""),
        ("vasL", d => d.VasL, "ค่า Vas ", 0.01, 20000, " ลิตร"),
        ("re", d => d.Re, "ค่า Re ", 0.1, 100, " โอห์ม"),
        ("sdCm2", d => d.SdCm2, "ค่า Sd ", 1, 20000, " ตร.ซม."),
        ("xmaxMm", d => d.XmaxMm, "ค่า Xmax ", 0, 100, " มม."),
        ("peW", d => d.PeW, "กำลังขับ Pe ", 0, 100000, " W"),
        ("sizeIn", d => d.SizeIn, "ขนาดลำโพง", 0.5, 30, " นิ้ว"),
    ];

    static readonly Dictionary<string, string> RangeLabels = DriverRanges.ToDictionary(r => r.Field, r => r.Label);

    // Every numeric input, so a field added to DriverInput gets the finite check without edits here.
    static readonly (string Field, PropertyInfo Prop)[] DriverNumbers = typeof(DriverInput).GetProperties()
        .Where(p => p.PropertyType == typeof(double?))
        .Select(p => (JsonNamingPolicy.CamelCase.ConvertName(p.Name), p))
        .ToArray();

    /// <summary>Trims; whitespace-only becomes null.</summary>
    public static string? Clean(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    public static ValidationError? Driver(DriverInput d)
    {
        var error = Required(d.Brand, "brand", "ยี่ห้อ", 120)
            ?? Required(d.Model, "model", "ชื่อรุ่น", 120)
            ?? OneOf(d.Category, "category", "ประเภทลำโพง", Categories)
            ?? OneOf(d.SourceKind, "sourceKind", "แหล่งที่มาของข้อมูล", SourceKinds)
            ?? MaxLength(d.KindTh, "kindTh", "ชื่อประเภท", 120)
            ?? MaxLength(d.Coil, "coil", "ชนิดวอยซ์คอยล์", 120)
            ?? (d.CoilWiring is null ? null : OneOf(d.CoilWiring, "coilWiring", "การต่อคอยล์ตอนวัด T/S", CoilWirings))
            ?? MaxLength(d.SourceUrl, "sourceUrl", "ลิงก์ที่มา", 2000)
            ?? MaxLength(d.Notes, "notes", "หมายเหตุ", 2000);
        if (error is not null) return error;

        // Rendered as a link by the UI, so only web URLs are accepted (no javascript:, file:, ...).
        if (d.SourceUrl is { } url && !IsWebUrl(url))
            return new("sourceUrl", "ลิงก์ที่มาต้องขึ้นต้นด้วย http:// หรือ https://");
        if (MaxLength(d.ImageUrl, "imageUrl", "ลิงก์รูป", 2000) is { } imageError) return imageError;
        if (d.ImageUrl is { } img && !IsWebUrl(img))
            return new("imageUrl", "ลิงก์รูปต้องขึ้นต้นด้วย http:// หรือ https://");
        if (Shape(d.Shape) is { } shapeError) return shapeError;

        // JSON cannot carry NaN, but an overflowing literal such as 1e999 deserializes to Infinity.
        foreach (var (field, prop) in DriverNumbers)
            if (prop.GetValue(d) is double v && !double.IsFinite(v))
                return new(field, $"{RangeLabels.GetValueOrDefault(field, $"ค่า {field} ")}ต้องเป็นตัวเลขที่ถูกต้อง");

        if (d.Fs is null) return new("fs", "ต้องกรอกค่า Fs");

        foreach (var (field, get, label, min, max, unit) in DriverRanges)
            if (get(d) is double v && (v < min || v > max))
                return new(field, $"{label}ต้องอยู่ระหว่าง {Num(min)} ถึง {Num(max)}{unit}");

        return null;
    }

    static bool IsWebUrl(string url) =>
        Uri.TryCreate(url, UriKind.Absolute, out var uri) && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps);

    static ValidationError? Shape(JsonElement? shape)
    {
        if (shape is not { } s) return null;
        if (s.ValueKind != JsonValueKind.Object) return new("shape", "ขนาดที่วัด (shape) ต้องเป็นออบเจกต์ JSON");
        foreach (var p in s.EnumerateObject())
        {
            if (!ShapeRanges.TryGetValue(p.Name, out var r)) return new("shape", $"ไม่รู้จักขนาด {p.Name}");
            if (p.Value.ValueKind == JsonValueKind.Null) continue;
            if (p.Value.ValueKind != JsonValueKind.Number || !p.Value.TryGetDouble(out var v) || !double.IsFinite(v) || v < r.Min || v > r.Max)
                return new("shape", $"{r.Label}ต้องอยู่ระหว่าง {Num(r.Min)} ถึง {Num(r.Max)}{(p.Name == "boltHoles" ? "" : " มม.")}");
        }
        return null;
    }

    /// <summary>
    /// A photo upload: a known angle, a JPEG/PNG/WebP whose bytes really are that type (so nothing
    /// else can be served back under an image name), at most 3 MB, and small alignment marks.
    /// </summary>
    public static ValidationError? Media(string angle, MediaInput m, out byte[] bytes, out string? marks)
    {
        bytes = [];
        marks = null;
        if (!MediaAngles.Contains(angle)) return new("angle", $"มุมรูปต้องเป็นหนึ่งใน {string.Join(", ", MediaAngles)}");
        if (m.Mime is null || !MediaTypes.Contains(m.Mime)) return new("mime", "รูปต้องเป็น JPEG, PNG หรือ WebP");
        if (string.IsNullOrEmpty(m.Data)) return new("data", "ไม่มีข้อมูลรูป");
        var buffer = new byte[m.Data.Length * 3 / 4 + 3];
        if (!Convert.TryFromBase64String(m.Data, buffer, out var n)) return new("data", "ข้อมูลรูปไม่ใช่ base64 ที่ถูกต้อง");
        if (n > MaxMediaBytes) return new("data", "รูปต้องมีขนาดไม่เกิน 3 MB");
        bytes = buffer[..n];
        if (!LooksLike(bytes, m.Mime)) return new("data", "ไฟล์ไม่ตรงกับชนิดรูปที่ระบุ");
        if (m.Marks is { } k)
        {
            if (k.ValueKind is not (JsonValueKind.Object or JsonValueKind.Null)) return new("marks", "จุดจัดตำแหน่ง (marks) ต้องเป็นออบเจกต์ JSON");
            if (k.ValueKind == JsonValueKind.Object)
            {
                marks = JsonSerializer.Serialize(k, Api.Json);
                if (marks.Length > 4096) return new("marks", "จุดจัดตำแหน่งต้องมีขนาดไม่เกิน 4 KB");
            }
        }
        return null;
    }

    static bool LooksLike(byte[] b, string mime) => mime switch
    {
        "image/jpeg" => b.Length > 3 && b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF,
        "image/png" => b.Length > 8 && b[0] == 0x89 && b[1] == 0x50 && b[2] == 0x4E && b[3] == 0x47,
        "image/webp" => b.Length > 12 && b[0] == (byte)'R' && b[1] == (byte)'I' && b[2] == (byte)'F' && b[3] == (byte)'F'
            && b[8] == (byte)'W' && b[9] == (byte)'E' && b[10] == (byte)'B' && b[11] == (byte)'P',
        _ => false,
    };

    public static ValidationError? Project(ProjectInput p, out ProjectValues values)
    {
        values = null!;
        var name = Clean(p.Name);
        var modelCode = Clean(p.ModelCode);
        var revision = Clean(p.Revision);
        var error = Required(name, "name", "ชื่อโปรเจกต์", 200)
            ?? MaxLength(modelCode, "modelCode", "รหัสรุ่น", 120)
            ?? MaxLength(revision, "revision", "รหัสรีวิชัน", 20);
        if (error is not null) return error;

        if (p.Data is not { ValueKind: JsonValueKind.Object } data)
            return new("data", "ข้อมูลโปรเจกต์ (data) ต้องเป็นออบเจกต์ JSON");
        var json = JsonSerializer.Serialize(data, Api.Json);
        if (Encoding.UTF8.GetByteCount(json) > MaxProjectDataBytes)
            return new("data", "ข้อมูลโปรเจกต์ต้องมีขนาดไม่เกิน 2 MB");

        values = new ProjectValues(name!, modelCode, revision, json);
        return null;
    }

    public static ValidationError? Setting(string key, SettingInput input) =>
        key.Length > 100 ? new("key", "ชื่อการตั้งค่าต้องยาวไม่เกิน 100 ตัวอักษร")
        : input.Value is null ? new("value", "ต้องระบุ value เป็นข้อความ")
        : null;

    static ValidationError? Required(string? value, string field, string label, int max) =>
        string.IsNullOrWhiteSpace(value) ? new(field, $"ต้องกรอก{label}") : MaxLength(value, field, label, max);

    static ValidationError? MaxLength(string? value, string field, string label, int max) =>
        value is not null && value.Length > max ? new(field, $"{label}ต้องยาวไม่เกิน {max} ตัวอักษร") : null;

    static ValidationError? OneOf(string? value, string field, string label, string[] allowed) =>
        value is not null && allowed.Contains(value) ? null
        : new(field, $"{label}ต้องเป็นหนึ่งใน {string.Join(", ", allowed)}");

    static string Num(double v) => v.ToString(CultureInfo.InvariantCulture);
}
