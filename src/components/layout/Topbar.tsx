import {
  FolderSearch,
  Moon,
  PanelLeft,
  Plus,
  Search,
  Sun,
  ChevronRight,
} from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { cn } from "@/lib/cn";

interface TopbarProps {
  onAddProject?: () => void;
  onScanFolder?: () => void;
  breadcrumbSegments?: Array<{ label: string; onClick?: () => void }>;
}

export function Topbar({
  onAddProject,
  onScanFolder,
  breadcrumbSegments,
}: TopbarProps) {
  const theme = useAppStore((s) => s.theme);
  const toggleTheme = useAppStore((s) => s.toggleTheme);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const route = useAppStore((s) => s.route);
  const setRoute = useAppStore((s) => s.setRoute);
  const setCommandPaletteOpen = useAppStore((s) => s.setCommandPaletteOpen);
  const pushToast = useAppStore((s) => s.pushToast);

  const segments = breadcrumbSegments ?? [
    {
      label:
        route.kind === "overview"
          ? "Overview"
          : route.kind === "ports"
            ? "Port Inspector"
            : route.kind === "presets"
              ? "Env Presets"
              : route.kind === "settings"
                ? "Settings"
                : "Project",
      onClick: () => setRoute({ kind: "overview" }),
    },
  ];

  const handleScan = () => {
    if (onScanFolder) {
      onScanFolder();
    } else {
      pushToast({
        title: "Scan Folder",
        description: "Use the + Add button to register a project folder.",
        variant: "info",
      });
    }
  };

  const handleAdd = () => {
    if (onAddProject) {
      onAddProject();
    } else {
      pushToast({
        title: "Ready to add project",
        description: "Select a project folder to register it.",
        variant: "info",
      });
    }
  };

  const isMac =
    typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent);

  return (
    <header
      data-tauri-drag-region
      className={cn(
        "flex h-11 shrink-0 items-center gap-3 border-b border-border bg-bg-topbar pr-3",
        isMac ? "pl-[80px]" : "pl-3",
      )}
    >
      {/* Left: Sidebar Toggle & Interactive Breadcrumb */}
      <div data-tauri-drag-region className="flex min-w-0 flex-1 items-center gap-1.5">
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label="Toggle sidebar"
          className="btn-press flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] text-fg-muted hover:bg-surface-hover hover:text-fg"
        >
          <PanelLeft className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
        </button>

        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-[12.5px]">
          {segments.map((seg, idx) => {
            const isLast = idx === segments.length - 1;
            return (
              <span key={`${seg.label}-${idx}`} className="flex min-w-0 items-center gap-1">
                {idx > 0 ? (
                  <ChevronRight
                    className="h-3.5 w-3.5 shrink-0 text-fg-faint"
                    aria-hidden="true"
                  />
                ) : null}
                <button
                  type="button"
                  onClick={seg.onClick}
                  disabled={!seg.onClick}
                  className={cn(
                    "truncate rounded px-1.5 py-0.5 leading-none transition-colors",
                    isLast
                      ? "font-semibold text-fg"
                      : "text-fg-muted hover:bg-surface-hover hover:text-fg",
                  )}
                >
                  {seg.label}
                </button>
              </span>
            );
          })}
        </nav>
      </div>

      {/* Center: Command Palette trigger */}
      <button
        type="button"
        onClick={() => setCommandPaletteOpen(true)}
        className="btn-press hidden h-7 w-56 shrink-0 items-center justify-between rounded-[7px] border border-border-strong bg-surface-2 px-2.5 text-[12.5px] text-fg-muted hover:border-info hover:text-fg sm:flex md:w-72 lg:w-80"
      >
        <span className="flex items-center gap-2">
          <Search className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Search projects, services, scripts…</span>
        </span>
        <kbd className="rounded bg-surface px-1.5 py-0.5 font-mono text-[11px] leading-none text-fg-faint">
          ⌘K
        </kbd>
      </button>

      {/* Right: Scan, + Add, Theme Toggle */}
      <div data-tauri-drag-region className="flex flex-1 items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={handleScan}
          className="btn-press flex h-7 items-center gap-1.5 rounded-[7px] border border-border-strong bg-surface px-2.5 text-[12.5px] font-medium text-fg-2 hover:bg-surface-hover hover:text-fg"
        >
          <FolderSearch className="h-3.5 w-3.5" strokeWidth={1.85} aria-hidden="true" />
          <span>Scan</span>
        </button>

        <button
          type="button"
          onClick={handleAdd}
          className="btn-press flex h-7 items-center gap-1.5 rounded-[7px] bg-accent px-2.5 text-[12.5px] font-semibold text-accent-fg hover:opacity-95"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden="true" />
          <span>Add</span>
        </button>

        <button
          type="button"
          onClick={() => void toggleTheme()}
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          title={theme === "dark" ? "Light theme" : "Dark theme"}
          className="btn-press flex h-7 w-7 items-center justify-center rounded-[7px] border border-border bg-surface text-fg-muted hover:bg-surface-hover hover:text-fg"
        >
          {theme === "dark" ? (
            <Sun className="h-3.5 w-3.5" strokeWidth={1.85} aria-hidden="true" />
          ) : (
            <Moon className="h-3.5 w-3.5" strokeWidth={1.85} aria-hidden="true" />
          )}
        </button>
      </div>
    </header>
  );
}
