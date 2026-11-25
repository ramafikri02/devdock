import { useEffect, useState } from "react";
import { AlertCircle, FolderOpen, X } from "lucide-react";
import { pickFolderDialog } from "@/lib/tauri";
import { useAppStore } from "@/store/appStore";
import { cn } from "@/lib/cn";

export function AddProjectModal() {
  const open = useAppStore((s) => s.addProjectModalOpen);
  const defaultTargetId = useAppStore((s) => s.addProjectDefaultTargetId);
  const close = useAppStore((s) => s.closeAddProjectModal);
  const projects = useAppStore((s) => s.projects);
  const registerProject = useAppStore((s) => s.registerProject);
  const attachService = useAppStore((s) => s.attachService);

  const [mode, setMode] = useState<"new" | "attach">("new");
  const [targetProjectId, setTargetProjectId] = useState<string>("");
  const [folder, setFolder] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setFolder("");
    setDisplayName("");
    setError(null);
    if (defaultTargetId && projects.some((p) => p.id === defaultTargetId)) {
      setMode("attach");
      setTargetProjectId(defaultTargetId);
    } else {
      setMode("new");
      setTargetProjectId(projects[0]?.id ?? "");
    }
  }, [open, defaultTargetId, projects]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  if (!open) return null;

  const handleBrowse = async () => {
    setError(null);
    const chosen = await pickFolderDialog("Select Node.js project folder");
    if (chosen) {
      setFolder(chosen);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!folder.trim()) {
      setError("Please select or enter a folder path first.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      if (mode === "attach" && targetProjectId) {
        await attachService(targetProjectId, folder.trim(), displayName.trim() || undefined);
      } else {
        await registerProject(folder.trim(), displayName.trim() || undefined);
      }
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add Project or Service"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[1px]"
      onClick={close}
    >
      <div
        className="animate-modal-enter w-full max-w-md rounded-[12px] border border-border-strong bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-[14.5px] font-semibold text-fg">
            Add Project / Service Folder
          </h2>
          <button
            type="button"
            onClick={close}
            aria-label="Close dialog"
            className="btn-press rounded p-1 text-fg-muted hover:bg-surface-hover hover:text-fg"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 p-4">
          {/* Mode toggle */}
          {projects.length > 0 ? (
            <div className="grid grid-cols-2 gap-1.5 rounded-[8px] border border-border bg-surface-2 p-1">
              <button
                type="button"
                onClick={() => setMode("new")}
                className={cn(
                  "rounded-[6px] px-2.5 py-1.5 text-[12.5px] font-medium transition-colors",
                  mode === "new"
                    ? "bg-surface text-fg shadow-xs"
                    : "text-fg-muted hover:text-fg",
                )}
              >
                New Project
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode("attach");
                  if (!targetProjectId && projects[0]) {
                    setTargetProjectId(projects[0].id);
                  }
                }}
                className={cn(
                  "rounded-[6px] px-2.5 py-1.5 text-[12.5px] font-medium transition-colors",
                  mode === "attach"
                    ? "bg-surface text-fg shadow-xs"
                    : "text-fg-muted hover:text-fg",
                )}
              >
                Attach to Project
              </button>
            </div>
          ) : null}

          {/* Target Project selector when attaching */}
          {mode === "attach" && projects.length > 0 ? (
            <div className="space-y-1.5">
              <label
                htmlFor="target-project"
                className="block text-[12px] font-medium text-fg-2"
              >
                Target Project
              </label>
              <select
                id="target-project"
                value={targetProjectId}
                onChange={(e) => setTargetProjectId(e.target.value)}
                className="h-9 w-full rounded-[7px] border border-border-strong bg-surface-2 px-2.5 text-[13px] text-fg"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.services.length} {p.services.length === 1 ? "service" : "services"})
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {/* Folder path + picker */}
          <div className="space-y-1.5">
            <label
              htmlFor="folder-path"
              className="block text-[12px] font-medium text-fg-2"
            >
              Project Folder (contains package.json)
            </label>
            <div className="flex gap-2">
              <input
                id="folder-path"
                type="text"
                value={folder}
                onChange={(e) => setFolder(e.target.value)}
                placeholder="/Users/dev/projects/lms-frontend"
                className="h-9 min-w-0 flex-1 rounded-[7px] border border-border-strong bg-surface-2 px-2.5 font-mono text-[12px] text-fg placeholder:text-fg-faint"
              />
              <button
                type="button"
                onClick={() => void handleBrowse()}
                className="btn-press flex h-9 shrink-0 items-center gap-1.5 rounded-[7px] border border-border-strong bg-surface-2 px-3 text-[12.5px] font-medium text-fg-2 hover:bg-surface-hover hover:text-fg"
              >
                <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Browse…</span>
              </button>
            </div>
          </div>

          {/* Optional display name */}
          <div className="space-y-1.5">
            <label
              htmlFor="display-name"
              className="block text-[12px] font-medium text-fg-2"
            >
              {mode === "attach"
                ? "Service Name (optional)"
                : "Project Name (optional)"}
            </label>
            <input
              id="display-name"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Leave blank to use package.json name"
              className="h-9 w-full rounded-[7px] border border-border-strong bg-surface-2 px-2.5 text-[13px] text-fg placeholder:text-fg-faint"
            />
          </div>

          {error ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-[8px] border border-danger/40 bg-danger-soft px-3 py-2 text-[12.5px] text-danger"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          ) : null}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={close}
              className="btn-press h-8 rounded-[7px] border border-border-strong bg-surface-2 px-3 text-[12.5px] font-medium text-fg-2 hover:bg-surface-hover hover:text-fg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="btn-press h-8 rounded-[7px] bg-accent px-3.5 text-[12.5px] font-semibold text-accent-fg hover:opacity-95 disabled:opacity-50"
            >
              {submitting ? "Saving…" : "Add"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
