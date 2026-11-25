# DevDock — Spec

> Status: **draft**, menunggu konfirmasi seam testing & lokasi issue tracker. Label tujuan: `ready-for-agent`.

## Problem Statement

Sebagai developer yang sering berpindah-pindah project Node.js di mesin lokal, satu produk sering terdiri dari beberapa folder terpisah (misalnya project **LMS** yang punya `lms-frontend` dan `lms-backend`), atau berupa monorepo, atau single repo biasa. Setiap kali setup atau mengganti konfigurasi (misalnya ganti database dari lokal ke staging), aku harus membuka dan mengedit file `.env` satu per satu secara manual dan berisiko menimpa konfigurasi lama. Menjalankan project juga repot: tiap service memakai package manager berbeda (npm, pnpm, yarn, bun), versi Node berbeda, dan port default yang sering bentrok (semua mau port 3000). Ketika beberapa service jalan bersamaan, aku tidak punya satu tempat untuk melihat log, pemakaian CPU/RAM, port mana yang dipakai siapa, atau berapa besar storage yang dimakan `node_modules`. Konfigurasi ini juga tidak bisa dipindahkan dengan mudah ke mesin lain (misal dari macOS ke Windows).

## Solution

DevDock adalah aplikasi desktop ringan (Tauri) untuk macOS Apple Silicon (lalu Windows) yang menjadi "dock" untuk semua project lokal. Model utamanya adalah **Project → Services**: satu Project (misal **LMS**) bisa berisi 1 atau banyak Service yang menunjuk ke folder masing-masing di disk (`lms-frontend`, `lms-backend`), termasuk sub-package monorepo, maupun single repo biasa. Aku bisa menambahkan folder langsung atau men-scan folder induk lalu menggabungkan hasil scan menjadi satu Project. DevDock otomatis membaca `package.json`, mendeteksi package manager, framework, versi Node, dan file env di tiap service. Dari satu UI aku bisa mengatur env lewat preset (di level Project maupun per Service), menjalankan satu script atau seluruh service dalam Project sekaligus, melihat log real-time, memonitor CPU/RAM/storage, menyelesaikan bentrok port, dan mengakses tiap service lewat domain `nama.localhost`. Semua konfigurasi bisa di-export dan di-import ke mesin lain, dengan bantuan memperbaiki path folder yang berubah.

## User Stories

### Menambah & mengenali project dan service
1. As a developer, I want to add a folder as a new project (with 1 service) or attach it as a service inside an existing project, so that multi-folder apps like `lms-frontend` + `lms-backend` live under one project.
2. As a developer, I want to scan a parent folder for runnable codebases, so that I can register many projects/services at once.
3. As a developer, I want the scan to skip `node_modules`, `.git`, `dist`, and similar folders, so that scanning is fast and results are clean.
4. As a developer, I want the scan depth to default to 3 levels and be adjustable, so that I can balance speed and thoroughness.
5. As a developer, I want scan results shown as a checklist before saving, with an option to group selected folders into one project (e.g. "LMS") or register them separately, so that my list matches how I organize my work.
6. As a developer, I want folders already registered in DevDock to be marked in scan results, so that I don't create duplicates.
7. As a developer, I want monorepos (npm/yarn workspaces, `pnpm-workspace.yaml`) detected as one project whose workspace packages become its services, so that monorepos and multi-repo projects work with the same mental model.
8. As a developer, I want a project with only 1 service to appear flat without extra nesting, so that single-repo projects stay simple.
9. As a developer, I want DevDock to detect each service's package manager from lockfiles and the `packageManager` field, so that scripts run with the right tool.
10. As a developer, I want to override the detected package manager per service, so that I can fix wrong detections.
11. As a developer, I want DevDock to detect each service's framework (Next, Vite, Nuxt, Express, NestJS, etc.) from dependencies, so that it knows how to assign ports.
12. As a developer, I want to rename a project or service with a display name, so that the sidebar is readable.
13. As a developer, I want to remove a service or an entire project from DevDock without touching files on disk, so that cleanup is safe.
14. As a developer, I want DevDock to re-read `package.json` when it changes, so that the scripts list stays up to date.
15. As a developer, I want a service whose folder no longer exists to be flagged as missing, so that I can relocate or remove it.

### Env & preset
16. As a developer, I want to see all env files (`.env`, `.env.local`, `.env.[mode]`, `.env.[mode].local`) of a service, so that I understand its configuration.
17. As a developer, I want the final resolved env shown with the source of each key, so that I know where each value comes from.
18. As a developer, I want secret values masked by default with a reveal toggle, so that I don't leak secrets while screen sharing.
19. As a developer, I want to edit env values in a form, so that I don't have to open a text editor.
20. As a developer, I want to create presets that contain only the keys they override, so that presets stay small and focused.
21. As a developer, I want to reuse a preset across multiple projects and services, so that e.g. "DB Staging" is defined once.
22. As a developer, I want to apply presets at the Project level (inherited by all its services) and/or at the Service level, so that switching an entire project like LMS to staging takes one action while still allowing per-service overrides.
23. As a developer, I want to apply multiple presets in a chosen order, so that I can combine e.g. "DB Staging" + "Redis Local".
24. As a developer, I want later presets and service-level presets to win over earlier/project-level ones on key conflicts, so that layering is predictable.
25. As a developer, I want presets injected into the process at run time by default, so that my repo files are untouched.
26. As a developer, I want an option to write the resolved env into a chosen `.env` file of a service, so that external tools (e.g. Prisma CLI in my terminal) see the same values.
27. As a developer, I want DevDock to back up the target `.env` file before writing it, so that I can recover from mistakes.
28. As a developer, I want missing keys compared to `.env.example` highlighted, so that I notice incomplete setups.
29. As a developer, I want unknown keys not present in `.env.example` flagged, so that I spot typos.
30. As a developer, I want secret preset values stored in the OS keychain, so that they aren't stored in plain text.
31. As a developer, I want to test a database connection from an env value (PostgreSQL, MySQL/MariaDB, MongoDB, Redis), so that I know credentials work before running the app.
32. As a developer, I want DevDock to auto-detect DB URLs from common keys and URL schemes, so that I don't have to tell it which keys are databases.
33. As a developer, I want a clear success/failure message with the error reason for DB tests, so that I can fix connection problems quickly.

### Menjalankan script
34. As a developer, I want to see all `package.json` scripts of a service, so that I can run any of them with one click.
35. As a developer, I want scripts run through the service's detected package manager, so that behavior matches my terminal.
36. As a developer, I want DevDock to use my login shell's PATH, so that `node`, `pnpm`, and other tools are found from a GUI app.
37. As a developer, I want the env injected in the order shell env → service `.env*` files → project presets → service presets → DevDock-assigned PORT, so that the result is predictable.
38. As a developer, I want to run several scripts of the same service simultaneously, so that I can run e.g. `dev` and `worker` together.
39. As a developer, I want to stop a running script gracefully with escalation to force-kill after 5 seconds, so that processes don't hang.
40. As a developer, I want stopping to kill the whole process tree, so that no orphan `node` processes keep ports busy.
41. As a developer, I want to restart a running script with one click, so that I can apply env changes quickly.
42. As a developer, I want to opt-in to auto-restart per script, so that crashing dev servers come back automatically.
43. As a developer, I want auto-restart limited to 3 times in 60 seconds, so that a broken app doesn't loop forever.
44. As a developer, I want an OS notification when a process crashes or auto-restart gives up, so that I notice failures while in other apps.
45. As a developer, I want to see exit code and run duration of finished scripts, so that I can diagnose failures.

### Menjalankan project multi-service
46. As a developer, I want to start all services in a project (e.g. `lms-backend` + `lms-frontend`) with one click, so that I can boot a full system effortlessly.
47. As a developer, I want each service in a project to have a configurable default script (e.g. `dev` or `start:dev`), so that "Start All" knows what to run.
48. As a developer, I want to define the start order of services inside a project, so that dependencies (e.g. backend before frontend) come up first.
49. As a developer, I want to stop or restart all services in a project with one click, so that shutdown and reload are fast.
50. As a developer, I want project status aggregated from its services (all running / partial / crashed / stopped), so that I see project health at a glance.

### Versi Node
51. As a developer, I want DevDock to determine each service's required Node version from `.nvmrc` → `.node-version` → `engines.node` → manual override, so that each service runs on the right version.
52. As a developer, I want scripts run with that Node version via fnm, so that I don't switch versions manually.
53. As a developer, I want DevDock to offer installing a missing Node version via fnm, so that setup is one click.
54. As a developer, I want a warning when no version manager is available and the active Node doesn't match, so that I understand odd failures.
55. As a developer, I want version-manager support to be pluggable (nvm, volta, mise later), so that the project can grow as open source.

### Port
56. As a developer, I want each service to have a persistent assigned port, so that URLs stay consistent.
57. As a developer, I want the port injected via `PORT` env and/or `--port` flag depending on framework, so that it works for Vite-like tools too.
58. As a developer, I want to override the port and the injection method manually per service, so that unusual setups still work.
59. As a developer, I want DevDock to check port availability before running, so that I don't get cryptic EADDRINUSE errors.
60. As a developer, I want conflict options: use next free port, kill the owning process, or cancel, so that I can resolve conflicts quickly.
61. As a developer, I want a port inspector listing which process uses which port, so that I can find what's occupying a port.
62. As a developer, I want to kill a process from the port inspector, so that I can free a port without the terminal.

### Log
63. As a developer, I want real-time logs with ANSI colors for each running process, so that output looks like my terminal.
64. As a developer, I want logs kept in a ring buffer of about 10,000 lines per process, so that memory stays bounded.
65. As a developer, I want to search and filter logs, so that I can find errors quickly.
66. As a developer, I want to clear logs, so that I can focus on new output.
67. As a developer, I want to save logs to a file, so that I can share or archive them.
68. As a developer, I want stdout and stderr distinguishable, so that errors stand out.

### Monitoring & storage
69. As a developer, I want CPU and RAM usage per running process tree, so that I see the true cost of `pnpm dev` and its children.
70. As a developer, I want metrics refreshed every 2 seconds with a 15-minute in-memory chart, so that I can spot spikes.
71. As a developer, I want a global overview of total CPU/RAM used by all DevDock-managed processes, so that I know the overall load.
72. As a developer, I want to calculate a service's (and total project's) storage size on demand, broken down into `node_modules`, build folders (`.next`, `dist`, etc.), and the rest, so that I know what's eating disk.
73. As a developer, I want storage sizes cached and refreshed in the background, so that I see them without waiting.
74. As a developer, I want to delete `node_modules` and build/cache folders from DevDock with confirmation, so that I can free disk space.

### Tray, navigasi, quick actions
75. As a developer, I want a menu-bar/tray icon listing running projects/services with start/stop and open-in-browser, so that I can control them without the main window.
76. As a developer, I want closing the window to keep DevDock and its processes running in the tray, so that I don't kill my dev servers accidentally.
77. As a developer, I want quitting DevDock to ask whether to stop all processes, so that I make a conscious choice.
78. As a developer, I want a ⌘K command palette to find projects/services and run scripts, so that I can work from the keyboard.
79. As a developer, I want quick actions to open a service in my editor, terminal, browser, or Finder/Explorer, so that I can jump to the right tool.
80. As a developer, I want default editor and terminal auto-detected and configurable in Settings, so that quick actions use my preferred tools.
81. As a developer, I want to see the current git branch and dirty status per service, so that I know what code I'm running.
82. As a developer, I want the theme to follow the system light/dark setting, so that DevDock fits my desktop.
83. As a developer, I want a clear navigation structure showing projects and their services with running status, so that I can navigate quickly.

### Domain lokal
84. As a developer, I want each running service reachable at `name.localhost` (e.g. `lms-frontend.localhost`, `lms-backend.localhost`), so that I don't have to remember ports.
85. As a developer, I want the reverse proxy to use port 80 and fall back to another port if unavailable, so that it works without hassle.
86. As a developer, I want an optional one-time `/etc/hosts` setup (with admin prompt) for browsers/CLIs that don't resolve `*.localhost`, so that Safari and curl also work.
87. As a developer, I want to disable the local domain feature entirely, so that nothing listens on port 80 if I don't want it.
88. As a developer, I want optional HTTPS via mkcert later, so that I can test secure-only features.

### Export / import
89. As a developer, I want to export my projects, services, presets, and settings to a single file, so that I can back up or move my setup.
90. As a developer, I want to choose at export time whether secrets are included, so that I control what leaves my machine.
91. As a developer, I want included secrets encrypted with a passphrase, so that the export file is safe to transfer.
92. As a developer, I want importing on another OS (e.g. macOS → Windows) to detect invalid service paths, so that I'm told what needs fixing.
93. As a developer, I want to remap a common parent folder (e.g. `/Users/fikri/H2o` → `D:\code\H2o`) once to fix all service paths, so that migration is fast.
94. As a developer, I want to fix remaining missing services individually via a folder picker, so that nothing is left broken.
95. As a developer, I want DevDock to validate a relocated folder by matching the `package.json` name, so that I don't link the wrong service.
96. As a developer, I want imported secrets stored into the destination OS's secure store, so that security is preserved across machines.

### Open source & distribusi
97. As an open-source user, I want installers for macOS arm64 and Windows on GitHub Releases, so that I can install DevDock easily.
98. As an open-source user, I want DevDock to auto-update, so that I get fixes without reinstalling.
99. As a contributor, I want a clear `ProjectAdapter` contract, so that I can add support for other ecosystems (Laravel, Python, Go) without changing the UI or storage.
100. As a contributor, I want a clear version-manager adapter contract, so that I can add nvm/volta/mise support.

## Implementation Decisions

### Model domain: Project → Services
- Satu **Project** mewakili satu produk/sistem (misal **LMS**, **h2o-platform**, **landing-page**).
- Setiap Project memiliki **1 atau banyak Service**.
  - **Multi-repo** (`lms-frontend`, `lms-backend` di folder terpisah): 1 Project dengan beberapa Service, masing-masing menunjuk ke path foldernya sendiri.
  - **Monorepo** (`workspaces` / `pnpm-workspace.yaml`): 1 Project dengan workspace package otomatis menjadi Service-nya.
  - **Single repo**: 1 Project dengan 1 Service (UI menampilkannya datar tanpa nesting tambahan).
- Tidak ada entitas "Stack" terpisah — orkestrasi start/stop beberapa service sekaligus dan shared preset adalah fitur bawaan Project.
- Satu folder service hanya dimiliki oleh **1 Project** (path unik).

### Arsitektur
- **Tauri v2** dengan backend **Rust** dan frontend **React + Vite + TypeScript**, Tailwind + shadcn/ui, Zustand untuk state, xterm.js untuk tampilan log.
- Seluruh logika bisnis berada di sebuah **library core Rust yang tidak bergantung pada Tauri**. Lapisan Tauri hanya *thin wrapper*: menerjemahkan command dari UI menjadi panggilan core dan meneruskan event core (log line, status proses, metrik) ke UI. Ini sekaligus menjadi seam testing utama.
- Akses ke hal yang spesifik OS di-abstraksi di balik interface kecil yang di-inject ke core: **SecretStore** (keychain), **ShellEnvProvider** (PATH login shell), **Notifier** (notifikasi OS). Implementasi nyata dipakai di app; implementasi in-memory dipakai di test.

### Modul core
- **ProjectRegistry**: CRUD Project & Service, urutan start service dalam project, pindah/gabung service, deteksi folder hilang, relokasi.
- **Scanner**: scan folder dengan kedalaman & ignore list; menghasilkan kandidat service & monorepo agar pengguna dapat memilih untuk menggabungkannya ke satu Project atau mendaftarkannya terpisah.
- **ProjectAdapter (kontrak)**: `detect(folder)`, `describe(service)` → package manager, framework, scripts, monorepo sub-packages; `build_run_command(service, script, runtime)`; `env_file_conventions()`; `port_strategy(framework)`. Implementasi pertama: **NodeAdapter**.
- **EnvResolver**: membaca file `.env*` service sesuai prioritas dotenv, menerapkan project presets lalu service presets berurutan, menghasilkan env final dengan atribusi sumber per key; validasi terhadap `.env.example`; mode tulis ke file dengan backup.
- **PresetStore**: preset sebagai himpunan override key; nilai rahasia disimpan via SecretStore, metadata di SQLite. Dapat dipasang terurut di level Project maupun per Service.
- **DbConnectionTester**: deteksi URL DB dari env (key umum + skema `postgres://`, `mysql://`, `mongodb://`, `redis://`), lalu login + query/ping nyata.
- **RuntimeResolver**: menentukan versi Node per service (`.nvmrc` → `.node-version` → `engines.node` → override) dan menyiapkan environment via **VersionManager adapter** (pertama: **fnm**), termasuk install versi yang hilang.
- **PortManager**: alokasi port persisten per service, cek ketersediaan, cari port kosong berikutnya, inspector (port → PID/nama proses), kill.
- **ProcessManager**: spawn script service dengan env final; kelola process group/tree; stop SIGTERM → SIGKILL setelah 5 detik (Windows: Job Object); restart; auto-restart opt-in (maks 3× / 60 detik); emit event status & exit code; serta orkestrasi Start All / Stop All berurutan di level Project dengan status agregat.
- **LogBuffer**: ring buffer ~10.000 baris per proses, menandai stdout/stderr, mendukung search dan export ke file.
- **Monitor**: sampling `sysinfo` tiap 2 detik, agregasi per pohon proses (dan total per project/global), simpan riwayat 15 menit di memori.
- **StorageAnalyzer**: kalkulasi ukuran folder per service & total project dengan breakdown (`node_modules`, folder build, lainnya), cache, refresh background, aksi hapus dengan konfirmasi.
- **GitInfo**: branch aktif & status dirty per service (read-only).
- **LocalDomainProxy**: reverse proxy HTTP `name.localhost` → port service; port 80 dengan fallback; bisa dimatikan; helper opsional untuk `/etc/hosts`.
- **ExportImport**: serialisasi project, service, preset, settings ke satu file berversi; secret opsional terenkripsi passphrase; import mendeteksi path service tidak valid, menyarankan remap folder induk bersama, dan memvalidasi relokasi lewat nama `package.json`.
- **Settings**: editor/terminal default (auto-detect), tema, opsi proxy, interval monitor.

### Penyimpanan & skema
- **SQLite** di direktori app data OS. Entitas utama: `project` (nama, root_path opsional untuk monorepo), `service` (project_id, path unik, nama, adapter, start_order, default_script, override PM/port/Node), `preset`, `preset_entry` (key, flag secret, nilai non-rahasia), `project_preset` (urutan), `service_preset` (urutan), `script_setting` (auto-restart), `setting`.
- Nilai secret **tidak** disimpan di SQLite; hanya referensi ke SecretStore (crate `keyring`: Keychain macOS / Credential Manager Windows).
- File export memiliki **nomor versi format** agar migrasi format di masa depan aman.

### Perilaku & kontrak penting
- Urutan resolusi env saat run: `shell env → file .env* service → project presets (berurutan) → service presets (berurutan) → PORT dari DevDock` (yang belakang menang).
- Default apply preset: **inject saat spawn**; mode "tulis ke `.env`" opsional per service dengan file target pilihan dan backup otomatis.
- PATH dibaca dari login shell pengguna saat startup (dan dapat di-refresh), karena app GUI macOS tidak mewarisi PATH shell.
- Menutup window → app tetap di tray; Quit → konfirmasi stop semua proses.
- Log dan metrik **tidak** dipersist otomatis.

### Urutan pengerjaan
1. Fondasi: Tauri, SQLite, ShellEnvProvider, kontrak adapter + NodeAdapter.
2. Project & Service: tambah/scan, gabung multi-folder jadi 1 project, monorepo, deteksi PM & framework.
3. Env & preset (level project & service), SecretStore, validasi `.env.example`, test koneksi DB.
4. Run script, log, port & inspector, versi Node (fnm) — app mulai bisa dipakai sehari-hari.
5. Monitoring CPU/RAM/storage, auto-restart, notifikasi.
6. Multi-service orchestration (Start/Stop All berurutan), tray, quick actions, git info, command palette.
7. Export/import + remap path.
8. Domain lokal `*.localhost`.
9. Kesiapan Windows: CI build (GitHub Actions), packaging, updater.

## Testing Decisions

- **Prinsip**: test hanya perilaku eksternal lewat API publik core, bukan detail internal. Test harus tetap lulus jika implementasi internal direfaktor.
- **Seam utama (satu-satunya seam besar)**: **API publik library core Rust**. Test integrasi memanggil core seperti yang dilakukan lapisan Tauri, memakai:
  - **folder fixture** di direktori sementara (service Node palsu dengan berbagai lockfile, multi-folder project, monorepo, file `.env*`, `.nvmrc`, `.env.example`);
  - **proses nyata** yang ringan (script yang mencetak log, listen di port, crash dengan exit code tertentu, spawn child) untuk menguji ProcessManager, PortManager, LogBuffer, dan Monitor;
  - implementasi in-memory untuk **SecretStore**, **ShellEnvProvider**, dan **Notifier**.
- **Modul yang dites lewat seam ini**: ProjectRegistry, Scanner, NodeAdapter, EnvResolver (termasuk urutan project preset vs service preset), PresetStore, RuntimeResolver (dengan fnm palsu di PATH fixture), PortManager, ProcessManager (stop tree, escalation, auto-restart limit, multi-service Start/Stop All), LogBuffer, ExportImport (round-trip, enkripsi, remap path), StorageAnalyzer.
- **DbConnectionTester**: dites terhadap container DB nyata (Docker) dalam suite terpisah yang opsional/di-skip jika Docker tidak tersedia.
- **LocalDomainProxy**: dites dengan menjalankan proxy di port tinggi acak dan upstream HTTP palsu.
- **Frontend**: tipis, tanpa logika bisnis; tidak ada test unit komponen di awal. Smoke test end-to-end (app terbuka, tambah project fixture, jalankan script, log muncul) ditambahkan saat milestone 4.
- **CI**: test core dijalankan di macOS dan Windows di GitHub Actions untuk menangkap perbedaan perilaku proses/path antar-OS.
- **Prior art**: belum ada — repo masih kosong; pola test ini akan menjadi acuan.

## Out of Scope

- Menjalankan / mengelola database atau service lokal (Postgres, Redis, Docker container) — dinyalakan manual oleh pengguna; DevDock hanya test koneksi.
- Satu folder service dipakai oleh lebih dari satu Project sekaligus (setiap service dimiliki tepat 1 Project).
- Ekosistem selain Node.js (Laravel/PHP, Python, Go, dll.) — hanya disiapkan kontrak adapternya.
- Version manager selain fnm (nvm, volta, mise) — hanya disiapkan kontrak adapternya.
- Persistensi log dan metrik ke disk secara otomatis.
- HTTPS untuk domain lokal (opsi lanjutan, bukan bagian rilis awal).
- Code signing & notarization Apple, Homebrew cask (ditunda).
- Linux sebagai target resmi (mungkin bekerja, tapi tidak dijamin).
- Sinkronisasi cloud / multi-user / fitur tim.

## Further Notes

- Environment pengembang saat ini: macOS 26.6 arm64, Node v24, npm/pnpm/yarn, fnm, git, Docker. Toolchain Rust perlu dipastikan sebelum milestone 1.
- Tanpa sertifikat Apple Developer, pengguna lain akan melihat peringatan Gatekeeper saat membuka app.
- Safari dan tool CLI belum tentu me-resolve `*.localhost`; disediakan helper `/etc/hosts` opsional.
- Driver DB (`sqlx`, `mongodb`, `redis`) menambah beberapa MB ke binary — masih dalam batas "ringan".
- Lisensi **MIT**, repo GitHub, rilis via GitHub Releases.
