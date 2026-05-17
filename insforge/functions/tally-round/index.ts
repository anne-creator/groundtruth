import { createClient } from 'npm:@insforge/sdk';

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
    db.database.from('current_state').select('alive_plan_ids').eq('id', 1).single(),
  ]);
  logErr('select decisions', decisionsRes);
  logErr('select current_state', stateRes);
  const decisionsData = decisionsRes.data;
  const stateData = stateRes.data;

  const aliveBefore: string[] = stateData?.alive_plan_ids ?? [];

  const voteCounts: Record<string, number> = {};
  for (const row of (decisionsData ?? []) as { chosen_plan_id: string }[]) {
    voteCounts[row.chosen_plan_id] = (voteCounts[row.chosen_plan_id] ?? 0) + 1;
  }

  const eliminated = aliveBefore.filter((id) => !voteCounts[id]);
  const aliveAfter = aliveBefore.filter((id) => voteCounts[id]);

  logErr('update current_state (tally)', await db.database.from('current_state').update({
    approvals: voteCounts,
    alive_plan_ids: aliveAfter,
    updated_at: new Date().toISOString(),
  }).eq('id', 1));

  if (eliminated.length > 0) {
    logErr('update plans (eliminated)', await db.database.from('plans').update({ eliminated_at_round: round }).in('id', eliminated));

    const eliminatedRowsRes = await db.database.from('plans').select('agent_id').in('id', eliminated);
    logErr('select eliminated plans', eliminatedRowsRes);
    const names = (eliminatedRowsRes.data ?? []).map((p: { agent_id: string }) =>
      p.agent_id.replace(/_ceo$/, '').replace(/_/g, ' '),
    );
    logErr('insert event_log (eliminated)', await db.database.from('event_log').insert([{
      round,
      source: 'system',
      kind: 'eliminated',
      narration: `Round ${round}: ${names.join(', ')} plan eliminated (0 votes). ${aliveAfter.length} plan(s) remain.`,
    }]));
  }

  // ── Termination ──────────────────────────────────────────────────────────
  if (aliveAfter.length === 1 || round === 3) {
    logErr('update current_state (complete)', await db.database.from('current_state').update({ status: 'complete', updated_at: new Date().toISOString() }).eq('id', 1));

    let narration: string;
    if (aliveAfter.length === 1) {
      const winnerRes = await db.database.from('plans').select('agent_id').eq('id', aliveAfter[0]).single();
      logErr('select winner', winnerRes);
      const winner = (winnerRes.data?.agent_id ?? '').replace(/_ceo$/, '').replace(/_/g, ' ');
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
