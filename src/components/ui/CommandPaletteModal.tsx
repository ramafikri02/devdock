import { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  FolderKanban,
  KeyRound,
  LayoutGrid,
  Network,
  Play,
  Search,
  Settings,
  Square,
  TerminalSquare,
  X,
} from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { cn } from "@/lib/cn";

interface PaletteAction {
  id: string;
  group: "Workspace" | "Projects" | "Services" | "Scripts";
  label: string;
  hint?: string;
  icon: typeof LayoutGrid;
  run: () => void | Promise<void>;
}

export function CommandPaletteModal() {
  const open = useAppStore((s) => s.commandPaletteOpen);
  const setOpen = useAppStore((s) => s.setCommandPaletteOpen);
  const setRoute = useAppStore((s) => s.setRoute);
  const toggleTheme = useAppStore((s) => s.toggleTheme);
  const toggleLogDrawer = useAppStore((s) => s.toggleLogDrawer);
  const projects = useAppStore((s) => s.projects);
  const processes = useAppStore((s) => s.processes);
  const runScript = useAppStore((s) => s.runScript);
  const stopProcess = useAppStore((s) => s.stopProcess);
  const startProjectAll = useAppStore((s) => s.startProjectAll);
  const stopProjectAll = useAppStore((s) => s.stopProjectAll);

  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const allActions = useMemo<PaletteAction[]>(() => {
    const procList = Object.values(processes);
    const items: PaletteAction[] = [
      {
        id: "ws:overview",
        group: "Workspace",
        label: "Open Overview",
        icon: LayoutGrid,
        run: () => setRoute({ kind: "overview" }),
      },
      {
        id: "ws:ports",
        group: "Workspace",
        label: "Open Port Inspector",
        icon: Network,
        run: () => setRoute({ kind: "ports" }),
      },
      {
        id: "ws:presets",
        group: "Workspace",
        label: "Open Env Presets",
        icon: KeyRound,
        run: () => setRoute({ kind: "presets" }),
      },
      {
        id: "ws:settings",
        group: "Workspace",
        label: "Open Settings",
        icon: Settings,
        run: () => setRoute({ kind: "settings" }),
      },
      {
        id: "ws:logs",
        group: "Workspace",
        label: "Toggle Log Drawer",
        hint: "⌘J",
        icon: TerminalSquare,
        run: () => toggleLogDrawer(),
      },
      {
        id: "ws:theme",
        group: "Workspace",
        label: "Toggle Dark / Light Theme",
        icon: Settings,
        run: () => void toggleTheme(),
      },
    ];

    for (const proj of projects) {
      if (proj.services.length > 1) {
        const anyRunning = proj.services.some((svc) =>
          procList.some(
            (p) =>
              p.serviceId === svc.id &&
              (p.status === "running" ||
                p.status === "starting" ||
                p.status === "restarting"),
          ),
        );
        items.push({
          id: `proj:open:${proj.id}`,
          group: "Projects",
          label: `Open Project ${proj.name}`,
          hint: `${proj.services.length} services`,
          icon: FolderKanban,
          run: () => setRoute({ kind: "project", projectId: proj.id }),
        });
        items.push({
          id: `proj:all:${proj.id}`,
          group: "Projects",
          label: anyRunning ? `Stop All: ${proj.name}` : `Start All: ${proj.name}`,
          icon: anyRunning ? Square : Play,
          run: () =>
            void (anyRunning ? stopProjectAll(proj.id) : startProjectAll(proj.id)),
        });
      }

      for (const svc of proj.services) {
        items.push({
          id: `svc:${svc.id}`,
          group: "Services",
          label: svc.name,
          hint: proj.services.length > 1 ? proj.name : svc.port ? `:${svc.port}` : undefined,
          icon: Box,
          run: () =>
            setRoute({
              kind: "service",
              projectId: proj.id,
              serviceId: svc.id,
            }),
        });

        for (const scriptName of Object.keys(svc.scripts)) {
          const activeProc = procList.find(
            (p) =>
              p.serviceId === svc.id &&
              p.script === scriptName &&
              (p.status === "running" ||
                p.status === "starting" ||
                p.status === "restarting"),
          );
          items.push({
            id: `script:${svc.id}:${scriptName}`,
            group: "Scripts",
            label: activeProc
              ? `Stop ${svc.name} · ${scriptName}`
              : `Run ${svc.name} · ${scriptName}`,
            hint: svc.scripts[scriptName],
            icon: activeProc ? Square : Play,
            run: () => {
              if (activeProc) {
                void stopProcess(activeProc.id);
              } else {
                void runScript(svc.id, scriptName);
              }
            },
          });
        }
      }
    }

    return items;
  }, [
    projects,
    processes,
    setRoute,
    toggleLogDrawer,
    toggleTheme,
    startProjectAll,
    stopProjectAll,
    runScript,
    stopProcess,
  ]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allActions.slice(0, 40);
    return allActions
      .filter(
        (a) =>
          a.label.toLowerCase().includes(q) ||
          a.group.toLowerCase().includes(q) ||
          (a.hint?.toLowerCase().includes(q) ?? false),
      )
      .slice(0, 40);
  }, [allActions, query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query, open]);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    setQuery("");
    const timer = window.setTimeout(() => inputRef.current?.focus(), 10);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) =>
          filtered.length > 0 ? (prev + 1) % filtered.length : 0,
        );
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) =>
          filtered.length > 0
            ? (prev - 1 + filtered.length) % filtered.length
            : 0,
        );
        return;
      }
      if (e.key === "Enter" && filtered[selectedIndex]) {
        e.preventDefault();
        void filtered[selectedIndex].run();
        setOpen(false);
        return;
      }
      if (e.key === "Tab" && dialogRef.current) {
        const focusable = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(
            "input, button:not([disabled]), [tabindex]:not([tabindex='-1'])",
          ),
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKeyDown);
      previousFocusRef.current?.focus?.();
    };
  }, [open, setOpen, filtered, selectedIndex]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command Palette"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/55 pt-24 backdrop-blur-[1px]"
      onClick={() => setOpen(false)}
    >
      <div
        ref={dialogRef}
        className="animate-modal-enter w-full max-w-xl overflow-hidden rounded-[12px] border border-border-strong bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <Search className="h-4 w-4 text-fg-muted" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search projects, services, scripts, or commands…"
            className="w-full bg-transparent text-[13.5px] text-fg placeholder:text-fg-faint focus:outline-none"
          />
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close command palette"
            className="rounded p-1 text-fg-muted hover:bg-surface-hover hover:text-fg"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>

        <div className="max-h-80 overflow-y-auto p-1.5" role="listbox">
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-[12.5px] text-fg-muted">
              No matching projects, services, or commands.
            </div>
          ) : (
            filtered.map((action, idx) => {
              const Icon = action.icon;
              const isSelected = idx === selectedIndex;
              return (
                <button
                  key={action.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  onClick={() => {
                    void action.run();
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between gap-2.5 rounded-[7px] px-2.5 py-2 text-left text-[13px]",
                    isSelected
                      ? "bg-surface-hover text-fg"
                      : "text-fg-2 hover:bg-surface-hover hover:text-fg",
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <Icon
                      className={cn(
                        "h-4 w-4 shrink-0",
                        isSelected ? "text-info" : "text-fg-muted",
                      )}
                      aria-hidden="true"
                    />
                    <span className="truncate">{action.label}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {action.hint ? (
                      <span className="max-w-[180px] truncate font-mono text-[11px] text-fg-faint">
                        {action.hint}
                      </span>
                    ) : null}
                    <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-fg-muted">
                      {action.group}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
