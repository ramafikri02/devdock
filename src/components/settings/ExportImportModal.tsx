import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FolderOpen,
  FolderSync,
  Loader2,
  Lock,
  Upload,
  X,
} from "lucide-react";
import {
  type ImportPreview,
  applyImportFile,
  exportConfigToFile,
  pickExportSaveDialog,
  pickFolderDialog,
  pickImportOpenDialog,
  previewImportFile,
} from "@/lib/tauri";
import { useAppStore } from "@/store/appStore";

interface ExportModalProps {
  open: boolean;
  onClose: () => void;
}

export function ExportConfigModal({ open, onClose }: ExportModalProps) {
  const pushToast = useAppStore((s) => s.pushToast);
  const [includeSecrets, setIncludeSecrets] = useState(true);
  const [passphrase, setPassphrase] = useState("");
  const [confirmPassphrase, setConfirmPassphrase] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const handleExport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (includeSecrets) {
      if (!passphrase.trim()) {
        pushToast({
          title: "Passphrase required",
          description: "Enter a passphrase to encrypt secrets.",
          variant: "warn",
        });
        return;
      }
      if (passphrase !== confirmPassphrase) {
        pushToast({
          title: "Passphrases do not match",
          description: "Make sure both passphrase fields match exactly.",
          variant: "warn",
        });
        return;
      }
    }

    const outputPath = await pickExportSaveDialog("devdock-backup.json");
    if (!outputPath) return;

    setBusy(true);
    try {
      const summary = await exportConfigToFile(
        outputPath,
        includeSecrets,
        includeSecrets ? passphrase : null,
      );
      pushToast({
        title: `Export complete (${summary.projectCount} ${summary.projectCount === 1 ? "project" : "projects"}, ${summary.presetCount} ${summary.presetCount === 1 ? "preset" : "presets"})`,
        description: summary.includesSecrets
          ? `${summary.secretCount} ${summary.secretCount === 1 ? "secret" : "secrets"} encrypted to ${summary.outputPath}`
          : `Saved without secrets to ${summary.outputPath}`,
        variant: "success",
      });
      setPassphrase("");
      setConfirmPassphrase("");
      onClose();
    } catch (err) {
      pushToast({
        title: "Failed to export configuration",
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Export Configuration"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-[1px]"
      onClick={onClose}
    >
      <form
        onSubmit={(e) => void handleExport(e)}
        onClick={(e) => e.stopPropagation()}
        className="animate-modal-enter w-full max-w-md rounded-[12px] border border-border-strong bg-surface p-5 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-2 text-[15px] font-semibold text-fg">
              <Download className="h-4 w-4 text-info" aria-hidden="true" />
              <span>Export DevDock Configuration</span>
            </h2>
            <p className="mt-0.5 text-[12.5px] text-fg-muted">
              Save projects, services, start order, presets, and settings to a versioned file for backup or OS migration.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close export dialog"
            className="rounded p-1 text-fg-muted hover:bg-surface-hover hover:text-fg"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <label className="flex cursor-pointer items-start gap-2.5 rounded-[8px] border border-border bg-surface-2 p-3">
            <input
              type="checkbox"
              checked={includeSecrets}
              onChange={(e) => setIncludeSecrets(e.target.checked)}
              className="mt-0.5 accent-accent"
            />
            <div>
              <div className="flex items-center gap-1.5 text-[13px] font-medium text-fg">
                <Lock className="h-3.5 w-3.5 text-warn" aria-hidden="true" />
                <span>Include encrypted secrets (recommended)</span>
              </div>
              <p className="mt-0.5 text-[11.5px] text-fg-muted">
                Secrets from the OS Keychain will be encrypted using AES-256-GCM + passphrase before writing to disk.
              </p>
            </div>
          </label>

          {includeSecrets ? (
            <div className="space-y-2.5">
              <div>
                <label
                  htmlFor="export-passphrase"
                  className="text-[12px] font-medium text-fg-2"
                >
                  Encryption Passphrase
                </label>
                <input
                  id="export-passphrase"
                  type="password"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder="Enter passphrase…"
                  className="mt-1 h-8 w-full rounded-[7px] border border-border-strong bg-surface-2 px-2.5 text-[13px] text-fg focus:border-info focus:outline-none"
                />
              </div>
              <div>
                <label
                  htmlFor="export-passphrase-confirm"
                  className="text-[12px] font-medium text-fg-2"
                >
                  Confirm Passphrase
                </label>
                <input
                  id="export-passphrase-confirm"
                  type="password"
                  value={confirmPassphrase}
                  onChange={(e) => setConfirmPassphrase(e.target.value)}
                  placeholder="Re-enter passphrase…"
                  className="mt-1 h-8 w-full rounded-[7px] border border-border-strong bg-surface-2 px-2.5 text-[13px] text-fg focus:border-info focus:outline-none"
                />
              </div>
            </div>
          ) : null}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="btn-press h-8 rounded-[7px] border border-border-strong bg-surface-2 px-3 text-[12.5px] font-medium text-fg-2 hover:bg-surface-hover hover:text-fg"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="btn-press flex h-8 items-center gap-1.5 rounded-[7px] bg-accent px-3.5 text-[12.5px] font-semibold text-accent-fg hover:opacity-95 disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            <span>Choose Location & Export</span>
          </button>
        </div>
      </form>
    </div>
  );
}

interface ImportModalProps {
  open: boolean;
  onClose: () => void;
}

export function ImportConfigModal({ open, onClose }: ImportModalProps) {
  const init = useAppStore((s) => s.init);
  const pushToast = useAppStore((s) => s.pushToast);

  const [filePath, setFilePath] = useState<string | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [oldParent, setOldParent] = useState("");
  const [newParent, setNewParent] = useState("");
  const [pathOverrides, setPathOverrides] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const refreshPreview = async (
    targetPath: string,
    passVal: string,
    oldP: string,
    newP: string,
    overrides: Record<string, string>,
  ) => {
    setLoading(true);
    try {
      const res = await previewImportFile(targetPath, passVal, oldP, newP, overrides);
      setPreview(res);
      if (!oldP && res.suggestedCommonParent) {
        setOldParent(res.suggestedCommonParent);
      }
    } catch (err) {
      pushToast({
        title: "Failed to read import file",
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleChooseFile = async () => {
    const picked = await pickImportOpenDialog();
    if (!picked) return;
    setFilePath(picked);
    setPassphrase("");
    setOldParent("");
    setNewParent("");
    setPathOverrides({});
    await refreshPreview(picked, "", "", "", {});
  };

  const handlePickNewParent = async () => {
    const picked = await pickFolderDialog("Select target parent folder on this machine");
    if (!picked || !filePath) return;
    setNewParent(picked);
    await refreshPreview(filePath, passphrase, oldParent, picked, pathOverrides);
  };

  const handlePickServiceFolder = async (serviceKey: string, serviceName: string) => {
    const picked = await pickFolderDialog(`Select folder for ${serviceName}`);
    if (!picked || !filePath) return;
    const nextOverrides = { ...pathOverrides, [serviceKey]: picked };
    setPathOverrides(nextOverrides);
    await refreshPreview(filePath, passphrase, oldParent, newParent, nextOverrides);
  };

  const handleApplyImport = async () => {
    if (!filePath) return;
    setApplying(true);
    try {
      const result = await applyImportFile(
        filePath,
        passphrase,
        oldParent,
        newParent,
        pathOverrides,
      );
      await init();
      pushToast({
        title: `Import complete (${result.projectsImported} ${result.projectsImported === 1 ? "project" : "projects"}, ${result.servicesImported} ${result.servicesImported === 1 ? "service" : "services"})`,
        description:
          result.secretsStored > 0
            ? `${result.secretsStored} ${result.secretsStored === 1 ? "secret" : "secrets"} stored in OS Keychain.`
            : undefined,
        variant: result.missingServices > 0 ? "warn" : "success",
      });
      onClose();
    } catch (err) {
      pushToast({
        title: "Failed to import configuration",
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    } finally {
      setApplying(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Import Configuration & Remap Paths"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-[1px]"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="animate-modal-enter flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-[12px] border border-border-strong bg-surface shadow-2xl"
      >
        <div className="flex items-start justify-between gap-2 border-b border-border px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 text-[15px] font-semibold text-fg">
              <Upload className="h-4 w-4 text-info" aria-hidden="true" />
              <span>Import Configuration & Remap Paths</span>
            </h2>
            <p className="mt-0.5 text-[12.5px] text-fg-muted">
              Restore projects, presets, and secrets, and remap folder paths when moving between machines or operating systems.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close import dialog"
            className="rounded p-1 text-fg-muted hover:bg-surface-hover hover:text-fg"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleChooseFile()}
              className="btn-press flex h-8 items-center gap-1.5 rounded-[7px] border border-border-strong bg-surface-2 px-3 text-[12.5px] font-medium text-fg hover:bg-surface-hover"
            >
              <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{filePath ? "Change File…" : "Choose Backup File (.json)…"}</span>
            </button>
            {filePath ? (
              <span className="truncate font-mono text-[11.5px] text-fg-muted">
                {filePath}
              </span>
            ) : null}
          </div>

          {loading ? (
            <div className="skeleton-shimmer h-28 rounded-[8px]" />
          ) : preview ? (
            <>
              {/* Bundle Summary */}
              <div className="flex flex-wrap items-center gap-2 rounded-[8px] border border-border bg-surface-2 px-3.5 py-2.5 text-[12px]">
                <span className="font-mono text-fg">
                  v{preview.formatVersion} · from {preview.sourceOs}
                </span>
                <span>·</span>
                <span className="font-mono tabular-nums text-fg-2">
                  {preview.projectCount} {preview.projectCount === 1 ? "project" : "projects"}, {preview.serviceCount} {preview.serviceCount === 1 ? "service" : "services"}, {preview.presetCount} {preview.presetCount === 1 ? "preset" : "presets"}
                </span>
                {preview.missingCount > 0 ? (
                  <span className="rounded bg-warn-soft px-1.5 py-0.5 font-mono text-[11px] text-warn tabular-nums">
                    {preview.missingCount} missing {preview.missingCount === 1 ? "path" : "paths"}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded bg-accent-soft px-1.5 py-0.5 text-[11px] text-accent">
                    <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                    All paths valid
                  </span>
                )}
              </div>

              {/* Passphrase verification when encrypted secrets present */}
              {preview.includesSecrets ? (
                <div className="rounded-[8px] border border-border bg-surface-2 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <label
                      htmlFor="import-passphrase"
                      className="flex items-center gap-1.5 text-[12.5px] font-medium text-fg"
                    >
                      <Lock className="h-3.5 w-3.5 text-warn" aria-hidden="true" />
                      <span>Secrets Passphrase ({preview.secretCount} {preview.secretCount === 1 ? "secret" : "secrets"})</span>
                    </label>
                    {preview.passphraseVerified ? (
                      <span className="text-[11.5px] font-medium text-accent">
                        ✓ Passphrase verified
                      </span>
                    ) : (
                      <span className="text-[11.5px] font-medium text-warn">
                        Enter passphrase to decrypt
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex gap-2">
                    <input
                      id="import-passphrase"
                      type="password"
                      value={passphrase}
                      onChange={(e) => setPassphrase(e.target.value)}
                      placeholder="Enter passphrase…"
                      className="h-8 flex-1 rounded-[7px] border border-border-strong bg-surface px-2.5 text-[12.5px] text-fg focus:border-info focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        filePath &&
                        void refreshPreview(
                          filePath,
                          passphrase,
                          oldParent,
                          newParent,
                          pathOverrides,
                        )
                      }
                      className="btn-press h-8 rounded-[7px] border border-border-strong bg-surface px-3 text-[12px] font-medium text-fg-2 hover:bg-surface-hover hover:text-fg"
                    >
                      Verify
                    </button>
                  </div>
                </div>
              ) : null}

              {/* Bulk Common Parent Remapping */}
              {preview.suggestedCommonParent || preview.missingCount > 0 ? (
                <div className="rounded-[8px] border border-border bg-surface-2 p-3">
                  <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-fg">
                    <FolderSync className="h-4 w-4 text-info" aria-hidden="true" />
                    <span>Bulk Remap Parent Folder</span>
                  </div>
                  <p className="mt-0.5 text-[11.5px] text-fg-muted">
                    Replace the old path prefix (e.g. <span className="font-mono">/Users/dev/code</span>) with the new folder on this machine (e.g. <span className="font-mono">D:\code</span>).
                  </p>
                  <div className="mt-2.5 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                    <input
                      type="text"
                      aria-label="Old parent folder prefix"
                      value={oldParent}
                      onChange={(e) => setOldParent(e.target.value)}
                      placeholder="Old parent folder…"
                      className="h-8 rounded-[7px] border border-border-strong bg-surface px-2.5 font-mono text-[12px] text-fg focus:border-info focus:outline-none"
                    />
                    <input
                      type="text"
                      aria-label="New parent folder prefix"
                      value={newParent}
                      onChange={(e) => setNewParent(e.target.value)}
                      placeholder="New parent folder…"
                      className="h-8 rounded-[7px] border border-border-strong bg-surface px-2.5 font-mono text-[12px] text-fg focus:border-info focus:outline-none"
                    />
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => void handlePickNewParent()}
                        className="btn-press h-8 rounded-[7px] border border-border-strong bg-surface px-2.5 text-[12px] font-medium text-fg-2 hover:bg-surface-hover hover:text-fg"
                      >
                        Browse…
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          filePath &&
                          void refreshPreview(
                            filePath,
                            passphrase,
                            oldParent,
                            newParent,
                            pathOverrides,
                          )
                        }
                        className="btn-press h-8 rounded-[7px] bg-info px-2.5 text-[12px] font-semibold text-white hover:opacity-95"
                      >
                        Apply
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}

              {/* Per-service path resolution list */}
              <div className="divide-y divide-border rounded-[8px] border border-border bg-surface-2">
                {preview.services.map((svc) => (
                  <div
                    key={svc.serviceKey}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
                        <span className="font-medium text-fg">{svc.serviceName}</span>
                        <span className="text-fg-faint">({svc.projectName})</span>
                        {svc.existsOnDisk && svc.packageNameMatches ? (
                          <span className="inline-flex items-center gap-1 rounded bg-accent-soft px-1.5 py-0.5 text-[10.5px] text-accent">
                            <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                            matched
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded bg-warn-soft px-1.5 py-0.5 text-[10.5px] text-warn">
                            <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                            {svc.existsOnDisk ? "package.json mismatch" : "not found"}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 truncate font-mono text-[11px] text-fg-muted">
                        {svc.resolvedPath}
                      </div>
                      {svc.warning ? (
                        <div className="mt-0.5 text-[11px] text-warn">{svc.warning}</div>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        void handlePickServiceFolder(svc.serviceKey, svc.serviceName)
                      }
                      className="btn-press h-7 shrink-0 rounded-[6px] border border-border-strong bg-surface px-2.5 text-[11.5px] font-medium text-fg-2 hover:bg-surface-hover hover:text-fg"
                    >
                      Relocate…
                    </button>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="rounded-[8px] border border-dashed border-border p-6 text-center text-[12.5px] text-fg-muted">
              Select a DevDock backup <span className="font-mono">.json</span> file to preview contents and remap folder paths.
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-3.5">
          <button
            type="button"
            onClick={onClose}
            className="btn-press h-8 rounded-[7px] border border-border-strong bg-surface-2 px-3 text-[12.5px] font-medium text-fg-2 hover:bg-surface-hover hover:text-fg"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={
              applying ||
              !preview ||
              (preview.includesSecrets && !preview.passphraseVerified)
            }
            onClick={() => void handleApplyImport()}
            className="btn-press flex h-8 items-center gap-1.5 rounded-[7px] bg-accent px-3.5 text-[12.5px] font-semibold text-accent-fg hover:opacity-95 disabled:opacity-45"
          >
            {applying ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Upload className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            <span>Import Configuration</span>
          </button>
        </div>
      </div>
    </div>
  );
}
