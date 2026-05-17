import { createClient } from 'npm:@insforge/sdk';

import Supermemory from 'npm:supermemory';

export const GT_AGENT_IDS = ['aggressive_ceo', 'conservative_ceo', 'balanced_ceo'] as const;

const PERSONA_NAME: Record<string, string> = {
  aggressive_ceo: 'Elon Musk',
  conservative_ceo: 'Warren Buffett',
  balanced_ceo: 'Ray Dalio',
};

function personaName(agentId: string): string {
  return PERSONA_NAME[agentId] ?? agentId.replace(/_ceo$/, '').replace(/_/g, ' ');
}

/** Full container tag charset (Supermemory constraint). */
const TAG_RE = /^[A-Za-z0-9._-]{1,100}$/;

export type SupermemoryClient = InstanceType<typeof Supermemory>;

export const EMPTY_PROFILE = {
  profile: { static: [] as string[], dynamic: [] as string[] },
  searchResults: undefined as { results: unknown[]; total: number; timing: number } | undefined,
};

export type EmptyProfile = typeof EMPTY_PROFILE;

export const EMPTY_SEARCH = { results: [] as unknown[], total: 0, timing: 0 };

/** documents.list responses use `memories` + `pagination`. */
export const EMPTY_LIST = {
  memories: [] as { id: string }[],
  pagination: { currentPage: 1, totalItems: 0, totalPages: 0 },
};

export function validateTag(tag: string, hint: string): void {
  if (!TAG_RE.test(tag)) {
    throw new Error(`Supermemory invalid container tag (${hint}): ${tag}`);
  }
}

/** Session-scoped and global Supermemory tags. */
export function tags(sessionToken: string) {
  if (!sessionToken?.trim()) throw new Error('[supermemory] missing session_token');
  const base = `gt.s.${sessionToken}`;
  validateTag(base, 'base');
  return {
    queries: 'gt.queries',
    evidence: `${base}.evidence`,
    plans: `${base}.plans`,
    decisions: `${base}.decisions`,
    approvals: `${base}.approvals`,
    agent: (agentId: string) => {
      const t = `${base}.agent.${agentId}`;
      validateTag(t, `agent.${agentId}`);
      return t;
    },
  };
}

function _sanityCheckTags(): void {
  try {
    const t = tags('aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee');
    validateTag(t.queries, 'queries');
    const al = [...GT_AGENT_IDS.map((id) => t.agent(id)), t.evidence, t.plans, t.decisions, t.approvals];
    al.forEach((x, i) => validateTag(x, `slot${i}`));
  } catch (e) {
    console.error('[supermemory:sanity]', e);
    throw e;
  }
}
_sanityCheckTags();

export function priorSessionBulkTags(priorToken: string | null | undefined): string[] {
  if (!priorToken) return [];
  try {
    const t = tags(priorToken);
    return [...GT_AGENT_IDS.map((id) => t.agent(id)), t.evidence, t.plans, t.decisions, t.approvals];
  } catch {
    return [];
  }
}

export async function safeCall<T>(label: string, fallback: T, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.warn(`[sm:${label}]`, err);
    return fallback;
  }
}

export function getClient(): SupermemoryClient | null {
  const key = Deno.env.get('SUPERMEMORY_API_KEY');
  if (!key) return null;
  return new Supermemory({ apiKey: key });
}

let settingsBootstrapped = false;

export async function bootstrapSettings(sm: SupermemoryClient): Promise<void> {
  if (settingsBootstrapped) return;
  settingsBootstrapped = true;
  await safeCall('settings.update', undefined, async () => {
    await sm.settings.get();
    try {
      await sm.settings.update({});
    } catch (e1) {
      console.warn('[sm:settings.update:empty]', e1);
    }
    console.log('[sm:settings.update] ok');
    return undefined;
  });
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  let round: number;
  try {
    ({ round } = await req.json());
    if (![1, 2, 3].includes(round)) throw new Error();
  } catch {
    return new Response(JSON.stringify({ error: 'Body must be { round: 1|2|3 }' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  const db = createClient({
    baseUrl: Deno.env.get('INSFORGE_INTERNAL_URL') || Deno.env.get('INSFORGE_BASE_URL')!,
    anonKey: Deno.env.get('ANON_KEY')!,
  });

  const logErr = (label: string, r: { error: unknown }) => {
    if (r.error) console.error(`[tally-round:r${round}:${label}]`, r.error);
  };

  // ── Round 1: populate alive_plan_ids from plans table, then advance ───────
  if (round === 1) {
    const allPlansRes = await db.database.from('plans').select('id');
    logErr('select plans', allPlansRes);
    const allPlanIds = (allPlansRes.data ?? []).map((p: { id: string }) => p.id);

    logErr('update current_state', await db.database.from('current_state').update({
      status: 'round2',
      round: 2,
      alive_plan_ids: allPlanIds,
      updated_at: new Date().toISOString(),
    }).eq('id', 1));

    logErr('insert event_log', await db.database.from('event_log').insert([{
      round: 1,
      source: 'system',
      kind: 'system',
      narration: `Round 1 complete. ${allPlanIds.length} plans on the table.`,
    }]));

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  // ── Rounds 2 & 3 ────────────────────────────────────────────────────────

  const [decisionsRes, stateRes] = await Promise.all([
    db.database.from('decisions').select('chosen_plan_id').eq('round', round),
    db.database.from('current_state').select('alive_plan_ids,session_token').eq('id', 1).single(),
  ]);
  logErr('select decisions', decisionsRes);
  logErr('select current_state', stateRes);
  const decisionsData = decisionsRes.data;
  const stateData = stateRes.data as {
    alive_plan_ids: string[] | null;
    session_token?: string | null;
  } | null;

  const aliveBefore: string[] = stateData?.alive_plan_ids ?? [];

  const sm = getClient();
  const sessionToken = stateData?.session_token ?? null;
  const tg = sessionToken && sm ? tags(sessionToken) : null;

  const voteCounts: Record<string, number> = {};
  for (const row of (decisionsData ?? []) as { chosen_plan_id: string }[]) {
    voteCounts[row.chosen_plan_id] = (voteCounts[row.chosen_plan_id] ?? 0) + 1;
  }

  let aliveAfter: string[];
  let eliminated: string[];

  if (round === 3) {
    const maxVotes = Math.max(0, ...aliveBefore.map((id) => voteCounts[id] ?? 0));
    aliveAfter = maxVotes === 0
      ? [...aliveBefore]
      : aliveBefore.filter((id) => (voteCounts[id] ?? 0) === maxVotes);
    eliminated = aliveBefore.filter((id) => !aliveAfter.includes(id));
  } else {
    // Round 2: eliminate plan(s) with the lowest vote count.
    // If every plan is tied (no distinct lowest), advance all to round 3.
    const counts = aliveBefore.map((id) => voteCounts[id] ?? 0);
    const allTied = new Set(counts).size <= 1;
    if (allTied) {
      eliminated = [];
      aliveAfter = [...aliveBefore];
    } else {
      const minVotes = Math.min(...counts);
      eliminated = aliveBefore.filter((id) => (voteCounts[id] ?? 0) === minVotes);
      aliveAfter = aliveBefore.filter((id) => (voteCounts[id] ?? 0) > minVotes);
    }
  }

  logErr('update current_state (tally)', await db.database.from('current_state').update({
    approvals: voteCounts,
    alive_plan_ids: aliveAfter,
    updated_at: new Date().toISOString(),
  }).eq('id', 1));

  if (eliminated.length > 0) {
    logErr('update plans (eliminated)', await db.database.from('plans').update({ eliminated_at_round: round }).in('id', eliminated));

    const eliminatedRowsRes = await db.database.from('plans').select('id,agent_id,content').in('id', eliminated);
    logErr('select eliminated plans', eliminatedRowsRes);
    const names = (eliminatedRowsRes.data ?? []).map((p: { agent_id: string }) => personaName(p.agent_id));
    const reason = round === 3 ? 'plurality vote' : 'lowest vote count';
    logErr('insert event_log (eliminated)', await db.database.from('event_log').insert([{
      round,
      source: 'system',
      kind: 'eliminated',
      narration: `Round ${round}: ${names.join(', ')} plan eliminated (${reason}). ${aliveAfter.length} plan(s) remain.`,
    }]));

    const rows = eliminatedRowsRes.data ?? [] as Array<{ id: string; agent_id: string; content: string }>;
    for (const planRow of rows) {
      if (!sm || !tg) continue;
      const filterVal = `${planRow.id}`;
      const listed = await safeCall(`documents.list.${filterVal}`, EMPTY_LIST, () =>
        sm.documents.list({
          containerTags: [tg.plans],
          filters: { AND: [{ key: 'plan_id', value: filterVal, filterType: 'metadata' }] },
          limit: 5,
        }));
      const smId = listed.memories[0]?.id;
      if (smId) {
        await safeCall(`documents.update.${smId}`, undefined, async () => {
          await sm.documents.update(smId, { metadata: { eliminated_at_round: round } });
          return undefined;
        });
      }
      const round1Thought = `Round 1: proposed "${planRow.content}"`;
      await safeCall(`memories.forget.${planRow.agent_id}`, undefined, async () => {
        const fr = await sm.memories.forget({
          containerTag: tg.agent(planRow.agent_id),
          content: round1Thought,
          reason: 'plan eliminated',
        });
        console.log(`[sm:tally-round forget ${planRow.id}] forgotten=${fr.forgotten}`);
        return undefined;
      });
    }
  }

  // ── Termination ──────────────────────────────────────────────────────────
  if (aliveAfter.length === 1 || round === 3) {
    logErr('update current_state (complete)', await db.database.from('current_state').update({ status: 'complete', updated_at: new Date().toISOString() }).eq('id', 1));

    let narration: string;
    if (aliveAfter.length === 1) {
      const winnerRes = await db.database.from('plans').select('agent_id').eq('id', aliveAfter[0]).single();
      logErr('select winner', winnerRes);
      const winner = personaName(winnerRes.data?.agent_id ?? '');
      narration = `Consensus reached on ${winner}'s plan.`;
    } else {
      narration = `Round 3 ends with ${aliveAfter.length} plans tied — user chooses.`;
    }

    logErr('insert event_log (consensus)', await db.database.from('event_log').insert([{ round, source: 'system', kind: 'consensus', narration }]));
  } else {
    logErr('update current_state (round3)', await db.database.from('current_state').update({
      status: 'round3',
      round: 3,
      approvals: {},
      updated_at: new Date().toISOString(),
    }).eq('id', 1));

    logErr('insert event_log (advance)', await db.database.from('event_log').insert([{
      round,
      source: 'system',
      kind: 'system',
      narration: `Round ${round} complete. No consensus yet — advancing to round 3.`,
    }]));
  }

  return new Response(JSON.stringify({ ok: true, alive: aliveAfter }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
