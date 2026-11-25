# DevDock — Panduan UI/UX & Design System

Dokumen acuan baku untuk tampilan, interaksi, animasi, dan struktur layar DevDock. Disusun berdasarkan hasil eksplorasi UI/UX Pro Max dan prototype final di [.scratch/ui-exploration/v2/devdock-unified.html](file:///Users/fikri/H2o/l/devdock/.scratch/ui-exploration/v2/devdock-unified.html), selaras dengan model domain **Project → Services** di [docs/spec.md](file:///Users/fikri/H2o/l/devdock/docs/spec.md).

---

## 1. Arah Visual & Design Tokens

- **Gaya:** Dark Mode (OLED-inspired) + Minimalism/Swiss clarity — padat informasi namun tetap lega, kontras tinggi, fokus pada keterbacaan angka/log dan status proses.
- **Tema:** Dark sebagai default, **Light mode** didukung penuh (mengikuti sistem OS dan bisa di-override di Settings). Semua warna didefinisikan lewat semantic CSS variables (`:root` / `.dark`) dan diekspos ke Tailwind v4 via `@theme inline` — dilarang hardcode hex di komponen.

### 1.1 Palet Warna Semantik

| Token | Dark Mode | Light Mode | Penggunaan |
|---|---|---|---|
| `--bg` | `#0B1120` | `#F8FAFC` | Latar kanvas utama |
| `--bg-sidebar` | `#080D1A` | `#F1F5F9` | Sidebar & panel kanan inspector |
| `--bg-topbar` | `#0A101E` | `#FFFFFF` | Topbar & status bar bawah |
| `--surface` | `#111827` | `#FFFFFF` | Card, tabel, toolbar |
| `--surface-2` | `#172033` | `#F8FAFC` | Elemen bertingkat, input, pill |
| `--surface-hover` | `#1E293B` | `#E2E8F0` | Hover & item aktif |
| `--border` | `#1F2A3F` | `#E2E8F0` | Garis pemisah halus |
| `--border-strong` | `#334155` | `#CBD5E1` | Border tombol, input, modal |
| `--fg` / `--fg-2` | `#F8FAFC` / `#CBD5E1` | `#0F172A` / `#334155` | Teks utama & sekunder |
| `--fg-muted` / `--fg-faint` | `#94A3B8` / `#64748B` | `#475569` / `#64748B` | Label, metadata, timestamp |
| `--accent` (Run/OK) | `#22C55E` (fg `#052E16`) | `#16A34A` (fg `#FFFFFF`) | Status running, tombol primary |
| `--info` (Focus/Link) | `#38BDF8` | `#0284C7` | Domain `.localhost`, focus ring, preset badge |
| `--warn` (Warning) | `#F59E0B` | `#B45309` | Bentrok port, env missing, partial status |
| `--danger` (Error/Stop) | `#F87171` / solid `#EF4444` | `#DC2626` | Crash, tombol Stop/Kill/Hapus |
| `--log-bg` | `#060A14` | `#0F172A` | Latar terminal log (selalu gelap agar ANSI kontras) |

### 1.2 Tipografi & Spacing
- **UI Font:** `IBM Plex Sans` (400, 500, 600, 700), ukuran dasar `13.5px`, line-height `1.5`.
- **Mono Font:** `JetBrains Mono` (400, 500, 600, 700) dengan `font-variant-numeric: tabular-nums` wajib untuk semua angka CPU, RAM, port, PID, ukuran storage, dan log agar tidak melompat saat data berubah.
- **Skala Spacing (kelipatan 4px):** `4 / 8 / 12 / 16 / 20 / 24px`.
- **Radius:** `6px` (pill, input kecil), `7–8px` (tombol, nav item), `10–12px` (card, modal).
- **Ikon:** Satu keluarga vektor SVG (**Lucide**), stroke konsisten `1.75–2px`. **Dilarang memakai emoji** sebagai ikon UI.

---

## 2. Motion, Micro-Interactions & Feedback

Tujuan animasi di DevDock: terasa **ringan, modern, dan responsif** (tidak pernah memperlambat alur kerja developer). Semua animasi hanya menganimasikan properti murah (`transform`, `opacity`, `background-color`, `border-color`) — hindari animasi `width`/`height` yang memicu layout thrashing.

### 2.1 Token Durasi & Easing
- `--dur-fast: 120ms` — hover, focus ring, press feedback, exit/dismiss (exit ~65% lebih cepat dari enter).
- `--dur-base: 180ms` — pindah halaman/tab, buka dropdown/popover, toast masuk, chevron expand.
- `--dur-panel: 220ms` — toggle sidebar, buka/tutup modal, maximize/restore panel log.
- **Easing:** enter `cubic-bezier(0.16, 1, 0.3, 1)` (cepat di awal, mendarat halus); exit `cubic-bezier(0.4, 0, 1, 1)`.

### 2.2 Transisi Layar & Tab
- **Pindah halaman (Overview ↔ Project Hub ↔ Service Workbench ↔ Port Inspector ↔ Env Presets):** cross-fade `opacity: 0 → 1` + geser vertikal halus `translateY(4px → 0)` selama `160ms`.
- **Pindah tab (`Scripts`, `Env`, `Storage`, `Settings`):** konten tab fade-in `140ms`; garis indikator aktif (`border-bottom`) berpindah halus antar tab.
- **Expand/collapse tree project di sidebar:** rotasi ikon chevron `0deg → 90deg` (`140ms`) + anak list fade-in cepat (`120ms`).

### 2.3 Status Proses & Kontrol Interaktif
- **Tombol:** hover background/border `120ms`; saat ditekan (`:active`) sedikit turun `translateY(1px)` tanpa mengubah ukuran layout.
- **Status dot proses:**
  - `starting` / `restarting`: animasi pulse halus (ring memudar `1.4s ease-out infinite`) + teks `starting…`.
  - `running`: titik hijau dengan glow lembut statis (tidak berkedip agar tidak mengganggu fokus).
  - `crashed` / `conflict`: titik merah/kuning statis + ikon/teks status (tidak mengandalkan warna saja).
- **Sidebar quick-action:** saat hover baris Project multi-service, pill jumlah (`2/2`) fade-out dan tombol cepat `▶` / `■` fade-in (`120ms`) di tempat yang sama.

### 2.4 Loading & Skeleton States
- **Scan folder & hitung storage:** tampilkan **shimmer skeleton** baris/card (gradient lembut bergerak `1.5s`, berhenti saat reduced motion) + progress teks kecil (misal *"Memindai folder… 12 ditemukan"*).
- **Test koneksi DB & aksi async tombol:** tombol berubah ke state `disabled` dengan **spinner SVG 14px** di samping teks (*"Menghubungkan…"*), lalu transisi halus ke badge hasil (`✓ PostgreSQL 16 OK · 18ms` atau `✗ Connection refused` dengan alasan error).
- **Start/Stop All Project:** setiap baris service di tabel Project Hub menampilkan progres berurutan (`waiting…` → `starting…` → `running`).

### 2.5 Toast, Alert & Modal
- **Toast notifikasi (feedback ringan):**
  - Posisi: kanan bawah, tepat di atas Status Bar (maks 3 toast bertumpuk).
  - Animasi: masuk `translateY(8px) + opacity` (`180ms`), keluar `opacity + translateX(12px)` (`120ms`).
  - Auto-dismiss `4 detik` (jeda otomatis saat di-hover), selalu punya tombol tutup `×`, memakai `aria-live="polite"` agar tidak mencuri fokus keyboard.
  - Contoh: *"Preset DB Staging dipasang ke LMS App"*, *"Log disimpan ke lms-backend.log"*, *"Port 5173 berhasil dibebaskan (PID 8812 dihentikan)"*.
- **Inline Alert Banner (perlu aksi segera):**
  - Contoh: kartu **Bentrok Port** di inspector kanan / Overview, banner **Folder tidak ditemukan**, atau warning **Key wajib belum diisi**.
  - Masuk dengan fade + slide halus (`180ms`), hilang mulus saat diselesaikan (misal klik *Pakai 5174* atau *Kill*).
- **Modal & Command Palette (`⌘K`):**
  - Scrim gelap fade-in `150ms`; panel modal masuk `scale(0.97 → 1) + translateY(-6px → 0) + opacity` (`180ms`), keluar `120ms`.
  - Fokus keyboard langsung masuk ke modal/input, terkunci di dalam (focus trap), `Esc` menutup dan mengembalikan fokus ke pemicunya.

### 2.6 Reduced Motion (Wajib)
- Seluruh animasi di atas wajib tunduk pada `@media (prefers-reduced-motion: reduce)`: matikan `transform`, shimmer, dan pulse; sisakan transisi `opacity` singkat atau perubahan instan.

---

## 3. App Shell & Navigasi

Struktur utama terdiri dari 4 area:

1. **Topbar (`46px`):**
   - Kiri: macOS traffic lights, tombol toggle sidebar, dan **Breadcrumb interaktif** (misal `Overview / LMS App / lms-frontend` — setiap segmen bisa diklik).
   - Tengah: pemicu **Command Palette (`⌘K`)**.
   - Kanan: tombol `Scan`, tombol primary `+ Tambah`, dan toggle tema terang/gelap.
2. **Sidebar (`256px`, bisa dilipat):**
   - **Section `WORKSPACE`:** `Overview` (pill jumlah jalan), `Port Inspector` (pill jumlah bentrok), `Env Presets` (pill jumlah preset).
   - **Section `PROJECTS` (menyatu — tidak ada pemisahan App Group/Stack vs Project):**
     - Project multi-service (multi-folder seperti `LMS App`, `Toko Online`, maupun monorepo seperti `h2o-platform`): memiliki chevron expand `▾`, status dot agregat, badge `2/2`, dan tombol cepat hover `▶`/`■`. Klik nama project → buka **Project Hub**; klik anak service → buka **Service Workbench**.
     - Project single-service (`landing-page`): tampil datar tanpa chevron; klik langsung buka **Service Workbench**.
   - **Footer sidebar:** tombol `Settings` (App Settings & Export/Import) + indikator `Tray aktif`.
3. **Main Stage:**
   - Menampilkan view aktif di bagian atas dan **Shared Log Drawer** yang bisa di-resize/maximize/hide di bagian bawah.
4. **Bottom Status Bar (`28px`):**
   - Kiri: ringkasan status global (`4 jalan`, `1 crash`, `1 bentrok port`).
   - Kanan: tombol toggle **`Logs ⌘J`** (menyala saat panel log terbuka), total CPU, total RAM, dan status reverse proxy (`proxy *.localhost :80`).

---

## 4. Spesifikasi Layar

### 4.1 Overview (Landing Default)
- **Header:** ringkasan jumlah project/service (tombol `+ Tambah` sudah tersedia global di Topbar; CTA `Tambah Project` hanya muncul di empty state saat belum ada service).
- **Compact Health Strip (4 segmen):** Jalan (`x/y`), Crash, Bentrok Port (auto-refresh periodik tiap 10 detik saat Overview aktif + navigasi ke Port Inspector), dan Storage total + reclaimable (dengan tombol refresh).
- **Live Telemetry Row (3 panel analytic):**
  - **CPU Total (Area Chart, 15m):** realtime `2s` dari `metrics.globalHistory`, hover scrubbing, `Peak` & `Avg`, serta tombol `Pause/Resume`.
  - **RAM Total (Area Chart, 15m):** realtime `2s` pohon proses DevDock dengan hover scrubbing, `Peak` & `Avg`, dan `Pause/Resume`.
  - **Panel Adaptif (Top Konsumsi Aktif / Distribusi Storage):** saat ada proses jalan menampilkan top service berdasarkan konsumsi RAM/CPU; saat idle menampilkan distribusi storage (`node_modules`, build cache, source & lain).
- **Section `Aktif & Perlu Perhatian`:** tampil otomatis di atas saat ada service berstatus `running`, `restarting`, `crashed`, `conflict`, atau `missing`.
- **Section `Projects & Services`:** toolbar dengan inline search, filter project (saat >1 project), segmented filter (`Semua`, `Jalan`, `Bermasalah`), tombol `Lipat/Expand semua`, dan toggle layout (`Grouped List` default / `Cards`). Mode default mengelompokkan service sebagai compact rows di dalam accordion tiap Project (dengan branch git ditampilkan sekali di header project, dan package non-server tanpa script `dev`/`start` dilipat ke sub-baris opsional).

### 4.2 Project Hub (Saat klik Project multi-service, mis. `LMS App`)
- **Layout 2 kolom:** konten utama di kiri + **Right Inspector (`280px`)** di kanan.
- **Header:** nama Project, badge status agregat (`2/2 running`), tipe (`multi-folder` / `monorepo`), tombol `+ Tambah Service`, `Restart All`, dan `Start All / Stop All`. Baris metadata menampilkan jumlah service, shared presets aktif, dan urutan start.
- **Tab:**
  - **Services (default):** tabel service sesuai urutan start (`#1`, `#2`, …) dengan nama & framework/PM/Node, default script, port & domain `.localhost`, status, tombol `Atur` (masuk ke Service Workbench), dan tombol `Run / Stop` cepat. Urutan start bisa diubah (panah naik/turun atau drag dengan alternatif keyboard).
  - **Shared Env & Presets:** daftar preset terurut di level Project (diwariskan ke semua service), tombol `+ Pasang Preset`, `Test DB`, dan `Lepas`.
  - **Storage & Settings:** total storage gabungan, bersihkan build cache lintas service, rename project, dan hapus dari DevDock (dengan konfirmasi).
- **Right Inspector:** grafik CPU gabungan, RAM gabungan, daftar port aktif project, dan breakdown storage gabungan.

### 4.3 Service Workbench (Saat klik Service, mis. `lms-frontend`, atau single-service Project)
- **Layout 2 kolom:** konten utama di kiri + **Right Inspector (`280px`)** di kanan.
- **Header:** nama service, status pill, badge Project induk, domain link `lms-frontend.localhost`, quick actions (`Open in Editor`, `Open in Terminal`, `Open in Finder`), tombol `Start / Stop`. Baris metadata: framework, PM, versi Node + sumber (`.nvmrc`), branch git + status dirty.
- **Tab:**
  - **Scripts:** tabel seluruh `scripts` dari `package.json` dengan command, status/durasi/exit code, toggle auto-restart, dan aksi `Run / Restart / Stop`.
  - **Env:** visualisasi urutan resolusi (`shell → .env* → project presets → service presets → PORT`), tombol `Reveal/Mask Secrets`, `Tulis ke .env` (dengan info backup `.env.bak`), dan tabel env final lengkap dengan sumber key, badge missing dari `.env.example`, dan tombol `Test DB` inline.
  - **Storage:** ukuran total & breakdown (`node_modules`, `.next`/`dist`, source), tombol refresh, dan tombol hapus dengan dialog konfirmasi.
  - **Settings:** path folder, pindah/keluar Project, override PM, versi Node (dengan tombol *Install via fnm* jika belum ada), port & metode inject (`PORT` / `--port`).
- **Right Inspector:** kartu alert bentrok port (jika ada), grafik CPU pohon proses (interval 2s, window 15m, tombol `Pause`), grafik RAM, ringkasan Runtime (port, Node, PM, auto-restart, PID), dan ringkasan Storage.

### 4.4 Workspace Views & Dialog Kunci
- **Port Inspector:** tabel semua port aktif (termasuk proses eksternal di luar DevDock) dengan PID, pemilik, highlight bentrok, dan tombol `Kill` (dengan konfirmasi).
- **Env Presets (Global):** grid/tabel semua preset lintas project, indikator `Keychain` vs `Plain`, daftar project/service pemakai, editor key-value + flag secret.
- **App Settings:** editor default, terminal default, tema, konfigurasi reverse proxy `*.localhost` (on/off, port 80/fallback, helper `/etc/hosts`), dan tombol **Export / Import Konfigurasi**.
- **Dialog Scan Folder:** pilih folder induk & kedalaman → hasil berupa checklist (folder yang sudah terdaftar ditandai) → opsi centang beberapa folder lalu *"Gabung jadi 1 Project"* (isi nama, misal `LMS App`) atau *"Daftarkan terpisah"*.
- **Dialog Import & Remap Path:** input passphrase (jika file mengandung secret terenkripsi) → deteksi path tidak valid → tawarkan remap folder induk bersama sekali klik → daftar sisa service yang masih hilang dengan folder picker yang divalidasi lewat nama `package.json`.

---

## 5. Spesifikasi Panel Log (Shared Log Drawer)

Satu panel log persisten berada di bagian bawah **Main Stage**, sehingga tinggi dan state-nya tetap terjaga saat berpindah antara **Project Hub** dan **Service Workbench**.

- **Ukuran & Visibilitas:**
  - **Drag handle** di garis atas panel untuk resize bebas (min `110px`, maks `78%` tinggi stage).
  - **Maximize / Restore:** memenuhi seluruh area Main Stage untuk membaca stack trace panjang.
  - **Hide / Show:** tombol `✕` untuk menutup; tombol **`Logs ⌘J`** di Status Bar atau shortcut `⌘J` untuk membuka kembali kapan saja (termasuk saat di Overview).
- **Scope Otomatis per Project (mencegah tab memanjang ke samping):**
  - Saat membuka `LMS App` atau `lms-frontend`, dropdown scope di ujung kiri bar log otomatis pindah ke **`LMS App`** dan hanya menampilkan tab milik project tersebut.
  - Tab paling kiri untuk project multi-service adalah **`All (Combined)`**: menggabungkan log seluruh service dalam project secara kronologis dengan prefix tag berwarna (`[lms-backend]`, `[lms-frontend]`).
  - Tab tiap proses (`lms-backend · start:dev`, `lms-frontend · dev`) bisa ditutup dengan **`×`** saat hover (hanya menyembunyikan tab tanpa mematikan proses yang berjalan); tombol `+ Tab` muncul untuk memunculkannya lagi.
  - Dropdown scope (`LMS App ▾`, `Toko Online ▾`, `h2o-platform ▾`, `Semua jalan`) memungkinkan pengguna mengintip log project lain tanpa pindah halaman.
- **Kontrol Log:** render via **xterm.js** (dukungan warna ANSI, ring buffer ~10.000 baris), live filter/search, filter stderr-only, tombol `Clear`, dan `Save to file`.

---

## 6. Mapping Komponen & Checklist Kualitas

- **Komponen shadcn/ui:** `Sidebar` (`SidebarProvider` + `SidebarTrigger`), `Tabs`, `Table`, `Command` (`CommandDialog` untuk `⌘K`), `Dialog` / `AlertDialog` (konfirmasi destruktif, scan, import), `Select`, `Badge`, `Tooltip`, `Sonner` (toast).
- **Aksesibilitas (Wajib):**
  - Kontras teks ≥ 4.5:1 di Dark & Light mode.
  - Status tidak pernah disampaikan hanya lewat warna (selalu disertai teks atau ikon).
  - Semua aksi bisa dioperasikan lewat keyboard (`Tab`, `Enter`, `Esc`, `⌘K`, `⌘J`), focus ring selalu terlihat dan tidak tertutup sticky bar.
  - Ikon dekoratif memakai `aria-hidden="true"`; tombol ikon saja wajib punya `aria-label`.
  - Aksi destruktif (hapus `node_modules`, kill PID eksternal, quit saat proses jalan, hapus project) wajib menampilkan dialog konfirmasi.
