# Warehouse Material MMP

Frontend prototype mengikuti PRD, Rules, Design, dan Architecture di `warehouse-material-mmp-docs/docs`. Data saat ini disimpan di browser (`localStorage`); Supabase belum dihubungkan.

## Struktur utama

- `src/app/` — Next.js App Router.
- `src/features/warehouse/` — alur aplikasi gudang yang dipakai oleh halaman Next.
- `styles.css` — gaya responsif yang mengikuti mockup.
- `app-legacy/` — folder lama yang tidak dipakai Next.
- `index.html`, `app.js`, `server.js` — preview HTML lama, bukan runtime Next.

## Jalankan Next.js

```powershell
pnpm install
pnpm dev
```

Buka `http://localhost:3000`. Akun demo (password `gudang123`): `admin@mmp.local` (Admin), `operator@mmp.local` (Operator), atau `user1@mmp.local` (Operator).

Admin dapat mengelola material dan reset quantity. Operator dapat melihat data serta melakukan scan/transaksi. Keduanya memakai data demo lokal yang sama di browser.

## Preview HTML lama

`node server.js` menjalankan prototipe HTML lama (biasanya di port 4173). Perubahan pada Next.js ada di `src/`, sehingga preview HTML tidak menampilkan source Next.

## Batas prototipe

Login demo belum menggunakan Supabase Auth dan pembatasan akses masih di sisi antarmuka. Untuk data bersama dan keamanan produksi, autentikasi, role, validasi, transaksi stok atomik, serta audit harus dipindahkan ke Supabase sesuai panduan sebelum dipakai operasional.
