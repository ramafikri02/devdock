import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  Eye,
  EyeOff,
  FileCode2,
  FileDown,
  KeyRound,
  Lock,
  Plus,
  RefreshCw,
  Save,
  X,
} from "lucide-react";
import {
  type Service,
  type ServiceEnvInspection,
  attachPresetToService,
  detachPresetFromService,
  inspectServiceEnv,
  reorderServicePresets,
  testServiceDbConnection,
  updateServiceEnvKey,
  writeServiceEnv,
} from "@/lib/tauri";
import { DbTestButton } from "@/components/workbench/DbTestButton";
import { useAppStore } from "@/store/appStore";
import { cn } from "@/lib/cn";

interface ServiceEnvTabProps {
  service: Service;
}

export function ServiceEnvTab({ service }: ServiceEnvTabProps) {
  const pushToast = useAppStore((s) => s.pushToast);
  const allPresets = useAppStore((s) => s.presets);
  const loadPresets = useAppStore((s) => s.loadPresets);
  const setRoute = useAppStore((s) => s.setRoute);

  const [mode, setMode] = useState("development");
  const [inspection, setInspection] = useState<ServiceEnvInspection | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealSecrets, setRevealSecrets] = useState(false);
  const [selectedPresetId, setSelectedPresetId] = useState("");

  // Inline edited drafts keyed by env key
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [missingInputs, setMissingInputs] = useState<Record<string, string>>({});

  // Add new key inline form
  const [addingKey, setAddingKey] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [newTargetFile, setNewTargetFile] = useState(".env.local");

  // Write-to-.env panel
  const [writePanelOpen, setWritePanelOpen] = useState(false);
  const [writeTargetFile, setWriteTargetFile] = useState(".env");
  const [writing, setWriting] = useState(false);

  const loadEnv = useCallback(
    async (selectedMode: string) => {
      if (service.isMissing) {
        setInspection(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const res = await inspectServiceEnv(service.id, selectedMode);
        setInspection(res);
        const nextDrafts: Record<string, string> = {};
        for (const e of res.entries) {
          nextDrafts[e.key] = e.value;
        }
        setDrafts(nextDrafts);
        const nextMissing: Record<string, string> = {};
        for (const m of res.missingKeys) {
          nextMissing[m.key] = m.exampleValue;
        }
        setMissingInputs(nextMissing);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [service.id, service.isMissing],
  );

  useEffect(() => {
    void loadEnv(mode);
  }, [loadEnv, mode]);

  if (service.isMissing) {
    return (
      <div className="rounded-[10px] border border-border bg-surface p-6 text-center text-[13px] text-fg-muted">
        Folder service tidak ditemukan. Relokasi folder terlebih dahulu untuk membaca file <code className="font-mono">.env*</code>.
      </div>
    );
  }

  const handleSaveSingleKey = async (key: string, targetFile: string, value: string) => {
    try {
      const res = await updateServiceEnvKey(service.id, targetFile, key, value);
      pushToast({
        title: `${key} disimpan ke ${res.targetFile}`,
        description: res.backupPath
          ? `Backup dibuat di ${res.targetFile}.bak`
          : undefined,
        variant: "success",
      });
      await loadEnv(mode);
    } catch (err) {
      pushToast({
        title: `Gagal menyimpan ${key}`,
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    }
  };

  const handleAddKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKey.trim()) return;
    await handleSaveSingleKey(newKey.trim(), newTargetFile, newValue);
    setNewKey("");
    setNewValue("");
    setAddingKey(false);
  };

  const handleWriteAll = async () => {
    if (!inspection) return;
    setWriting(true);
    try {
      const payload: Record<string, string> = {};
      for (const entry of inspection.entries) {
        payload[entry.key] = drafts[entry.key] ?? entry.value;
      }
      const res = await writeServiceEnv(service.id, writeTargetFile, payload);
      pushToast({
        title: `${res.writtenKeys} key ditulis ke ${res.targetFile}`,
        description: res.backupPath
          ? `File lama dibackup ke ${res.targetFile}.bak`
          : "File baru dibuat.",
        variant: "success",
      });
      setWritePanelOpen(false);
      await loadEnv(mode);
    } catch (err) {
      pushToast({
        title: "Gagal menulis file .env",
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    } finally {
      setWriting(false);
    }
  };

  const targetFileOptions = [
    ".env",
    ".env.local",
    `.env.${mode}`,
    `.env.${mode}.local`,
  ];

  const attachedServicePresetIds = new Set(
    (inspection?.servicePresets ?? []).map((p) => p.presetId),
  );
  const availableServicePresets = allPresets.filter(
    (p) => !attachedServicePresetIds.has(p.id),
  );

  const handleAttachServicePreset = async () => {
    if (!selectedPresetId) return;
    try {
      await attachPresetToService(service.id, selectedPresetId);
      setSelectedPresetId("");
      await Promise.all([loadEnv(mode), loadPresets()]);
      pushToast({
        title: `Preset dipasang ke ${service.name}`,
        variant: "success",
      });
    } catch (err) {
      pushToast({
        title: "Gagal memasang preset",
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    }
  };

  const handleDetachServicePreset = async (presetId: string, presetName: string) => {
    try {
      await detachPresetFromService(service.id, presetId);
      await Promise.all([loadEnv(mode), loadPresets()]);
      pushToast({
        title: `Preset "${presetName}" dilepas`,
        variant: "info",
      });
    } catch (err) {
      pushToast({
        title: "Gagal melepas preset",
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    }
  };

  const handleMoveServicePreset = async (index: number, direction: -1 | 1) => {
    if (!inspection) return;
    const list = [...inspection.servicePresets];
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= list.length) return;
    const [moved] = list.splice(index, 1);
    list.splice(targetIndex, 0, moved);
    try {
      await reorderServicePresets(
        service.id,
        list.map((p) => p.presetId),
      );
      await loadEnv(mode);
    } catch (err) {
      pushToast({
        title: "Gagal mengubah urutan preset",
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    }
  };

  return (
    <div className="space-y-4">
      {/* Resolution order visual */}
      <div className="rounded-[10px] border border-border bg-surface p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
            <span className="font-semibold text-fg-muted">Prioritas Resolusi:</span>
            <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-fg-faint">
              shell
            </span>
            {inspection?.files.map((f) => (
              <span key={f.name} className="flex items-center gap-1.5">
                <span className="text-fg-faint">→</span>
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 font-mono",
                    f.exists
                      ? "bg-info-soft font-medium text-info"
                      : "bg-surface-2 text-fg-faint line-through opacity-60",
                  )}
                  title={f.exists ? `${f.keyCount} key` : "File tidak ada"}
                >
                  {f.name}
                  {f.exists ? ` (${f.keyCount})` : ""}
                </span>
              </span>
            ))}
            {inspection?.projectPresets.map((p) => (
              <span key={`proj-${p.presetId}`} className="flex items-center gap-1.5">
                <span className="text-fg-faint">→</span>
                <span className="rounded bg-warn-soft px-1.5 py-0.5 font-mono font-medium text-warn">
                  project:{p.presetName}
                </span>
              </span>
            ))}
            {inspection?.servicePresets.map((p) => (
              <span key={`svc-${p.presetId}`} className="flex items-center gap-1.5">
                <span className="text-fg-faint">→</span>
                <span className="rounded bg-accent-soft px-1.5 py-0.5 font-mono font-medium text-accent">
                  service:{p.presetName}
                </span>
              </span>
            ))}
            {inspection?.assignedPort ? (
              <span className="flex items-center gap-1.5">
                <span className="text-fg-faint">→</span>
                <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono font-medium text-fg">
                  PORT={inspection.assignedPort}
                </span>
              </span>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="env-mode-select" className="text-[11.5px] text-fg-muted">
              Mode:
            </label>
            <select
              id="env-mode-select"
              value={mode}
              onChange={(e) => setMode(e.target.value)}
              className="h-7 rounded-[6px] border border-border-strong bg-surface-2 px-2 font-mono text-[11.5px] text-fg"
            >
              {(inspection?.availableModes ?? ["development", "production"]).map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Presets attached to Project & Service */}
      <div className="rounded-[10px] border border-border bg-surface p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <KeyRound className="h-3.5 w-3.5 text-info" aria-hidden="true" />
            <span className="text-[12.5px] font-semibold text-fg">
              Env Presets (Inject saat Spawn)
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <select
              aria-label="Pilih preset untuk dipasang ke service"
              value={selectedPresetId}
              onChange={(e) => setSelectedPresetId(e.target.value)}
              className="h-7 rounded-[6px] border border-border-strong bg-surface-2 px-2 text-[11.5px] text-fg"
            >
              <option value="">Pasang preset ke service…</option>
              {availableServicePresets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.entries.length} key)
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!selectedPresetId}
              onClick={() => void handleAttachServicePreset()}
              className="btn-press inline-flex h-7 items-center gap-1 rounded-[6px] bg-accent px-2.5 text-[11.5px] font-semibold text-accent-fg hover:opacity-95 disabled:opacity-45"
            >
              <Plus className="h-3 w-3" aria-hidden="true" />
              <span>Pasang</span>
            </button>
          </div>
        </div>

        <div className="mt-2.5 grid gap-3 sm:grid-cols-2">
          {/* Inherited Project Presets */}
          <div className="rounded-[8px] border border-border bg-surface-2/50 p-2.5">
            <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium text-fg-muted">
              <span>Diwariskan dari Project</span>
              <button
                type="button"
                onClick={() =>
                  setRoute({ kind: "project", projectId: service.projectId })
                }
                className="text-info hover:underline"
              >
                Atur di Project →
              </button>
            </div>
            {!inspection || inspection.projectPresets.length === 0 ? (
              <p className="text-[11.5px] text-fg-faint">
                Tidak ada shared preset di level project.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {inspection.projectPresets.map((p, idx) => (
                  <span
                    key={p.presetId}
                    className="inline-flex items-center gap-1 rounded-[6px] bg-warn-soft px-2 py-0.5 font-mono text-[11px] text-warn"
                  >
                    <span>#{idx + 1}</span>
                    <span>{p.presetName}</span>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Service Presets */}
          <div className="rounded-[8px] border border-border bg-surface-2/50 p-2.5">
            <div className="mb-1.5 text-[11px] font-medium text-fg-muted">
              Preset Khusus Service (Menimpa Project Preset)
            </div>
            {!inspection || inspection.servicePresets.length === 0 ? (
              <p className="text-[11.5px] text-fg-faint">
                Belum ada preset khusus untuk service ini.
              </p>
            ) : (
              <div className="space-y-1">
                {inspection.servicePresets.map((p, idx) => (
                  <div
                    key={p.presetId}
                    className="flex items-center justify-between gap-1.5 rounded-[6px] border border-border bg-surface px-2 py-1"
                  >
                    <span className="truncate font-mono text-[11.5px] text-fg">
                      <span className="mr-1 text-fg-faint">#{idx + 1}</span>
                      {p.presetName}
                    </span>
                    <div className="flex items-center gap-0.5">
                      <button
                        type="button"
                        aria-label={`Naikkan ${p.presetName}`}
                        disabled={idx === 0}
                        onClick={() => void handleMoveServicePreset(idx, -1)}
                        className="flex h-6 w-6 items-center justify-center rounded text-fg-muted hover:bg-surface-hover hover:text-fg disabled:opacity-35"
                      >
                        <ArrowUp className="h-3 w-3" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Turunkan ${p.presetName}`}
                        disabled={idx === inspection.servicePresets.length - 1}
                        onClick={() => void handleMoveServicePreset(idx, 1)}
                        className="flex h-6 w-6 items-center justify-center rounded text-fg-muted hover:bg-surface-hover hover:text-fg disabled:opacity-35"
                      >
                        <ArrowDown className="h-3 w-3" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Lepas ${p.presetName}`}
                        onClick={() =>
                          void handleDetachServicePreset(p.presetId, p.presetName)
                        }
                        className="flex h-6 w-6 items-center justify-center rounded text-danger hover:bg-danger-soft"
                      >
                        <X className="h-3 w-3" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
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
            onClick={() => setAddingKey((v) => !v)}
            className="btn-press flex h-8 items-center gap-1.5 rounded-[7px] border border-border-strong bg-surface px-2.5 text-[12px] font-medium text-fg-2 hover:bg-surface-hover hover:text-fg"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Tambah Key</span>
          </button>

          <button
            type="button"
            onClick={() => void loadEnv(mode)}
            className="btn-press flex h-8 items-center gap-1.5 rounded-[7px] border border-border bg-surface px-2.5 text-[12px] font-medium text-fg-muted hover:bg-surface-hover hover:text-fg"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Muat Ulang</span>
          </button>
        </div>

        <button
          type="button"
          onClick={() => setWritePanelOpen((v) => !v)}
          className="btn-press flex h-8 items-center gap-1.5 rounded-[7px] bg-accent px-3 text-[12px] font-semibold text-accent-fg hover:opacity-95"
        >
          <FileDown className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Tulis ke .env</span>
        </button>
      </div>

      {/* Write-to-.env confirmation panel */}
      {writePanelOpen ? (
        <div className="rounded-[10px] border border-info/40 bg-info-soft/40 p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[12.5px] font-semibold text-fg">
                Tulis seluruh resolved env ke file
              </p>
              <p className="mt-0.5 text-[11.5px] text-fg-muted">
                File tujuan yang sudah ada akan otomatis dibackup ke{" "}
                <code className="font-mono text-fg-2">{writeTargetFile}.bak</code> sebelum ditimpa.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <select
                aria-label="File target .env"
                value={writeTargetFile}
                onChange={(e) => setWriteTargetFile(e.target.value)}
                className="h-8 rounded-[7px] border border-border-strong bg-surface px-2 font-mono text-[12px] text-fg"
              >
                {targetFileOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={writing}
                onClick={() => void handleWriteAll()}
                className="btn-press h-8 rounded-[7px] bg-accent px-3 text-[12px] font-semibold text-accent-fg hover:opacity-95 disabled:opacity-50"
              >
                {writing ? "Menulis…" : "Tulis & Backup"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Inline add key form */}
      {addingKey ? (
        <form
          onSubmit={(e) => void handleAddKey(e)}
          className="rounded-[10px] border border-border-strong bg-surface p-3.5"
        >
          <div className="grid gap-2 sm:grid-cols-[1fr_1.4fr_auto_auto]">
            <input
              type="text"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder="NAMA_KEY"
              className="h-8 rounded-[7px] border border-border-strong bg-surface-2 px-2.5 font-mono text-[12px] text-fg placeholder:text-fg-faint"
            />
            <input
              type="text"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              placeholder="nilai"
              className="h-8 rounded-[7px] border border-border-strong bg-surface-2 px-2.5 font-mono text-[12px] text-fg placeholder:text-fg-faint"
            />
            <select
              aria-label="Target file"
              value={newTargetFile}
              onChange={(e) => setNewTargetFile(e.target.value)}
              className="h-8 rounded-[7px] border border-border-strong bg-surface-2 px-2 font-mono text-[12px] text-fg"
            >
              {targetFileOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="btn-press h-8 rounded-[7px] bg-accent px-3 text-[12px] font-semibold text-accent-fg hover:opacity-95"
            >
              Simpan
            </button>
          </div>
        </form>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="rounded-[8px] border border-danger/40 bg-danger-soft px-3 py-2 text-[12.5px] text-danger"
        >
          {error}
        </div>
      ) : null}

      {/* Missing keys from .env.example */}
      {inspection && inspection.missingKeys.length > 0 ? (
        <div
          role="alert"
          className="rounded-[10px] border border-warn/40 bg-warn-soft p-3.5"
        >
          <div className="flex items-center gap-2 text-[12.5px] font-semibold text-fg">
            <AlertTriangle className="h-4 w-4 text-warn" aria-hidden="true" />
            <span>
              {inspection.missingKeys.length} key dari{" "}
              <code className="font-mono">.env.example</code> belum terisi
            </span>
          </div>
          <div className="mt-2.5 space-y-2">
            {inspection.missingKeys.map((m) => (
              <div
                key={m.key}
                className="flex flex-wrap items-center gap-2 rounded-[7px] border border-border bg-surface p-2"
              >
                <span className="min-w-[160px] font-mono text-[12px] font-medium text-warn">
                  {m.key}
                </span>
                <input
                  type={m.isSecret && !revealSecrets ? "password" : "text"}
                  value={missingInputs[m.key] ?? ""}
                  onChange={(e) =>
                    setMissingInputs((prev) => ({ ...prev, [m.key]: e.target.value }))
                  }
                  placeholder={m.exampleValue || "Masukkan nilai…"}
                  className="h-7 min-w-0 flex-1 rounded-[6px] border border-border-strong bg-surface-2 px-2 font-mono text-[12px] text-fg"
                />
                <button
                  type="button"
                  onClick={() =>
                    void handleSaveSingleKey(
                      m.key,
                      ".env.local",
                      missingInputs[m.key] ?? "",
                    )
                  }
                  className="btn-press inline-flex h-7 items-center gap-1 rounded-[6px] bg-accent px-2.5 text-[11.5px] font-semibold text-accent-fg hover:opacity-95"
                >
                  <Check className="h-3 w-3" aria-hidden="true" />
                  <span>Simpan ke .env.local</span>
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Resolved env table */}
      <div className="overflow-hidden rounded-[10px] border border-border bg-surface">
        {loading && !inspection ? (
          <div className="space-y-2 p-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="skeleton-shimmer h-10 rounded-[6px]" />
            ))}
          </div>
        ) : !inspection || inspection.entries.length === 0 ? (
          <div className="p-6 text-center text-[13px] text-fg-muted">
            <FileCode2 className="mx-auto mb-2 h-6 w-6 text-fg-faint" aria-hidden="true" />
            Belum ada variabel environment di file <code className="font-mono">.env*</code> untuk mode{" "}
            <code className="font-mono">{mode}</code>.
          </div>
        ) : (
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-border bg-surface-2 text-[11.5px] font-semibold tracking-wide text-fg-muted uppercase">
                <th className="px-3.5 py-2.5">Key</th>
                <th className="px-3.5 py-2.5">Nilai</th>
                <th className="px-3.5 py-2.5">Sumber</th>
                <th className="px-3.5 py-2.5 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border text-[12.5px]">
              {inspection.entries.map((entry) => {
                const draftVal = drafts[entry.key] ?? entry.value;
                const isDirty = draftVal !== entry.value;
                const masked = entry.isSecret && !revealSecrets;

                return (
                  <tr
                    key={entry.key}
                    className="transition-colors hover:bg-surface-hover/30"
                  >
                    <td className="px-3.5 py-2 align-middle">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono font-medium text-fg select-text">
                          {entry.key}
                        </span>
                        {entry.isSecret ? (
                          <span
                            className="inline-flex items-center gap-0.5 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-fg-muted"
                            title="Terdeteksi sebagai nilai sensitif"
                          >
                            <Lock className="h-2.5 w-2.5" aria-hidden="true" />
                            secret
                          </span>
                        ) : null}
                        {entry.isUnknown ? (
                          <span
                            className="rounded bg-warn-soft px-1.5 py-0.5 text-[10px] font-medium text-warn"
                            title="Key ini tidak ada di .env.example"
                          >
                            tidak ada di .env.example
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3.5 py-2 align-middle">
                      <input
                        type={masked ? "password" : "text"}
                        aria-label={`Nilai untuk ${entry.key}`}
                        value={draftVal}
                        onChange={(e) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [entry.key]: e.target.value,
                          }))
                        }
                        className="h-7 w-full min-w-[180px] rounded-[6px] border border-transparent bg-surface-2 px-2 font-mono text-[12px] text-fg hover:border-border-strong focus:border-info"
                      />
                    </td>
                    <td className="px-3.5 py-2 align-middle">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[11px]",
                          entry.layerKind === "project_preset"
                            ? "bg-warn-soft text-warn"
                            : entry.layerKind === "service_preset"
                              ? "bg-accent-soft text-accent"
                              : entry.layerKind === "port"
                                ? "bg-surface-2 font-semibold text-fg"
                                : entry.layerKind === "shell"
                                  ? "bg-surface-2 text-fg-muted"
                                  : "bg-info-soft text-info",
                        )}
                      >
                        {entry.source}
                      </span>
                      {entry.overriddenSources.length > 0 ? (
                        <span
                          className="ml-1.5 text-[10.5px] text-fg-faint"
                          title={`Menimpa ${entry.overriddenSources.join(", ")}`}
                        >
                          (timpa {entry.overriddenSources.join(", ")})
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3.5 py-2 text-right align-middle">
                      <div className="inline-flex items-start justify-end gap-1.5">
                        {entry.detectedDbKind ? (
                          <DbTestButton
                            envKey={entry.key}
                            onTest={() =>
                              testServiceDbConnection(
                                service.id,
                                entry.key,
                                mode,
                                isDirty ? draftVal : undefined,
                              )
                            }
                          />
                        ) : null}
                        <button
                          type="button"
                          disabled={!isDirty}
                          onClick={() =>
                            void handleSaveSingleKey(
                              entry.key,
                              entry.layerKind === "file" ? entry.source : ".env.local",
                              draftVal,
                            )
                          }
                          title={
                            entry.layerKind === "file"
                              ? `Simpan perubahan ke ${entry.source}`
                              : "Simpan sebagai override ke .env.local"
                          }
                          className="btn-press inline-flex h-7 items-center gap-1 rounded-[6px] border border-border-strong bg-surface-2 px-2 text-[11.5px] font-medium text-fg hover:bg-surface-hover disabled:opacity-35"
                        >
                          <Save className="h-3 w-3" aria-hidden="true" />
                          <span>Simpan</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
