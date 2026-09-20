"use client";

import { useCallback, useState } from "react";
import { fmtMoney } from "@/lib/money";
import type { Bucket } from "@/lib/stats";

/* ============================================================================
   Charts follow the house rules: one axis, thin marks capped at 24px with a
   4px rounded data-end, a 2px surface gap between neighbours, hairline
   recessive gridlines, selective direct labels, and a hover layer on every
   mark. Money uses the blue<->red DIVERGING pair (gray at zero), never a
   categorical hue — the sign is the information.
   ========================================================================== */

type Tip = { x: number; y: number; lines: string[] } | null;

function useTip() {
  const [tip, setTip] = useState<Tip>(null);
  const show = useCallback((e: React.MouseEvent, lines: string[]) => {
    setTip({ x: e.clientX, y: e.clientY, lines });
  }, []);
  const hide = useCallback(() => setTip(null), []);
  return { tip, show, hide };
}

function TipBox({ tip }: { tip: Tip }) {
  if (!tip) return null;
  // Flip to the left of the cursor near the right edge so it never clips.
  const flip = typeof window !== "undefined" && tip.x > window.innerWidth - 200;
  return (
    <div
      className="viz-tip"
      style={{
        left: flip ? undefined : tip.x + 12,
        right: flip ? window.innerWidth - tip.x + 12 : undefined,
        top: tip.y + 12,
      }}
    >
      {tip.lines.map((l, i) => (
        <div key={i} style={{ color: i === 0 ? "var(--ink)" : "var(--ink-2)" }}>
          {l}
        </div>
      ))}
    </div>
  );
}

/** A bar/column with only its data-end rounded; the baseline end stays square. */
function endRoundedPath(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  dir: "up" | "down" | "right" | "left",
): string {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  if (h <= 0 || w <= 0) return "";
  if (dir === "up") {
    return `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h} Z`;
  }
  if (dir === "down") {
    return `M${x},${y} L${x},${y + h - rr} Q${x},${y + h} ${x + rr},${y + h} L${x + w - rr},${y + h} Q${x + w},${y + h} ${x + w},${y + h - rr} L${x + w},${y} Z`;
  }
  // horizontal bars: x/y/w/h describe the rect, rounding the far end
  const ry = Math.max(0, Math.min(r, h / 2, w));
  if (dir === "right") {
    return `M${x},${y} L${x + w - ry},${y} Q${x + w},${y} ${x + w},${y + ry} L${x + w},${y + h - ry} Q${x + w},${y + h} ${x + w - ry},${y + h} L${x},${y + h} Z`;
  }
  return `M${x + w},${y} L${x + ry},${y} Q${x},${y} ${x},${y + ry} L${x},${y + h - ry} Q${x},${y + h} ${x + ry},${y + h} L${x + w},${y + h} Z`;
}

function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (v <= m * mag) return m * mag;
  return 10 * mag;
}

/* ---------------------------------------------------------------------- */

/**
 * Net profit/loss per week — columns diverging from a zero baseline. The only
 * direct labels are the best and worst weeks; the rest live in the tooltip.
 */
export function WeeklyPL({ buckets }: { buckets: Bucket[] }) {
  const { tip, show, hide } = useTip();
  if (buckets.length === 0) {
    return <p className="py-6 text-center text-sm" style={{ color: "var(--muted)" }}>No settled bets yet.</p>;
  }

  const W = 720;
  const H = 220;
  const PAD = { t: 18, r: 14, b: 26, l: 52 };
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;

  const maxAbs = niceCeil(Math.max(...buckets.map((b) => Math.abs(b.netCents)), 1) / 100) * 100;
  const zeroY = PAD.t + plotH / 2;
  const scale = (cents: number) => (cents / maxAbs) * (plotH / 2);

  const band = plotW / buckets.length;
  const barW = Math.min(24, Math.max(6, band - 10));

  const best = buckets.reduce((a, b) => (b.netCents > a.netCents ? b : a));
  const worst = buckets.reduce((a, b) => (b.netCents < a.netCents ? b : a));

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: "auto" }} role="img"
           aria-label="Net profit or loss by week">
        {[1, 0.5, 0, -0.5, -1].map((f) => {
          const y = zeroY - f * (plotH / 2);
          return (
            <g key={f}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y} y2={y} stroke="var(--line)" strokeWidth={1} />
              <text x={PAD.l - 8} y={y + 3.5} textAnchor="end" fontSize={10} className="tnum"
                    fill="var(--muted)">
                {fmtMoney(f * maxAbs)}
              </text>
            </g>
          );
        })}
        <line x1={PAD.l} x2={W - PAD.r} y1={zeroY} y2={zeroY} stroke="var(--line-strong)" strokeWidth={1} />

        {buckets.map((b, i) => {
          const cx = PAD.l + band * i + band / 2;
          const x = cx - barW / 2;
          const h = Math.abs(scale(b.netCents));
          const up = b.netCents >= 0;
          // The 2px surface gap: a column never touches the zero rule.
          const y = up ? zeroY - h : zeroY + 2;
          const hh = Math.max(h - 2, 0);
          const isLabeled = b.key === best.key || b.key === worst.key;
          return (
            <g key={b.key}>
              <path
                className="viz-mark"
                d={endRoundedPath(x, up ? y : zeroY + 2, barW, hh, 4, up ? "up" : "down")}
                fill={up ? "var(--pos)" : "var(--neg)"}
              />
              {isLabeled && hh > 0 && (
                <text
                  x={cx}
                  y={up ? y - 5 : zeroY + hh + 14}
                  textAnchor="middle"
                  fontSize={10}
                  fontWeight={600}
                  className="tnum"
                  fill="var(--ink-2)"
                >
                  {fmtMoney(b.netCents, { sign: true })}
                </text>
              )}
              <rect
                className="viz-hit"
                x={cx - band / 2}
                y={PAD.t}
                width={band}
                height={plotH}
                onMouseMove={(e) =>
                  show(e, [
                    b.label,
                    `Net ${fmtMoney(b.netCents, { sign: true })}`,
                    `${b.bets} bet${b.bets === 1 ? "" : "s"} · ${b.won}-${b.lost} · ${fmtMoney(b.wageredCents)} wagered`,
                  ])
                }
                onMouseLeave={hide}
              />
              <text x={cx} y={H - 8} textAnchor="middle" fontSize={10} fill="var(--muted)">
                {b.label.replace("Week ", "W")}
              </text>
            </g>
          );
        })}
      </svg>
      <TipBox tip={tip} />
    </div>
  );
}

/* ---------------------------------------------------------------------- */

/** Running net P/L in settle order — a single 2px line with an end marker. */
export function EquityCurve({ points }: { points: { at: string; netCents: number }[] }) {
  const { tip, show, hide } = useTip();
  if (points.length < 2) {
    return (
      <p className="py-6 text-center text-sm" style={{ color: "var(--muted)" }}>
        Two settled bets are needed to draw a curve.
      </p>
    );
  }

  const W = 720;
  const H = 200;
  const PAD = { t: 16, r: 58, b: 24, l: 52 };
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;

  const vals = points.map((p) => p.netCents);
  const maxAbs = niceCeil(Math.max(...vals.map(Math.abs), 1) / 100) * 100;
  const zeroY = PAD.t + plotH / 2;
  const xAt = (i: number) => PAD.l + (plotW * i) / (points.length - 1);
  const yAt = (c: number) => zeroY - (c / maxAbs) * (plotH / 2);

  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${xAt(i)},${yAt(p.netCents)}`).join(" ");
  const last = points[points.length - 1];
  const lastUp = last.netCents >= 0;
  const stroke = lastUp ? "var(--pos)" : "var(--neg)";

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Running net profit and loss">
        {[1, 0, -1].map((f) => {
          const y = zeroY - f * (plotH / 2);
          return (
            <g key={f}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y} y2={y}
                    stroke={f === 0 ? "var(--line-strong)" : "var(--line)"} strokeWidth={1} />
              <text x={PAD.l - 8} y={y + 3.5} textAnchor="end" fontSize={10} className="tnum" fill="var(--muted)">
                {fmtMoney(f * maxAbs)}
              </text>
            </g>
          );
        })}

        <path d={d} fill="none" stroke={stroke} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

        {/* End marker carries a 2px surface ring so it reads over the line. */}
        <circle cx={xAt(points.length - 1)} cy={yAt(last.netCents)} r={4.5} fill={stroke}
                stroke="var(--surface)" strokeWidth={2} />
        <text x={xAt(points.length - 1) + 10} y={yAt(last.netCents) + 4} fontSize={11} fontWeight={600}
              className="tnum" fill="var(--ink-2)">
          {fmtMoney(last.netCents, { sign: true })}
        </text>

        {points.map((p, i) => (
          <rect
            key={i}
            className="viz-hit"
            x={xAt(i) - plotW / (points.length - 1) / 2}
            y={PAD.t}
            width={plotW / (points.length - 1)}
            height={plotH}
            onMouseMove={(e) =>
              show(e, [
                `Bet ${i + 1} of ${points.length}`,
                `Running ${fmtMoney(p.netCents, { sign: true })}`,
                new Date(p.at).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
              ])
            }
            onMouseLeave={hide}
          />
        ))}
      </svg>
      <TipBox tip={tip} />
    </div>
  );
}

/* ---------------------------------------------------------------------- */

/** Net by team — horizontal diverging bars, sorted best to worst. */
export function TeamBars({ buckets, limit = 10 }: { buckets: Bucket[]; limit?: number }) {
  const { tip, show, hide } = useTip();
  const rows = buckets.slice(0, limit);
  if (rows.length === 0) {
    return <p className="py-6 text-center text-sm" style={{ color: "var(--muted)" }}>No settled bets yet.</p>;
  }

  const ROW = 26;
  const W = 720;
  const H = rows.length * ROW + 24;
  const LABEL = 46;
  const VALUE = 74;
  const plotW = W - LABEL - VALUE;
  const midX = LABEL + plotW / 2;
  const maxAbs = niceCeil(Math.max(...rows.map((r) => Math.abs(r.netCents)), 1) / 100) * 100;
  const barH = Math.min(24, ROW - 10);

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Net profit or loss by team">
        <line x1={midX} x2={midX} y1={6} y2={H - 18} stroke="var(--line-strong)" strokeWidth={1} />
        {rows.map((r, i) => {
          const y = 8 + i * ROW;
          const w = (Math.abs(r.netCents) / maxAbs) * (plotW / 2);
          const up = r.netCents >= 0;
          // 2px surface gap either side of the zero rule.
          const x = up ? midX + 2 : midX - 2 - w;
          return (
            <g key={r.key}>
              <text x={LABEL - 8} y={y + barH / 2 + 4} textAnchor="end" fontSize={11} fontWeight={600}
                    fill="var(--ink-2)">
                {r.label}
              </text>
              <path
                className="viz-mark"
                d={endRoundedPath(x, y, Math.max(w, 1), barH, 4, up ? "right" : "left")}
                fill={up ? "var(--pos)" : "var(--neg)"}
              />
              <text x={W - VALUE + 8} y={y + barH / 2 + 4} fontSize={11} className="tnum" fill="var(--ink-2)">
                {fmtMoney(r.netCents, { sign: true })}
              </text>
              <rect className="viz-hit" x={0} y={y - 4} width={W} height={ROW}
                    onMouseMove={(e) =>
                      show(e, [
                        r.label,
                        `Net ${fmtMoney(r.netCents, { sign: true })}`,
                        `${r.won}-${r.lost} on ${r.bets} bet${r.bets === 1 ? "" : "s"} · ${fmtMoney(r.wageredCents)} wagered`,
                      ])
                    }
                    onMouseLeave={hide} />
            </g>
          );
        })}
      </svg>
      <TipBox tip={tip} />
    </div>
  );
}
