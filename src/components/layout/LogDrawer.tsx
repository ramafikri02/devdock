import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import {
  AlertCircle,
  Download,
  Maximize2,
  Minimize2,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import {
  type LogLine,
  type ProcessInfo,
  clearProcessLogs,
  clearProjectLogs,
  exportLogsToFile,
  getAllLogs,
  getProcessLogs,
  getProjectLogs,
  onProcessLog,
  onProcessLogsCleared,
  pickSaveLogFileDialog,
} from "@/lib/tauri";
import { stripAnsi } from "@/lib/format";
import { useAppStore } from "@/store/appStore";
import { cn } from "@/lib/cn";

const SERVICE_TAG_ANSI_COLORS = [
  "\x1b[36m", // cyan
  "\x1b[35m", // magenta
  "\x1b[32m", // green
  "\x1b[33m", // yellow
  "\x1b[34m", // blue
  "\x1b[96m", // bright cyan
  "\x1b[95m", // bright magenta
];

function getServiceTagAnsi(serviceId: string): string {
  let hash = 0;
  for (let i = 0; i < serviceId.length; i += 1) {
    hash = (hash * 31 + serviceId.charCodeAt(i)) | 0;
  }
  return SERVICE_TAG_ANSI_COLORS[Math.abs(hash) % SERVICE_TAG_ANSI_COLORS.length];
}

function formatLineForTerminal(line: LogLine, showServiceTag: boolean): string {
  const errPrefix = line.stream === "stderr" ? "\x1b[31m│\x1b[0m " : "";
  const tag = showServiceTag
    ? `${getServiceTagAnsi(line.serviceId)}[${line.serviceName}]\x1b[0m `
    : "";
  return `${errPrefix}${tag}${line.text}`;
}

function statusDotClass(status: ProcessInfo["status"]): string {
  switch (status) {
    case "running":
      return "bg-accent";
    case "starting":
    case "restarting":
    case "stopping":
      return "bg-warn animate-pulse";
    case "crashed":
      return "bg-danger";
    case "stopped":
      return "bg-fg-faint";
  }
}

export function LogDrawer() {
  const logDrawerOpen = useAppStore((s) => s.logDrawerOpen);
  const logDrawerHeight = useAppStore((s) => s.logDrawerHeight);
  const logDrawerMaximized = useAppStore((s) => s.logDrawerMaximized);
  const logScope = useAppStore((s) => s.logScope);
  const activeLogTab = useAppStore((s) => s.activeLogTab);
  const hiddenLogTabIds = useAppStore((s) => s.hiddenLogTabIds);
  const projects = useAppStore((s) => s.projects);
  const processesMap = useAppStore((s) => s.processes);

  const toggleLogDrawer = useAppStore((s) => s.toggleLogDrawer);
  const setLogDrawerHeight = useAppStore((s) => s.setLogDrawerHeight);
  const setLogDrawerMaximized = useAppStore((s) => s.setLogDrawerMaximized);
  const setLogScope = useAppStore((s) => s.setLogScope);
  const setActiveLogTab = useAppStore((s) => s.setActiveLogTab);
  const hideLogTab = useAppStore((s) => s.hideLogTab);
  const restoreLogTab = useAppStore((s) => s.restoreLogTab);
  const pushToast = useAppStore((s) => s.pushToast);

  const [filterText, setFilterText] = useState("");
  const [stderrOnly, setStderrOnly] = useState(false);
  const [restoreMenuOpen, setRestoreMenuOpen] = useState(false);
  const [lineCount, setLineCount] = useState(0);
  const [tuiTaskSelection, setTuiTaskSelection] = useState<string | null>(null);
  const [tuiSearch, setTuiSearch] = useState("");
  const [tuiSearchOpen, setTuiSearchOpen] = useState(false);
  const [termContainerEl, setTermContainerEl] = useState<HTMLDivElement | null>(null);
  const [termReadyVersion, setTermReadyVersion] = useState(0);

  const drawerRef = useRef<HTMLElement | null>(null);
  const tuiSidebarRef = useRef<HTMLElement | null>(null);
  const tuiSearchInputRef = useRef<HTMLInputElement | null>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  const allProcesses = useMemo(() => {
    // Keep only the latest (preferring active) process per (serviceId, script)
    // so repeated restarts/crashes don't create duplicate stale tabs with identical names.
    const latestByKey = new Map<string, ProcessInfo>();
    const isActive = (s: ProcessInfo["status"]) =>
      s === "running" || s === "starting" || s === "restarting" || s === "stopping";

    for (const proc of Object.values(processesMap)) {
      const key = `${proc.serviceId}::${proc.script}`;
      const existing = latestByKey.get(key);
      if (!existing) {
        latestByKey.set(key, proc);
        continue;
      }
      const procActive = isActive(proc.status);
      const existingActive = isActive(existing.status);
      if (procActive && !existingActive) {
        latestByKey.set(key, proc);
      } else if (procActive === existingActive && proc.startedAt > existing.startedAt) {
        latestByKey.set(key, proc);
      }
    }

    const statusRank = (s: ProcessInfo["status"]) => {
      if (isActive(s)) return 0;
      if (s === "crashed") return 1;
      return 2;
    };

    return Array.from(latestByKey.values()).sort((a, b) => {
      const rankDiff = statusRank(a.status) - statusRank(b.status);
      if (rankDiff !== 0) return rankDiff;
      return a.serviceName.localeCompare(b.serviceName) || a.script.localeCompare(b.script);
    });
  }, [processesMap]);

  const scopedProcesses = useMemo(() => {
    if (logScope.kind === "all") {
      return allProcesses;
    }
    return allProcesses.filter((p) => p.projectId === logScope.projectId);
  }, [allProcesses, logScope]);

  const hiddenSet = useMemo(() => new Set(hiddenLogTabIds), [hiddenLogTabIds]);

  const visibleTabs = useMemo(
    () => scopedProcesses.filter((p) => !hiddenSet.has(p.id)),
    [scopedProcesses, hiddenSet],
  );

  const hiddenTabs = useMemo(
    () => scopedProcesses.filter((p) => hiddenSet.has(p.id)),
    [scopedProcesses, hiddenSet],
  );

  // If the active process tab is no longer in scope, fall back to combined
  const effectiveTab = useMemo(() => {
    if (activeLogTab === "combined") return "combined";
    const match = visibleTabs.find((p) => p.id === activeLogTab);
    return match ? match.id : "combined";
  }, [activeLogTab, visibleTabs]);

  // Turborepo TUI split-pane mode activates specifically on the "All (Combined)" tab
  const isTuiAllMode = effectiveTab === "combined" && scopedProcesses.length > 0;

  const filteredTuiTasks = useMemo(() => {
    const q = tuiSearch.trim().toLowerCase();
    if (!q) return scopedProcesses;
    return scopedProcesses.filter(
      (p) =>
        p.serviceName.toLowerCase().includes(q) ||
        p.script.toLowerCase().includes(q),
    );
  }, [scopedProcesses, tuiSearch]);

  const effectiveTuiTask = useMemo(() => {
    if (!isTuiAllMode) return "stream";
    if (tuiTaskSelection === "stream") return "stream";
    if (tuiTaskSelection && scopedProcesses.some((p) => p.id === tuiTaskSelection)) {
      return tuiTaskSelection;
    }
    return scopedProcesses[0]?.id ?? "stream";
  }, [isTuiAllMode, tuiTaskSelection, scopedProcesses]);

  const activeLogTarget = useMemo(() => {
    if (effectiveTab !== "combined") return effectiveTab;
    if (isTuiAllMode && effectiveTuiTask !== "stream") return effectiveTuiTask;
    return "combined";
  }, [effectiveTab, isTuiAllMode, effectiveTuiTask]);

  const selectedTuiProcess = useMemo(
    () =>
      isTuiAllMode && effectiveTuiTask !== "stream"
        ? (scopedProcesses.find((p) => p.id === effectiveTuiTask) ?? null)
        : null,
    [isTuiAllMode, effectiveTuiTask, scopedProcesses],
  );

  const showServiceTag = activeLogTarget === "combined";

  // Initialize xterm.js instance whenever the drawer is open and the container element mounts
  useEffect(() => {
    if (!logDrawerOpen || !termContainerEl) return;

    const term = new XTerm({
      disableStdin: true,
      convertEol: true,
      scrollback: 10_000,
      fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 12,
      lineHeight: 1.45,
      cursorBlink: false,
      cursorStyle: "bar",
      cursorInactiveStyle: "none",
      theme: {
        background: "#060A14",
        foreground: "#E2E8F0",
        cursor: "#060A14",
        selectionBackground: "rgba(56, 189, 248, 0.28)",
        black: "#0F172A",
        red: "#F87171",
        green: "#4ADE80",
        yellow: "#FBBF24",
        blue: "#60A5FA",
        magenta: "#E879F9",
        cyan: "#38BDF8",
        white: "#E2E8F0",
        brightBlack: "#64748B",
        brightRed: "#FCA5A5",
        brightGreen: "#86EFAC",
        brightYellow: "#FDE68A",
        brightBlue: "#93C5FD",
        brightMagenta: "#F0ABFC",
        brightCyan: "#7DD3FC",
        brightWhite: "#F8FAFC",
      },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(termContainerEl);
    try {
      fitAddon.fit();
    } catch {
      // Ignore initial zero-size fit
    }

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;
    setTermReadyVersion((v) => v + 1);

    const observer = new ResizeObserver(() => {
      try {
        fitAddon.fit();
      } catch {
        // Ignore transient resize errors
      }
    });
    observer.observe(termContainerEl);

    return () => {
      observer.disconnect();
      term.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, [logDrawerOpen, termContainerEl]);

  // Fit terminal when height, maximized state, or TUI split-pane mode changes
  useEffect(() => {
    if (!logDrawerOpen) return;
    const raf = requestAnimationFrame(() => {
      try {
        fitAddonRef.current?.fit();
      } catch {
        // Ignore
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [logDrawerOpen, logDrawerHeight, logDrawerMaximized, isTuiAllMode]);

  // Load buffered logs and stream live log events without racing or leaking listeners
  useEffect(() => {
    if (!logDrawerOpen) return;
    let cancelled = false;
    let loading = true;
    let maxLoadedSeq = 0;
    const pendingLines: LogLine[] = [];
    let unlistenLog: (() => void) | undefined;
    let unlistenClear: (() => void) | undefined;

    const queryLower = filterText.trim().toLowerCase();

    const matchesFilter = (line: LogLine): boolean => {
      if (activeLogTarget !== "combined") {
        if (line.processId !== activeLogTarget) return false;
      } else if (logScope.kind === "project") {
        if (line.projectId !== logScope.projectId) return false;
      }
      if (stderrOnly && line.stream !== "stderr") return false;
      if (queryLower) {
        const plain = stripAnsi(line.text).toLowerCase();
        const matches =
          plain.includes(queryLower) ||
          line.serviceName.toLowerCase().includes(queryLower) ||
          line.script.toLowerCase().includes(queryLower);
        if (!matches) return false;
      }
      return true;
    };

    void onProcessLog((line) => {
      if (cancelled || !matchesFilter(line)) return;
      if (loading) {
        pendingLines.push(line);
        return;
      }
      if (line.seq <= maxLoadedSeq) return;
      maxLoadedSeq = line.seq;
      const term = xtermRef.current;
      if (term) {
        term.writeln(formatLineForTerminal(line, showServiceTag));
        setLineCount((c) => Math.min(10_000, c + 1));
      }
    }).then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlistenLog = fn;
      }
    });

    void onProcessLogsCleared(({ processId }) => {
      if (cancelled) return;
      if (activeLogTarget === processId || activeLogTarget === "combined") {
        pendingLines.length = 0;
        maxLoadedSeq = 0;
        xtermRef.current?.reset();
        setLineCount(0);
      }
    }).then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlistenClear = fn;
      }
    });

    const load = async () => {
      try {
        let lines: LogLine[] = [];
        if (activeLogTarget !== "combined") {
          lines = await getProcessLogs(activeLogTarget, filterText, stderrOnly);
        } else if (logScope.kind === "project") {
          lines = await getProjectLogs(logScope.projectId, filterText, stderrOnly);
        } else {
          lines = await getAllLogs(filterText, stderrOnly);
        }

        if (cancelled) return;
        const term = xtermRef.current;
        if (!term) return;

        for (const l of lines) {
          if (l.seq > maxLoadedSeq) maxLoadedSeq = l.seq;
        }
        const extra = pendingLines.filter((l) => l.seq > maxLoadedSeq);
        for (const l of extra) {
          if (l.seq > maxLoadedSeq) maxLoadedSeq = l.seq;
        }
        const combined = extra.length > 0 ? [...lines, ...extra] : lines;

        term.reset();
        try {
          fitAddonRef.current?.fit();
        } catch {
          // Ignore transient fit errors
        }
        if (combined.length > 0) {
          const chunk = combined
            .map((l) => formatLineForTerminal(l, showServiceTag))
            .join("\r\n");
          term.writeln(chunk);
          term.scrollToBottom();
        }
        setLineCount(combined.length);
      } catch {
        // Ignore fetch errors for gone processes
      } finally {
        loading = false;
        pendingLines.length = 0;
      }
    };

    void load();
    return () => {
      cancelled = true;
      if (unlistenLog) unlistenLog();
      if (unlistenClear) unlistenClear();
    };
  }, [
    logDrawerOpen,
    termReadyVersion,
    activeLogTarget,
    logScope,
    filterText,
    stderrOnly,
    showServiceTag,
  ]);

  // Drag-to-resize handler (min 110px, max 78% of parent main stage height)
  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      if (logDrawerMaximized) {
        setLogDrawerMaximized(false);
      }
      const startY = e.clientY;
      const startHeight = drawerRef.current?.getBoundingClientRect().height ?? logDrawerHeight;
      const parentHeight =
        drawerRef.current?.parentElement?.getBoundingClientRect().height ?? 700;
      const maxHeight = Math.max(200, Math.floor(parentHeight * 0.78));

      const onMouseMove = (moveEvent: MouseEvent) => {
        const delta = startY - moveEvent.clientY;
        const next = Math.min(maxHeight, Math.max(110, Math.round(startHeight + delta)));
        setLogDrawerHeight(next);
      };

      const onMouseUp = () => {
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
      };

      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    },
    [logDrawerHeight, logDrawerMaximized, setLogDrawerHeight, setLogDrawerMaximized],
  );

  const handleClear = async () => {
    try {
      if (activeLogTarget !== "combined") {
        await clearProcessLogs(activeLogTarget);
      } else if (logScope.kind === "project") {
        await clearProjectLogs(logScope.projectId);
      } else {
        for (const p of allProcesses) {
          await clearProcessLogs(p.id);
        }
      }
      xtermRef.current?.reset();
      setLineCount(0);
    } catch (err) {
      pushToast({
        title: "Failed to clear logs",
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    }
  };

  const handleSaveLogs = async () => {
    const scopeKind =
      activeLogTarget !== "combined"
        ? "process"
        : logScope.kind === "project"
          ? "project"
          : "all";
    const scopeId =
      activeLogTarget !== "combined"
        ? activeLogTarget
        : logScope.kind === "project"
          ? logScope.projectId
          : null;

    let defaultFileName = "devdock-logs.log";
    if (activeLogTarget !== "combined") {
      const p = processesMap[activeLogTarget];
      if (p) defaultFileName = `${p.serviceName}-${p.script}.log`;
    } else if (logScope.kind === "project") {
      const proj = projects.find((pr) => pr.id === logScope.projectId);
      if (proj) defaultFileName = `${proj.name.toLowerCase().replace(/\s+/g, "-")}.log`;
    }

    const filePath = await pickSaveLogFileDialog(defaultFileName);
    if (!filePath) return;

    try {
      const savedLines = await exportLogsToFile(
        scopeKind,
        scopeId,
        filePath,
        filterText,
        stderrOnly,
        true,
      );
      const basename = filePath.split(/[\\/]/).pop() || filePath;
      pushToast({
        title: `Logs saved to ${basename}`,
        description: `${savedLines} ${savedLines === 1 ? "line" : "lines"} written.`,
        variant: "success",
      });
    } catch (err) {
      pushToast({
        title: "Failed to save logs",
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    }
  };

  const tuiNavItems = useMemo(
    () => [...filteredTuiTasks.map((p) => p.id), "stream"],
    [filteredTuiTasks],
  );

  // Auto-focus the TUI task sidebar when switching into the All (Combined) tab
  // so Up/Down arrow keys work immediately without clicking the sidebar first.
  useEffect(() => {
    if (!logDrawerOpen || !isTuiAllMode) return;
    const raf = requestAnimationFrame(() => {
      const activeEl = document.activeElement;
      const isTypingElsewhere =
        activeEl instanceof HTMLInputElement ||
        activeEl instanceof HTMLTextAreaElement ||
        activeEl instanceof HTMLSelectElement;
      if (!isTypingElsewhere) {
        tuiSidebarRef.current?.focus({ preventScroll: true });
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [logDrawerOpen, isTuiAllMode]);

  const handleTuiKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (!isTuiAllMode) return;
    const target = e.target as HTMLElement | null;

    if (target === tuiSearchInputRef.current) {
      if (e.key === "Escape") {
        setTuiSearch("");
        setTuiSearchOpen(false);
        tuiSidebarRef.current?.focus({ preventScroll: true });
      } else if (e.key === "ArrowDown" && tuiNavItems.length > 0) {
        e.preventDefault();
        setTuiTaskSelection(tuiNavItems[0]);
        tuiSidebarRef.current?.focus({ preventScroll: true });
      }
      return;
    }

    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      target?.isContentEditable
    ) {
      return;
    }

    if (e.key === "/") {
      e.preventDefault();
      setTuiSearchOpen(true);
      requestAnimationFrame(() => tuiSearchInputRef.current?.focus());
      return;
    }

    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (tuiNavItems.length === 0) return;
      e.preventDefault();
      const idx = tuiNavItems.indexOf(effectiveTuiTask);
      const nextIdx =
        e.key === "ArrowDown"
          ? (idx + 1) % tuiNavItems.length
          : (idx - 1 + tuiNavItems.length) % tuiNavItems.length;
      setTuiTaskSelection(tuiNavItems[nextIdx]);
    }
  };

  if (!logDrawerOpen) {
    return null;
  }

  const scopeValue =
    logScope.kind === "all" ? "all" : `project:${logScope.projectId}`;

  return (
    <section
      ref={drawerRef}
      aria-label="Shared Log Drawer"
      onKeyDown={handleTuiKeyDown}
      style={logDrawerMaximized ? undefined : { height: `${logDrawerHeight}px` }}
      className={cn(
        "relative flex shrink-0 flex-col border-t border-border-strong bg-log-bg text-slate-200",
        logDrawerMaximized && "min-h-0 flex-1",
      )}
    >
      {/* Top drag-to-resize handle */}
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize log drawer"
        onMouseDown={handleResizeMouseDown}
        className="group absolute inset-x-0 -top-1 z-10 h-2 cursor-row-resize"
      >
        <div className="mx-auto mt-0.5 h-[2px] w-16 rounded-full bg-transparent transition-colors group-hover:bg-info/70" />
      </div>

      {/* Header bar: scope selector, tabs, search/filter, actions */}
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-slate-800/90 bg-[#080D1A] px-2">
        {/* Left: Scope switcher + Process Tabs */}
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
          <select
            aria-label="Log project scope"
            value={scopeValue}
            onChange={(e) => {
              const val = e.target.value;
              if (val === "all") {
                setLogScope({ kind: "all" });
              } else if (val.startsWith("project:")) {
                setLogScope({
                  kind: "project",
                  projectId: val.slice("project:".length),
                });
              }
            }}
            className="h-6 shrink-0 rounded-[5px] border border-slate-700/80 bg-slate-900 px-1.5 text-[11.5px] font-medium text-slate-200 hover:border-slate-600 focus:outline-none"
          >
            {projects.map((p) => (
              <option key={p.id} value={`project:${p.id}`}>
                {p.name}
              </option>
            ))}
            <option value="all">All running</option>
          </select>

          <div className="h-4 w-px shrink-0 bg-slate-800" aria-hidden="true" />

          {/* All (Combined) tab */}
          <button
            type="button"
            onClick={() => setActiveLogTab("combined")}
            className={cn(
              "flex h-6 shrink-0 items-center gap-1.5 rounded-[5px] px-2 text-[11.5px] font-medium transition-colors",
              effectiveTab === "combined"
                ? "bg-slate-800 text-slate-100"
                : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200",
            )}
          >
            <span>All (Combined)</span>
            {scopedProcesses.length > 0 ? (
              <span className="rounded bg-slate-700/70 px-1 font-mono text-[10px] text-slate-300 tabular-nums">
                {scopedProcesses.length}
              </span>
            ) : null}
          </button>

          {/* Per-process tabs with hover close button */}
          {visibleTabs.map((proc) => {
            const active = effectiveTab === proc.id;
            return (
              <div
                key={proc.id}
                className={cn(
                  "group flex h-6 shrink-0 items-center gap-1 rounded-[5px] pl-2 pr-1 text-[11.5px] transition-colors",
                  active
                    ? "bg-slate-800 font-medium text-slate-100"
                    : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200",
                )}
              >
                <button
                  type="button"
                  onClick={() => setActiveLogTab(proc.id)}
                  className="flex items-center gap-1.5"
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 shrink-0 rounded-full",
                      statusDotClass(proc.status),
                    )}
                    aria-hidden="true"
                  />
                  <span className="max-w-[140px] truncate font-mono">
                    {proc.serviceName} · {proc.script}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    hideLogTab(proc.id);
                  }}
                  aria-label={`Hide ${proc.serviceName} ${proc.script} tab`}
                  title="Hide tab (process keeps running)"
                  className="ml-0.5 rounded p-0.5 text-slate-500 opacity-60 hover:bg-slate-700 hover:text-slate-100 group-hover:opacity-100"
                >
                  <X className="h-2.5 w-2.5" aria-hidden="true" />
                </button>
              </div>
            );
          })}

          {/* + Tab button to restore closed tabs */}
          {hiddenTabs.length > 0 ? (
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => setRestoreMenuOpen((v) => !v)}
                className="flex h-6 items-center gap-1 rounded-[5px] border border-slate-700/80 bg-slate-900 px-1.5 text-[11px] font-medium text-slate-300 hover:bg-slate-800 hover:text-slate-100"
              >
                <Plus className="h-3 w-3" aria-hidden="true" />
                <span>Tab ({hiddenTabs.length})</span>
              </button>

              {restoreMenuOpen ? (
                <div className="absolute bottom-8 left-0 z-30 min-w-[200px] rounded-[8px] border border-slate-700 bg-slate-900 p-1 shadow-xl">
                  <div className="px-2 py-1 text-[10.5px] font-semibold tracking-wide text-slate-400 uppercase">
                    Restore hidden tabs
                  </div>
                  {hiddenTabs.map((proc) => (
                    <button
                      key={proc.id}
                      type="button"
                      onClick={() => {
                        restoreLogTab(proc.id);
                        setRestoreMenuOpen(false);
                      }}
                      className="flex w-full items-center gap-2 rounded-[5px] px-2 py-1.5 text-left font-mono text-[11.5px] text-slate-200 hover:bg-slate-800"
                    >
                      <span
                        className={cn(
                          "h-1.5 w-1.5 shrink-0 rounded-full",
                          statusDotClass(proc.status),
                        )}
                        aria-hidden="true"
                      />
                      <span className="truncate">
                        {proc.serviceName} · {proc.script}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Right: Filter, stderr-only, Clear, Save, Maximize, Close */}
        <div className="flex shrink-0 items-center gap-1.5">
          <div className="relative flex items-center">
            <Search
              className="pointer-events-none absolute left-2 h-3 w-3 text-slate-500"
              aria-hidden="true"
            />
            <input
              type="text"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="Filter logs…"
              aria-label="Filter log output"
              className="h-6 w-36 rounded-[5px] border border-slate-700/80 bg-slate-900 pr-5 pl-6 text-[11.5px] text-slate-200 placeholder:text-slate-500 focus:border-info focus:outline-none sm:w-44"
            />
            {filterText ? (
              <button
                type="button"
                onClick={() => setFilterText("")}
                aria-label="Clear filter"
                className="absolute right-1 rounded p-0.5 text-slate-400 hover:text-slate-100"
              >
                <X className="h-2.5 w-2.5" aria-hidden="true" />
              </button>
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => setStderrOnly((v) => !v)}
            aria-pressed={stderrOnly}
            title="Show stderr only"
            className={cn(
              "btn-press flex h-6 items-center gap-1 rounded-[5px] border px-2 text-[11px] font-medium",
              stderrOnly
                ? "border-danger/60 bg-danger-soft text-danger"
                : "border-slate-700/80 bg-slate-900 text-slate-400 hover:bg-slate-800 hover:text-slate-200",
            )}
          >
            <AlertCircle className="h-3 w-3" aria-hidden="true" />
            <span>stderr</span>
          </button>

          <button
            type="button"
            onClick={() => void handleClear()}
            aria-label="Clear logs"
            title="Clear log buffer"
            className="btn-press rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={() => void handleSaveLogs()}
            aria-label="Save logs to file"
            title="Save logs to file"
            className="btn-press rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
          </button>

          <div className="h-4 w-px bg-slate-800" aria-hidden="true" />

          <button
            type="button"
            onClick={() => setLogDrawerMaximized(!logDrawerMaximized)}
            aria-label={logDrawerMaximized ? "Restore log drawer" : "Maximize log drawer"}
            title={logDrawerMaximized ? "Restore" : "Maximize"}
            className="btn-press rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
          >
            {logDrawerMaximized ? (
              <Minimize2 className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>

          <button
            type="button"
            onClick={toggleLogDrawer}
            aria-label="Close log drawer"
            title="Hide (⌘J)"
            className="btn-press rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Terminal viewport (Turborepo TUI split-pane when All tab is active) */}
      <div className="flex min-h-0 flex-1 overflow-hidden bg-log-bg">
        {isTuiAllMode ? (
          <aside
            ref={tuiSidebarRef}
            aria-label="Tasks list"
            tabIndex={0}
            className="flex w-[220px] shrink-0 flex-col border-r border-slate-800/90 bg-[#050811] focus:outline-none"
          >
            {/* TUI Sidebar header / quick search */}
            <div className="flex h-7 shrink-0 items-center justify-between border-b border-slate-800/80 px-2.5">
              {tuiSearchOpen || tuiSearch ? (
                <div className="flex w-full items-center gap-1.5">
                  <Search
                    className="h-3 w-3 shrink-0 text-slate-500"
                    aria-hidden="true"
                  />
                  <input
                    ref={tuiSearchInputRef}
                    type="text"
                    value={tuiSearch}
                    onChange={(e) => setTuiSearch(e.target.value)}
                    onBlur={() => {
                      if (!tuiSearch) setTuiSearchOpen(false);
                    }}
                    placeholder="Filter tasks…"
                    aria-label="Filter TUI tasks"
                    className="w-full bg-transparent font-mono text-[11px] text-slate-200 placeholder:text-slate-500 focus:outline-none"
                  />
                  {tuiSearch ? (
                    <button
                      type="button"
                      onClick={() => {
                        setTuiSearch("");
                        setTuiSearchOpen(false);
                      }}
                      aria-label="Clear task search"
                      className="text-slate-500 hover:text-slate-200"
                    >
                      <X className="h-2.5 w-2.5" aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setTuiSearchOpen(true);
                    requestAnimationFrame(() => tuiSearchInputRef.current?.focus());
                  }}
                  className="flex w-full items-center justify-between font-mono text-[11px] text-slate-400 hover:text-slate-200"
                >
                  <span>Tasks (/ - Search)</span>
                </button>
              )}
            </div>

            {/* TUI Task list */}
            <div
              role="listbox"
              aria-label="Running and recent tasks"
              className="min-h-0 flex-1 overflow-y-auto py-1 font-mono text-[11.5px]"
            >
              {filteredTuiTasks.map((proc) => {
                const selected = effectiveTuiTask === proc.id;
                return (
                  <button
                    key={proc.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => setTuiTaskSelection(proc.id)}
                    className={cn(
                      "flex w-full items-center gap-1.5 px-2.5 py-1 text-left transition-colors",
                      selected
                        ? "bg-slate-600/55 font-semibold text-slate-50"
                        : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200",
                    )}
                  >
                    <span
                      className={cn(
                        "shrink-0 text-[11px] leading-none",
                        selected ? "text-slate-200" : "text-slate-600",
                      )}
                      aria-hidden="true"
                    >
                      »
                    </span>
                    <span
                      className={cn(
                        "h-1.5 w-1.5 shrink-0 rounded-full",
                        statusDotClass(proc.status),
                      )}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 truncate">
                      <span>{proc.serviceName}</span>
                      <span className={selected ? "text-slate-300" : "text-slate-500"}>
                        #{proc.script}
                      </span>
                    </span>
                  </button>
                );
              })}

              {filteredTuiTasks.length === 0 ? (
                <div className="px-2.5 py-2 text-[11px] text-slate-500">
                  No matching tasks
                </div>
              ) : null}

              <div className="my-1 border-t border-slate-800/70" />

              <button
                type="button"
                role="option"
                aria-selected={effectiveTuiTask === "stream"}
                onClick={() => setTuiTaskSelection("stream")}
                className={cn(
                  "flex w-full items-center justify-between gap-1.5 px-2.5 py-1 text-left transition-colors",
                  effectiveTuiTask === "stream"
                    ? "bg-slate-600/55 font-semibold text-slate-50"
                    : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200",
                )}
              >
                <span className="truncate">All (Interleaved)</span>
                <span className="rounded bg-slate-800 px-1 text-[10px] text-slate-400 tabular-nums">
                  {scopedProcesses.length}
                </span>
              </button>
            </div>

            {/* TUI Footer keybind hints */}
            <div className="flex shrink-0 items-center justify-between border-t border-slate-800/80 px-2.5 py-1 font-mono text-[10px] text-slate-500">
              <span>↑ ↓ - Select</span>
              <span>/ - Search</span>
            </div>
          </aside>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {isTuiAllMode ? (
            <div className="flex h-7 shrink-0 items-center justify-between gap-2 border-b border-slate-800/70 bg-[#070B16] px-3 font-mono text-[11px] text-slate-400">
              {selectedTuiProcess ? (
                <>
                  <div className="flex min-w-0 items-center gap-1.5 truncate">
                    <span className="font-semibold text-slate-200">
                      {selectedTuiProcess.serviceName}#{selectedTuiProcess.script}
                    </span>
                    <span className="text-slate-600">&gt;</span>
                    <span className="truncate text-slate-400">
                      {selectedTuiProcess.command}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-[10.5px]">
                    {selectedTuiProcess.pid ? (
                      <span className="text-slate-500 tabular-nums">
                        PID {selectedTuiProcess.pid}
                      </span>
                    ) : null}
                    <span
                      className={cn(
                        "flex items-center gap-1 capitalize",
                        selectedTuiProcess.status === "running"
                          ? "text-accent"
                          : selectedTuiProcess.status === "crashed"
                            ? "text-danger"
                            : "text-slate-500",
                      )}
                    >
                      <span
                        className={cn(
                          "h-1.5 w-1.5 rounded-full",
                          statusDotClass(selectedTuiProcess.status),
                        )}
                        aria-hidden="true"
                      />
                      {selectedTuiProcess.status}
                    </span>
                  </div>
                </>
              ) : (
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-slate-200">
                    All (Interleaved)
                  </span>
                  <span className="text-slate-500">
                    · {scopedProcesses.length}{" "}
                    {scopedProcesses.length === 1 ? "task" : "tasks"}
                  </span>
                </div>
              )}
            </div>
          ) : null}

          <div className="relative min-h-0 flex-1 overflow-hidden px-2 py-1.5">
            <div
              ref={setTermContainerEl}
              className="h-full w-full select-text"
            />
            {lineCount === 0 ? (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4 font-mono text-[12px] text-slate-500">
                {scopedProcesses.length === 0
                  ? "No processes in this scope yet. Run a script from the Service Workbench to view log output."
                  : filterText || stderrOnly
                    ? "No log lines match the current filter."
                    : "Waiting for log output…"}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
