import { type ReactNode, useEffect } from "react";
import { Topbar } from "./Topbar";
import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";
import { LogDrawer } from "./LogDrawer";
import { ToastContainer } from "@/components/ui/ToastContainer";
import { useAppStore } from "@/store/appStore";

interface AppShellProps {
  children: ReactNode;
  projectsSlot?: ReactNode;
  onAddProject?: () => void;
  onScanFolder?: () => void;
  breadcrumbSegments?: Array<{ label: string; onClick?: () => void }>;
}

export function AppShell({
  children,
  projectsSlot,
  onAddProject,
  onScanFolder,
  breadcrumbSegments,
}: AppShellProps) {
  const toggleLogDrawer = useAppStore((s) => s.toggleLogDrawer);
  const setCommandPaletteOpen = useAppStore((s) => s.setCommandPaletteOpen);
  const logDrawerOpen = useAppStore((s) => s.logDrawerOpen);
  const logDrawerMaximized = useAppStore((s) => s.logDrawerMaximized);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        toggleLogDrawer();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleLogDrawer, setCommandPaletteOpen]);

  return (
    <div className="flex h-full w-full flex-col bg-bg text-fg">
      <Topbar
        onAddProject={onAddProject}
        onScanFolder={onScanFolder}
        breadcrumbSegments={breadcrumbSegments}
      />

      <div className="flex min-h-0 flex-1">
        <Sidebar projectsSlot={projectsSlot} />
        <div className="flex min-w-0 flex-1 flex-col">
          <main
            className={
              logDrawerOpen && logDrawerMaximized
                ? "hidden"
                : "min-h-0 flex-1 overflow-y-auto"
            }
          >
            {children}
          </main>
          <LogDrawer />
        </div>
      </div>

      <StatusBar />
      <ToastContainer />
    </div>
  );
}
