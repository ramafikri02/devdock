import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Code2,
  Database,
  Download,
  Globe,
  Loader2,
  Moon,
  RefreshCw,
  ShieldCheck,
  Sun,
  Terminal,
  Upload,
} from "lucide-react";
import {
  ExportConfigModal,
  ImportConfigModal,
} from "@/components/settings/ExportImportModal";
import {
  type HostsSyncPreview,
  openExternalUrl,
  previewHostsSync,
  setDefaultEditor,
  setDefaultTerminal,
  syncEtcHosts,
} from "@/lib/tauri";
import { useAppStore } from "@/store/appStore";
import { cn } from "@/lib/cn";

export function SettingsView() {
  const bootstrap = useAppStore((s) => s.bootstrap);
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const refreshPath = useAppStore((s) => s.refreshPath);
  const proxyStatus = useAppStore((s) => s.proxyStatus);
  const setProxyEnabled = useAppStore((s) => s.setProxyEnabled);
  const toolSettings = useAppStore((s) => s.toolSettings);
  const setToolSettings = useAppStore((s) => s.setToolSettings);
  const pushToast = useAppStore((s) => s.pushToast);

  const [proxyBusy, setProxyBusy] = useState(false);
  const [hostsPreview, setHostsPreview] = useState<HostsSyncPreview | null>(null);
  const [syncingHosts, setSyncingHosts] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const loadHostsPreview = async () => {
    try {
      const preview = await previewHostsSync();
      setHostsPreview(preview);
    } catch {
      // Non-fatal in browser preview
    }
  };

  useEffect(() => {
    void loadHostsPreview();
  }, [proxyStatus?.routes.length]);

  const handleToggleProxy = async () => {
    setProxyBusy(true);
    try {
      await setProxyEnabled(!(proxyStatus?.enabled ?? true));
    } catch (err) {
      pushToast({
        title: "Gagal mengubah status reverse proxy",
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    } finally {
      setProxyBusy(false);
    }
  };

  const handleSyncHosts = async () => {
    setSyncingHosts(true);
    try {
      const res = await syncEtcHosts();
      await loadHostsPreview();
      pushToast({
        title: `${res.domainsWritten} domain disinkronkan ke ${res.hostsPath}`,
        variant: "success",
      });
    } catch (err) {
      pushToast({
        title: "Gagal memperbarui file hosts",
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    } finally {
      setSyncingHosts(false);
    }
  };

  return (
    <div className="animate-view-enter mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="text-[19px] font-semibold tracking-tight text-fg">
          Settings
        </h1>
        <p className="mt-0.5 text-[13px] text-fg-muted">
          Pengaturan tema, domain lokal *.localhost, environment shell PATH, dan informasi penyimpanan lokal.
        </p>
      </div>

      {/* Appearance */}
      <section className="rounded-[10px] border border-border bg-surface p-4">
        <h2 className="text-[14px] font-semibold text-fg">Tampilan</h2>
        <p className="mt-0.5 text-[12.5px] text-fg-muted">
          Pilih tema gelap (default) atau tema terang dengan kontras tinggi.
        </p>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => void setTheme("dark")}
            className={cn(
              "btn-press flex h-8 items-center gap-2 rounded-[7px] border px-3 text-[13px] font-medium",
              theme === "dark"
                ? "border-info bg-info-soft text-fg"
                : "border-border-strong bg-surface-2 text-fg-muted hover:text-fg",
            )}
          >
            <Moon className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Dark Mode</span>
          </button>
          <button
            type="button"
            onClick={() => void setTheme("light")}
            className={cn(
              "btn-press flex h-8 items-center gap-2 rounded-[7px] border px-3 text-[13px] font-medium",
              theme === "light"
                ? "border-info bg-info-soft text-fg"
                : "border-border-strong bg-surface-2 text-fg-muted hover:text-fg",
            )}
          >
            <Sun className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Light Mode</span>
          </button>
        </div>
      </section>

      {/* Local Domains Reverse Proxy */}
      <section className="rounded-[10px] border border-border bg-surface p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-[14px] font-semibold text-fg">
              <Globe className="h-4 w-4 text-info" aria-hidden="true" />
              <span>Domain Lokal (*.localhost Reverse Proxy)</span>
            </h2>
            <p className="mt-0.5 text-[12.5px] text-fg-muted">
              Akses setiap service melalui URL seperti{" "}
              <span className="font-mono text-fg-2">service.localhost</span> (mendukung WebSocket/HMR). Mencoba port 80 lebih dulu dan fallback otomatis ke port :{proxyStatus?.fallbackPort ?? 2999} jika port 80 membutuhkan hak admin.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={proxyStatus?.enabled ?? true}
            disabled={proxyBusy}
            onClick={() => void handleToggleProxy()}
            className={cn(
              "btn-press flex h-8 shrink-0 items-center gap-2 rounded-[7px] border px-3 text-[12.5px] font-semibold disabled:opacity-50",
              proxyStatus?.running
                ? "border-accent/50 bg-accent-soft text-accent"
                : "border-border-strong bg-surface-2 text-fg-muted hover:text-fg",
            )}
          >
            {proxyBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : null}
            <span>
              {proxyStatus?.running
                ? `Aktif (:${proxyStatus.boundPort})`
                : proxyStatus?.enabled
                  ? "Mencoba aktif…"
                  : "Nonaktif"}
            </span>
          </button>
        </div>

        {proxyStatus?.usedFallback ? (
          <div className="mt-3 rounded-[8px] border border-warn/35 bg-warn-soft px-3 py-2 text-[12px] text-warn">
            Port 80 tidak dapat di-bind tanpa privilege root, sehingga proxy aktif di port fallback{" "}
            <span className="font-mono font-semibold">:{proxyStatus.boundPort}</span>.
          </div>
        ) : null}

        {proxyStatus?.error ? (
          <div className="mt-3 rounded-[8px] border border-danger/35 bg-danger-soft px-3 py-2 text-[12px] text-danger">
            {proxyStatus.error}
          </div>
        ) : null}

        {proxyStatus && proxyStatus.routes.length > 0 ? (
          <div className="mt-3 space-y-1.5 rounded-[8px] border border-border bg-surface-2 p-3">
            <div className="text-[11px] font-semibold tracking-wider text-fg-faint uppercase">
              Rute Domain Terdaftar ({proxyStatus.routes.length})
            </div>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {proxyStatus.routes.map((route) => (
                <div
                  key={route.serviceId}
                  className="flex items-center justify-between gap-2 rounded-[6px] border border-border bg-surface px-2.5 py-1.5 text-[12px]"
                >
                  <button
                    type="button"
                    disabled={!proxyStatus.running}
                    onClick={() => void openExternalUrl(route.url)}
                    className="truncate font-mono text-info hover:underline disabled:text-fg-muted disabled:no-underline"
                  >
                    {route.url}
                  </button>
                  <span className="shrink-0 font-mono text-[11px] text-fg-faint tabular-nums">
                    → :{route.targetPort}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* Optional /etc/hosts sync helper */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-border bg-surface-2 p-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-fg">
              <ShieldCheck className="h-3.5 w-3.5 text-info" aria-hidden="true" />
              <span>Kompatibilitas Safari & CLI (/etc/hosts)</span>
              {hostsPreview?.alreadySynced ? (
                <span className="inline-flex items-center gap-1 rounded bg-accent-soft px-1.5 py-0.5 text-[10.5px] text-accent">
                  <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                  Tersinkron
                </span>
              ) : null}
            </div>
            <p className="mt-0.5 text-[11.5px] text-fg-muted">
              Opsional: tulis entri <span className="font-mono">127.0.0.1</span> ke{" "}
              <span className="font-mono">{hostsPreview?.hostsPath ?? "/etc/hosts"}</span> dengan prompt admin OS sekali klik agar Safari dan <span className="font-mono">curl</span> langsung mengenali domain lokal.
            </p>
          </div>
          <button
            type="button"
            disabled={syncingHosts || !hostsPreview || hostsPreview.domains.length === 0}
            onClick={() => void handleSyncHosts()}
            className="btn-press flex h-8 shrink-0 items-center gap-1.5 rounded-[7px] border border-border-strong bg-surface px-3 text-[12px] font-medium text-fg-2 hover:bg-surface-hover hover:text-fg disabled:opacity-45"
          >
            {syncingHosts ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            <span>{syncingHosts ? "Menyinkronkan…" : "Sinkronkan /etc/hosts"}</span>
          </button>
        </div>
      </section>

      {/* Quick Actions: Default Editor & Terminal */}
      <section className="rounded-[10px] border border-border bg-surface p-4">
        <h2 className="flex items-center gap-2 text-[14px] font-semibold text-fg">
          <Code2 className="h-4 w-4 text-info" aria-hidden="true" />
          <span>Quick Actions (Editor & Terminal Default)</span>
        </h2>
        <p className="mt-0.5 text-[12.5px] text-fg-muted">
          DevDock mendeteksi editor dan terminal yang terpasang di mesin Anda untuk tombol aksi cepat di Service Workbench.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="default-editor-select"
              className="text-[12px] font-medium text-fg-2"
            >
              Editor Default
            </label>
            <select
              id="default-editor-select"
              value={toolSettings?.defaultEditor ?? ""}
              onChange={(e) => {
                const val = e.target.value || null;
                void setDefaultEditor(val)
                  .then((updated) => {
                    setToolSettings(updated);
                    pushToast({
                      title: "Editor default diperbarui",
                      variant: "success",
                    });
                  })
                  .catch((err) => {
                    pushToast({
                      title: "Gagal menyimpan editor default",
                      description: err instanceof Error ? err.message : String(err),
                      variant: "danger",
                    });
                  });
              }}
              className="mt-1.5 h-8 w-full rounded-[7px] border border-border-strong bg-surface-2 px-2.5 text-[12.5px] text-fg"
            >
              <option value="">Deteksi otomatis</option>
              {(toolSettings?.detectedEditors ?? []).map((ed) => (
                <option key={ed.id} value={ed.id}>
                  {ed.name} {ed.available ? "(terpasang)" : "(tidak terdeteksi)"}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="default-terminal-select"
              className="text-[12px] font-medium text-fg-2"
            >
              Terminal Default
            </label>
            <select
              id="default-terminal-select"
              value={toolSettings?.defaultTerminal ?? ""}
              onChange={(e) => {
                const val = e.target.value || null;
                void setDefaultTerminal(val)
                  .then((updated) => {
                    setToolSettings(updated);
                    pushToast({
                      title: "Terminal default diperbarui",
                      variant: "success",
                    });
                  })
                  .catch((err) => {
                    pushToast({
                      title: "Gagal menyimpan terminal default",
                      description: err instanceof Error ? err.message : String(err),
                      variant: "danger",
                    });
                  });
              }}
              className="mt-1.5 h-8 w-full rounded-[7px] border border-border-strong bg-surface-2 px-2.5 text-[12.5px] text-fg"
            >
              <option value="">Deteksi otomatis</option>
              {(toolSettings?.detectedTerminals ?? []).map((term) => (
                <option key={term.id} value={term.id}>
                  {term.name} {term.available ? "(terpasang)" : "(tidak terdeteksi)"}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* Shell PATH */}
      <section className="rounded-[10px] border border-border bg-surface p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-[14px] font-semibold text-fg">
              <Terminal className="h-4 w-4 text-info" aria-hidden="true" />
              <span>Login Shell PATH</span>
            </h2>
            <p className="mt-0.5 text-[12.5px] text-fg-muted">
              Diambil dari login shell pengguna agar `node`, `pnpm`, `yarn`, `bun`, dan `fnm` ditemukan dari aplikasi GUI.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refreshPath()}
            className="btn-press flex h-8 shrink-0 items-center gap-1.5 rounded-[7px] border border-border-strong bg-surface-2 px-3 text-[12.5px] font-medium text-fg-2 hover:bg-surface-hover hover:text-fg"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Refresh PATH</span>
          </button>
        </div>
        <div className="mt-3 max-h-28 overflow-y-auto rounded-[8px] border border-border bg-surface-2 p-2.5 font-mono text-[11.5px] break-all text-fg-2 select-text">
          {bootstrap?.shellPath || "Memuat PATH…"}
        </div>
      </section>

      {/* Database */}
      <section className="rounded-[10px] border border-border bg-surface p-4">
        <h2 className="flex items-center gap-2 text-[14px] font-semibold text-fg">
          <Database className="h-4 w-4 text-accent" aria-hidden="true" />
          <span>SQLite Storage</span>
        </h2>
        <div className="mt-2 space-y-1 font-mono text-[12px] text-fg-muted select-text">
          <div>Path: {bootstrap?.dbPath ?? "—"}</div>
          <div>Schema version: v{bootstrap?.schemaVersion ?? "—"}</div>
          <div>Adapters: {bootstrap?.adapters.join(", ") ?? "—"}</div>
        </div>
      </section>

      {/* Export / Import */}
      <section className="rounded-[10px] border border-border bg-surface p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-[14px] font-semibold text-fg">
              Export & Import Konfigurasi
            </h2>
            <p className="mt-0.5 text-[12.5px] text-fg-muted">
              Cadangkan atau pindahkan seluruh project, service, preset (termasuk secret terenkripsi), dan settings antar macOS dan Windows dengan remap path otomatis.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setExportOpen(true)}
              className="btn-press flex h-8 items-center gap-1.5 rounded-[7px] border border-border-strong bg-surface-2 px-3 text-[12.5px] font-medium text-fg-2 hover:bg-surface-hover hover:text-fg"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Export…</span>
            </button>
            <button
              type="button"
              onClick={() => setImportOpen(true)}
              className="btn-press flex h-8 items-center gap-1.5 rounded-[7px] bg-accent px-3 text-[12.5px] font-semibold text-accent-fg hover:opacity-95"
            >
              <Upload className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Import…</span>
            </button>
          </div>
        </div>
      </section>

      <ExportConfigModal open={exportOpen} onClose={() => setExportOpen(false)} />
      <ImportConfigModal open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  );
}
