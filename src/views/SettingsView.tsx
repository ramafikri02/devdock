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
  type AvailableUpdateInfo,
  checkForAppUpdate,
  installAppUpdateAndRelaunch,
} from "@/lib/updater";
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
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [updateProgress, setUpdateProgress] = useState<number | null>(null);
  const [availableUpdate, setAvailableUpdate] = useState<AvailableUpdateInfo | null>(null);
  const [updateCheckedEmpty, setUpdateCheckedEmpty] = useState(false);

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
        title: "Failed to toggle reverse proxy",
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
        title: `Synced ${res.domainsWritten} ${res.domainsWritten === 1 ? "domain" : "domains"} to ${res.hostsPath}`,
        variant: "success",
      });
    } catch (err) {
      pushToast({
        title: "Failed to update hosts file",
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    } finally {
      setSyncingHosts(false);
    }
  };

  return (
    <div className="animate-view-enter w-full space-y-6 p-6">
      <div>
        <h1 className="text-[19px] font-semibold tracking-tight text-fg">
          Settings
        </h1>
        <p className="mt-0.5 text-[13px] text-fg-muted">
          Appearance, *.localhost local domains, login shell PATH, and local storage info.
        </p>
      </div>

      {/* Appearance */}
      <section className="rounded-[10px] border border-border bg-surface p-4">
        <h2 className="text-[14px] font-semibold text-fg">Appearance</h2>
        <p className="mt-0.5 text-[12.5px] text-fg-muted">
          Choose dark mode (default) or high-contrast light mode.
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
              <span>Local Domains (*.localhost Reverse Proxy)</span>
            </h2>
            <p className="mt-0.5 text-[12.5px] text-fg-muted">
              Access each service via URLs like{" "}
              <span className="font-mono text-fg-2">service.localhost</span> (WebSocket/HMR supported). Binds port 80 first and automatically falls back to :{proxyStatus?.fallbackPort ?? 2999} if port 80 requires elevated privileges.
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
                ? `Active (:${proxyStatus.boundPort})`
                : proxyStatus?.enabled
                  ? "Starting…"
                  : "Disabled"}
            </span>
          </button>
        </div>

        {proxyStatus?.usedFallback ? (
          <div className="mt-3 rounded-[8px] border border-warn/35 bg-warn-soft px-3 py-2 text-[12px] text-warn">
            Port 80 cannot be bound without root privileges, so the proxy is running on fallback port{" "}
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
              Registered Domain Routes ({proxyStatus.routes.length})
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
              <span>Safari & CLI Compatibility (/etc/hosts)</span>
              {hostsPreview?.alreadySynced ? (
                <span className="inline-flex items-center gap-1 rounded bg-accent-soft px-1.5 py-0.5 text-[10.5px] text-accent">
                  <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                  Synced
                </span>
              ) : null}
            </div>
            <p className="mt-0.5 text-[11.5px] text-fg-muted">
              Optional: write <span className="font-mono">127.0.0.1</span> entries to{" "}
              <span className="font-mono">{hostsPreview?.hostsPath ?? "/etc/hosts"}</span> with a one-click OS admin prompt so Safari and <span className="font-mono">curl</span> resolve local domains directly.
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
            <span>{syncingHosts ? "Syncing…" : "Sync /etc/hosts"}</span>
          </button>
        </div>
      </section>

      {/* Quick Actions: Default Editor & Terminal */}
      <section className="rounded-[10px] border border-border bg-surface p-4">
        <h2 className="flex items-center gap-2 text-[14px] font-semibold text-fg">
          <Code2 className="h-4 w-4 text-info" aria-hidden="true" />
          <span>Quick Actions (Default Editor & Terminal)</span>
        </h2>
        <p className="mt-0.5 text-[12.5px] text-fg-muted">
          DevDock detects editors and terminals installed on your machine for quick action buttons in the Service Workbench.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="default-editor-select"
              className="text-[12px] font-medium text-fg-2"
            >
              Default Editor
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
                      title: "Default editor updated",
                      variant: "success",
                    });
                  })
                  .catch((err) => {
                    pushToast({
                      title: "Failed to save default editor",
                      description: err instanceof Error ? err.message : String(err),
                      variant: "danger",
                    });
                  });
              }}
              className="mt-1.5 h-8 w-full rounded-[7px] border border-border-strong bg-surface-2 px-2.5 text-[12.5px] text-fg"
            >
              <option value="">Auto-detect</option>
              {(toolSettings?.detectedEditors ?? []).map((ed) => (
                <option key={ed.id} value={ed.id}>
                  {ed.name} {ed.available ? "(installed)" : "(not detected)"}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="default-terminal-select"
              className="text-[12px] font-medium text-fg-2"
            >
              Default Terminal
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
                      title: "Default terminal updated",
                      variant: "success",
                    });
                  })
                  .catch((err) => {
                    pushToast({
                      title: "Failed to save default terminal",
                      description: err instanceof Error ? err.message : String(err),
                      variant: "danger",
                    });
                  });
              }}
              className="mt-1.5 h-8 w-full rounded-[7px] border border-border-strong bg-surface-2 px-2.5 text-[12.5px] text-fg"
            >
              <option value="">Auto-detect</option>
              {(toolSettings?.detectedTerminals ?? []).map((term) => (
                <option key={term.id} value={term.id}>
                  {term.name} {term.available ? "(installed)" : "(not detected)"}
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
              Loaded from your login shell so `node`, `pnpm`, `yarn`, `bun`, and `fnm` are available from the GUI app.
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
          {bootstrap?.shellPath || "Loading PATH…"}
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
              Export & Import Configuration
            </h2>
            <p className="mt-0.5 text-[12.5px] text-fg-muted">
              Back up or migrate all projects, services, presets (including encrypted secrets), and settings across macOS and Windows with automatic path remapping.
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

      {/* App Auto-Updater */}
      <section className="rounded-[10px] border border-border bg-surface p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-[14px] font-semibold text-fg">
              App Updates
            </h2>
            <p className="mt-0.5 text-[12.5px] text-fg-muted">
              Installed version:{" "}
              <span className="font-mono font-medium text-fg">
                v{bootstrap?.version ?? "0.1.0"}
              </span>
              . DevDock checks official releases on GitHub Releases when requested.
            </p>
          </div>
          <button
            type="button"
            disabled={checkingUpdate || installingUpdate}
            onClick={() => {
              setCheckingUpdate(true);
              setUpdateCheckedEmpty(false);
              void checkForAppUpdate()
                .then((res) => {
                  setAvailableUpdate(res);
                  if (!res) setUpdateCheckedEmpty(true);
                })
                .catch((err) => {
                  pushToast({
                    title: "Failed to check for updates",
                    description: err instanceof Error ? err.message : String(err),
                    variant: "danger",
                  });
                })
                .finally(() => setCheckingUpdate(false));
            }}
            className="btn-press flex h-8 items-center gap-1.5 rounded-[7px] border border-border-strong bg-surface-2 px-3 text-[12.5px] font-medium text-fg-2 hover:bg-surface-hover hover:text-fg disabled:opacity-50"
          >
            {checkingUpdate ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            <span>{checkingUpdate ? "Checking…" : "Check for Updates"}</span>
          </button>
        </div>

        {updateCheckedEmpty && !availableUpdate ? (
          <div className="mt-3 rounded-[8px] border border-border bg-surface-2 px-3 py-2 text-[12px] text-fg-muted">
            You are already on the latest version.
          </div>
        ) : null}

        {availableUpdate ? (
          <div className="mt-3 rounded-[8px] border border-info/40 bg-info-soft p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-[13px] font-semibold text-fg">
                  Update available: v{availableUpdate.version}
                </div>
                {availableUpdate.body ? (
                  <p className="mt-0.5 text-[12px] text-fg-2">{availableUpdate.body}</p>
                ) : null}
              </div>
              <button
                type="button"
                disabled={installingUpdate}
                onClick={() => {
                  setInstallingUpdate(true);
                  setUpdateProgress(0);
                  void installAppUpdateAndRelaunch(availableUpdate.raw, (pct) => {
                    setUpdateProgress(pct);
                  }).catch((err) => {
                    setInstallingUpdate(false);
                    pushToast({
                      title: "Failed to install update",
                      description: err instanceof Error ? err.message : String(err),
                      variant: "danger",
                    });
                  });
                }}
                className="btn-press flex h-8 items-center gap-1.5 rounded-[7px] bg-accent px-3 text-[12.5px] font-semibold text-accent-fg hover:opacity-95 disabled:opacity-50"
              >
                {installingUpdate ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                <span>
                  {installingUpdate
                    ? updateProgress !== null
                      ? `Downloading (${updateProgress}%)…`
                      : "Downloading…"
                    : "Install & Restart"}
                </span>
              </button>
            </div>
          </div>
        ) : null}
      </section>

      <ExportConfigModal open={exportOpen} onClose={() => setExportOpen(false)} />
      <ImportConfigModal open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  );
}
