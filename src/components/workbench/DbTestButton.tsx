import { useState } from "react";
import { CheckCircle2, Database, Loader2, XCircle } from "lucide-react";
import { type DbTestResult } from "@/lib/tauri";

interface DbTestButtonProps {
  envKey: string;
  onTest: () => Promise<DbTestResult>;
}

export function DbTestButton({ envKey, onTest }: DbTestButtonProps) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<DbTestResult | null>(null);

  const handleClick = async () => {
    setTesting(true);
    try {
      const res = await onTest();
      setResult(res);
    } catch (err) {
      setResult({
        key: envKey,
        kind: "postgres",
        ok: false,
        latencyMs: 0,
        serverInfo: null,
        error: err instanceof Error ? err.message : String(err),
        displayTarget: "",
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={testing}
        onClick={() => void handleClick()}
        aria-label={`Test database connection for ${envKey}`}
        className="btn-press inline-flex h-7 items-center gap-1.5 rounded-[6px] border border-info/40 bg-info-soft px-2 text-[11.5px] font-medium text-info hover:opacity-90 disabled:cursor-wait disabled:opacity-65"
      >
        {testing ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            <span>Connecting…</span>
          </>
        ) : (
          <>
            <Database className="h-3 w-3" aria-hidden="true" />
            <span>Test DB</span>
          </>
        )}
      </button>

      {result && !testing ? (
        result.ok ? (
          <div
            className="inline-flex items-center gap-1 rounded bg-accent-soft px-1.5 py-0.5 font-mono text-[10.5px] text-accent tabular-nums"
            title={result.displayTarget || undefined}
          >
            <CheckCircle2 className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span>
              {result.serverInfo ?? "OK"} · {result.latencyMs}ms
            </span>
          </div>
        ) : (
          <div
            className="inline-flex max-w-[260px] items-center gap-1 rounded bg-danger-soft px-1.5 py-0.5 text-[10.5px] text-danger"
            title={result.error ?? "Connection failed"}
          >
            <XCircle className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="truncate">{result.error ?? "Connection failed"}</span>
          </div>
        )
      ) : null}
    </div>
  );
}
