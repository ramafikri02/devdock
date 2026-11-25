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
        title: "Scan Folder tersedia di Wave 2A",
        description: "Gunakan tombol + Tambah untuk mendaftarkan folder project.",
        variant: "info",
      });
    }
  };

  const handleAdd = () => {
    if (onAddProject) {
      onAddProject();
    } else {
      pushToast({
        title: "Siap menambah project",
        description: "Akan dihubungkan pada modul registrasi folder.",
        variant: "info",
      });
    }
  };

  return (
    <header
      data-tauri-drag-region
      className="flex h-[46px] shrink-0 items-center justify-between border-b border-border bg-bg-topbar pr-3 pl-[76px]"
    >
      {/* Left: Sidebar Toggle & Interactive Breadcrumb */}
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label="Toggle sidebar"
          className="btn-press flex h-7 w-7 items-center justify-center rounded-[7px] text-fg-muted hover:bg-surface-hover hover:text-fg"
        >
          <PanelLeft className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
        </button>

        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-[13px]">
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
                    "truncate rounded px-1.5 py-0.5 transition-colors",
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
        className="btn-press hidden h-7 w-72 items-center justify-between rounded-[7px] border border-border-strong bg-surface-2 px-2.5 text-[12.5px] text-fg-muted hover:border-info hover:text-fg sm:flex"
      >
        <span className="flex items-center gap-2">
          <Search className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Cari project, service, script…</span>
        </span>
        <kbd className="rounded bg-surface px-1.5 py-0.5 font-mono text-[11px] text-fg-faint">
          ⌘K
        </kbd>
      </button>

      {/* Right: Scan, + Tambah, Theme Toggle */}
      <div className="flex items-center gap-1.5">
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
          <span>Tambah</span>
        </button>

        <button
          type="button"
          onClick={() => void toggleTheme()}
          aria-label={theme === "dark" ? "Ganti ke tema terang" : "Ganti ke tema gelap"}
          title={theme === "dark" ? "Tema terang" : "Tema gelap"}
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
