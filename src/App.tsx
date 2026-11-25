import { useEffect, useMemo } from "react";
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
  onMetricsSnapshot,
  onProcessCrashed,
  onProcessStatus,
  onProjectsChanged,
} from "@/lib/tauri";
import { useAppStore } from "@/store/appStore";

export default function App() {
  const init = useAppStore((s) => s.init);
  const loadProjects = useAppStore((s) => s.loadProjects);
  const upsertProcess = useAppStore((s) => s.upsertProcess);
  const refreshPorts = useAppStore((s) => s.refreshPorts);
  const setMetricsSnapshot = useAppStore((s) => s.setMetricsSnapshot);
  const pushToast = useAppStore((s) => s.pushToast);
  const projects = useAppStore((s) => s.projects);
  const route = useAppStore((s) => s.route);
  const setRoute = useAppStore((s) => s.setRoute);
  const openAddProjectModal = useAppStore((s) => s.openAddProjectModal);
  const openScanModal = useAppStore((s) => s.openScanModal);

  useEffect(() => {
    void init();
  }, [init]);

  // Auto-refresh scripts when package.json changes on disk
  useEffect(() => {
    let unlistenProjects: (() => void) | undefined;
    let unlistenProcess: (() => void) | undefined;
    let unlistenCrash: (() => void) | undefined;
    let unlistenMetrics: (() => void) | undefined;
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
    return () => {
      if (unlistenProjects) unlistenProjects();
      if (unlistenProcess) unlistenProcess();
      if (unlistenCrash) unlistenCrash();
      if (unlistenMetrics) unlistenMetrics();
    };
  }, [loadProjects, upsertProcess, refreshPorts, setMetricsSnapshot, pushToast]);

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
    </>
  );
}
