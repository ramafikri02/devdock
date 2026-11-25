import { useEffect, useState } from "react";
import { AlertTriangle, HardDrive, Plus, Trash2, ArrowRight } from "lucide-react";
import {
  FRAMEWORK_LABELS,
  type Project,
  type ProjectStorageSummary,
  analyzeProjectStorage,
} from "@/lib/tauri";
import { formatBytes } from "@/lib/format";
import { useAppStore } from "@/store/appStore";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

interface ProjectOverviewViewProps {
  project: Project;
}

export function ProjectOverviewView({ project }: ProjectOverviewViewProps) {
  const setRoute = useAppStore((s) => s.setRoute);
  const openAddProjectModal = useAppStore((s) => s.openAddProjectModal);
  const removeProject = useAppStore((s) => s.removeProject);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [storage, setStorage] = useState<ProjectStorageSummary | null>(null);

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
            {storage ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-fg-muted tabular-nums">
                <HardDrive className="h-3 w-3 text-warn" aria-hidden="true" />
                {formatBytes(storage.totalBytes)}
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 text-[13px] text-fg-muted">
            Pilih service untuk membuka Service Workbench atau tambahkan folder service baru ke project ini.
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
