import { useState } from "react";
import { AlertTriangle, Box, ChevronRight, FolderKanban } from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { cn } from "@/lib/cn";

export function SidebarProjects() {
  const projects = useAppStore((s) => s.projects);
  const route = useAppStore((s) => s.route);
  const setRoute = useAppStore((s) => s.setRoute);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  if (projects.length === 0) {
    return (
      <div className="rounded-[8px] border border-dashed border-border px-3 py-4 text-center">
        <Box
          className="mx-auto mb-1.5 h-5 w-5 text-fg-faint"
          strokeWidth={1.75}
          aria-hidden="true"
        />
        <p className="text-[12px] text-fg-muted">
          Belum ada project terdaftar.
        </p>
        <p className="mt-0.5 text-[11.5px] text-fg-faint">
          Klik + Tambah untuk mulai.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      {projects.map((project) => {
        // Single-service project renders flat without extra nesting
        if (project.services.length === 1) {
          const svc = project.services[0];
          const active =
            route.kind === "service" && route.serviceId === svc.id;
          return (
            <button
              key={project.id}
              type="button"
              onClick={() =>
                setRoute({
                  kind: "service",
                  projectId: project.id,
                  serviceId: svc.id,
                })
              }
              className={cn(
                "btn-press flex h-8 w-full items-center justify-between gap-2 rounded-[7px] px-2 text-left text-[13px]",
                active
                  ? "bg-surface-hover font-medium text-fg"
                  : "text-fg-2 hover:bg-surface-hover/70 hover:text-fg",
              )}
            >
              <span className="flex min-w-0 items-center gap-2">
                {svc.isMissing ? (
                  <AlertTriangle
                    className="h-3.5 w-3.5 shrink-0 text-warn"
                    aria-hidden="true"
                  />
                ) : (
                  <span
                    className="h-2 w-2 shrink-0 rounded-full bg-fg-faint/60"
                    aria-hidden="true"
                  />
                )}
                <span className="truncate">{project.name}</span>
              </span>
              {svc.isMissing ? (
                <span className="shrink-0 rounded bg-warn-soft px-1.5 py-0.5 text-[10px] font-medium text-warn">
                  missing
                </span>
              ) : null}
            </button>
          );
        }

        // Multi-service project renders expandable tree
        const isOpen = expanded[project.id] ?? true;
        const isProjectActive =
          route.kind === "project" && route.projectId === project.id;
        const hasMissing = project.services.some((s) => s.isMissing);

        return (
          <div key={project.id} className="flex flex-col">
            <div
              className={cn(
                "flex h-8 items-center gap-1 rounded-[7px] px-1.5",
                isProjectActive
                  ? "bg-surface-hover text-fg"
                  : "text-fg-2 hover:bg-surface-hover/70 hover:text-fg",
              )}
            >
              <button
                type="button"
                onClick={() =>
                  setExpanded((prev) => ({ ...prev, [project.id]: !isOpen }))
                }
                aria-label={isOpen ? `Tutup ${project.name}` : `Buka ${project.name}`}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-fg-muted hover:text-fg"
              >
                <ChevronRight
                  className={cn(
                    "h-3.5 w-3.5 transition-transform duration-150",
                    isOpen && "rotate-90",
                  )}
                  aria-hidden="true"
                />
              </button>

              <button
                type="button"
                onClick={() =>
                  setRoute({ kind: "project", projectId: project.id })
                }
                className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left text-[13px] font-medium"
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <FolderKanban
                    className={cn(
                      "h-3.5 w-3.5 shrink-0",
                      hasMissing ? "text-warn" : "text-fg-muted",
                    )}
                    aria-hidden="true"
                  />
                  <span className="truncate">{project.name}</span>
                </span>
                <span className="shrink-0 rounded-full bg-surface-2 px-1.5 py-0.5 font-mono text-[10.5px] text-fg-muted tabular-nums">
                  0/{project.services.length}
                </span>
              </button>
            </div>

            {isOpen ? (
              <div className="mt-0.5 ml-4 flex flex-col gap-0.5 border-l border-border pl-2">
                {project.services.map((svc) => {
                  const active =
                    route.kind === "service" && route.serviceId === svc.id;
                  return (
                    <button
                      key={svc.id}
                      type="button"
                      onClick={() =>
                        setRoute({
                          kind: "service",
                          projectId: project.id,
                          serviceId: svc.id,
                        })
                      }
                      className={cn(
                        "btn-press flex h-7 w-full items-center justify-between gap-2 rounded-[6px] px-2 text-left text-[12.5px]",
                        active
                          ? "bg-surface-hover font-medium text-fg"
                          : "text-fg-muted hover:bg-surface-hover/70 hover:text-fg",
                      )}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        {svc.isMissing ? (
                          <AlertTriangle
                            className="h-3 w-3 shrink-0 text-warn"
                            aria-hidden="true"
                          />
                        ) : (
                          <span
                            className="h-1.5 w-1.5 shrink-0 rounded-full bg-fg-faint/60"
                            aria-hidden="true"
                          />
                        )}
                        <span className="truncate">{svc.name}</span>
                      </span>
                      {svc.isMissing ? (
                        <span className="shrink-0 text-[10px] font-medium text-warn">
                          missing
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
