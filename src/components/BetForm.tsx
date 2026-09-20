"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Field, inputCls, inputStyle } from "./ui";
import { TEAMS } from "@/lib/teams";
import {
  americanProfitCents,
  centsToDollars,
  dollarsToCents,
  fmtMoney,
  fmtPct,
  impliedProbability,
  priceProbability,
} from "@/lib/money";
import type { Bet, BetKind, Game, MarketType } from "@/lib/types";

type Draft = {
  kind: BetKind;
  gameId: string;
  marketType: MarketType;
  team: string;
  line: string;
  overUnder: "over" | "under";
  contracts: string;
  price: string;
  stake: string;
  odds: string;
  fees: string;
  placedAt: string;
  note: string;
  selection: string;
};

const blank = (): Draft => ({
  kind: "contract",
  gameId: "",
  marketType: "moneyline",
  team: "",
  line: "",
  overUnder: "over",
  contracts: "",
  price: "",
  stake: "",
  odds: "-110",
  fees: "",
  placedAt: new Date().toISOString().slice(0, 16),
  note: "",
  selection: "",
});

function fromBet(b: Bet): Draft {
  return {
    kind: b.kind,
    gameId: b.gameId ?? "",
    marketType: b.marketType,
    team: b.team ?? "",
    line: b.line === null ? "" : String(b.line),
    overUnder: b.overUnder ?? "over",
    contracts: b.contracts === null ? "" : String(b.contracts),
    price: b.entryPriceCents === null ? "" : String(b.entryPriceCents),
    stake: b.stakeCents ? String(centsToDollars(b.stakeCents)) : "",
    odds: b.americanOdds === null ? "" : String(b.americanOdds),
    fees: b.feesCents ? String(centsToDollars(b.feesCents)) : "",
    placedAt: (b.placedAt || new Date().toISOString()).slice(0, 16),
    note: b.note,
    selection: b.selection,
  };
}

export default function BetForm({
  open,
  games,
  editing,
  prefillGameId,
  onClose,
  onSave,
}: {
  open: boolean;
  games: Game[];
  editing: Bet | null;
  prefillGameId?: string | null;
  onClose: () => void;
  onSave: (payload: Partial<Bet>) => Promise<void>;
}) {
  const [d, setD] = useState<Draft>(blank());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (editing) setD(fromBet(editing));
    else setD({ ...blank(), gameId: prefillGameId ?? "" });
  }, [open, editing, prefillGameId]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }));

  const game = useMemo(() => games.find((g) => g.id === d.gameId) ?? null, [games, d.gameId]);

  // A game-linked bet offers only that game's two teams — the common case, and
  // it makes an impossible pick unrepresentable.
  const teamOptions = game ? [game.awayTeam, game.homeTeam] : TEAMS.map((t) => t.abbr);

  const stakeCents =
    d.kind === "contract"
      ? Math.round((Number(d.contracts) || 0) * (Number(d.price) || 0))
      : dollarsToCents(d.stake);
  const toWinCents =
    d.kind === "contract"
      ? Math.round((Number(d.contracts) || 0) * 100) - stakeCents
      : americanProfitCents(Number(d.odds) || 0, stakeCents);
  const breakEven =
    d.kind === "contract"
      ? priceProbability(Number(d.price) || 0)
      : impliedProbability(Number(d.odds) || 0);

  const upcoming = useMemo(
    () => [...games].sort((a, b) => b.date.localeCompare(a.date)),
    [games],
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (stakeCents <= 0) {
      setError(d.kind === "contract" ? "Enter contracts and a price." : "Enter a stake.");
      return;
    }
    if (d.marketType !== "total" && !d.team && !d.selection.trim()) {
      setError("Pick a team, or describe the selection.");
      return;
    }
    if ((d.marketType === "spread" || d.marketType === "total") && d.line.trim() === "") {
      setError("Enter the line.");
      return;
    }

    const payload: Partial<Bet> = {
      kind: d.kind,
      gameId: d.gameId || null,
      season: game?.season ?? null,
      seasonType: game?.seasonType ?? null,
      week: game?.week ?? null,
      eventDate: game?.date ?? null,
      homeTeam: game?.homeTeam ?? null,
      awayTeam: game?.awayTeam ?? null,
      team: d.marketType === "total" ? null : d.team || null,
      marketType: d.marketType,
      line: d.line.trim() === "" ? null : Number(d.line),
      overUnder: d.marketType === "total" ? d.overUnder : null,
      selection: d.selection.trim(),
      contracts: d.kind === "contract" ? Number(d.contracts) || 0 : null,
      entryPriceCents: d.kind === "contract" ? Math.round(Number(d.price) || 0) : null,
      americanOdds: d.kind === "odds" ? Math.round(Number(d.odds) || 0) : null,
      stakeCents,
      feesCents: dollarsToCents(d.fees),
      placedAt: new Date(d.placedAt).toISOString(),
      note: d.note,
    };

    setBusy(true);
    try {
      await onSave(payload);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8"
      style={{ background: "rgb(0 0 0 / 0.5)" }}
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="w-full max-w-2xl rounded-2xl border p-5 shadow-xl"
        style={{ background: "var(--surface)", borderColor: "var(--line-strong)" }}
      >
        <h2 className="text-base font-semibold">{editing ? "Edit bet" : "Add a bet"}</h2>
        <p className="mt-0.5 text-xs" style={{ color: "var(--muted)" }}>
          Kalshi positions import themselves — this is for anything placed elsewhere.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Bet shape">
            <div className="flex gap-2">
              {(["contract", "odds"] as BetKind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => set("kind", k)}
                  className="flex-1 rounded-lg border px-3 py-1.5 text-sm font-medium"
                  style={{
                    background: d.kind === k ? "var(--accent)" : "var(--surface-2)",
                    color: d.kind === k ? "#fff" : "var(--ink)",
                    borderColor: d.kind === k ? "transparent" : "var(--line-strong)",
                  }}
                >
                  {k === "contract" ? "Contracts" : "Odds"}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Market">
            <select
              className={inputCls}
              style={inputStyle}
              value={d.marketType}
              onChange={(e) => set("marketType", e.target.value as MarketType)}
            >
              <option value="moneyline">Moneyline / to win</option>
              <option value="spread">Spread</option>
              <option value="total">Total (over/under)</option>
              <option value="prop">Prop</option>
              <option value="other">Other / futures</option>
            </select>
          </Field>

          <Field label="Game" hint="Linking a game lets the app grade this from the final score.">
            <select
              className={inputCls}
              style={inputStyle}
              value={d.gameId}
              onChange={(e) => {
                set("gameId", e.target.value);
                set("team", "");
              }}
            >
              <option value="">No game (futures / other)</option>
              {upcoming.map((g) => (
                <option key={g.id} value={g.id}>
                  {`W${g.week} · ${g.shortName || `${g.awayTeam} @ ${g.homeTeam}`} · ${new Date(
                    g.date,
                  ).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`}
                </option>
              ))}
            </select>
          </Field>

          {d.marketType === "total" ? (
            <Field label="Side">
              <select
                className={inputCls}
                style={inputStyle}
                value={d.overUnder}
                onChange={(e) => set("overUnder", e.target.value as "over" | "under")}
              >
                <option value="over">Over</option>
                <option value="under">Under</option>
              </select>
            </Field>
          ) : (
            <Field label="Team backed">
              <select
                className={inputCls}
                style={inputStyle}
                value={d.team}
                onChange={(e) => set("team", e.target.value)}
              >
                <option value="">—</option>
                {teamOptions.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {(d.marketType === "spread" || d.marketType === "total") && (
            <Field
              label={d.marketType === "spread" ? "Spread" : "Total"}
              hint={d.marketType === "spread" ? "From the backed team's view: -3.5 lays it, +3.5 takes it." : undefined}
            >
              <input
                className={inputCls}
                style={inputStyle}
                inputMode="decimal"
                placeholder={d.marketType === "spread" ? "-3.5" : "47.5"}
                value={d.line}
                onChange={(e) => set("line", e.target.value)}
              />
            </Field>
          )}

          {d.kind === "contract" ? (
            <>
              <Field label="Contracts" hint="Fractions are fine — Kalshi allows them.">
                <input
                  className={inputCls}
                  style={inputStyle}
                  inputMode="decimal"
                  placeholder="25"
                  value={d.contracts}
                  onChange={(e) => set("contracts", e.target.value)}
                />
              </Field>
              <Field label="Price per contract (¢)">
                <input
                  className={inputCls}
                  style={inputStyle}
                  inputMode="numeric"
                  placeholder="62"
                  value={d.price}
                  onChange={(e) => set("price", e.target.value)}
                />
              </Field>
            </>
          ) : (
            <>
              <Field label="Stake ($)">
                <input
                  className={inputCls}
                  style={inputStyle}
                  inputMode="decimal"
                  placeholder="50.00"
                  value={d.stake}
                  onChange={(e) => set("stake", e.target.value)}
                />
              </Field>
              <Field label="American odds">
                <input
                  className={inputCls}
                  style={inputStyle}
                  inputMode="numeric"
                  placeholder="-110"
                  value={d.odds}
                  onChange={(e) => set("odds", e.target.value)}
                />
              </Field>
            </>
          )}

          <Field label="Fees ($)">
            <input
              className={inputCls}
              style={inputStyle}
              inputMode="decimal"
              placeholder="0.00"
              value={d.fees}
              onChange={(e) => set("fees", e.target.value)}
            />
          </Field>

          <Field label="Placed">
            <input
              type="datetime-local"
              className={inputCls}
              style={inputStyle}
              value={d.placedAt}
              onChange={(e) => set("placedAt", e.target.value)}
            />
          </Field>

          <div className="sm:col-span-2">
            <Field label="Label" hint="Optional — overrides the auto-generated description.">
              <input
                className={inputCls}
                style={inputStyle}
                placeholder="e.g. Bills -3.5 vs Miami"
                value={d.selection}
                onChange={(e) => set("selection", e.target.value)}
              />
            </Field>
          </div>

          <div className="sm:col-span-2">
            <Field label="Note">
              <textarea
                className={inputCls}
                style={inputStyle}
                rows={2}
                value={d.note}
                onChange={(e) => set("note", e.target.value)}
              />
            </Field>
          </div>
        </div>

        <div
          className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg border px-3 py-2 text-xs"
          style={{ background: "var(--surface-2)", borderColor: "var(--line)" }}
        >
          <span style={{ color: "var(--ink-2)" }}>
            Risking <strong className="tnum">{fmtMoney(stakeCents)}</strong>
          </span>
          <span style={{ color: "var(--ink-2)" }}>
            To win <strong className="tnum">{fmtMoney(toWinCents)}</strong>
          </span>
          <span style={{ color: "var(--muted)" }}>
            Break-even {fmtPct(breakEven)}
          </span>
        </div>

        {error && (
          <p className="mt-3 text-sm" style={{ color: "var(--neg)" }}>
            {error}
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? "Saving…" : editing ? "Save changes" : "Add bet"}
          </Button>
        </div>
      </form>
    </div>
  );
}
