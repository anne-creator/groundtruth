import type {
  Neo4jContext,
  Neo4jCashNode,
  Neo4jBurnNode,
  Neo4jRoundNode,
  Neo4jMilestone,
  Neo4jThreat,
} from '../types';

export interface KeyFacts {
  cashOnHand: Neo4jCashNode | null;
  monthlyBurn: Neo4jBurnNode | null;
  fundraiseRound: Neo4jRoundNode | null;
  demoDate: Neo4jMilestone | null;
  fundraiseExpiry: Neo4jMilestone | null;
  threat: Neo4jThreat | null;
  baselineRunwayMonths: number | null;
  constraints: { label: string; threshold_months?: number; rationale?: string }[];
}

function nodeHasKey<K extends string>(
  n: object | undefined,
  k: K,
): n is Record<K, unknown> {
  return !!n && k in n;
}

export function extractKeyFacts(ctx: Neo4jContext | null | undefined): KeyFacts {
  const rec = ctx?.records?.[0];

  const cashOnHand =
    rec && nodeHasKey(rec.cash, 'amount_usd') ? (rec.cash as Neo4jCashNode) : null;
  const monthlyBurn =
    rec && nodeHasKey(rec.burn, 'monthly_usd') ? (rec.burn as Neo4jBurnNode) : null;
  const fundraiseRound =
    rec && nodeHasKey(rec.round, 'target_usd') ? (rec.round as Neo4jRoundNode) : null;

  const demoDate = rec?.milestones?.find((m) => m.kind === 'YC') ?? null;
  const fundraiseExpiry = rec?.milestones?.find((m) => m.kind === 'fundraise') ?? null;
  const threat = rec?.threats?.[0] ?? null;

  const baselineRunwayMonths =
    cashOnHand && monthlyBurn && monthlyBurn.monthly_usd > 0
      ? cashOnHand.amount_usd / monthlyBurn.monthly_usd
      : null;

  // Constraints come from milestones with `constraint` populated (see start-session/index.ts).
  const constraints = (rec?.milestones ?? [])
    .filter((m) => m.constraint)
    .map((m) => ({
      label: m.constraint as string,
      threshold_months: m.threshold_months,
    }));

  return {
    cashOnHand,
    monthlyBurn,
    fundraiseRound,
    demoDate,
    fundraiseExpiry,
    threat,
    baselineRunwayMonths,
    constraints,
  };
}

export function formatUSD(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(amount % 1_000_000 === 0 ? 0 : 1)}M`;
  if (amount >= 1_000) return `$${Math.round(amount / 1_000)}k`;
  return `$${amount}`;
}

export function formatMonths(m: number): string {
  return `${m.toFixed(1)}mo`;
}

/** "2026-08-15" → "Aug 15". Locale-agnostic short form. */
export function formatShortDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[d.getUTCMonth()]} ${d.getUTCDate()}`;
  } catch {
    return iso;
  }
}

/** Days from today (UTC) to iso date. Negative if past. */
export function daysUntil(iso: string): number | null {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const now = new Date();
    const ms = d.getTime() - now.getTime();
    return Math.round(ms / 86_400_000);
  } catch {
    return null;
  }
}
