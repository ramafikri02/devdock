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

  const drawerRef = useRef<HTMLElement | null>(null);
  const termContainerRef = useRef<HTMLDivElement | null>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  const allProcesses = useMemo(
    () =>
      Object.values(processesMap).sort((a, b) =>
        a.startedAt.localeCompare(b.startedAt),
      ),
    [processesMap],
  );

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

  const showServiceTag = effectiveTab === "combined";

  // Initialize xterm.js instance when drawer is open
  useEffect(() => {
    if (!logDrawerOpen || !termContainerRef.current) return;

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
    term.open(termContainerRef.current);
    try {
      fitAddon.fit();
    } catch {
      // Ignore initial zero-size fit
    }

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    const observer = new ResizeObserver(() => {
      try {
        fitAddon.fit();
      } catch {
        // Ignore transient resize errors
      }
    });
    observer.observe(termContainerRef.current);

    return () => {
      observer.disconnect();
      term.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, [logDrawerOpen]);

  // Fit terminal when height or maximized state changes
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
  }, [logDrawerOpen, logDrawerHeight, logDrawerMaximized]);

  // Load buffered logs whenever scope, tab, filter, or stderr toggle changes
  useEffect(() => {
    if (!logDrawerOpen) return;
    let cancelled = false;

    const load = async () => {
      try {
        let lines: LogLine[] = [];
        if (effectiveTab !== "combined") {
          lines = await getProcessLogs(effectiveTab, filterText, stderrOnly);
        } else if (logScope.kind === "project") {
          lines = await getProjectLogs(logScope.projectId, filterText, stderrOnly);
        } else {
          lines = await getAllLogs(filterText, stderrOnly);
        }

        if (cancelled) return;
        const term = xtermRef.current;
        if (!term) return;
        term.reset();
        if (lines.length > 0) {
          const chunk = lines
            .map((l) => formatLineForTerminal(l, showServiceTag))
            .join("\r\n");
          term.writeln(chunk);
        }
        setLineCount(lines.length);
      } catch {
        // Ignore fetch errors for gone processes
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [logDrawerOpen, effectiveTab, logScope, filterText, stderrOnly, showServiceTag]);

  // Stream live log events directly to xterm.js
  useEffect(() => {
    if (!logDrawerOpen) return;
    let unlistenLog: (() => void) | undefined;
    let unlistenClear: (() => void) | undefined;

    const queryLower = filterText.trim().toLowerCase();

    void onProcessLog((line) => {
      // Scope & tab check
      if (effectiveTab !== "combined") {
        if (line.processId !== effectiveTab) return;
      } else if (logScope.kind === "project") {
        if (line.projectId !== logScope.projectId) return;
      }

      if (stderrOnly && line.stream !== "stderr") return;

      if (queryLower) {
        const plain = stripAnsi(line.text).toLowerCase();
        const matches =
          plain.includes(queryLower) ||
          line.serviceName.toLowerCase().includes(queryLower) ||
          line.script.toLowerCase().includes(queryLower);
        if (!matches) return;
      }

      const term = xtermRef.current;
      if (term) {
        term.writeln(formatLineForTerminal(line, showServiceTag));
        setLineCount((c) => Math.min(10_000, c + 1));
      }
    }).then((fn) => {
      unlistenLog = fn;
    });

    void onProcessLogsCleared(({ processId }) => {
      if (effectiveTab === processId || effectiveTab === "combined") {
        xtermRef.current?.reset();
        setLineCount(0);
      }
    }).then((fn) => {
      unlistenClear = fn;
    });

    return () => {
      if (unlistenLog) unlistenLog();
      if (unlistenClear) unlistenClear();
    };
  }, [logDrawerOpen, effectiveTab, logScope, filterText, stderrOnly, showServiceTag]);

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
      if (effectiveTab !== "combined") {
        await clearProcessLogs(effectiveTab);
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
      effectiveTab !== "combined"
        ? "process"
        : logScope.kind === "project"
          ? "project"
          : "all";
    const scopeId =
      effectiveTab !== "combined"
        ? effectiveTab
        : logScope.kind === "project"
          ? logScope.projectId
          : null;

    let defaultFileName = "devdock-logs.log";
    if (effectiveTab !== "combined") {
      const p = processesMap[effectiveTab];
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

  if (!logDrawerOpen) {
    return null;
  }

  const scopeValue =
    logScope.kind === "all" ? "all" : `project:${logScope.projectId}`;

  return (
    <section
      ref={drawerRef}
      aria-label="Shared Log Drawer"
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

      {/* Terminal viewport */}
      <div className="relative min-h-0 flex-1 overflow-hidden bg-log-bg px-2 py-1.5">
        <div
          ref={termContainerRef}
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
    </section>
  );
}
