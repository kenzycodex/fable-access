"use client";

import { useState } from "react";

/**
 * Charts for the console, drawn in plain SVG.
 *
 * There is no chart library on purpose. The console draws a handful of simple
 * shapes (a grouped bar chart, a donut, a sparkline), and a library would add
 * hundreds of kilobytes for them. Colours come in as props so status hues stay
 * reserved for status: green is "passed", amber is "flagged", red is "blocked",
 * and nothing else borrows them.
 */

export interface BarSeries {
  key: string;
  label: string;
  color: string;
}

export interface BarDatum {
  label: string;
  /** One value per series, in the same order as `series`. */
  values: number[];
}

/** Round an axis maximum up to a tidy number so the gridlines read cleanly. */
function niceMax(value: number): number {
  if (value <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(value)));
  const n = value / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

/**
 * A grouped or stacked bar chart with horizontal gridlines and a hover readout.
 * Stacked is the right shape for "decisions per day split by outcome".
 */
export function BarChart({
  data,
  series,
  height = 220,
  stacked = true,
  empty = "No data yet",
}: {
  data: BarDatum[];
  series: BarSeries[];
  height?: number;
  stacked?: boolean;
  empty?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const totals = data.map((d) => (stacked ? d.values.reduce((a, b) => a + b, 0) : Math.max(...d.values, 0)));
  const max = niceMax(Math.max(...totals, 0));
  const hasData = totals.some((t) => t > 0);

  if (data.length === 0 || !hasData) {
    return (
      <div className="flex items-center justify-center text-[13px] text-d-faint" style={{ height }}>
        {empty}
      </div>
    );
  }

  const W = 640;
  const padL = 34;
  const padB = 24;
  const padT = 8;
  const plotW = W - padL;
  const plotH = height - padB - padT;
  const slot = plotW / data.length;
  const barW = Math.min(stacked ? 26 : 12, slot * 0.6);
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  // Label every nth day so the axis never turns into a smear.
  const every = Math.max(1, Math.ceil(data.length / 8));

  const y = (v: number) => padT + plotH - (v / max) * plotH;

  return (
    <div className="relative w-full">
      <svg viewBox={`0 0 ${W} ${height}`} className="w-full" role="img" aria-label="Bar chart">
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={padL}
              x2={W}
              y1={y(max * t)}
              y2={y(max * t)}
              stroke="currentColor"
              className="text-d-border"
              strokeDasharray={t === 0 ? undefined : "3 4"}
            />
            <text x={padL - 6} y={y(max * t) + 3} textAnchor="end" className="fill-d-faint" fontSize="10">
              {Math.round(max * t).toLocaleString("en-NG")}
            </text>
          </g>
        ))}

        {data.map((d, i) => {
          const cx = padL + slot * i + slot / 2;
          let acc = 0;
          return (
            <g key={`${d.label}-${i}`} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              {/* A wide invisible target so a short bar is still easy to hover. */}
              <rect x={cx - slot / 2} y={padT} width={slot} height={plotH} fill="transparent" />
              {d.values.map((v, s) => {
                if (v <= 0) return null;
                if (stacked) {
                  const top = y(acc + v);
                  const h = y(acc) - top;
                  acc += v;
                  return (
                    <rect
                      key={series[s].key}
                      x={cx - barW / 2}
                      y={top}
                      width={barW}
                      height={Math.max(h, 1)}
                      rx={s === d.values.length - 1 || acc === totals[i] ? 5 : 1}
                      fill={series[s].color}
                      opacity={hover === null || hover === i ? 1 : 0.35}
                    />
                  );
                }
                const off = (s - (d.values.length - 1) / 2) * (barW + 3);
                return (
                  <rect
                    key={series[s].key}
                    x={cx + off - barW / 2}
                    y={y(v)}
                    width={barW}
                    height={Math.max(y(0) - y(v), 1)}
                    rx={4}
                    fill={series[s].color}
                    opacity={hover === null || hover === i ? 1 : 0.35}
                  />
                );
              })}
              {i % every === 0 && (
                <text x={cx} y={height - 6} textAnchor="middle" className="fill-d-faint" fontSize="10">
                  {d.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {hover !== null && (
        <div
          className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 rounded-xl border border-d-border bg-d-surface px-3 py-2 text-[11px] shadow-lg"
          style={{ left: `${((padL + slot * hover + slot / 2) / W) * 100}%` }}
        >
          <p className="mb-1 font-semibold text-d-text">{data[hover].label}</p>
          {series.map((s, i) => (
            <p key={s.key} className="flex items-center gap-1.5 text-d-muted">
              <span className="size-2 rounded-full" style={{ backgroundColor: s.color }} />
              {s.label}
              <span className="ml-auto pl-3 font-semibold tabular-nums text-d-text">{data[hover].values[i]}</span>
            </p>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5 text-[12px] text-d-muted">
            <span className="size-2.5 rounded-full" style={{ backgroundColor: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

/** A donut with the total in the middle. Segments with no value are skipped. */
export function DonutChart({
  segments,
  centerValue,
  centerLabel,
  size = 168,
}: {
  segments: DonutSegment[];
  centerValue: string;
  centerLabel: string;
  size?: number;
}) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  const r = 54;
  const c = 2 * Math.PI * r;
  const GAP = total > 0 && segments.filter((s) => s.value > 0).length > 1 ? 3 : 0;
  let offset = 0;

  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      <svg viewBox="0 0 140 140" className="size-full -rotate-90" role="img" aria-label={`${centerLabel}: ${centerValue}`}>
        <circle cx="70" cy="70" r={r} fill="none" strokeWidth="16" stroke="currentColor" className="text-d-surface-2" />
        {total > 0 &&
          segments.map((s) => {
            if (s.value <= 0) return null;
            const len = (s.value / total) * c;
            const dash = Math.max(len - GAP, 0.5);
            const el = (
              <circle
                key={s.label}
                cx="70"
                cy="70"
                r={r}
                fill="none"
                strokeWidth="16"
                stroke={s.color}
                strokeLinecap="round"
                strokeDasharray={`${dash} ${c - dash}`}
                strokeDashoffset={-offset}
                style={{ transition: "stroke-dasharray 0.6s ease" }}
              />
            );
            offset += len;
            return el;
          })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-[26px] font-bold leading-none tracking-tight text-d-text">{centerValue}</span>
        <span className="mt-1 text-[11px] font-medium text-d-muted">{centerLabel}</span>
      </div>
    </div>
  );
}

/** A tiny trend line: shape only, no axes. The latest point carries a dot. */
export function Sparkline({
  points,
  color = "#7c3aed",
  className = "",
}: {
  points: number[];
  color?: string;
  className?: string;
}) {
  if (points.length < 2) return null;
  const w = 96;
  const h = 32;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const span = max - min || 1;
  const step = w / (points.length - 1);
  const xy = points.map((p, i) => [i * step, h - ((p - min) / span) * (h - 6) - 3] as const);
  const line = xy.map(([x, yv], i) => `${i ? "L" : "M"}${x.toFixed(1)},${yv.toFixed(1)}`).join(" ");
  const area = `${line} L${w},${h} L0,${h} Z`;
  const [lx, ly] = xy[xy.length - 1];

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={`h-8 w-24 overflow-visible ${className}`} fill="none" aria-hidden="true" focusable="false">
      <path d={area} fill={color} opacity={0.1} />
      <path d={line} stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lx} cy={ly} r={3} fill={color} />
    </svg>
  );
}

/** A horizontal bar list for breakdowns (channels, scam patterns, signals). */
export function BarList({
  items,
  emptyLabel = "No data yet",
  color = "#7c3aed",
}: {
  items: { label: string; count: number; hint?: string }[];
  emptyLabel?: string;
  color?: string;
}) {
  if (items.length === 0) {
    return <p className="py-8 text-center text-[13px] text-d-faint">{emptyLabel}</p>;
  }
  const max = Math.max(...items.map((i) => i.count), 1);
  return (
    <div className="flex flex-col gap-4">
      {items.map((item) => (
        <div key={item.label}>
          <div className="mb-1.5 flex items-center justify-between gap-3 text-[13px]">
            <span className="min-w-0 truncate font-medium text-d-text">{item.label}</span>
            <span className="shrink-0 font-semibold tabular-nums text-d-text">
              {item.count.toLocaleString("en-NG")}
              {item.hint && <span className="ml-1.5 text-[11px] font-normal text-d-faint">{item.hint}</span>}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-d-surface-2">
            <div className="h-full rounded-full" style={{ width: `${Math.max(Math.round((item.count / max) * 100), 3)}%`, backgroundColor: color }} />
          </div>
        </div>
      ))}
    </div>
  );
}
