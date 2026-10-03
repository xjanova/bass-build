# BASS BUILD

โปรแกรมออกแบบตู้ลำโพงทุกชนิด พร้อมแล็บจำลองฟิสิกส์ 3 มิติบนเว็บ (WebGPU) และฐานข้อมูล SQLite

แผนทั้งหมดอยู่ที่ [docs/PLAN.md](docs/PLAN.md) · ผลวัดต้นแบบควันและคลื่นอยู่ที่ [docs/SPIKES.md](docs/SPIKES.md)

## เริ่มใช้งาน

ดับเบิลคลิก `start.bat` — บิลด์หน้าเว็บ เปิดเซิร์ฟเวอร์ C# ที่ `http://127.0.0.1:5178` แล้วเปิดเบราว์เซอร์ให้

ต้องมี Node.js 22+ และ .NET SDK 10 · ใช้ Chrome หรือ Edge รุ่นที่รองรับ WebGPU

## ระหว่างพัฒนา

```bash
dotnet run --project server/BassBuild.Server
```

```bash
npm run dev
```

หน้าเว็บอยู่ที่ `http://127.0.0.1:5173` (ส่งต่อ `/api` ไปเซิร์ฟเวอร์ C#) · ต้นแบบโซลเวอร์อยู่ที่ `/spikes/lbm.html` และ `/spikes/fdtd.html`

## ทดสอบ

```bash
npm test
```

```bash
dotnet test server/BassBuild.sln
```

## โครงสร้าง

| โฟลเดอร์ | หน้าที่ |
|---|---|
| `packages/physics` | เอนจินฟิสิกส์ (TypeScript): ลำโพง, วงจรเทียบแบบ nodal, ตู้ทุกชนิด, การวิเคราะห์ |
| `apps/web` | หน้าจอ React + ฉาก 3D Three.js (WebGPU) + ต้นแบบ LBM/FDTD |
| `server` | ASP.NET Core (.NET 10) + SQLite: ลำโพง, วัสดุ, โปรเจกต์ |
| `data/seed` | ข้อมูลตั้งต้น (ลำโพงตัวอย่าง, วัสดุ, ท่อ PVC) |
| `docs` | แผนและผลทดสอบ |
