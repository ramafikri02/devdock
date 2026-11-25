import { useCallback, useEffect, useState } from "react";
import {
  FolderArchive,
  HardDrive,
  Package,
  RefreshCw,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  type CleanableFolder,
  type Service,
  type ServiceStorageReport,
  analyzeServiceStorage,
  cleanServiceStorage,
} from "@/lib/tauri";
import { formatBytes } from "@/lib/format";
import { useAppStore } from "@/store/appStore";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

interface ServiceStorageTabProps {
  service: Service;
  onReportChange?: (report: ServiceStorageReport | null) => void;
}

export function ServiceStorageTab({
  service,
  onReportChange,
}: ServiceStorageTabProps) {
  const pushToast = useAppStore((s) => s.pushToast);
  const refreshGlobalStorage = useAppStore((s) => s.refreshGlobalStorage);

  const [report, setReport] = useState<ServiceStorageReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [deletingName, setDeletingName] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<CleanableFolder | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runAnalysis = useCallback(
    async (forceRefresh: boolean) => {
      if (service.isMissing) {
        setReport(null);
        onReportChange?.(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const res = await analyzeServiceStorage(service.id, forceRefresh);
        setReport(res);
        onReportChange?.(res);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [service.id, service.isMissing, onReportChange],
  );

  useEffect(() => {
    void runAnalysis(false);
  }, [runAnalysis]);

  if (service.isMissing) {
    return (
      <div className="rounded-[10px] border border-border bg-surface p-6 text-center text-[13px] text-fg-muted">
        Folder service tidak ditemukan. Relokasi folder untuk menganalisis penggunaan storage.
      </div>
    );
  }

  const handleConfirmDelete = async () => {
    if (!confirmTarget) return;
    const folder = confirmTarget;
    setConfirmTarget(null);
    setDeletingName(folder.name);
    try {
      const res = await cleanServiceStorage(service.id, folder.name);
      setReport(res.updatedReport);
      onReportChange?.(res.updatedReport);
      void refreshGlobalStorage(false);
      pushToast({
        title: `Folder "${res.deletedFolder}" dihapus`,
        description: `${formatBytes(res.freedBytes)} ruang disk berhasil dibebaskan.`,
        variant: "success",
      });
    } catch (err) {
      pushToast({
        title: `Gagal menghapus ${folder.name}`,
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    } finally {
      setDeletingName(null);
    }
  };

  const total = report?.totalBytes ?? 0;
  const nmPct = total > 0 ? Math.round(((report?.nodeModulesBytes ?? 0) / total) * 100) : 0;
  const buildPct =
    total > 0 ? Math.round(((report?.buildCacheBytes ?? 0) / total) * 100) : 0;
  const srcPct = Math.max(0, 100 - nmPct - buildPct);

  return (
    <div className="space-y-4">
      {/* Header action bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[12.5px] text-fg-muted">
          {loading ? (
            <span>Menghitung ukuran folder…</span>
          ) : report ? (
            <span>
              Total{" "}
              <strong className="font-mono text-fg tabular-nums">
                {formatBytes(report.totalBytes)}
              </strong>{" "}
              · Dapat dibersihkan:{" "}
              <strong className="font-mono text-warn tabular-nums">
                {formatBytes(report.reclaimableBytes)}
              </strong>
              {report.fromCache ? (
                <span className="ml-1.5 text-[11px] text-fg-faint">(cached)</span>
              ) : null}
            </span>
          ) : (
            <span>Siap menghitung penggunaan disk service.</span>
          )}
        </div>

        <button
          type="button"
          disabled={loading}
          onClick={() => void runAnalysis(true)}
          className="btn-press flex h-8 items-center gap-1.5 rounded-[7px] border border-border-strong bg-surface px-3 text-[12px] font-medium text-fg-2 hover:bg-surface-hover hover:text-fg disabled:opacity-50"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
          <span>{loading ? "Menghitung…" : "Refresh"}</span>
        </button>
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-[8px] border border-danger/40 bg-danger-soft px-3 py-2 text-[12.5px] text-danger"
        >
          {error}
        </div>
      ) : null}

      {/* Breakdown cards */}
      {loading && !report ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-busy="true">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="skeleton-shimmer h-20 rounded-[10px] border border-border"
            />
          ))}
        </div>
      ) : report ? (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-[10px] border border-border bg-surface p-3.5">
              <div className="flex items-center justify-between text-[12px] text-fg-muted">
                <span>node_modules</span>
                <Package className="h-3.5 w-3.5 text-warn" aria-hidden="true" />
              </div>
              <div className="mt-1.5 font-mono text-[18px] font-semibold text-fg tabular-nums">
                {formatBytes(report.nodeModulesBytes)}
              </div>
              <div className="mt-0.5 font-mono text-[11px] text-fg-faint tabular-nums">
                {nmPct}% dari total
              </div>
            </div>

            <div className="rounded-[10px] border border-border bg-surface p-3.5">
              <div className="flex items-center justify-between text-[12px] text-fg-muted">
                <span>Build & Cache</span>
                <FolderArchive className="h-3.5 w-3.5 text-info" aria-hidden="true" />
              </div>
              <div className="mt-1.5 font-mono text-[18px] font-semibold text-fg tabular-nums">
                {formatBytes(report.buildCacheBytes)}
              </div>
              <div className="mt-0.5 font-mono text-[11px] text-fg-faint tabular-nums">
                {buildPct}% dari total
              </div>
            </div>

            <div className="rounded-[10px] border border-border bg-surface p-3.5">
              <div className="flex items-center justify-between text-[12px] text-fg-muted">
                <span>Source & Lainnya</span>
                <HardDrive className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
              </div>
              <div className="mt-1.5 font-mono text-[18px] font-semibold text-fg tabular-nums">
                {formatBytes(report.sourceBytes)}
              </div>
              <div className="mt-0.5 font-mono text-[11px] text-fg-faint tabular-nums">
                {srcPct}% dari total
              </div>
            </div>
          </div>

          {/* Stacked visual bar */}
          {total > 0 ? (
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface-2">
              <div className="flex h-full w-full">
                {nmPct > 0 ? (
                  <div
                    style={{ width: `${nmPct}%` }}
                    className="bg-warn"
                    title={`node_modules: ${formatBytes(report.nodeModulesBytes)}`}
                  />
                ) : null}
                {buildPct > 0 ? (
                  <div
                    style={{ width: `${buildPct}%` }}
                    className="bg-info"
                    title={`Build & Cache: ${formatBytes(report.buildCacheBytes)}`}
                  />
                ) : null}
                {srcPct > 0 ? (
                  <div
                    style={{ width: `${srcPct}%` }}
                    className="bg-accent/70"
                    title={`Source: ${formatBytes(report.sourceBytes)}`}
                  />
                ) : null}
              </div>
            </div>
          ) : null}

          {/* Cleanable folders table */}
          <div className="overflow-hidden rounded-[10px] border border-border bg-surface">
            <div className="border-b border-border bg-surface-2 px-4 py-2.5 text-[11.5px] font-semibold tracking-wide text-fg-muted uppercase">
              Folder yang Aman Dibersihkan
            </div>
            {report.cleanableFolders.length === 0 ? (
              <div className="flex items-center justify-center gap-2 p-6 text-[13px] text-fg-muted">
                <Sparkles className="h-4 w-4 text-accent" aria-hidden="true" />
                <span>Bersih — tidak ada folder node_modules atau build cache yang ditemukan.</span>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {report.cleanableFolders.map((folder) => {
                  const isDeleting = deletingName === folder.name;
                  return (
                    <div
                      key={folder.name}
                      className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[13px] font-semibold text-fg">
                            {folder.name}
                          </span>
                          <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10.5px] text-fg-muted">
                            {folder.kind === "node_modules"
                              ? "Dependencies"
                              : "Build / Cache"}
                          </span>
                        </div>
                        <p className="mt-0.5 truncate font-mono text-[11.5px] text-fg-faint">
                          {folder.path}
                        </p>
                      </div>

                      <div className="flex items-center gap-3">
                        <span className="font-mono text-[13px] font-semibold text-fg tabular-nums">
                          {formatBytes(folder.sizeBytes)}
                        </span>
                        <button
                          type="button"
                          disabled={isDeleting || loading}
                          onClick={() => setConfirmTarget(folder)}
                          className="btn-press inline-flex h-7.5 items-center gap-1.5 rounded-[7px] border border-danger/45 bg-danger-soft px-2.5 text-[12px] font-medium text-danger hover:bg-danger-solid hover:text-white disabled:opacity-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>{isDeleting ? "Menghapus…" : "Hapus"}</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      ) : null}

      <ConfirmDialog
        open={confirmTarget !== null}
        title={
          confirmTarget
            ? `Hapus "${confirmTarget.name}" (${formatBytes(confirmTarget.sizeBytes)})?`
            : ""
        }
        description={
          confirmTarget
            ? `Folder ${confirmTarget.path} akan dihapus secara permanen dari disk untuk membebaskan ${formatBytes(confirmTarget.sizeBytes)}. Source code Anda tidak akan disentuh.`
            : ""
        }
        confirmLabel="Hapus Permanen"
        onCancel={() => setConfirmTarget(null)}
        onConfirm={() => void handleConfirmDelete()}
      />
    </div>
  );
}
