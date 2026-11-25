import {
  KeyRound,
  LayoutGrid,
  Network,
  Settings,
  Box,
} from "lucide-react";
import { type ReactNode } from "react";
import { useAppStore } from "@/store/appStore";
import { cn } from "@/lib/cn";

interface SidebarProps {
  projectsSlot?: ReactNode;
}

export function Sidebar({ projectsSlot }: SidebarProps) {
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const route = useAppStore((s) => s.route);
  const setRoute = useAppStore((s) => s.setRoute);
  const presetCount = useAppStore((s) => s.presets.length);
  const processes = useAppStore((s) => s.processes);
  const portConflictCount = useAppStore((s) => s.portSnapshot?.conflictCount ?? 0);

  if (!sidebarOpen) {
    return null;
  }

  const runningCount = Object.values(processes).filter(
    (p) => p.status === "running" || p.status === "starting",
  ).length;

  const navItems = [
    {
      id: "overview" as const,
      label: "Overview",
      icon: LayoutGrid,
      badge: String(runningCount),
      badgeTone: runningCount > 0 ? "bg-accent-soft text-accent" : "bg-surface-2 text-fg-muted",
    },
    {
      id: "ports" as const,
      label: "Port Inspector",
      icon: Network,
      badge: portConflictCount > 0 ? String(portConflictCount) : null,
      badgeTone: "bg-warn-soft text-warn",
    },
    {
      id: "presets" as const,
      label: "Env Presets",
      icon: KeyRound,
      badge: presetCount > 0 ? String(presetCount) : null,
      badgeTone: "bg-surface-2 text-fg-muted",
    },
  ];

  return (
    <aside className="flex w-[256px] shrink-0 flex-col border-r border-border bg-bg-sidebar">
      <div className="flex-1 overflow-y-auto px-2.5 py-3">
        {/* WORKSPACE section */}
        <div className="mb-4">
          <div className="mb-1.5 px-2 text-[11px] font-semibold tracking-wider text-fg-faint uppercase">
            Workspace
          </div>
          <nav className="flex flex-col gap-0.5" aria-label="Workspace">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = route.kind === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setRoute({ kind: item.id })}
                  className={cn(
                    "btn-press flex h-8 w-full items-center justify-between rounded-[7px] px-2 text-[13px] font-medium",
                    active
                      ? "bg-surface-hover text-fg"
                      : "text-fg-2 hover:bg-surface-hover/70 hover:text-fg",
                  )}
                >
                  <span className="flex items-center gap-2">
                    <Icon
                      className={cn(
                        "h-4 w-4",
                        active ? "text-info" : "text-fg-muted",
                      )}
                      strokeWidth={1.85}
                      aria-hidden="true"
                    />
                    <span>{item.label}</span>
                  </span>
                  {item.badge !== null ? (
                    <span
                      className={cn(
                        "rounded-full px-1.5 py-0.5 font-mono text-[11px] tabular-nums",
                        item.badgeTone,
                      )}
                    >
                      {item.badge}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </nav>
        </div>

        {/* PROJECTS section */}
        <div>
          <div className="mb-1.5 px-2 text-[11px] font-semibold tracking-wider text-fg-faint uppercase">
            Projects
          </div>
          {projectsSlot ?? (
            <div className="rounded-[8px] border border-dashed border-border px-3 py-4 text-center">
              <Box
                className="mx-auto mb-1.5 h-5 w-5 text-fg-faint"
                strokeWidth={1.75}
                aria-hidden="true"
              />
              <p className="text-[12px] text-fg-muted">
                No projects registered yet.
              </p>
              <p className="mt-0.5 text-[11.5px] text-fg-faint">
                Click + Add to get started.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-border px-2.5 py-2">
        <button
          type="button"
          onClick={() => setRoute({ kind: "settings" })}
          className={cn(
            "btn-press flex h-7 items-center gap-2 rounded-[7px] px-2 text-[12.5px] font-medium",
            route.kind === "settings"
              ? "bg-surface-hover text-fg"
              : "text-fg-muted hover:bg-surface-hover hover:text-fg",
          )}
        >
          <Settings className="h-3.5 w-3.5" strokeWidth={1.85} aria-hidden="true" />
          <span>Settings</span>
        </button>

        <div className="flex items-center gap-1.5 text-[11.5px] text-fg-muted">
          <span
            className="h-2 w-2 rounded-full bg-accent shadow-[0_0_5px_var(--accent)]"
            aria-hidden="true"
          />
          <span>Tray active</span>
        </div>
      </div>
    </aside>
  );
}
