import { useEffect, useRef, useState } from "react";
import { Search, LayoutGrid, Network, KeyRound, Settings, X } from "lucide-react";
import { useAppStore } from "@/store/appStore";

export function CommandPaletteModal() {
  const open = useAppStore((s) => s.commandPaletteOpen);
  const setOpen = useAppStore((s) => s.setCommandPaletteOpen);
  const setRoute = useAppStore((s) => s.setRoute);
  const toggleTheme = useAppStore((s) => s.toggleTheme);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    const timer = window.setTimeout(() => inputRef.current?.focus(), 10);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, setOpen]);

  if (!open) return null;

  const actions = [
    {
      label: "Buka Overview",
      icon: LayoutGrid,
      run: () => setRoute({ kind: "overview" }),
    },
    {
      label: "Buka Port Inspector",
      icon: Network,
      run: () => setRoute({ kind: "ports" }),
    },
    {
      label: "Buka Env Presets",
      icon: KeyRound,
      run: () => setRoute({ kind: "presets" }),
    },
    {
      label: "Buka Settings",
      icon: Settings,
      run: () => setRoute({ kind: "settings" }),
    },
    {
      label: "Toggle Dark / Light Theme",
      icon: Settings,
      run: () => void toggleTheme(),
    },
  ].filter((a) => a.label.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command Palette"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/55 pt-24 backdrop-blur-[1px]"
      onClick={() => setOpen(false)}
    >
      <div
        className="animate-modal-enter w-full max-w-lg overflow-hidden rounded-[12px] border border-border-strong bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <Search className="h-4 w-4 text-fg-muted" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ketik perintah atau navigasi…"
            className="w-full bg-transparent text-[13.5px] text-fg placeholder:text-fg-faint focus:outline-none"
          />
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Tutup command palette"
            className="rounded p-1 text-fg-muted hover:bg-surface-hover hover:text-fg"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>

        <div className="max-h-72 overflow-y-auto p-1.5">
          {actions.length === 0 ? (
            <div className="px-3 py-6 text-center text-[12.5px] text-fg-muted">
              Tidak ada perintah yang cocok.
            </div>
          ) : (
            actions.map((action) => {
              const Icon = action.icon;
              return (
                <button
                  key={action.label}
                  type="button"
                  onClick={() => {
                    action.run();
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2.5 rounded-[7px] px-2.5 py-2 text-left text-[13px] text-fg-2 hover:bg-surface-hover hover:text-fg"
                >
                  <Icon className="h-4 w-4 text-fg-muted" aria-hidden="true" />
                  <span>{action.label}</span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
