import { type LucideIcon } from "lucide-react";

interface PlaceholderViewProps {
  title: string;
  description: string;
  waveLabel: string;
  icon: LucideIcon;
}

export function PlaceholderView({
  title,
  description,
  waveLabel,
  icon: Icon,
}: PlaceholderViewProps) {
  return (
    <div className="animate-view-enter mx-auto max-w-4xl p-6">
      <div className="rounded-[12px] border border-border bg-surface p-6">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-surface-2 text-info">
            <Icon className="h-4.5 w-4.5" strokeWidth={1.85} aria-hidden="true" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-[16px] font-semibold text-fg">{title}</h1>
              <span className="rounded-full bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-fg-muted">
                {waveLabel}
              </span>
            </div>
            <p className="mt-1 text-[13px] text-fg-muted">{description}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
