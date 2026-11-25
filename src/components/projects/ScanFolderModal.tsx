import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  FolderOpen,
  FolderSearch,
  Layers,
  Package,
  X,
} from "lucide-react";
import {
  FRAMEWORK_LABELS,
  type ScanCandidate,
  type ScanResult,
  pickFolderDialog,
  registerFolderAsProject,
  registerGroupedProject,
  scanFolder,
} from "@/lib/tauri";
import { useAppStore } from "@/store/appStore";
import { cn } from "@/lib/cn";

export function ScanFolderModal() {
  const open = useAppStore((s) => s.scanModalOpen);
  const close = useAppStore((s) => s.closeScanModal);
  const loadProjects = useAppStore((s) => s.loadProjects);
  const setRoute = useAppStore((s) => s.setRoute);
  const pushToast = useAppStore((s) => s.pushToast);

  const [rootPath, setRootPath] = useState("");
  const [depth, setDepth] = useState(3);
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);

  // Selected standalone service paths
  const [selectedServices, setSelectedServices] = useState<Set<string>>(new Set());
  // Selected monorepo root paths -> selected workspace package paths
  const [selectedMonorepos, setSelectedMonorepos] = useState<
    Record<string, Set<string>>
  >({});

  // Grouping mode when >= 2 standalone services are selected
  const [groupMode, setGroupMode] = useState(false);
  const [groupName, setGroupName] = useState("");

  useEffect(() => {
    if (!open) return;
    setError(null);
    setGroupMode(false);
    setGroupName("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  const totalSelectedCount = useMemo(() => {
    let count = selectedServices.size;
    for (const pkgs of Object.values(selectedMonorepos)) {
      if (pkgs.size > 0) count += 1;
    }
    return count;
  }, [selectedServices, selectedMonorepos]);

  if (!open) return null;

  const runScan = async (targetPath: string, targetDepth: number) => {
    if (!targetPath.trim()) {
      setError("Pilih folder induk terlebih dahulu.");
      return;
    }
    setScanning(true);
    setError(null);
    setResult(null);
    setGroupMode(false);

    try {
      const scanRes = await scanFolder(targetPath.trim(), targetDepth);
      setResult(scanRes);

      // Pre-select unregistered candidates
      const nextServices = new Set<string>();
      const nextMonorepos: Record<string, Set<string>> = {};

      for (const c of scanRes.candidates) {
        if (c.kind === "service" && !c.alreadyRegistered) {
          nextServices.add(c.path);
        } else if (c.kind === "monorepo") {
          const unregPkgs = new Set(
            c.workspacePackages
              .filter((p) => !p.alreadyRegistered)
              .map((p) => p.path),
          );
          if (unregPkgs.size > 0) {
            nextMonorepos[c.path] = unregPkgs;
          }
        }
      }
      setSelectedServices(nextServices);
      setSelectedMonorepos(nextMonorepos);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setScanning(false);
    }
  };

  const handleBrowse = async () => {
    const picked = await pickFolderDialog("Pilih folder induk untuk di-scan");
    if (picked) {
      setRootPath(picked);
      void runScan(picked, depth);
    }
  };

  const toggleService = (path: string) => {
    setSelectedServices((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const toggleMonorepo = (candidate: ScanCandidate) => {
    setSelectedMonorepos((prev) => {
      const next = { ...prev };
      const current = next[candidate.path];
      const unregPaths = candidate.workspacePackages
        .filter((p) => !p.alreadyRegistered)
        .map((p) => p.path);

      if (current && current.size > 0) {
        delete next[candidate.path];
      } else if (unregPaths.length > 0) {
        next[candidate.path] = new Set(unregPaths);
      }
      return next;
    });
  };

  const toggleWorkspacePkg = (monoPath: string, pkgPath: string) => {
    setSelectedMonorepos((prev) => {
      const next = { ...prev };
      const set = new Set(next[monoPath] ?? []);
      if (set.has(pkgPath)) {
        set.delete(pkgPath);
      } else {
        set.add(pkgPath);
      }
      if (set.size === 0) {
        delete next[monoPath];
      } else {
        next[monoPath] = set;
      }
      return next;
    });
  };

  const handleRegisterSeparately = async () => {
    if (!result) return;
    setSaving(true);
    setError(null);
    let createdCount = 0;
    let lastProjectId: string | null = null;

    try {
      for (const c of result.candidates) {
        if (c.kind === "service" && selectedServices.has(c.path)) {
          const p = await registerFolderAsProject(c.path);
          lastProjectId = p.id;
          createdCount += 1;
        } else if (c.kind === "monorepo") {
          const pkgs = selectedMonorepos[c.path];
          if (pkgs && pkgs.size > 0) {
            const p = await registerGroupedProject(
              c.name,
              Array.from(pkgs),
              c.path,
            );
            lastProjectId = p.id;
            createdCount += 1;
          }
        }
      }

      await loadProjects();
      if (lastProjectId) {
        setRoute({ kind: "project", projectId: lastProjectId });
      }
      pushToast({
        title: `${createdCount} project berhasil didaftarkan`,
        variant: "success",
      });
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleGroupSelected = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupName.trim()) {
      setError("Masukkan nama project untuk grup ini (mis. LMS App).");
      return;
    }
    const folders = Array.from(selectedServices);
    if (folders.length < 2) {
      setError("Pilih minimal 2 folder service untuk digabung menjadi 1 Project.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const project = await registerGroupedProject(groupName.trim(), folders, null);
      await loadProjects();
      setRoute({ kind: "project", projectId: project.id });
      pushToast({
        title: `Project "${project.name}" (${project.services.length} service) dibuat`,
        variant: "success",
      });
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Scan Folder Project"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[1px]"
      onClick={close}
    >
      <div
        className="animate-modal-enter flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-[12px] border border-border-strong bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <FolderSearch className="h-4 w-4 text-info" aria-hidden="true" />
            <h2 className="text-[14.5px] font-semibold text-fg">
              Scan Folder Induk
            </h2>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Tutup dialog"
            className="btn-press rounded p-1 text-fg-muted hover:bg-surface-hover hover:text-fg"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Scan controls */}
        <div className="border-b border-border bg-surface-2/60 p-4">
          <div className="flex flex-wrap items-end gap-2.5">
            <div className="min-w-0 flex-1 space-y-1">
              <label
                htmlFor="scan-root-path"
                className="block text-[12px] font-medium text-fg-2"
              >
                Folder Induk
              </label>
              <div className="flex gap-2">
                <input
                  id="scan-root-path"
                  type="text"
                  value={rootPath}
                  onChange={(e) => setRootPath(e.target.value)}
                  placeholder="/Users/dev/projects"
                  className="h-8.5 min-w-0 flex-1 rounded-[7px] border border-border-strong bg-surface px-2.5 font-mono text-[12px] text-fg placeholder:text-fg-faint"
                />
                <button
                  type="button"
                  onClick={() => void handleBrowse()}
                  className="btn-press flex h-8.5 shrink-0 items-center gap-1.5 rounded-[7px] border border-border-strong bg-surface px-3 text-[12.5px] font-medium text-fg-2 hover:bg-surface-hover hover:text-fg"
                >
                  <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Pilih…</span>
                </button>
              </div>
            </div>

            <div className="w-24 space-y-1">
              <label
                htmlFor="scan-depth"
                className="block text-[12px] font-medium text-fg-2"
              >
                Kedalaman
              </label>
              <select
                id="scan-depth"
                value={depth}
                onChange={(e) => setDepth(Number(e.target.value))}
                className="h-8.5 w-full rounded-[7px] border border-border-strong bg-surface px-2 font-mono text-[12.5px] text-fg"
              >
                {[1, 2, 3, 4, 5, 6].map((d) => (
                  <option key={d} value={d}>
                    {d} level
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              disabled={scanning || !rootPath.trim()}
              onClick={() => void runScan(rootPath, depth)}
              className="btn-press h-8.5 rounded-[7px] bg-accent px-3.5 text-[12.5px] font-semibold text-accent-fg hover:opacity-95 disabled:opacity-50"
            >
              {scanning ? "Memindai…" : "Mulai Scan"}
            </button>
          </div>
          <p className="mt-2 text-[11.5px] text-fg-faint">
            Otomatis melewati <code className="font-mono">node_modules</code>,{" "}
            <code className="font-mono">.git</code>,{" "}
            <code className="font-mono">dist</code>,{" "}
            <code className="font-mono">.next</code>, dan mendeteksi monorepo{" "}
            <code className="font-mono">workspaces</code> /{" "}
            <code className="font-mono">pnpm-workspace.yaml</code>.
          </p>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {error ? (
            <div
              role="alert"
              className="mb-3 flex items-start gap-2 rounded-[8px] border border-danger/40 bg-danger-soft px-3 py-2 text-[12.5px] text-danger"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          ) : null}

          {scanning ? (
            <div className="space-y-3" aria-busy="true" aria-live="polite">
              <p className="text-[12.5px] text-fg-muted">
                Memindai folder hingga kedalaman {depth}…
              </p>
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="skeleton-shimmer h-14 rounded-[8px] border border-border"
                />
              ))}
            </div>
          ) : result ? (
            result.candidates.length === 0 ? (
              <div className="py-10 text-center text-[13px] text-fg-muted">
                Tidak ada codebase Node.js ditemukan di folder ini (memindai{" "}
                <span className="font-mono tabular-nums">{result.scannedDirs}</span>{" "}
                direktori).
              </div>
            ) : (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between text-[12px] text-fg-muted">
                  <span>
                    Ditemukan{" "}
                    <strong className="font-mono text-fg tabular-nums">
                      {result.candidates.length}
                    </strong>{" "}
                    kandidat dari{" "}
                    <span className="font-mono tabular-nums">{result.scannedDirs}</span>{" "}
                    direktori
                  </span>
                  <span className="font-mono text-[11.5px] text-fg-faint tabular-nums">
                    {totalSelectedCount} dipilih
                  </span>
                </div>

                {result.candidates.map((c) => {
                  if (c.kind === "monorepo") {
                    const checkedSet = selectedMonorepos[c.path];
                    const isChecked = Boolean(checkedSet && checkedSet.size > 0);
                    return (
                      <div
                        key={c.path}
                        className="rounded-[9px] border border-border bg-surface-2/60 p-3"
                      >
                        <label className="flex cursor-pointer items-start gap-2.5">
                          <input
                            type="checkbox"
                            disabled={c.alreadyRegistered}
                            checked={isChecked}
                            onChange={() => toggleMonorepo(c)}
                            className="mt-1 h-4 w-4 accent-[var(--accent)]"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold text-fg">{c.name}</span>
                              <span className="rounded bg-info-soft px-1.5 py-0.5 text-[10.5px] font-semibold text-info">
                                Monorepo ({c.workspacePackages.length} packages)
                              </span>
                              <span className="font-mono text-[11px] text-fg-muted">
                                {c.packageManager}
                              </span>
                              {c.alreadyRegistered ? (
                                <span className="inline-flex items-center gap-1 rounded bg-accent-soft px-1.5 py-0.5 text-[10.5px] font-medium text-accent">
                                  <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                                  Sudah terdaftar
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-0.5 truncate font-mono text-[11.5px] text-fg-faint">
                              {c.path}
                            </p>
                          </div>
                        </label>

                        {/* Workspace packages */}
                        <div className="mt-2.5 space-y-1.5 border-l-2 border-border pl-4">
                          {c.workspacePackages.map((pkg) => {
                            const pkgChecked = Boolean(checkedSet?.has(pkg.path));
                            return (
                              <label
                                key={pkg.path}
                                className={cn(
                                  "flex cursor-pointer items-center justify-between gap-2 rounded-[6px] px-2 py-1.5 text-[12.5px]",
                                  pkg.alreadyRegistered
                                    ? "opacity-60"
                                    : "hover:bg-surface-hover/50",
                                )}
                              >
                                <span className="flex min-w-0 items-center gap-2">
                                  <input
                                    type="checkbox"
                                    disabled={pkg.alreadyRegistered}
                                    checked={pkgChecked}
                                    onChange={() => toggleWorkspacePkg(c.path, pkg.path)}
                                    className="h-3.5 w-3.5 accent-[var(--accent)]"
                                  />
                                  <span className="truncate font-medium text-fg">
                                    {pkg.name}
                                  </span>
                                  <span className="rounded bg-surface px-1.5 py-0.5 text-[10.5px] text-fg-muted">
                                    {FRAMEWORK_LABELS[pkg.framework]}
                                  </span>
                                </span>
                                {pkg.alreadyRegistered ? (
                                  <span className="text-[11px] text-accent">Terdaftar</span>
                                ) : (
                                  <span className="font-mono text-[11px] text-fg-faint tabular-nums">
                                    {pkg.scriptCount} scripts
                                  </span>
                                )}
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    );
                  }

                  const checked = selectedServices.has(c.path);
                  return (
                    <label
                      key={c.path}
                      className={cn(
                        "flex cursor-pointer items-start gap-2.5 rounded-[9px] border border-border bg-surface-2/40 p-3 transition-colors",
                        c.alreadyRegistered
                          ? "cursor-default opacity-65"
                          : "hover:bg-surface-hover/40",
                      )}
                    >
                      <input
                        type="checkbox"
                        disabled={c.alreadyRegistered}
                        checked={checked}
                        onChange={() => toggleService(c.path)}
                        className="mt-1 h-4 w-4 accent-[var(--accent)]"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-fg">{c.name}</span>
                          <span className="inline-flex items-center gap-1 rounded bg-surface px-1.5 py-0.5 text-[11px] text-fg-2">
                            <Layers className="h-3 w-3 text-info" aria-hidden="true" />
                            {FRAMEWORK_LABELS[c.framework]}
                          </span>
                          <span className="inline-flex items-center gap-1 rounded bg-surface px-1.5 py-0.5 font-mono text-[11px] text-fg-2">
                            <Package className="h-3 w-3 text-accent" aria-hidden="true" />
                            {c.packageManager}
                          </span>
                          <span className="font-mono text-[11px] text-fg-faint tabular-nums">
                            {c.scriptCount} scripts
                          </span>
                          {c.alreadyRegistered ? (
                            <span className="inline-flex items-center gap-1 rounded bg-accent-soft px-1.5 py-0.5 text-[10.5px] font-medium text-accent">
                              <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                              Sudah terdaftar
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-0.5 truncate font-mono text-[11.5px] text-fg-faint">
                          {c.path}
                        </p>
                      </div>
                    </label>
                  );
                })}
              </div>
            )
          ) : (
            <div className="py-10 text-center text-[13px] text-fg-muted">
              Pilih folder induk lalu klik <strong>Mulai Scan</strong> untuk menemukan seluruh project Node.js dan monorepo.
            </div>
          )}
        </div>

        {/* Footer actions */}
        {result && result.candidates.length > 0 ? (
          <div className="border-t border-border bg-surface-2/60 p-3.5">
            {groupMode ? (
              <form
                onSubmit={(e) => void handleGroupSelected(e)}
                className="flex flex-wrap items-center gap-2"
              >
                <input
                  type="text"
                  autoFocus
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder="Nama Project gabungan (mis. LMS App)"
                  className="h-8 min-w-0 flex-1 rounded-[7px] border border-border-strong bg-surface px-2.5 text-[13px] text-fg placeholder:text-fg-faint"
                />
                <button
                  type="button"
                  onClick={() => setGroupMode(false)}
                  className="btn-press h-8 rounded-[7px] border border-border-strong bg-surface px-3 text-[12.5px] font-medium text-fg-2 hover:bg-surface-hover"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={saving || !groupName.trim()}
                  className="btn-press h-8 rounded-[7px] bg-accent px-3.5 text-[12.5px] font-semibold text-accent-fg hover:opacity-95 disabled:opacity-50"
                >
                  {saving
                    ? "Menyimpan…"
                    : `Buat 1 Project (${selectedServices.size} folder)`}
                </button>
              </form>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[12px] text-fg-muted">
                  {selectedServices.size >= 2
                    ? `${selectedServices.size} folder standalone dipilih — bisa digabung jadi 1 Project.`
                    : "Pilih kandidat yang ingin didaftarkan ke DevDock."}
                </span>
                <div className="flex items-center gap-2">
                  {selectedServices.size >= 2 ? (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => setGroupMode(true)}
                      className="btn-press h-8 rounded-[7px] border border-info/50 bg-info-soft px-3 text-[12.5px] font-medium text-info hover:opacity-95"
                    >
                      Gabung jadi 1 Project ({selectedServices.size})
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={saving || totalSelectedCount === 0}
                    onClick={() => void handleRegisterSeparately()}
                    className="btn-press h-8 rounded-[7px] bg-accent px-3.5 text-[12.5px] font-semibold text-accent-fg hover:opacity-95 disabled:opacity-50"
                  >
                    {saving ? "Menyimpan…" : `Daftarkan Terpisah (${totalSelectedCount})`}
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
