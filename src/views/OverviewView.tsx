import {
  Activity,
  AlertTriangle,
  Cpu,
  FolderPlus,
  HardDrive,
  MemoryStick,
  Network,
  PlayCircle,
} from "lucide-react";
import { useAppStore } from "@/store/appStore";

interface OverviewViewProps {
  projectCount?: number;
  serviceCount?: number;
  onAddProject?: () => void;
}

export function OverviewView({
  projectCount = 0,
  serviceCount = 0,
  onAddProject,
}: OverviewViewProps) {
  const bootstrap = useAppStore((s) => s.bootstrap);

  const kpis = [
    { label: "Jalan", value: "0", icon: PlayCircle, tone: "text-accent" },
    { label: "Crash", value: "0", icon: AlertTriangle, tone: "text-danger" },
    { label: "Bentrok Port", value: "0", icon: Network, tone: "text-warn" },
    { label: "CPU Total", value: "0.0%", icon: Cpu, tone: "text-info" },
    { label: "RAM Total", value: "0 MB", icon: MemoryStick, tone: "text-info" },
    { label: "node_modules", value: "—", icon: HardDrive, tone: "text-fg-muted" },
  ];

  return (
    <div className="animate-view-enter mx-auto max-w-6xl space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-[19px] font-semibold tracking-tight text-fg">
            Overview
          </h1>
          <p className="mt-0.5 text-[13px] text-fg-muted">
            <span className="font-mono tabular-nums">{projectCount}</span> project ·{" "}
            <span className="font-mono tabular-nums">{serviceCount}</span> service terdaftar
            {bootstrap ? (
              <>
                {" "}
                · Core v{bootstrap.version} (schema v{bootstrap.schemaVersion})
              </>
            ) : null}
          </p>
        </div>

        {onAddProject ? (
          <button
            type="button"
            onClick={onAddProject}
            className="btn-press flex h-8 items-center gap-1.5 rounded-[7px] bg-accent px-3 text-[13px] font-semibold text-accent-fg hover:opacity-95"
          >
            <FolderPlus className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
            <span>Tambah Project</span>
          </button>
        ) : null}
      </div>

      {/* KPI Row (6 cards) */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {kpis.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <div
              key={kpi.label}
              className="rounded-[10px] border border-border bg-surface p-3.5"
            >
              <div className="flex items-center justify-between text-[12px] text-fg-muted">
                <span>{kpi.label}</span>
                <Icon
                  className={`h-3.5 w-3.5 ${kpi.tone}`}
                  strokeWidth={1.85}
                  aria-hidden="true"
                />
              </div>
              <div className="mt-2 font-mono text-[20px] font-semibold text-fg tabular-nums">
                {kpi.value}
              </div>
            </div>
          );
        })}
      </div>

      {/* Empty state / ready card */}
      <div className="rounded-[12px] border border-border bg-surface p-6">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-info-soft text-info">
            <Activity className="h-4.5 w-4.5" strokeWidth={1.85} aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[14.5px] font-semibold text-fg">
              DevDock siap digunakan
            </h2>
            <p className="mt-1 text-[13px] text-fg-muted">
              Tambahkan folder project Node.js untuk mendeteksi package manager, framework, dan daftar script secara otomatis.
            </p>
            {bootstrap ? (
              <div className="mt-4 grid gap-2 rounded-[8px] border border-border bg-surface-2 p-3 font-mono text-[11.5px] text-fg-muted">
                <div className="truncate">
                  <span className="text-fg-faint">DB:</span> {bootstrap.dbPath}
                </div>
                <div className="truncate">
                  <span className="text-fg-faint">Adapters:</span>{" "}
                  {bootstrap.adapters.join(", ")}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
