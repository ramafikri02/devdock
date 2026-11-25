# DevDock — Execution Waves

Peta eksekusi bertahap untuk 17 tiket di `.scratch/devdock/issues/`. Setiap Wave mengelompokkan tiket yang aman dikerjakan dalam 1 sesi berdasarkan dependensi (`Blocked by`), sehingga setiap akhir Wave menghasilkan checkpoint yang bisa langsung dicoba dan diverifikasi.

## Cara Menggunakan

Saat user meminta **"kerjain wave X"** (misal `kerjain wave 1`, `/goal kerjain wave 1`, atau `/teamwork kerjain wave 2A`):
1. Baca daftar tiket untuk Wave yang diminta pada tabel di bawah.
2. Pastikan seluruh `Blocked by` tiket tersebut sudah berstatus `done`.
3. Kerjakan sesuai aturan di `AGENTS.md`, `docs/spec.md`, dan `docs/ui-ux.md`.
   - Untuk tiket yang menyentuh UI baru atau komponen kompleks, gunakan panduan `docs/ui-ux.md` (dan skill `ui-ux-pro-max` bila perlu verifikasi kontras/pola).
   - Untuk setiap tiket selesai: verifikasi build + typecheck + test lulus → centang semua `- [x]` → ubah `Status: done` → langsung `git commit` dengan Conventional Commits.

---

## Daftar Wave

### Wave 1 — Fondasi App Shell, Core & Register Project
- **Tiket:** `01` → `02` *(serial)*
- **Rekomendasi prompt:** `/goal kerjain wave 1` (single agent)
- **File tiket:**
  - `.scratch/devdock/issues/01-app-shell-design-system-and-core-foundation.md`
  - `.scratch/devdock/issues/02-register-single-folder-project-and-service-workbench.md`
- **Checkpoint:** App Tauri terbuka (dark/light mode sesuai `docs/ui-ux.md`), SQLite & login shell PATH jalan, tambah folder project Node.js, deteksi PM/framework/scripts, Service Workbench tampil.

---

### Wave 2A — Discovery, Env Files & Storage
- **Tiket:** `03`, `04`, `12` *(paralel — ketiganya hanya bergantung pada `02`)*
- **Rekomendasi prompt:** `/teamwork kerjain wave 2A`
- **File tiket:**
  - `.scratch/devdock/issues/03-folder-scanner-multi-folder-grouping-and-monorepo-detection.md`
  - `.scratch/devdock/issues/04-env-file-reader-validation-and-editor.md`
  - `.scratch/devdock/issues/12-storage-analyzer-and-safe-cleanup.md`
- **Checkpoint:** Scan folder induk + monorepo + gabung multi-folder (mis. LMS App), Env reader/validator `.env.example`/editor, dan Storage analyzer + cleanup aman.

---

### Wave 2B — Env Presets (Keychain) & DB Connection Tester
- **Tiket:** `05`, `06` *(paralel — keduanya hanya bergantung pada `04`)*
- **Rekomendasi prompt:** `/teamwork kerjain wave 2B` atau `/goal kerjain wave 2B`
- **File tiket:**
  - `.scratch/devdock/issues/05-layered-env-presets-and-os-keychain.md`
  - `.scratch/devdock/issues/06-database-connection-tester.md`
- **Checkpoint:** Env Presets lintas project & per service dengan OS Keychain, preview resolusi berlapis, dan Test DB nyata (Postgres/MySQL/Mongo/Redis).

---

### Wave 3 — Core Script Runner & Scoped Log Drawer
- **Tiket:** `07` *(fokus 1 tiket — menjadi fondasi Wave 4)*
- **Rekomendasi prompt:** `/goal kerjain wave 3` (single agent)
- **File tiket:**
  - `.scratch/devdock/issues/07-run-scripts-process-tree-lifecycle-and-scoped-log-drawer.md`
- **Checkpoint:** Menjalankan script `package.json` dengan env final, stop seluruh pohon proses (SIGTERM → SIGKILL), dan Shared Log Drawer (xterm.js, resize/maximize/hide `⌘J`, scoped per Project + `All (Combined)`).

---

### Wave 4 — Node Version, Ports, Auto-Restart & Monitoring
- **Tiket:** `08`, `09`, `10`, `11` *(paralel — keempatnya hanya bergantung pada `07`)*
- **Rekomendasi prompt:** `/teamwork kerjain wave 4`
- **File tiket:**
  - `.scratch/devdock/issues/08-node-version-management-fnm.md`
  - `.scratch/devdock/issues/09-port-allocation-conflict-resolution-and-port-inspector.md`
  - `.scratch/devdock/issues/10-auto-restart-policy-and-crash-notifications.md`
  - `.scratch/devdock/issues/11-real-time-cpu-ram-monitoring-and-overview-dashboard.md`
- **Checkpoint:** Versi Node via `fnm`, port persisten + resolusi bentrok + Port Inspector, auto-restart & notifikasi crash, serta CPU/RAM monitoring + Overview dashboard. **App sudah layak dipakai harian.**

---

### Wave 5A — Project Hub & Local Domains
- **Tiket:** `13`, `15` *(paralel — `13` butuh Wave 4, `15` hanya butuh `09`)*
- **Rekomendasi prompt:** `/teamwork kerjain wave 5A`
- **File tiket:**
  - `.scratch/devdock/issues/13-project-hub-and-multi-service-orchestration.md`
  - `.scratch/devdock/issues/15-local-domains-reverse-proxy.md`
- **Checkpoint:** Project Hub (`Start/Restart/Stop All` berurutan, shared presets, inspector gabungan) dan reverse proxy `*.localhost`.

---

### Wave 5B — Tray, Ergonomi, Export/Import & Release CI
- **Tiket:** `14`, `16` *(paralel setelah `13`)* → lalu `17` *(final setelah `15` & `16`)*
- **Rekomendasi prompt:** `/teamwork kerjain wave 5B`
- **File tiket:**
  - `.scratch/devdock/issues/14-system-tray-quick-actions-git-info-and-command-palette.md`
  - `.scratch/devdock/issues/16-cross-os-export-import-and-path-remapping.md`
  - `.scratch/devdock/issues/17-cross-platform-ci-windows-packaging-and-auto-updater.md`
- **Checkpoint:** Menu bar tray, Quick Actions, Git info, `⌘K` Command Palette, Export/Import lintas OS dengan remap path, CI macOS/Windows, installer `.dmg`/`.msi`, dan auto-updater.
