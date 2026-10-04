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

## เว็บจริง

ทุก push เข้า `main` จะรัน [.github/workflows/deploy.yml](.github/workflows/deploy.yml): ตรวจชนิด, ทดสอบฟิสิกส์และเซิร์ฟเวอร์, บิลด์เว็บด้วย `VITE_STATIC=1` (ไม่มีเซิร์ฟเวอร์ C# อยู่ข้างหลัง จึงใช้ข้อมูลตัวอย่างที่แนบมากับเว็บ) แล้ว rsync ขึ้น https://bassbuild.xman4289.com · สั่งรันเองได้จากแท็บ Actions

ต้องมี secret `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS` · คีย์นี้ถูกล็อกไว้ใน `~/.ssh/authorized_keys` บนเซิร์ฟเวอร์ด้วย `rrsync -wo -munge` ให้เขียนได้เฉพาะ `public_html` ของโดเมนนี้ · ค่า cache และ header ความปลอดภัยอยู่ใน [apps/web/public/.htaccess](apps/web/public/.htaccess)

## คลังลำโพง

ลำโพงจริงอยู่ใน [data/seed/drivers.json](data/seed/drivers.json) (ค่า T/S จาก datasheet ของผู้ผลิต ทุกรุ่นมี `sourceUrl`) และลำโพงสมมติสำหรับทดสอบอยู่ใน `drivers.sample.json`

- เพิ่มรุ่นใหม่: เก็บเป็น JSON รูปแบบเดียวกัน แล้วรัน `python data/seed/merge_drivers.py <ไฟล์.json>` สคริปต์ตรวจช่วงค่า หน่วย และความสอดคล้อง (Qts, Vas, Fs, Qes) ตัดรุ่นที่ค่าเพี้ยนเกิน 30 % และต่อท้ายไฟล์เดิม (ห้ามแทรกกลาง เพราะเว็บใช้ลำดับเป็นรหัส)
- เซิร์ฟเวอร์ C# เพิ่มรุ่นที่ยังไม่มีให้ฐานข้อมูลเดิมเองเมื่อไฟล์ seed เปลี่ยน
- ลำโพงวอยซ์คอยล์คู่ (`"coil": "DVC"`) ใส่ `coilWiring` เป็น `series` หรือ `parallel` ตามที่ datasheet บอกว่าค่า T/S วัดตอนต่อคอยล์แบบไหน (ไม่ระบุ แอปจะเดาจากอิมพีแดนซ์และติดป้ายว่าประมาณ)
- ลำโพงที่ผู้ใช้เพิ่มเอง: บนเว็บเก็บในเบราว์เซอร์ (localStorage) ในแอปเครื่องเก็บใน SQLite

## โครงสร้าง

| โฟลเดอร์ | หน้าที่ |
|---|---|
| `packages/physics` | เอนจินฟิสิกส์ (TypeScript): ลำโพง, วงจรเทียบแบบ nodal, ตู้ทุกชนิด, การวิเคราะห์ |
| `apps/web` | หน้าจอ React + ฉาก 3D Three.js (WebGPU) + ต้นแบบ LBM/FDTD |
| `server` | ASP.NET Core (.NET 10) + SQLite: ลำโพง, วัสดุ, โปรเจกต์ |
| `data/seed` | ข้อมูลตั้งต้น (ลำโพงตัวอย่าง, วัสดุ, ท่อ PVC) |
| `docs` | แผนและผลทดสอบ |
