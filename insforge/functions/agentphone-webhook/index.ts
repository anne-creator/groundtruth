import { createClient } from 'npm:@insforge/sdk';

// AgentPhone sends all events here:
//   SMS:   { event: "agent.message", channel: "sms",   data: { from, message } }
//   Voice: { event: "agent.message", channel: "voice", data: { from, transcript } }
//
// Function-to-function fetch is blocked on Deno Subhosting, so we inline the
// start-session logic here and write directly to the DB via the SDK client.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const PERSONA_NAMES: Record<string, string> = {
  aggressive_ceo: 'Elon Musk',
  conservative_ceo: 'Warren Buffett',
  balanced_ceo: 'Ray Dalio',
};

const NULL_UUID = '00000000-0000-0000-0000-000000000000';

function parseDecision(text: string): 'approved' | 'rejected' | null {
  const t = text.toLowerCase();
  const approved =
    t.includes('approve') ||
    t.includes('yes') ||
    t.includes('confirmed') ||
    t.includes('do it') ||
    t.includes('proceed');
  const rejected =
    t.includes('reject') ||
    t.includes('no') ||
    t.includes('decline') ||
    t.includes('cancel') ||
    t.includes('stop');
  if (approved) return 'approved';
  if (rejected) return 'rejected';
  return null;
}

const FIXTURE = {
  nodes: [
    { label: 'Company',          props: { id: 'acme',          name: 'Acme', stage: 'YC W26' } },
    { label: 'CashPosition',     props: { id: 'cash_1',        amount_usd: 480000, asof: '2026-05-09' } },
    { label: 'BurnRate',         props: { id: 'burn_1',        monthly_usd: 95000, kind: 'gross', asof: '2026-05-09' } },
    { label: 'Milestone',        props: { id: 'demo_day',      name: 'Demo Day', date: '2026-08-15', kind: 'YC' } },
    { label: 'Milestone',        props: { id: 'ts_expiry',     name: 'Beta Capital term sheet expiry', date: '2026-06-30', kind: 'fundraise' } },
    { label: 'FundraiseRound',   props: { id: 'seed',          name: 'Seed', target_usd: 3000000, committed_usd: 750000, status: 'in_progress' } },
    { label: 'Investor',         props: { id: 'inv_acme_v',    name: 'Acme Ventures', commitment_usd: 500000, stage: 'verbal' } },
    { label: 'Investor',         props: { id: 'inv_beta',      name: 'Beta Capital', commitment_usd: 250000, stage: 'term_sheet', expires: '2026-06-30' } },
    { label: 'RunwayConstraint', props: { id: 'pre_demo_floor', label: 'Pre-Demo Day cash floor', threshold_months: 3, rationale: 'Need 3mo cushion entering Demo Day' } },
    { label: 'Threat',           props: { id: 'threat_ts',     label: 'Beta term sheet expires before Demo Day', date: '2026-06-30', impact: 'high' } },
  ],
  relationships: [
    { from: 'burn_1',    to: 'cash_1',         type: 'DRAINS',      props: {} },
    { from: 'inv_acme_v',to: 'seed',           type: 'COMMITS_TO',  props: { stage: 'verbal' } },
    { from: 'inv_beta',  to: 'seed',           type: 'COMMITS_TO',  props: { stage: 'term_sheet' } },
    { from: 'seed',      to: 'cash_1',         type: 'REPLENISHES', props: { expected_amount_usd: 750000 } },
    { from: 'threat_ts', to: 'pre_demo_floor', type: 'THREATENS',   props: {} },
    { from: 'demo_day',  to: 'pre_demo_floor', type: 'CONSTRAINS',  props: {} },
    { from: 'ts_expiry', to: 'pre_demo_floor', type: 'CONSTRAINS',  props: {} },
  ],
};

function buildContext() {
  const node = (id: string) => FIXTURE.nodes.find((n) => n.props.id === id)?.props ?? {};
  const relsFrom = (fromId: string, type: string) =>
    FIXTURE.relationships.filter((r) => r.from === fromId && r.type === type);

  const cash = node('cash_1');
  const burn = node('burn_1');
  const round = node('seed');

  const investors = FIXTURE.nodes
    .filter((n) => n.label === 'Investor')
    .map((n) => {
      const rel = relsFrom(n.props.id, 'COMMITS_TO')[0];
      return { ...n.props, commit_stage: rel?.props?.stage };
    });

  const constraint = node('pre_demo_floor');
  const milestones = FIXTURE.nodes
    .filter((n) => n.label === 'Milestone')
    .map((n) => ({ ...n.props, constraint: (constraint as Record<string, unknown>).label, threshold_months: (constraint as Record<string, unknown>).threshold_months }));

  const threats = FIXTURE.nodes
    .filter((n) => n.label === 'Threat')
    .map((n) => n.props);

  return { records: [{ cash, burn, round, investors, milestones, threats }] };
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  let payload: {
    event: string;
    channel: string;
    agentId?: string;
    data: {
      from: string;
      to?: string;
      direction?: 'inbound' | 'outbound';
      message?: string;
      transcript?: string;
      conversationId?: string;
    };
  };
  try {
    payload = await req.json();
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  console.log('[agentphone-webhook] payload', JSON.stringify(payload));

  if (payload.event !== 'agent.message') {
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  const db = createClient({
    baseUrl: Deno.env.get('INSFORGE_INTERNAL_URL') || Deno.env.get('INSFORGE_BASE_URL')!,
    anonKey: Deno.env.get('ANON_KEY')!,
  });

  const logErr = (label: string, r: { error: unknown }) => {
    if (r.error) console.error(`[agentphone-webhook:${label}]`, r.error);
  };

  // ── SMS: either an approval reply to a complete session, or a new session ──
  if (payload.channel === 'sms') {
    if (payload.data.direction === 'outbound') {
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    const from = payload.data.from;
    const message = (payload.data.message ?? '').trim();

    if (!message) {
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    // Reply-approval branch: if we're awaiting approval and the sender matches,
    // try to parse the message as a decision before starting a new session.
    const currentRes = await db.database
      .from('current_state')
      .select('status,caller_phone,alive_plan_ids')
      .eq('id', 1)
      .single();

    if (
      currentRes.data?.status === 'complete' &&
      currentRes.data.caller_phone === from
    ) {
      const decision = parseDecision(message);
      if (decision) {
        const planId: string | undefined = (currentRes.data.alive_plan_ids ?? [])[0];
        if (planId) {
          const planRes = await db.database.from('plans').select('agent_id').eq('id', planId).single();
          const agentId = planRes.data?.agent_id ?? '';
          const persona = PERSONA_NAMES[agentId] ?? 'Your advisor';

          logErr('insert approvals', await db.database.from('approvals').insert([{
            plan_id: planId,
            decision,
          }]));

          logErr('update current_state', await db.database.from('current_state').update({
            status: decision,
            updated_at: new Date().toISOString(),
          }).eq('id', 1));

          logErr('insert event_log', await db.database.from('event_log').insert([{
            round: 0,
            source: 'system',
            kind: 'system',
            narration: `SMS ${decision} for ${persona}'s plan.`,
          }]));

          return new Response(JSON.stringify({ ok: true, decision }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
        }
      }
      // Unrecognized text while awaiting approval → fall through to new session.
    }

    console.log('[agentphone-webhook] starting session from SMS', { from, message });

    logErr('delete approvals', await db.database.from('approvals').delete().neq('id', NULL_UUID));
    logErr('delete decisions', await db.database.from('decisions').delete().neq('id', NULL_UUID));
    logErr('delete event_log', await db.database.from('event_log').delete().neq('id', NULL_UUID));
    logErr('delete plans',     await db.database.from('plans').delete().neq('id', NULL_UUID));

    const context = buildContext();

    logErr('update current_state', await db.database.from('current_state').update({
      query: message,
      round: 1,
      status: 'round1',
      neo4j_context: context,
      alive_plan_ids: [],
      approvals: {},
      caller_phone: from,
      updated_at: new Date().toISOString(),
    }).eq('id', 1));

    logErr('insert event_log', await db.database.from('event_log').insert([{
      round: 1,
      source: 'system',
      kind: 'system',
      narration: `Session triggered via SMS from ${from}. Context loaded. Dispatching board.`,
    }]));

    console.log('[agentphone-webhook] session started; frontend will orchestrate');

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  // ── Voice: handle approval/rejection from the outbound call ──────────────
  if (payload.channel === 'voice') {
    const transcript = payload.data.transcript ?? '';
    const decision = parseDecision(transcript);

    if (!decision) {
      return Response.json({
        text: "I didn't catch that. Please say 'approve' to execute the recommendation, or 'reject' to decline.",
      });
    }

    const stateRes = await db.database.from('current_state').select('alive_plan_ids').eq('id', 1).single();
    const planId: string | undefined = (stateRes.data?.alive_plan_ids ?? [])[0];

    if (!planId) {
      return Response.json({ text: 'No active recommendation found. Please try again from the dashboard.', hangup: true });
    }

    const planRes = await db.database.from('plans').select('agent_id,content').eq('id', planId).single();
    const agentId = planRes.data?.agent_id ?? '';
    const persona = PERSONA_NAMES[agentId] ?? 'Your advisor';
    const approved = decision === 'approved';

    // Record the approval directly (inlined from execute-action's DB writes).
    // Side-effect fan-out (Slack/Calendar) is skipped here — that still belongs
    // in execute-action, and the dashboard can fire it on a follow-up.
    logErr('insert approvals', await db.database.from('approvals').insert([{
      plan_id: planId,
      decision,
    }]));

    logErr('update current_state', await db.database.from('current_state').update({
      status: decision,
      updated_at: new Date().toISOString(),
    }).eq('id', 1));

    logErr('insert event_log', await db.database.from('event_log').insert([{
      round: 0,
      source: 'system',
      kind: 'system',
      narration: `Voice ${decision} for ${persona}'s plan.`,
    }]));

    const reply = approved
      ? `Decision locked in. ${persona}'s recommendation is now recorded. Your board thanks you. Goodbye.`
      : `Understood. ${persona}'s recommendation has been rejected. Your board is standing by. Goodbye.`;

    return Response.json({ text: reply, hangup: true });
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
