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
          title: "Passphrase wajib diisi",
          description: "Masukkan passphrase untuk mengenkripsi secret.",
          variant: "warn",
        });
        return;
      }
      if (passphrase !== confirmPassphrase) {
        pushToast({
          title: "Passphrase tidak cocok",
          description: "Pastikan konfirmasi passphrase sama persis.",
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
        title: `Export berhasil (${summary.projectCount} project, ${summary.presetCount} preset)`,
        description: summary.includesSecrets
          ? `${summary.secretCount} secret dienkripsi ke ${summary.outputPath}`
          : `Disimpan tanpa secret ke ${summary.outputPath}`,
        variant: "success",
      });
      setPassphrase("");
      setConfirmPassphrase("");
      onClose();
    } catch (err) {
      pushToast({
        title: "Gagal mengekspor konfigurasi",
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
      aria-label="Export Konfigurasi"
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
              <span>Export Konfigurasi DevDock</span>
            </h2>
            <p className="mt-0.5 text-[12.5px] text-fg-muted">
              Simpan project, service, urutan start, preset, dan settings ke satu file berversi untuk backup atau pindah OS.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup dialog export"
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
                <span>Sertakan secret terenkripsi (disarankan)</span>
              </div>
              <p className="mt-0.5 text-[11.5px] text-fg-muted">
                Secret dari Keychain akan dienkripsi menggunakan AES-256-GCM + passphrase sebelum ditulis ke file.
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
                  Passphrase Enkripsi
                </label>
                <input
                  id="export-passphrase"
                  type="password"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder="Masukkan passphrase…"
                  className="mt-1 h-8 w-full rounded-[7px] border border-border-strong bg-surface-2 px-2.5 text-[13px] text-fg focus:border-info focus:outline-none"
                />
              </div>
              <div>
                <label
                  htmlFor="export-passphrase-confirm"
                  className="text-[12px] font-medium text-fg-2"
                >
                  Konfirmasi Passphrase
                </label>
                <input
                  id="export-passphrase-confirm"
                  type="password"
                  value={confirmPassphrase}
                  onChange={(e) => setConfirmPassphrase(e.target.value)}
                  placeholder="Ulangi passphrase…"
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
            Batal
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
            <span>Pilih Lokasi & Export</span>
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
        title: "Gagal membaca file import",
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
    const picked = await pickFolderDialog("Pilih folder induk tujuan di mesin ini");
    if (!picked || !filePath) return;
    setNewParent(picked);
    await refreshPreview(filePath, passphrase, oldParent, picked, pathOverrides);
  };

  const handlePickServiceFolder = async (serviceKey: string, serviceName: string) => {
    const picked = await pickFolderDialog(`Pilih folder untuk ${serviceName}`);
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
        title: `Import berhasil (${result.projectsImported} project, ${result.servicesImported} service)`,
        description:
          result.secretsStored > 0
            ? `${result.secretsStored} secret disimpan ke OS Keychain.`
            : undefined,
        variant: result.missingServices > 0 ? "warn" : "success",
      });
      onClose();
    } catch (err) {
      pushToast({
        title: "Gagal mengimpor konfigurasi",
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
      aria-label="Import Konfigurasi & Remap Path"
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
              <span>Import Konfigurasi & Remap Path</span>
            </h2>
            <p className="mt-0.5 text-[12.5px] text-fg-muted">
              Pulihkan project, preset, secret, dan petakan ulang path folder jika berpindah mesin atau OS.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup dialog import"
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
              <span>{filePath ? "Ganti File…" : "Pilih File Backup (.json)…"}</span>
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
                  v{preview.formatVersion} · dari {preview.sourceOs}
                </span>
                <span>·</span>
                <span className="font-mono tabular-nums text-fg-2">
                  {preview.projectCount} project, {preview.serviceCount} service, {preview.presetCount} preset
                </span>
                {preview.missingCount > 0 ? (
                  <span className="rounded bg-warn-soft px-1.5 py-0.5 font-mono text-[11px] text-warn tabular-nums">
                    {preview.missingCount} path belum ditemukan
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded bg-accent-soft px-1.5 py-0.5 text-[11px] text-accent">
                    <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                    Semua path valid
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
                      <span>Passphrase Secret ({preview.secretCount} secret)</span>
                    </label>
                    {preview.passphraseVerified ? (
                      <span className="text-[11.5px] font-medium text-accent">
                        ✓ Passphrase cocok
                      </span>
                    ) : (
                      <span className="text-[11.5px] font-medium text-warn">
                        Masukkan passphrase untuk dekripsi
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex gap-2">
                    <input
                      id="import-passphrase"
                      type="password"
                      value={passphrase}
                      onChange={(e) => setPassphrase(e.target.value)}
                      placeholder="Masukkan passphrase…"
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
                      Verifikasi
                    </button>
                  </div>
                </div>
              ) : null}

              {/* Bulk Common Parent Remapping */}
              {preview.suggestedCommonParent || preview.missingCount > 0 ? (
                <div className="rounded-[8px] border border-border bg-surface-2 p-3">
                  <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-fg">
                    <FolderSync className="h-4 w-4 text-info" aria-hidden="true" />
                    <span>Remap Folder Induk Sekaligus</span>
                  </div>
                  <p className="mt-0.5 text-[11.5px] text-fg-muted">
                    Ubah awalan path lama (misal <span className="font-mono">/Users/fikri/H2o</span>) ke folder baru di mesin ini (misal <span className="font-mono">D:\code\H2o</span>).
                  </p>
                  <div className="mt-2.5 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                    <input
                      type="text"
                      aria-label="Prefix folder lama"
                      value={oldParent}
                      onChange={(e) => setOldParent(e.target.value)}
                      placeholder="Folder induk lama…"
                      className="h-8 rounded-[7px] border border-border-strong bg-surface px-2.5 font-mono text-[12px] text-fg focus:border-info focus:outline-none"
                    />
                    <input
                      type="text"
                      aria-label="Prefix folder baru"
                      value={newParent}
                      onChange={(e) => setNewParent(e.target.value)}
                      placeholder="Folder induk baru…"
                      className="h-8 rounded-[7px] border border-border-strong bg-surface px-2.5 font-mono text-[12px] text-fg focus:border-info focus:outline-none"
                    />
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => void handlePickNewParent()}
                        className="btn-press h-8 rounded-[7px] border border-border-strong bg-surface px-2.5 text-[12px] font-medium text-fg-2 hover:bg-surface-hover hover:text-fg"
                      >
                        Pilih…
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
                        Terapkan
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
                            cocok
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded bg-warn-soft px-1.5 py-0.5 text-[10.5px] text-warn">
                            <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                            {svc.existsOnDisk ? "nama package.json beda" : "tidak ditemukan"}
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
                      Relokasi…
                    </button>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="rounded-[8px] border border-dashed border-border p-6 text-center text-[12.5px] text-fg-muted">
              Pilih file backup <span className="font-mono">.json</span> hasil export DevDock untuk meninjau isi dan memetakan path folder.
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-3.5">
          <button
            type="button"
            onClick={onClose}
            className="btn-press h-8 rounded-[7px] border border-border-strong bg-surface-2 px-3 text-[12.5px] font-medium text-fg-2 hover:bg-surface-hover hover:text-fg"
          >
            Batal
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
            <span>Import Konfigurasi</span>
          </button>
        </div>
      </div>
    </div>
  );
}
