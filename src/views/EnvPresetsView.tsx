import { useEffect, useState } from "react";
import {
  Eye,
  EyeOff,
  FolderGit2,
  KeyRound,
  Layers,
  Lock,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import {
  type EnvPreset,
  type PresetEntryInput,
  createPreset,
  deletePreset,
  updatePreset,
} from "@/lib/tauri";
import { useAppStore } from "@/store/appStore";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { cn } from "@/lib/cn";

interface DraftEntry {
  key: string;
  value: string;
  isSecret: boolean;
}

export function EnvPresetsView() {
  const presets = useAppStore((s) => s.presets);
  const loadPresets = useAppStore((s) => s.loadPresets);
  const setRoute = useAppStore((s) => s.setRoute);
  const pushToast = useAppStore((s) => s.pushToast);

  const [revealSecrets, setRevealSecrets] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftEntries, setDraftEntries] = useState<DraftEntry[]>([
    { key: "", value: "", isSecret: false },
  ]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<EnvPreset | null>(null);

  useEffect(() => {
    void loadPresets();
  }, [loadPresets]);

  const openCreateEditor = () => {
    setEditingPresetId(null);
    setDraftName("");
    setDraftEntries([{ key: "", value: "", isSecret: false }]);
    setFormError(null);
    setEditorOpen(true);
  };

  const openEditEditor = (preset: EnvPreset) => {
    setEditingPresetId(preset.id);
    setDraftName(preset.name);
    setDraftEntries(
      preset.entries.length > 0
        ? preset.entries.map((e) => ({
            key: e.key,
            value: e.value,
            isSecret: e.isSecret,
          }))
        : [{ key: "", value: "", isSecret: false }],
    );
    setFormError(null);
    setEditorOpen(true);
  };

  const closeEditor = () => {
    setEditorOpen(false);
    setEditingPresetId(null);
    setFormError(null);
  };

  const addDraftRow = () => {
    setDraftEntries((prev) => [...prev, { key: "", value: "", isSecret: false }]);
  };

  const removeDraftRow = (index: number) => {
    setDraftEntries((prev) =>
      prev.length <= 1
        ? [{ key: "", value: "", isSecret: false }]
        : prev.filter((_, i) => i !== index),
    );
  };

  const updateDraftRow = (index: number, patch: Partial<DraftEntry>) => {
    setDraftEntries((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const cleanedEntries: PresetEntryInput[] = draftEntries
      .filter((row) => row.key.trim().length > 0)
      .map((row) => ({
        key: row.key.trim(),
        value: row.value,
        isSecret: row.isSecret,
      }));

    if (!draftName.trim()) {
      setFormError("Nama preset tidak boleh kosong.");
      return;
    }

    setSaving(true);
    try {
      if (editingPresetId) {
        const updated = await updatePreset(
          editingPresetId,
          draftName.trim(),
          cleanedEntries,
        );
        pushToast({
          title: `Preset "${updated.name}" diperbarui`,
          variant: "success",
        });
      } else {
        const created = await createPreset(draftName.trim(), cleanedEntries);
        pushToast({
          title: `Preset "${created.name}" dibuat`,
          variant: "success",
        });
      }
      await loadPresets();
      closeEditor();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    try {
      await deletePreset(target.id);
      await loadPresets();
      pushToast({
        title: `Preset "${target.name}" dihapus`,
        variant: "info",
      });
    } catch (err) {
      pushToast({
        title: "Gagal menghapus preset",
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    }
  };

  return (
    <div className="animate-view-enter mx-auto max-w-5xl space-y-5 p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-[19px] font-semibold tracking-tight text-fg">
              Env Presets
            </h1>
            <span className="rounded-full bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-fg-muted tabular-nums">
              {presets.length} preset
            </span>
          </div>
          <p className="mt-0.5 text-[13px] text-fg-muted">
            Preset override-only yang dapat dipasang berurutan di level Project maupun Service. Nilai bertanda{" "}
            <span className="font-medium text-fg-2">Keychain</span> disimpan di OS secure store dan tidak pernah ditulis ke SQLite.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setRevealSecrets((v) => !v)}
            className="btn-press flex h-8 items-center gap-1.5 rounded-[7px] border border-border-strong bg-surface px-2.5 text-[12px] font-medium text-fg-2 hover:bg-surface-hover hover:text-fg"
          >
            {revealSecrets ? (
              <>
                <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Sembunyikan Secret</span>
              </>
            ) : (
              <>
                <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Tampilkan Secret</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={openCreateEditor}
            className="btn-press flex h-8 items-center gap-1.5 rounded-[7px] bg-accent px-3 text-[12.5px] font-semibold text-accent-fg hover:opacity-95"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Buat Preset</span>
          </button>
        </div>
      </div>

      {/* Inline Editor Card */}
      {editorOpen ? (
        <form
          onSubmit={(e) => void handleSave(e)}
          className="rounded-[10px] border border-info/40 bg-surface p-4 shadow-sm"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border pb-3">
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-info" aria-hidden="true" />
              <h2 className="text-[14px] font-semibold text-fg">
                {editingPresetId ? "Edit Env Preset" : "Buat Env Preset Baru"}
              </h2>
            </div>
            <button
              type="button"
              aria-label="Tutup editor preset"
              onClick={closeEditor}
              className="flex h-7 w-7 items-center justify-center rounded-[6px] text-fg-muted hover:bg-surface-hover hover:text-fg"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <div className="mt-3.5 space-y-3.5">
            <div>
              <label
                htmlFor="preset-name-input"
                className="mb-1 block text-[12px] font-medium text-fg-2"
              >
                Nama Preset
              </label>
              <input
                id="preset-name-input"
                type="text"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder="Mis. DB Staging, Redis Local, Stripe Sandbox"
                className="h-8 w-full max-w-md rounded-[7px] border border-border-strong bg-surface-2 px-2.5 text-[13px] text-fg placeholder:text-fg-faint focus:border-info"
              />
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[12px] font-medium text-fg-2">
                  Override Entries
                </span>
                <button
                  type="button"
                  onClick={addDraftRow}
                  className="btn-press inline-flex h-7 items-center gap-1 rounded-[6px] border border-border-strong bg-surface-2 px-2 text-[11.5px] font-medium text-fg-2 hover:bg-surface-hover hover:text-fg"
                >
                  <Plus className="h-3 w-3" aria-hidden="true" />
                  <span>Tambah Baris</span>
                </button>
              </div>

              <div className="space-y-2">
                {draftEntries.map((row, idx) => (
                  <div
                    key={idx}
                    className="grid gap-2 sm:grid-cols-[1fr_1.4fr_auto_auto]"
                  >
                    <input
                      type="text"
                      aria-label={`Key baris ${idx + 1}`}
                      value={row.key}
                      onChange={(e) =>
                        updateDraftRow(idx, { key: e.target.value })
                      }
                      placeholder="DATABASE_URL"
                      className="h-8 rounded-[7px] border border-border-strong bg-surface-2 px-2.5 font-mono text-[12px] text-fg placeholder:text-fg-faint"
                    />
                    <input
                      type={row.isSecret && !revealSecrets ? "password" : "text"}
                      aria-label={`Nilai baris ${idx + 1}`}
                      value={row.value}
                      onChange={(e) =>
                        updateDraftRow(idx, { value: e.target.value })
                      }
                      placeholder="postgres://…"
                      className="h-8 rounded-[7px] border border-border-strong bg-surface-2 px-2.5 font-mono text-[12px] text-fg placeholder:text-fg-faint"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        updateDraftRow(idx, { isSecret: !row.isSecret })
                      }
                      className={cn(
                        "btn-press inline-flex h-8 items-center gap-1.5 rounded-[7px] border px-2.5 text-[11.5px] font-medium",
                        row.isSecret
                          ? "border-warn/40 bg-warn-soft text-warn"
                          : "border-border-strong bg-surface-2 text-fg-muted hover:text-fg",
                      )}
                      title={
                        row.isSecret
                          ? "Disimpan di OS Keychain"
                          : "Disimpan sebagai plain text di SQLite"
                      }
                    >
                      <Lock className="h-3 w-3" aria-hidden="true" />
                      <span>{row.isSecret ? "Keychain" : "Plain"}</span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Hapus baris ${idx + 1}`}
                      onClick={() => removeDraftRow(idx)}
                      className="flex h-8 w-8 items-center justify-center rounded-[7px] border border-border bg-surface-2 text-fg-muted hover:border-danger/40 hover:bg-danger-soft hover:text-danger"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {formError ? (
              <div
                role="alert"
                className="rounded-[7px] border border-danger/40 bg-danger-soft px-3 py-2 text-[12px] text-danger"
              >
                {formError}
              </div>
            ) : null}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={closeEditor}
                className="btn-press h-8 rounded-[7px] border border-border-strong bg-surface-2 px-3 text-[12px] font-medium text-fg-2 hover:bg-surface-hover hover:text-fg"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={saving}
                className="btn-press h-8 rounded-[7px] bg-accent px-3.5 text-[12px] font-semibold text-accent-fg hover:opacity-95 disabled:opacity-50"
              >
                {saving ? "Menyimpan…" : "Simpan Preset"}
              </button>
            </div>
          </div>
        </form>
      ) : null}

      {/* Preset List */}
      {presets.length === 0 ? (
        <div className="rounded-[10px] border border-dashed border-border bg-surface p-10 text-center">
          <KeyRound
            className="mx-auto mb-2.5 h-8 w-8 text-fg-faint"
            strokeWidth={1.6}
            aria-hidden="true"
          />
          <p className="text-[14px] font-medium text-fg">
            Belum ada Env Preset
          </p>
          <p className="mx-auto mt-1 max-w-md text-[12.5px] text-fg-muted">
            Buat preset seperti <code className="font-mono">DB Staging</code> atau{" "}
            <code className="font-mono">Redis Local</code> untuk dipakai ulang di banyak project dan service tanpa mengubah file{" "}
            <code className="font-mono">.env</code> di repo.
          </p>
          <button
            type="button"
            onClick={openCreateEditor}
            className="btn-press mt-4 inline-flex h-8 items-center gap-1.5 rounded-[7px] bg-accent px-3 text-[12.5px] font-semibold text-accent-fg hover:opacity-95"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Buat Preset Pertama</span>
          </button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {presets.map((preset) => {
            const secretCount = preset.entries.filter((e) => e.isSecret).length;
            const plainCount = preset.entries.length - secretCount;

            return (
              <div
                key={preset.id}
                className="flex flex-col rounded-[10px] border border-border bg-surface p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="text-[14.5px] font-semibold text-fg">
                      {preset.name}
                    </h2>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span className="inline-flex items-center gap-1 rounded bg-warn-soft px-1.5 py-0.5 font-mono text-warn tabular-nums">
                        <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                        {secretCount} Keychain
                      </span>
                      <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-fg-muted tabular-nums">
                        {plainCount} Plain
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-label={`Edit preset ${preset.name}`}
                      onClick={() => openEditEditor(preset)}
                      className="btn-press flex h-7 w-7 items-center justify-center rounded-[6px] border border-border-strong bg-surface-2 text-fg-2 hover:bg-surface-hover hover:text-fg"
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Hapus preset ${preset.name}`}
                      onClick={() => setDeleteTarget(preset)}
                      className="btn-press flex h-7 w-7 items-center justify-center rounded-[6px] border border-danger/30 bg-danger-soft text-danger hover:bg-danger-solid hover:text-white"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </div>

                {/* Entries preview */}
                <div className="mt-3 flex-1 overflow-hidden rounded-[8px] border border-border bg-surface-2/60">
                  {preset.entries.length === 0 ? (
                    <div className="px-3 py-2.5 text-[12px] text-fg-faint">
                      Preset belum memiliki entry.
                    </div>
                  ) : (
                    <div className="divide-y divide-border text-[12px]">
                      {preset.entries.map((entry) => (
                        <div
                          key={entry.id}
                          className="flex items-center justify-between gap-2 px-3 py-1.5"
                        >
                          <div className="flex min-w-0 items-center gap-1.5">
                            <span className="truncate font-mono font-medium text-fg">
                              {entry.key}
                            </span>
                            <span
                              className={cn(
                                "shrink-0 rounded px-1 py-0.5 text-[10px] font-medium",
                                entry.isSecret
                                  ? "bg-warn-soft text-warn"
                                  : "bg-surface-2 text-fg-faint",
                              )}
                            >
                              {entry.isSecret ? "Keychain" : "Plain"}
                            </span>
                          </div>
                          <span className="max-w-[50%] truncate font-mono text-[11.5px] text-fg-muted">
                            {entry.isSecret && !revealSecrets
                              ? "••••••••"
                              : entry.value || "(kosong)"}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Usages */}
                <div className="mt-3 border-t border-border pt-2.5">
                  <div className="mb-1 text-[11px] font-medium text-fg-muted">
                    Dipakai oleh ({preset.usages.length})
                  </div>
                  {preset.usages.length === 0 ? (
                    <p className="text-[11.5px] text-fg-faint">
                      Belum dipasang ke project atau service mana pun.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {preset.usages.map((u) => (
                        <button
                          key={`${u.kind}-${u.id}`}
                          type="button"
                          onClick={() =>
                            u.kind === "project"
                              ? setRoute({ kind: "project", projectId: u.projectId })
                              : setRoute({
                                  kind: "service",
                                  projectId: u.projectId,
                                  serviceId: u.id,
                                })
                          }
                          className="inline-flex items-center gap-1 rounded-[6px] border border-border-strong bg-surface-2 px-2 py-0.5 text-[11px] text-fg-2 hover:bg-surface-hover hover:text-fg"
                        >
                          {u.kind === "project" ? (
                            <Layers className="h-3 w-3 text-info" aria-hidden="true" />
                          ) : (
                            <FolderGit2 className="h-3 w-3 text-fg-muted" aria-hidden="true" />
                          )}
                          <span>
                            {u.kind === "project"
                              ? u.projectName
                              : `${u.projectName} / ${u.name}`}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title={deleteTarget ? `Hapus preset "${deleteTarget.name}"?` : ""}
        description={
          deleteTarget && deleteTarget.usages.length > 0
            ? `Preset ini sedang dipakai oleh ${deleteTarget.usages.length} project/service. Menghapus preset akan melepasnya dan menghapus seluruh nilai secret dari OS Keychain.`
            : "Preset dan seluruh nilai secret-nya di OS Keychain akan dihapus secara permanen."
        }
        confirmLabel="Hapus Preset"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void handleConfirmDelete()}
      />
    </div>
  );
}
