"use client";

import type { ReactNode } from "react";
import { team as teamOf } from "@/lib/teams";
import type { BetStatus } from "@/lib/types";

export function Card({
  title,
  subtitle,
  right,
  children,
  className = "",
}: {
  title?: string;
  subtitle?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-xl border p-4 ${className}`}
      style={{ background: "var(--surface)", borderColor: "var(--line)" }}
    >
      {(title || right) && (
        <header className="mb-3 flex items-start justify-between gap-3">
          <div>
            {title && (
              <h2 className="text-sm font-semibold tracking-tight" style={{ color: "var(--ink)" }}>
                {title}
              </h2>
            )}
            {subtitle && (
              <p className="mt-0.5 text-xs" style={{ color: "var(--muted)" }}>
                {subtitle}
              </p>
            )}
          </div>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

/**
 * Stat tile: label, value, optional delta. The value uses proportional figures
 * — tabular digits look loose at display sizes.
 */
export function StatTile({
  label,
  value,
  sub,
  tone = "neutral",
  hero = false,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "neutral" | "pos" | "neg";
  hero?: boolean;
}) {
  const color =
    tone === "pos" ? "var(--pos)" : tone === "neg" ? "var(--neg)" : "var(--ink)";
  return (
    <div
      className="rounded-xl border px-4 py-3"
      style={{ background: "var(--surface)", borderColor: "var(--line)" }}
    >
      <div className="text-xs font-medium" style={{ color: "var(--muted)" }}>
        {label}
      </div>
      <div
        className={`mt-1 font-semibold ${hero ? "text-4xl" : "text-2xl"}`}
        style={{ color }}
      >
        {value}
      </div>
      {sub && (
        <div className="mt-1 text-xs" style={{ color: "var(--ink-2)" }}>
          {sub}
        </div>
      )}
    </div>
  );
}

const STATUS_STYLE: Record<BetStatus, { bg: string; fg: string; label: string }> = {
  open: { bg: "color-mix(in srgb, var(--ink) 8%, transparent)", fg: "var(--ink-2)", label: "Open" },
  won: { bg: "color-mix(in srgb, var(--pos) 16%, transparent)", fg: "var(--pos)", label: "Won" },
  lost: { bg: "color-mix(in srgb, var(--neg) 16%, transparent)", fg: "var(--neg)", label: "Lost" },
  push: { bg: "color-mix(in srgb, var(--ink) 8%, transparent)", fg: "var(--ink-2)", label: "Push" },
  void: { bg: "color-mix(in srgb, var(--ink) 8%, transparent)", fg: "var(--muted)", label: "Void" },
};

/** Status always carries a word, never color alone. */
export function StatusPill({ status }: { status: BetStatus }) {
  const s = STATUS_STYLE[status];
  return (
    <span
      className="inline-block rounded-md px-1.5 py-0.5 text-[11px] font-semibold"
      style={{ background: s.bg, color: s.fg }}
    >
      {s.label}
    </span>
  );
}

/** The one place a club color is allowed — identity, not data encoding. */
export function TeamChip({ abbr, muted = false }: { abbr: string | null; muted?: boolean }) {
  const t = teamOf(abbr);
  if (!t) return <span style={{ color: "var(--muted)" }}>—</span>;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span
        aria-hidden
        className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ background: t.color, outline: "1px solid var(--line-strong)" }}
      />
      <span
        className="font-semibold"
        style={{ color: muted ? "var(--ink-2)" : "var(--ink)" }}
        title={`${t.location} ${t.name}`}
      >
        {t.abbr}
      </span>
    </span>
  );
}

export function Button({
  children,
  onClick,
  variant = "ghost",
  disabled,
  type = "button",
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost" | "danger";
  disabled?: boolean;
  type?: "button" | "submit";
  title?: string;
}) {
  const styles =
    variant === "primary"
      ? { background: "var(--accent)", color: "#fff", borderColor: "transparent" }
      : variant === "danger"
        ? { background: "transparent", color: "var(--neg)", borderColor: "var(--line-strong)" }
        : { background: "var(--surface-2)", color: "var(--ink)", borderColor: "var(--line-strong)" };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="rounded-lg border px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 hover:brightness-95"
      style={styles}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium" style={{ color: "var(--ink-2)" }}>
        {label}
      </span>
      {children}
      {hint && (
        <span className="mt-1 block text-[11px]" style={{ color: "var(--muted)" }}>
          {hint}
        </span>
      )}
    </label>
  );
}

export const inputCls =
  "w-full rounded-lg border px-2.5 py-1.5 text-sm outline-none focus:ring-2";

export const inputStyle = {
  background: "var(--surface-2)",
  borderColor: "var(--line-strong)",
  color: "var(--ink)",
} as const;

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="py-8 text-center text-sm" style={{ color: "var(--muted)" }}>
      {children}
    </p>
  );
}
