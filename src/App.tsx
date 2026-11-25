import { useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { CommandPaletteModal } from "@/components/ui/CommandPaletteModal";
import { AddProjectModal } from "@/components/projects/AddProjectModal";
import { ScanFolderModal } from "@/components/projects/ScanFolderModal";
import { SidebarProjects } from "@/components/projects/SidebarProjects";
import { OverviewView } from "@/views/OverviewView";
import { SettingsView } from "@/views/SettingsView";
import { ServiceWorkbenchView } from "@/views/ServiceWorkbenchView";
import { ProjectOverviewView } from "@/views/ProjectOverviewView";
import { EnvPresetsView } from "@/views/EnvPresetsView";
import { PortInspectorView } from "@/views/PortInspectorView";
import {
  confirmAppQuit,
  onMetricsSnapshot,
  onProcessCrashed,
  onProcessStatus,
  onProjectOrchestration,
  onProjectsChanged,
  onProxyStatus,
  onQuitRequested,
} from "@/lib/tauri";
import { useAppStore } from "@/store/appStore";

export default function App() {
  const init = useAppStore((s) => s.init);
  const loadProjects = useAppStore((s) => s.loadProjects);
  const upsertProcess = useAppStore((s) => s.upsertProcess);
  const refreshPorts = useAppStore((s) => s.refreshPorts);
  const setMetricsSnapshot = useAppStore((s) => s.setMetricsSnapshot);
  const setProxyStatus = useAppStore((s) => s.setProxyStatus);
  const setOrchestrationStep = useAppStore((s) => s.setOrchestrationStep);
  const pushToast = useAppStore((s) => s.pushToast);
  const projects = useAppStore((s) => s.projects);
  const route = useAppStore((s) => s.route);
  const setRoute = useAppStore((s) => s.setRoute);
  const openAddProjectModal = useAppStore((s) => s.openAddProjectModal);
  const openScanModal = useAppStore((s) => s.openScanModal);
  const [quitActiveCount, setQuitActiveCount] = useState<number | null>(null);
  const [quitBusy, setQuitBusy] = useState(false);

  useEffect(() => {
    void init();
  }, [init]);

  // Auto-refresh scripts when package.json changes on disk
  useEffect(() => {
    let unlistenProjects: (() => void) | undefined;
    let unlistenProcess: (() => void) | undefined;
    let unlistenCrash: (() => void) | undefined;
    let unlistenMetrics: (() => void) | undefined;
    let unlistenOrchestration: (() => void) | undefined;
    let unlistenProxy: (() => void) | undefined;
    let unlistenQuit: (() => void) | undefined;
    void onProjectsChanged(() => {
      void loadProjects();
    }).then((fn) => {
      unlistenProjects = fn;
    });
    void onProcessStatus((info) => {
      upsertProcess(info);
      void refreshPorts();
    }).then((fn) => {
      unlistenProcess = fn;
    });
    void onProcessCrashed((crash) => {
      pushToast({
        title: `${crash.serviceName} · ${crash.script} crashed`,
        description: crash.lastErrorSnippet
          ? `${crash.reason} — ${crash.lastErrorSnippet}`
          : crash.reason,
        variant: "danger",
      });
    }).then((fn) => {
      unlistenCrash = fn;
    });
    void onMetricsSnapshot((snapshot) => {
      setMetricsSnapshot(snapshot);
    }).then((fn) => {
      unlistenMetrics = fn;
    });
    void onProjectOrchestration((step) => {
      setOrchestrationStep(step);
    }).then((fn) => {
      unlistenOrchestration = fn;
    });
    void onProxyStatus((status) => {
      setProxyStatus(status);
    }).then((fn) => {
      unlistenProxy = fn;
    });
    void onQuitRequested(({ activeCount }) => {
      setQuitActiveCount(activeCount);
    }).then((fn) => {
      unlistenQuit = fn;
    });
    return () => {
      if (unlistenProjects) unlistenProjects();
      if (unlistenProcess) unlistenProcess();
      if (unlistenCrash) unlistenCrash();
      if (unlistenMetrics) unlistenMetrics();
      if (unlistenOrchestration) unlistenOrchestration();
      if (unlistenProxy) unlistenProxy();
      if (unlistenQuit) unlistenQuit();
    };
  }, [
    loadProjects,
    upsertProcess,
    refreshPorts,
    setMetricsSnapshot,
    setOrchestrationStep,
    setProxyStatus,
    pushToast,
  ]);

  useEffect(() => {
    if (quitActiveCount === null) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !quitBusy) {
        setQuitActiveCount(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [quitActiveCount, quitBusy]);

  const totalServices = useMemo(
    () => projects.reduce((sum, p) => sum + p.services.length, 0),
    [projects],
  );

  const activeProject =
    route.kind === "project" || route.kind === "service"
      ? projects.find((p) => p.id === route.projectId)
      : undefined;

  const activeService =
    route.kind === "service" && activeProject
      ? activeProject.services.find((s) => s.id === route.serviceId)
      : undefined;

  const breadcrumbSegments = useMemo(() => {
    const base = [
      { label: "Overview", onClick: () => setRoute({ kind: "overview" }) },
    ];
    if (route.kind === "overview") return base;
    if (route.kind === "ports") return [...base, { label: "Port Inspector" }];
    if (route.kind === "presets") return [...base, { label: "Env Presets" }];
    if (route.kind === "settings") return [...base, { label: "Settings" }];
    if (route.kind === "project" && activeProject) {
      return [...base, { label: activeProject.name }];
    }
    if (route.kind === "service" && activeProject && activeService) {
      if (activeProject.services.length === 1) {
        return [...base, { label: activeProject.name }];
      }
      return [
        ...base,
        {
          label: activeProject.name,
          onClick: () =>
            setRoute({ kind: "project", projectId: activeProject.id }),
        },
        { label: activeService.name },
      ];
    }
    return base;
  }, [route, activeProject, activeService, setRoute]);

  const renderMain = () => {
    switch (route.kind) {
      case "overview":
        return (
          <OverviewView
            projectCount={projects.length}
            serviceCount={totalServices}
            onAddProject={() => openAddProjectModal(null)}
          />
        );
      case "ports":
        return <PortInspectorView />;
      case "presets":
        return <EnvPresetsView />;
      case "settings":
        return <SettingsView />;
      case "project":
        if (activeProject) {
          return <ProjectOverviewView project={activeProject} />;
        }
        return (
          <OverviewView
            projectCount={projects.length}
            serviceCount={totalServices}
            onAddProject={() => openAddProjectModal(null)}
          />
        );
      case "service":
        if (activeProject && activeService) {
          return (
            <ServiceWorkbenchView
              project={activeProject}
              service={activeService}
            />
          );
        }
        return (
          <OverviewView
            projectCount={projects.length}
            serviceCount={totalServices}
            onAddProject={() => openAddProjectModal(null)}
          />
        );
    }
  };

  return (
    <>
      <AppShell
        projectsSlot={<SidebarProjects />}
        onAddProject={() => openAddProjectModal(null)}
        onScanFolder={() => openScanModal()}
        breadcrumbSegments={breadcrumbSegments}
      >
        {renderMain()}
      </AppShell>
      <CommandPaletteModal />
      <AddProjectModal />
      <ScanFolderModal />
      {quitActiveCount !== null ? (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-label="Confirm quit DevDock"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-[1px]"
          onClick={() => {
            if (!quitBusy) setQuitActiveCount(null);
          }}
        >
          <div
            className="animate-modal-enter w-full max-w-md rounded-[12px] border border-border-strong bg-surface p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-warn-soft text-warn">
                <AlertTriangle className="h-4.5 w-4.5" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-[15px] font-semibold text-fg">
                  {quitActiveCount > 0
                    ? "Stop all processes before quitting?"
                    : "Quit DevDock?"}
                </h2>
                {quitActiveCount > 0 ? (
                  <p className="mt-1 text-[13px] leading-relaxed text-fg-muted">
                    There {quitActiveCount === 1 ? "is" : "are"} currently{" "}
                    <span className="font-mono font-semibold text-fg tabular-nums">
                      {quitActiveCount}
                    </span>{" "}
                    running {quitActiveCount === 1 ? "process" : "processes"}. You can stop the entire process tree or leave {quitActiveCount === 1 ? "it" : "them"} running in the background.
                  </p>
                ) : (
                  <p className="mt-1 text-[13px] leading-relaxed text-fg-muted">
                    DevDock will close completely and stop running in the background. To keep it active in the menu bar, close the window with the close button instead.
                  </p>
                )}
              </div>
            </div>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={quitBusy}
                onClick={() => setQuitActiveCount(null)}
                className="btn-press h-8 rounded-[7px] border border-border-strong bg-surface-2 px-3 text-[12.5px] font-medium text-fg-2 hover:bg-surface-hover hover:text-fg disabled:opacity-50"
              >
                Cancel
              </button>
              {quitActiveCount > 0 ? (
                <>
                  <button
                    type="button"
                    disabled={quitBusy}
                    onClick={() => {
                      setQuitBusy(true);
                      void confirmAppQuit(false).finally(() => setQuitBusy(false));
                    }}
                    className="btn-press h-8 rounded-[7px] border border-border-strong bg-surface-2 px-3 text-[12.5px] font-medium text-fg hover:bg-surface-hover disabled:opacity-50"
                  >
                    Leave Running & Quit
                  </button>
                  <button
                    type="button"
                    disabled={quitBusy}
                    onClick={() => {
                      setQuitBusy(true);
                      void confirmAppQuit(true).finally(() => setQuitBusy(false));
                    }}
                    className="btn-press h-8 rounded-[7px] bg-danger-solid px-3 text-[12.5px] font-semibold text-white hover:opacity-95 disabled:opacity-50"
                  >
                    Stop All & Quit
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  disabled={quitBusy}
                  onClick={() => {
                    setQuitBusy(true);
                    void confirmAppQuit(false).finally(() => setQuitBusy(false));
                  }}
                  className="btn-press h-8 rounded-[7px] bg-danger-solid px-3 text-[12.5px] font-semibold text-white hover:opacity-95 disabled:opacity-50"
                >
                  Quit DevDock
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
