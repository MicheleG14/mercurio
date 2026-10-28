import { cn } from '@/lib/utils';

/**
 * How much of something is done, "3 / 5", with a thin bar under it. The text says it all (F5):
 * the bar only helps the eye down a column. Numbers are already formatted by the caller.
 */
export function ProgressCell({
  done,
  total,
  ratio,
  label,
  className,
}: {
  done: string;
  total: string;
  /** 0 to 1. */
  ratio: number;
  /** What the figures are, for screen readers: "shipped 3 of 5". */
  label: string;
  className?: string;
}) {
  const percent = Math.round(Math.min(Math.max(ratio, 0), 1) * 100);
  return (
    <span className={cn('inline-flex min-w-20 flex-col gap-1', className)} aria-label={label}>
      <span className="tabular-nums" aria-hidden="true">
        {done} / {total}
      </span>
      <span className="bg-muted h-1 w-full overflow-hidden rounded-full" aria-hidden="true">
        <span
          className={cn('block h-full rounded-full', percent === 100 ? 'bg-success' : 'bg-primary')}
          style={{ width: `${percent}%` }}
        />
      </span>
    </span>
  );
}
