# DevDock — Agent Working Rules

Acuan utama proyek:
- Spesifikasi produk & arsitektur: `docs/spec.md`
- Panduan UI/UX, token warna, & animasi: `docs/ui-ux.md`
- Daftar tiket kerja: `.scratch/devdock/issues/`

## 1. Alur Pengerjaan Tiket

1. Pilih tiket dari frontier (semua tiket di `Blocked by` sudah berstatus `done`).
2. Saat mulai, ubah `**Status:** ready-for-agent` menjadi `**Status:** in-progress` di file tiket.
3. Kerjakan seluruh cakupan vertical slice (schema, core Rust, Tauri bridge, UI, dan integration test).
4. Pastikan semua build, typecheck, dan test lulus sebelum menandai selesai.
5. Jika semua acceptance criteria sudah terpenuhi dan terverifikasi:
   - **Langsung centang** semua item `- [ ]` → `- [x]` di file tiket.
   - Ubah `**Status:** done`.
   - **Langsung buat `git commit`** untuk perubahan tiket tersebut (jangan `git push` kecuali diminta user).

## 2. Format Commit Message

Gunakan format **Conventional Commits** yang singkat, jelas, dan *on point* (huruf kecil, imperatif, tanpa titik di akhir):

```text
<type>: <ringkasan singkat perubahan>
```

Tipe yang dipakai:
- `feat`: fitur atau kemampuan baru
- `fix`: perbaikan bug
- `refactor`: perbaikan struktur kode tanpa mengubah perilaku
- `chore`: setup tooling, konfigurasi, dependency, housekeeping
- `docs`: perubahan dokumentasi
- `test`: penambahan atau perbaikan test
- `style`: penyesuaian tampilan/formatting tanpa perubahan logika
- `ci`: konfigurasi CI/CD & release workflow

Contoh:
- `feat: scaffold tauri app shell, design system, and rust core`
- `feat: add folder scanner with monorepo and multi-folder grouping`
- `fix: terminate full process tree on script stop`
- `refactor: simplify env layer resolution order`
- `chore: configure sqlite migrations and test fixtures`

## 3. Prinsip Teknis Singkat

- Seluruh logika bisnis berada di library core Rust yang independen dari Tauri; lapisan Tauri hanya thin wrapper.
- Uji perilaku eksternal lewat public API core (bukan detail internal), gunakan in-memory fake untuk `SecretStore`, `ShellEnvProvider`, dan `Notifier`.
- Ikuti semantic CSS tokens, tipografi (`IBM Plex Sans` + `JetBrains Mono` `tabular-nums`), ikon Lucide SVG (tanpa emoji), aksesibilitas, dan aturan motion (`prefers-reduced-motion`) di `docs/ui-ux.md`.
