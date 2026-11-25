import { useId, useState } from "react";
import { Pause, Play } from "lucide-react";
import { cn } from "@/lib/cn";

export interface TelemetryPoint {
  timestampMs: number;
  value: number;
}

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
          aria-label={paused ? `Resume ${title} chart` : `Pause ${title} chart`}
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
          aria-label={`${title}: ${currentText}, peak ${peakText}, status ${statusText}`}
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
        <span className="font-mono tabular-nums">Peak: {peakText}</span>
        <span>{paused ? "Paused" : statusText}</span>
      </div>
    </div>
  );
}

interface TelemetryAreaChartProps {
  title: string;
  currentText: string;
  peakText: string;
  avgText: string;
  subtitle: string;
  points: TelemetryPoint[];
  formatValue: (value: number) => string;
  strokeColorVar: string;
  paused: boolean;
  isLive: boolean;
  onTogglePause: () => void;
  windowLabel?: string;
}

function formatTimeShort(tsMs: number): string {
  if (!tsMs) return "";
  const d = new Date(tsMs);
  return d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function TelemetryAreaChart({
  title,
  currentText,
  peakText,
  avgText,
  subtitle,
  points,
  formatValue,
  strokeColorVar,
  paused,
  isLive,
  onTogglePause,
  windowLabel = "15m",
}: TelemetryAreaChartProps) {
  const gradId = useId();
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const width = 320;
  const height = 84;
  const padTop = 8;
  const padBottom = 6;
  const usableH = height - padTop - padBottom;

  const series: TelemetryPoint[] =
    points.length >= 2
      ? points
      : points.length === 1
        ? [points[0], points[0]]
        : [
            { timestampMs: 0, value: 0 },
            { timestampMs: 0, value: 0 },
          ];

  const maxVal = Math.max(...series.map((p) => p.value), 1);

  const coords = series.map((p, idx) => {
    const x = (idx / (series.length - 1)) * width;
    const clamped = Math.max(0, p.value);
    const y = padTop + usableH - (clamped / maxVal) * usableH;
    return { x, y, point: p };
  });

  const linePath = coords
    .map((c, idx) => `${idx === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`)
    .join(" ");
  const areaPath = `${linePath} L${width},${height} L0,${height} Z`;

  const hovered = hoverIdx !== null ? coords[hoverIdx] : null;
  const hasRealSamples = points.length > 0;

  return (
    <div className="flex flex-col justify-between rounded-[10px] border border-border bg-surface p-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-medium text-fg-muted">{title}</span>
            <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-fg-faint">
              {windowLabel}
            </span>
            {paused ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-warn-soft px-1.5 py-0.5 text-[10px] font-medium text-warn">
                Paused
              </span>
            ) : isLive ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
                Live · 2s
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-fg-faint">
                Idle
              </span>
            )}
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-mono text-[22px] font-semibold leading-tight text-fg tabular-nums">
              {hovered && hasRealSamples ? formatValue(hovered.point.value) : currentText}
            </span>
            {hovered && hasRealSamples && hovered.point.timestampMs > 0 ? (
              <span className="font-mono text-[11px] text-fg-faint tabular-nums">
                @ {formatTimeShort(hovered.point.timestampMs)}
              </span>
            ) : (
              <span className="truncate text-[11.5px] text-fg-faint">{subtitle}</span>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={onTogglePause}
          aria-label={paused ? `Resume ${title} chart` : `Pause ${title} chart`}
          title={paused ? "Resume live chart" : "Pause live chart"}
          className="btn-press inline-flex h-6 shrink-0 items-center gap-1 rounded-[6px] border border-border-strong bg-surface-2 px-2 text-[10.5px] font-medium text-fg-muted hover:bg-surface-hover hover:text-fg"
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

      {/* Interactive SVG Area Chart */}
      <div
        className="relative mt-3"
        onMouseLeave={() => setHoverIdx(null)}
        onMouseMove={(e) => {
          if (!hasRealSamples) return;
          const rect = e.currentTarget.getBoundingClientRect();
          if (rect.width <= 0) return;
          const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
          const idx = Math.round(ratio * (coords.length - 1));
          setHoverIdx(idx);
        }}
      >
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`${title}: current ${currentText}, peak ${peakText}, average ${avgText}`}
          className="h-[84px] w-full overflow-visible"
        >
          <defs>
            <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={strokeColorVar} stopOpacity="0.26" />
              <stop offset="100%" stopColor={strokeColorVar} stopOpacity="0.01" />
            </linearGradient>
          </defs>

          {/* Subtle horizontal guide lines */}
          {[0.25, 0.5, 0.75].map((pct) => {
            const y = padTop + usableH * pct;
            return (
              <line
                key={pct}
                x1="0"
                y1={y}
                x2={width}
                y2={y}
                stroke="var(--border)"
                strokeDasharray="3 3"
                strokeWidth="1"
              />
            );
          })}

          <path d={areaPath} fill={`url(#${gradId})`} />
          <path
            d={linePath}
            fill="none"
            stroke={strokeColorVar}
            strokeWidth="1.75"
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {/* Hover crosshair */}
          {hovered && hasRealSamples ? (
            <>
              <line
                x1={hovered.x}
                y1={padTop}
                x2={hovered.x}
                y2={height}
                stroke="var(--border-strong)"
                strokeDasharray="2 2"
                strokeWidth="1"
              />
              <circle
                cx={hovered.x}
                cy={hovered.y}
                r="3.25"
                fill={strokeColorVar}
                stroke="var(--surface)"
                strokeWidth="1.5"
              />
            </>
          ) : null}
        </svg>
      </div>

      {/* Footer stats */}
      <div className="mt-2.5 flex items-center justify-between border-t border-border pt-2 font-mono text-[11px] text-fg-faint tabular-nums">
        <span>
          Peak <span className="text-fg-2">{peakText}</span>
        </span>
        <span>
          Avg <span className="text-fg-2">{avgText}</span>
        </span>
      </div>
    </div>
  );
}
