import { RefreshCw, Moon, Sun, Database, Terminal } from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { cn } from "@/lib/cn";

export function SettingsView() {
  const bootstrap = useAppStore((s) => s.bootstrap);
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const refreshPath = useAppStore((s) => s.refreshPath);

  return (
    <div className="animate-view-enter mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="text-[19px] font-semibold tracking-tight text-fg">
          Settings
        </h1>
        <p className="mt-0.5 text-[13px] text-fg-muted">
          Pengaturan tema, environment shell PATH, dan informasi penyimpanan lokal.
        </p>
      </div>

      {/* Appearance */}
      <section className="rounded-[10px] border border-border bg-surface p-4">
        <h2 className="text-[14px] font-semibold text-fg">Tampilan</h2>
        <p className="mt-0.5 text-[12.5px] text-fg-muted">
          Pilih tema gelap (default) atau tema terang dengan kontras tinggi.
        </p>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => void setTheme("dark")}
            className={cn(
              "btn-press flex h-8 items-center gap-2 rounded-[7px] border px-3 text-[13px] font-medium",
              theme === "dark"
                ? "border-info bg-info-soft text-fg"
                : "border-border-strong bg-surface-2 text-fg-muted hover:text-fg",
            )}
          >
            <Moon className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Dark Mode</span>
          </button>
          <button
            type="button"
            onClick={() => void setTheme("light")}
            className={cn(
              "btn-press flex h-8 items-center gap-2 rounded-[7px] border px-3 text-[13px] font-medium",
              theme === "light"
                ? "border-info bg-info-soft text-fg"
                : "border-border-strong bg-surface-2 text-fg-muted hover:text-fg",
            )}
          >
            <Sun className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Light Mode</span>
          </button>
        </div>
      </section>

      {/* Shell PATH */}
      <section className="rounded-[10px] border border-border bg-surface p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-[14px] font-semibold text-fg">
              <Terminal className="h-4 w-4 text-info" aria-hidden="true" />
              <span>Login Shell PATH</span>
            </h2>
            <p className="mt-0.5 text-[12.5px] text-fg-muted">
              Diambil dari login shell pengguna agar `node`, `pnpm`, `yarn`, `bun`, dan `fnm` ditemukan dari aplikasi GUI.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refreshPath()}
            className="btn-press flex h-8 shrink-0 items-center gap-1.5 rounded-[7px] border border-border-strong bg-surface-2 px-3 text-[12.5px] font-medium text-fg-2 hover:bg-surface-hover hover:text-fg"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Refresh PATH</span>
          </button>
        </div>
        <div className="mt-3 max-h-28 overflow-y-auto rounded-[8px] border border-border bg-surface-2 p-2.5 font-mono text-[11.5px] break-all text-fg-2 select-text">
          {bootstrap?.shellPath || "Memuat PATH…"}
        </div>
      </section>

      {/* Database */}
      <section className="rounded-[10px] border border-border bg-surface p-4">
        <h2 className="flex items-center gap-2 text-[14px] font-semibold text-fg">
          <Database className="h-4 w-4 text-accent" aria-hidden="true" />
          <span>SQLite Storage</span>
        </h2>
        <div className="mt-2 space-y-1 font-mono text-[12px] text-fg-muted select-text">
          <div>Path: {bootstrap?.dbPath ?? "—"}</div>
          <div>Schema version: v{bootstrap?.schemaVersion ?? "—"}</div>
          <div>Adapters: {bootstrap?.adapters.join(", ") ?? "—"}</div>
        </div>
      </section>
    </div>
  );
}
