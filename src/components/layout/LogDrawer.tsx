import { useState } from "react";
import { Maximize2, Minimize2, Terminal, X } from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { cn } from "@/lib/cn";

export function LogDrawer() {
  const logDrawerOpen = useAppStore((s) => s.logDrawerOpen);
  const toggleLogDrawer = useAppStore((s) => s.toggleLogDrawer);
  const [maximized, setMaximized] = useState(false);

  if (!logDrawerOpen) {
    return null;
  }

  return (
    <section
      aria-label="Shared Log Drawer"
      className={cn(
        "flex shrink-0 flex-col border-t border-border-strong bg-log-bg text-slate-200",
        maximized ? "h-[75%]" : "h-[200px]",
      )}
    >
      <div className="flex h-8 items-center justify-between border-b border-slate-800 px-3">
        <div className="flex items-center gap-2 text-[12px] font-medium text-slate-300">
          <Terminal className="h-3.5 w-3.5 text-info" aria-hidden="true" />
          <span>Shared Log Drawer</span>
          <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10.5px] text-slate-400">
            All (Combined)
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setMaximized((m) => !m)}
            aria-label={maximized ? "Restore panel log" : "Maximize panel log"}
            className="btn-press rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
          >
            {maximized ? (
              <Minimize2 className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            onClick={toggleLogDrawer}
            aria-label="Tutup panel log"
            className="btn-press rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center p-4 font-mono text-[12px] text-slate-400">
        Belum ada proses berjalan. Output log real-time akan muncul di sini saat script dijalankan.
      </div>
    </section>
  );
}
