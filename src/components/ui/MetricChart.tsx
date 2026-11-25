import { useId } from "react";
import { Pause, Play } from "lucide-react";
import { cn } from "@/lib/cn";

interface SparklineProps {
  values: number[];
  max?: number;
  strokeClass?: string;
  fillClass?: string;
  label: string;
  className?: string;
}

export function Sparkline({
  values,
  max,
  strokeClass = "stroke-info",
  fillClass = "fill-info/15",
  label,
  className,
}: SparklineProps) {
  const width = 96;
  const height = 28;
  const pts = values.length > 0 ? values : [0, 0];
  const peak = Math.max(max ?? 0, ...pts, 1);

  const coords = pts.map((v, idx) => {
    const x = pts.length === 1 ? width : (idx / (pts.length - 1)) * width;
    const clamped = Math.max(0, Math.min(v, peak));
    const y = height - 2 - (clamped / peak) * (height - 4);
    return { x, y };
  });

  const linePath = coords
    .map((c, idx) => `${idx === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`)
    .join(" ");
  const areaPath = `${linePath} L${width},${height} L0,${height} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label}
      className={cn("overflow-visible", className)}
    >
      <path d={areaPath} className={fillClass} />
      <path
        d={linePath}
        fill="none"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        className={strokeClass}
      />
    </svg>
  );
}

interface MetricChartCardProps {
  title: string;
  currentText: string;
  peakText: string;
  statusText: string;
  values: number[];
  strokeColorVar: string;
  paused: boolean;
  onTogglePause: () => void;
}

export function MetricChartCard({
  title,
  currentText,
  peakText,
  statusText,
  values,
  strokeColorVar,
  paused,
  onTogglePause,
}: MetricChartCardProps) {
  const gradId = useId();
  const width = 236;
  const height = 64;
  const pts = values.length >= 2 ? values : [values[0] ?? 0, values[0] ?? 0];
  const peak = Math.max(...pts, 1);

  const coords = pts.map((v, idx) => {
    const x = (idx / (pts.length - 1)) * width;
    const clamped = Math.max(0, v);
    const y = height - 4 - (clamped / peak) * (height - 10);
    return { x, y };
  });

  const linePath = coords
    .map((c, idx) => `${idx === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`)
    .join(" ");
  const areaPath = `${linePath} L${width},${height} L0,${height} Z`;

  return (
    <div className="rounded-[10px] border border-border bg-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-fg-muted">
            <span>{title}</span>
            <span className="rounded bg-surface-2 px-1 py-0.2 font-mono text-[10px] text-fg-faint">
              15m
            </span>
          </div>
          <div className="mt-0.5 font-mono text-[16px] font-semibold text-fg tabular-nums">
            {currentText}
          </div>
        </div>
        <button
          type="button"
          onClick={onTogglePause}
          aria-label={paused ? `Lanjutkan grafik ${title}` : `Jeda grafik ${title}`}
          title={paused ? "Resume sampling" : "Pause chart"}
          className="btn-press inline-flex h-6 items-center gap-1 rounded-[6px] border border-border-strong bg-surface-2 px-1.5 text-[10.5px] font-medium text-fg-muted hover:bg-surface-hover hover:text-fg"
        >
          {paused ? (
            <>
              <Play className="h-2.5 w-2.5 fill-current" aria-hidden="true" />
              <span>Resume</span>
            </>
          ) : (
            <>
              <Pause className="h-2.5 w-2.5" aria-hidden="true" />
              <span>Pause</span>
            </>
          )}
        </button>
      </div>

      <div className="mt-2">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`${title}: ${currentText}, puncak ${peakText}, status ${statusText}`}
          className="h-16 w-full"
        >
          <defs>
            <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={strokeColorVar} stopOpacity="0.28" />
              <stop offset="100%" stopColor={strokeColorVar} stopOpacity="0.02" />
            </linearGradient>
          </defs>
          <line
            x1="0"
            y1={height / 2}
            x2={width}
            y2={height / 2}
            stroke="var(--border)"
            strokeDasharray="3 3"
            strokeWidth="1"
          />
          <path d={areaPath} fill={`url(#${gradId})`} />
          <path
            d={linePath}
            fill="none"
            stroke={strokeColorVar}
            strokeWidth="1.75"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </svg>
      </div>

      <div className="mt-1.5 flex items-center justify-between text-[11px] text-fg-faint">
        <span className="font-mono tabular-nums">Puncak: {peakText}</span>
        <span>{paused ? "Dijeda" : statusText}</span>
      </div>
    </div>
  );
}
