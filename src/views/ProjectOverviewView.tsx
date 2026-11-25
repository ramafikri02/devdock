import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Eye,
  EyeOff,
  HardDrive,
  KeyRound,
  Layers,
  Lock,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import {
  FRAMEWORK_LABELS,
  type Project,
  type ProjectEnvSummary,
  type ProjectStorageSummary,
  analyzeProjectStorage,
  attachPresetToProject,
  detachPresetFromProject,
  inspectProjectSharedEnv,
  reorderProjectPresets,
} from "@/lib/tauri";
import { formatBytes } from "@/lib/format";
import { useAppStore } from "@/store/appStore";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { cn } from "@/lib/cn";

interface ProjectOverviewViewProps {
  project: Project;
}

type ProjectTab = "services" | "env";

export function ProjectOverviewView({ project }: ProjectOverviewViewProps) {
  const setRoute = useAppStore((s) => s.setRoute);
  const openAddProjectModal = useAppStore((s) => s.openAddProjectModal);
  const removeProject = useAppStore((s) => s.removeProject);
  const allPresets = useAppStore((s) => s.presets);
  const loadPresets = useAppStore((s) => s.loadPresets);
  const pushToast = useAppStore((s) => s.pushToast);

  const [activeTab, setActiveTab] = useState<ProjectTab>("services");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [storage, setStorage] = useState<ProjectStorageSummary | null>(null);
  const [sharedEnv, setSharedEnv] = useState<ProjectEnvSummary | null>(null);
  const [selectedPresetToAdd, setSelectedPresetToAdd] = useState("");
  const [revealSecrets, setRevealSecrets] = useState(false);

  const loadSharedEnv = useCallback(async () => {
    try {
      const res = await inspectProjectSharedEnv(project.id);
      setSharedEnv(res);
    } catch {
      // Non-fatal
    }
  }, [project.id]);

  useEffect(() => {
    let cancelled = false;
    void analyzeProjectStorage(project.id, false)
      .then((res) => {
        if (!cancelled) setStorage(res);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  useEffect(() => {
    void loadSharedEnv();
  }, [loadSharedEnv]);

  const attachedIds = new Set((sharedEnv?.presets ?? []).map((p) => p.presetId));
  const availablePresets = allPresets.filter((p) => !attachedIds.has(p.id));

  const handleAttachPreset = async () => {
    if (!selectedPresetToAdd) return;
    try {
      await attachPresetToProject(project.id, selectedPresetToAdd);
      setSelectedPresetToAdd("");
      await Promise.all([loadSharedEnv(), loadPresets()]);
      pushToast({
        title: `Preset dipasang ke ${project.name}`,
        variant: "success",
      });
    } catch (err) {
      pushToast({
        title: "Gagal memasang preset",
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    }
  };

  const handleDetachPreset = async (presetId: string, presetName: string) => {
    try {
      await detachPresetFromProject(project.id, presetId);
      await Promise.all([loadSharedEnv(), loadPresets()]);
      pushToast({
        title: `Preset "${presetName}" dilepas dari ${project.name}`,
        variant: "info",
      });
    } catch (err) {
      pushToast({
        title: "Gagal melepas preset",
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    }
  };

  const handleMovePreset = async (index: number, direction: -1 | 1) => {
    if (!sharedEnv) return;
    const list = [...sharedEnv.presets];
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= list.length) return;
    const [moved] = list.splice(index, 1);
    list.splice(targetIndex, 0, moved);
    try {
      await reorderProjectPresets(
        project.id,
        list.map((p) => p.presetId),
      );
      await loadSharedEnv();
    } catch (err) {
      pushToast({
        title: "Gagal mengubah urutan preset",
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    }
  };

  return (
    <div className="animate-view-enter mx-auto max-w-5xl space-y-5 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-[19px] font-semibold tracking-tight text-fg">
              {project.name}
            </h1>
            <span className="rounded-full bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-fg-muted tabular-nums">
              {project.services.length} services
            </span>
            {sharedEnv && sharedEnv.presets.length > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-info-soft px-2 py-0.5 font-mono text-[11px] text-info tabular-nums">
                <KeyRound className="h-3 w-3" aria-hidden="true" />
                {sharedEnv.presets.length} shared preset
              </span>
            ) : null}
            {storage ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-fg-muted tabular-nums">
                <HardDrive className="h-3 w-3 text-warn" aria-hidden="true" />
                {formatBytes(storage.totalBytes)}
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 text-[13px] text-fg-muted">
            Kelola service dan shared env preset yang diwariskan ke seluruh service dalam project ini.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => openAddProjectModal(project.id)}
            className="btn-press flex h-8 items-center gap-1.5 rounded-[7px] bg-accent px-3 text-[12.5px] font-semibold text-accent-fg hover:opacity-95"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Tambah Service</span>
          </button>
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            className="btn-press flex h-8 items-center gap-1.5 rounded-[7px] border border-danger/40 bg-danger-soft px-3 text-[12.5px] font-medium text-danger hover:bg-danger-solid hover:text-white"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Hapus Project</span>
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-border" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "services"}
          onClick={() => setActiveTab("services")}
          className={cn(
            "relative flex items-center gap-1.5 px-3 py-2 text-[13px] font-medium transition-colors",
            activeTab === "services"
              ? "text-fg after:absolute after:right-0 after:bottom-0 after:left-0 after:h-[2px] after:bg-info"
              : "text-fg-muted hover:text-fg",
          )}
        >
          <Layers className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Services</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "env"}
          onClick={() => setActiveTab("env")}
          className={cn(
            "relative flex items-center gap-1.5 px-3 py-2 text-[13px] font-medium transition-colors",
            activeTab === "env"
              ? "text-fg after:absolute after:right-0 after:bottom-0 after:left-0 after:h-[2px] after:bg-info"
              : "text-fg-muted hover:text-fg",
          )}
        >
          <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Shared Env & Presets</span>
          {sharedEnv && sharedEnv.presets.length > 0 ? (
            <span className="rounded-full bg-surface-2 px-1.5 py-0.5 font-mono text-[10.5px] text-fg-muted tabular-nums">
              {sharedEnv.presets.length}
            </span>
          ) : null}
        </button>
      </div>

      {activeTab === "services" ? (
        <div className="overflow-hidden rounded-[10px] border border-border bg-surface">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-border bg-surface-2 text-[11.5px] font-semibold tracking-wide text-fg-muted uppercase">
                <th className="px-4 py-2.5">#</th>
                <th className="px-4 py-2.5">Service</th>
                <th className="px-4 py-2.5">Framework / PM</th>
                <th className="px-4 py-2.5">Scripts</th>
                <th className="px-4 py-2.5 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border text-[13px]">
              {project.services.map((svc, index) => (
                <tr
                  key={svc.id}
                  className="transition-colors hover:bg-surface-hover/40"
                >
                  <td className="px-4 py-3 font-mono text-[12px] text-fg-faint tabular-nums">
                    #{index + 1}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 font-medium text-fg">
                      <span>{svc.name}</span>
                      {svc.isMissing ? (
                        <span className="inline-flex items-center gap-1 rounded bg-warn-soft px-1.5 py-0.5 text-[10.5px] text-warn">
                          <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                          missing
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-0.5 max-w-md truncate font-mono text-[11.5px] text-fg-faint">
                      {svc.path}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[12.5px] text-fg-2">
                    {FRAMEWORK_LABELS[svc.detectedFramework]} ·{" "}
                    <span className="font-mono">
                      {svc.pmOverride ?? svc.detectedPm}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-[12px] text-fg-muted tabular-nums">
                    {Object.keys(svc.scripts).length}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() =>
                        setRoute({
                          kind: "service",
                          projectId: project.id,
                          serviceId: svc.id,
                        })
                      }
                      className="btn-press inline-flex h-7 items-center gap-1 rounded-[6px] border border-border-strong bg-surface-2 px-2.5 text-[12px] font-medium text-fg-2 hover:bg-surface-hover hover:text-fg"
                    >
                      <span>Atur</span>
                      <ArrowRight className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Attached Project Presets */}
          <div className="rounded-[10px] border border-border bg-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-[13.5px] font-semibold text-fg">
                  Project Presets (Diwariskan ke Semua Service)
                </h2>
                <p className="mt-0.5 text-[12px] text-fg-muted">
                  Preset yang berada lebih bawah memiliki prioritas lebih tinggi jika ada key yang sama.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <select
                  aria-label="Pilih preset untuk dipasang ke project"
                  value={selectedPresetToAdd}
                  onChange={(e) => setSelectedPresetToAdd(e.target.value)}
                  className="h-8 rounded-[7px] border border-border-strong bg-surface-2 px-2.5 text-[12px] text-fg"
                >
                  <option value="">Pilih preset…</option>
                  {availablePresets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.entries.length} key)
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={!selectedPresetToAdd}
                  onClick={() => void handleAttachPreset()}
                  className="btn-press inline-flex h-8 items-center gap-1.5 rounded-[7px] bg-accent px-3 text-[12px] font-semibold text-accent-fg hover:opacity-95 disabled:opacity-45"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Pasang Preset</span>
                </button>
              </div>
            </div>

            {!sharedEnv || sharedEnv.presets.length === 0 ? (
              <div className="mt-3 rounded-[8px] border border-dashed border-border p-4 text-center text-[12.5px] text-fg-muted">
                Belum ada shared preset dipasang.{" "}
                <button
                  type="button"
                  onClick={() => setRoute({ kind: "presets" })}
                  className="font-medium text-info hover:underline"
                >
                  Kelola Env Presets →
                </button>
              </div>
            ) : (
              <div className="mt-3 space-y-1.5">
                {sharedEnv.presets.map((preset, idx) => (
                  <div
                    key={preset.presetId}
                    className="flex items-center justify-between gap-2 rounded-[8px] border border-border bg-surface-2 px-3 py-2"
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="font-mono text-[11.5px] text-fg-faint tabular-nums">
                        #{idx + 1}
                      </span>
                      <span className="text-[13px] font-medium text-fg">
                        {preset.presetName}
                      </span>
                      <span className="rounded bg-surface px-1.5 py-0.5 font-mono text-[10.5px] text-fg-muted tabular-nums">
                        {preset.entryCount} key
                      </span>
                      {preset.secretCount > 0 ? (
                        <span className="inline-flex items-center gap-1 rounded bg-warn-soft px-1.5 py-0.5 font-mono text-[10.5px] text-warn tabular-nums">
                          <Lock className="h-2.5 w-2.5" aria-hidden="true" />
                          {preset.secretCount} Keychain
                        </span>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        aria-label={`Naikkan urutan ${preset.presetName}`}
                        disabled={idx === 0}
                        onClick={() => void handleMovePreset(idx, -1)}
                        className="flex h-7 w-7 items-center justify-center rounded-[6px] border border-border bg-surface text-fg-muted hover:bg-surface-hover hover:text-fg disabled:opacity-35"
                      >
                        <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Turunkan urutan ${preset.presetName}`}
                        disabled={idx === sharedEnv.presets.length - 1}
                        onClick={() => void handleMovePreset(idx, 1)}
                        className="flex h-7 w-7 items-center justify-center rounded-[6px] border border-border bg-surface text-fg-muted hover:bg-surface-hover hover:text-fg disabled:opacity-35"
                      >
                        <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Lepas preset ${preset.presetName}`}
                        onClick={() =>
                          void handleDetachPreset(
                            preset.presetId,
                            preset.presetName,
                          )
                        }
                        className="flex h-7 items-center gap-1 rounded-[6px] border border-danger/30 bg-danger-soft px-2 text-[11.5px] font-medium text-danger hover:bg-danger-solid hover:text-white"
                      >
                        <X className="h-3 w-3" aria-hidden="true" />
                        <span>Lepas</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Merged Shared Env Preview */}
          {sharedEnv && sharedEnv.entries.length > 0 ? (
            <div className="overflow-hidden rounded-[10px] border border-border bg-surface">
              <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
                <span className="text-[12.5px] font-semibold text-fg">
                  Preview Shared Env ({sharedEnv.entries.length} key)
                </span>
                <button
                  type="button"
                  onClick={() => setRevealSecrets((v) => !v)}
                  className="btn-press inline-flex h-7 items-center gap-1 rounded-[6px] border border-border-strong bg-surface-2 px-2 text-[11.5px] font-medium text-fg-2 hover:bg-surface-hover hover:text-fg"
                >
                  {revealSecrets ? (
                    <>
                      <EyeOff className="h-3 w-3" aria-hidden="true" />
                      <span>Sembunyikan</span>
                    </>
                  ) : (
                    <>
                      <Eye className="h-3 w-3" aria-hidden="true" />
                      <span>Tampilkan Secret</span>
                    </>
                  )}
                </button>
              </div>
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-border bg-surface-2 text-[11.5px] font-semibold tracking-wide text-fg-muted uppercase">
                    <th className="px-4 py-2">Key</th>
                    <th className="px-4 py-2">Nilai</th>
                    <th className="px-4 py-2">Preset Sumber</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border text-[12.5px]">
                  {sharedEnv.entries.map((entry) => (
                    <tr key={entry.key}>
                      <td className="px-4 py-2 font-mono font-medium text-fg">
                        <div className="flex items-center gap-1.5">
                          <span>{entry.key}</span>
                          {entry.isSecret ? (
                            <span className="inline-flex items-center gap-0.5 rounded bg-warn-soft px-1.5 py-0.5 text-[10px] text-warn">
                              <Lock className="h-2.5 w-2.5" aria-hidden="true" />
                              secret
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-2 font-mono text-[12px] text-fg-2">
                        {entry.isSecret && !revealSecrets
                          ? "••••••••"
                          : entry.value}
                      </td>
                      <td className="px-4 py-2">
                        <span className="rounded bg-info-soft px-1.5 py-0.5 font-mono text-[11px] text-info">
                          project:{entry.source}
                        </span>
                        {entry.overriddenSources.length > 0 ? (
                          <span className="ml-1.5 text-[10.5px] text-fg-faint">
                            (timpa {entry.overriddenSources.join(", ")})
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title={`Hapus project "${project.name}"?`}
        description="Menghapus project hanya menghapusnya dari DevDock. Folder dan file kode di disk tidak akan disentuh."
        confirmLabel="Hapus dari DevDock"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          void removeProject(project.id);
        }}
      />
    </div>
  );
}
