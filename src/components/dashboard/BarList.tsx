/** A simple horizontal bar list for breakdowns (channels, patterns, signals).
 * No chart library, just proportional divs against the max value. */
export function BarList({
  items,
  emptyLabel = "No data yet",
  accent = "var(--color-secondary)",
}: {
  items: { label: string; count: number; hint?: string }[];
  emptyLabel?: string;
  accent?: string;
}) {
  if (items.length === 0) {
    return <p className="py-6 text-center text-sm text-gray-500 dark:text-white/40">{emptyLabel}</p>;
  }
  const max = Math.max(...items.map((i) => i.count), 1);

  return (
    <div className="flex flex-col gap-3">
      {items.map((item) => (
        <div key={item.label} className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-gray-800 dark:text-white/80">{item.label}</span>
            <span className="tabular-nums font-bold text-gray-900 dark:text-white">
              {item.count}
              {item.hint && <span className="ml-1.5 text-xs font-normal text-gray-400 dark:text-white/40">{item.hint}</span>}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-white/10">
            <div
              className="h-full rounded-full"
              style={{ width: `${Math.round((item.count / max) * 100)}%`, backgroundColor: accent }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
