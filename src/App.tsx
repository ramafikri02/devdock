import { useEffect, useMemo } from "react";
import { Network } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { CommandPaletteModal } from "@/components/ui/CommandPaletteModal";
import { AddProjectModal } from "@/components/projects/AddProjectModal";
import { ScanFolderModal } from "@/components/projects/ScanFolderModal";
import { SidebarProjects } from "@/components/projects/SidebarProjects";
import { OverviewView } from "@/views/OverviewView";
import { SettingsView } from "@/views/SettingsView";
import { PlaceholderView } from "@/views/PlaceholderView";
import { ServiceWorkbenchView } from "@/views/ServiceWorkbenchView";
import { ProjectOverviewView } from "@/views/ProjectOverviewView";
import { EnvPresetsView } from "@/views/EnvPresetsView";
import { onProjectsChanged } from "@/lib/tauri";
import { useAppStore } from "@/store/appStore";

export default function App() {
  const init = useAppStore((s) => s.init);
  const loadProjects = useAppStore((s) => s.loadProjects);
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
    let unlisten: (() => void) | undefined;
    void onProjectsChanged(() => {
      void loadProjects();
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      if (unlisten) unlisten();
    };
  }, [loadProjects]);

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
        return (
          <PlaceholderView
            title="Port Inspector"
            description="Daftar semua port aktif dan resolusi bentrok port akan hadir di Wave 4."
            waveLabel="Wave 4"
            icon={Network}
          />
        );
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
