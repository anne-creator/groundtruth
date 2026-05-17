import { createClient } from 'npm:@insforge/sdk';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

interface PlanAction {
  type: 'slack_message' | 'graph_annotation' | 'calendar_create';
  channel?: string;
  body?: string;
  target_id?: string;
  annotation?: string;
  title?: string;
  date?: string;
}

async function fireSlack(action: PlanAction) {
  const token = Deno.env.get('SLACK_BOT_TOKEN');
  if (!token) return;
  await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ channel: action.channel, text: action.body }),
  });
}

async function fireCalendar(action: PlanAction) {
  if (!Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON') || !action.date || !action.title) return;
  // Full OAuth2 implementation via googleapis omitted for v1
  console.log('Calendar stub:', action.title, action.date);
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  let planId: string;
  let decision: string;
  try {
    ({ plan_id: planId, decision } = await req.json());
    if (!planId || !['approved', 'rejected'].includes(decision)) throw new Error();
  } catch {
    return new Response(JSON.stringify({ error: 'Body must be { plan_id: string, decision: "approved"|"rejected" }' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  const db = createClient({
    baseUrl: Deno.env.get('INSFORGE_INTERNAL_URL') || Deno.env.get('INSFORGE_BASE_URL')!,
    anonKey: Deno.env.get('ANON_KEY')!,
  });

  const logErr = (label: string, r: { error: unknown }) => {
    if (r.error) console.error(`[execute-action:${decision}:${label}]`, r.error);
  };

  const [apprRes, stateRes] = await Promise.all([
    db.database.from('approvals').insert([{ plan_id: planId, decision }]),
    db.database.from('current_state').update({ status: decision, updated_at: new Date().toISOString() }).eq('id', 1),
  ]);
  logErr('insert approvals', apprRes);
  logErr('update current_state', stateRes);

  let actionCount = 0;
  if (decision === 'approved') {
    const planActionsRes = await db.database.from('plans').select('agent_id,actions').eq('id', planId).single();
    logErr('select plan actions', planActionsRes);
    if (planActionsRes.data?.actions) {
      const actions: PlanAction[] = planActionsRes.data.actions;
      actionCount = actions.length;
      await Promise.all(actions.map((a) => {
        if (a.type === 'slack_message') return fireSlack(a);
        if (a.type === 'calendar_create') return fireCalendar(a);
        return Promise.resolve();
      }));
    }
  }

  const planRowRes = await db.database.from('plans').select('agent_id').eq('id', planId).single();
  logErr('select plan agent_id', planRowRes);
  const agentId = planRowRes.data?.agent_id ?? planId;
  const shortName = agentId.replace(/_ceo$/, '').replace(/_/g, ' ');

  logErr('insert event_log', await db.database.from('event_log').insert([{
    round: 0,
    source: 'system',
    kind: 'system',
    narration: decision === 'approved'
      ? `Human approved ${shortName}'s plan. Firing ${actionCount} action(s).`
      : `Human rejected ${shortName}'s plan.`,
  }]));

  return new Response(JSON.stringify({ ok: true, actions_fired: actionCount }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
