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
            ?? MaxLength(d.SourceUrl, "sourceUrl", "ลิงก์ที่มา", 2000)
            ?? MaxLength(d.Notes, "notes", "หมายเหตุ", 2000);
        if (error is not null) return error;

        // Rendered as a link by the UI, so only web URLs are accepted (no javascript:, file:, ...).
        if (d.SourceUrl is { } url && !(Uri.TryCreate(url, UriKind.Absolute, out var uri) && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps)))
            return new("sourceUrl", "ลิงก์ที่มาต้องขึ้นต้นด้วย http:// หรือ https://");

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
