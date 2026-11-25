# DevDock

Lightweight desktop workspace manager (Tauri v2 + Rust + React) for local Node.js services, monorepos, and multi-folder projects.

## Key Features

- **Project → Services Model:** Register single-repo folders, monorepos (`workspaces` / `pnpm-workspace.yaml`), or group multiple separate folders (e.g. `lms-frontend` + `lms-backend`) under one unified Project Hub.
- **Layered Env & OS Keychain Presets:** Inspect `.env*` precedence, validate against `.env.example`, test live database connections (PostgreSQL, MySQL/MariaDB, MongoDB, Redis), and store secret preset values in macOS Keychain / Windows Credential Manager.
- **Process Tree Lifecycle & Scoped Log Drawer:** Run `package.json` scripts via detected package managers (`npm`, `pnpm`, `yarn`, `bun`) and `fnm` Node versions, terminate full process trees (`SIGTERM → SIGKILL` on Unix, Job Objects on Windows), enable opt-in auto-restart (`3× / 60s`), and stream ANSI logs into a persistent scoped xterm.js drawer (`⌘J`).
- **Port Management & `*.localhost` Reverse Proxy:** Persistent port assignment, pre-flight conflict resolution, system-wide Port Inspector, and built-in HTTP/WebSocket reverse proxy (`service.localhost`).
- **Monitoring, Storage & Desktop Ergonomics:** 2-second process-tree CPU/RAM metrics, `node_modules` & build-cache cleanup, System Tray controls, Quick Actions (Editor, Terminal, Browser, Finder/Explorer), Git branch/dirty status, `⌘K` Command Palette, and passphrase-encrypted Cross-OS Export/Import with path remapping.

## Installation

Download the latest installer for **macOS Apple Silicon (`.dmg`)** or **Windows (`.msi` / `.exe`)** from [GitHub Releases](https://github.com/ramafikri02/devdock/releases).

### macOS Gatekeeper Note (Unsigned Builds)

Pre-built open-source macOS binaries are currently distributed without Apple Developer notarization. If macOS displays *"DevDock is damaged and can't be opened"* or blocks launch via Gatekeeper:

1. Move `DevDock.app` to `/Applications`.
2. Remove the quarantine attribute:
   ```bash
   xattr -cr /Applications/DevDock.app
   ```
3. Or open **System Settings → Privacy & Security** and click **Open Anyway**.

## Local Development

Prerequisites: Rust stable (`cargo`), Node.js 20+, `pnpm`.

```bash
pnpm install
pnpm typecheck
pnpm build
cargo test --workspace
pnpm tauri dev
```

Run the automated end-to-end smoke test (builds and launches the real desktop binary against a temporary Node.js fixture):

```bash
pnpm test:e2e
```

## Release & Auto-Updater Signing

DevDock uses Tauri's updater (`latest.json` on GitHub Releases). To publish signed releases from your fork:

1. Generate a signing keypair:
   ```bash
   pnpm tauri signer generate -w ~/.tauri/devdock.key
   ```
2. Put the contents of `~/.tauri/devdock.key.pub` into `plugins.updater.pubkey` in `src-tauri/tauri.conf.json`.
3. Add `TAURI_SIGNING_PRIVATE_KEY` (and optional `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`) to your repository's GitHub Actions Secrets.
4. Push a tag `v*` (e.g. `git tag v0.1.0 && git push origin v0.1.0`) to trigger `.github/workflows/release.yml`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for architecture details and guides on implementing new `ProjectAdapter` ecosystems and `VersionManager` adapters.

## License

[MIT](LICENSE)
