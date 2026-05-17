import { createClient } from 'npm:@insforge/sdk';

// Called by the frontend when status='complete' and caller_phone is set.
// Sends an SMS via AgentPhone delivering the winning recommendation.
// Inbound SMS replies ("approve"/"reject") are handled by /agentphone-webhook.

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

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  const db = createClient({
    baseUrl: Deno.env.get('INSFORGE_INTERNAL_URL') || Deno.env.get('INSFORGE_BASE_URL')!,
    anonKey: Deno.env.get('ANON_KEY')!,
  });

  const stateRes = await db.database
    .from('current_state')
    .select('caller_phone,alive_plan_ids,query')
    .eq('id', 1)
    .single();

  if (stateRes.error || !stateRes.data) {
    return Response.json({ error: 'Could not read session state' }, { status: 500, headers: CORS });
  }

  const { caller_phone: callerPhone, alive_plan_ids: alivePlanIds, query } = stateRes.data;

  if (!callerPhone) {
    return Response.json({ error: 'No caller phone on record — session was not SMS-triggered' }, { status: 400, headers: CORS });
  }

  const winningPlanId: string | undefined = alivePlanIds?.[0];
  if (!winningPlanId) {
    return Response.json({ error: 'No winning plan found' }, { status: 400, headers: CORS });
  }

  const planRes = await db.database
    .from('plans')
    .select('agent_id,content,logic_plan,confidence')
    .eq('id', winningPlanId)
    .single();

  if (planRes.error || !planRes.data) {
    return Response.json({ error: 'Could not read winning plan' }, { status: 500, headers: CORS });
  }

  const { agent_id: agentId, content, logic_plan: logicPlan, confidence } = planRes.data;
  const persona = PERSONA_NAMES[agentId] ?? 'Your advisor';
  const runway = (logicPlan as { computed_runway?: { actual_projected_months?: number; cash_zero_date?: string } })
    ?.computed_runway;
  const runwayNote = runway?.actual_projected_months != null
    ? ` Runway: ${runway.actual_projected_months.toFixed(1)}mo.`
    : '';
  const confidenceNote = confidence != null ? ` Confidence: ${Math.round(confidence * 100)}%.` : '';

  const message =
    `GroundTruth board — recommendation for: "${query}"\n` +
    `From ${persona}: ${content}\n` +
    `${runwayNote}${confidenceNote}\n` +
    `Reply APPROVE to execute or REJECT to decline.`;

  const agentPhoneKey = Deno.env.get('AGENTPHONE_API_KEY');
  const agentPhoneAgentId = Deno.env.get('AGENTPHONE_AGENT_ID');

  if (!agentPhoneKey || !agentPhoneAgentId) {
    console.error('[text-user] Missing AGENTPHONE_API_KEY or AGENTPHONE_AGENT_ID');
    return Response.json({ error: 'AgentPhone not configured' }, { status: 500, headers: CORS });
  }

  const smsBody: Record<string, unknown> = {
    agentId: agentPhoneAgentId,
    toNumber: callerPhone,
    message,
  };

  const numberIdEnv = Deno.env.get('AGENTPHONE_NUMBER_ID');
  if (numberIdEnv) smsBody.fromNumberId = numberIdEnv;

  const smsRes = await fetch('https://api.agentphone.ai/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${agentPhoneKey}`,
    },
    body: JSON.stringify(smsBody),
  });

  if (!smsRes.ok) {
    const errText = await smsRes.text();
    console.error('[text-user] AgentPhone error', smsRes.status, errText);
    return Response.json({ error: `AgentPhone returned ${smsRes.status}`, detail: errText }, { status: 502, headers: CORS });
  }

  const smsData = await smsRes.json();

  await db.database.from('event_log').insert([{
    round: 0,
    source: 'system',
    kind: 'system',
    narration: `Board texted ${callerPhone} — ${persona} delivering recommendation.`,
  }]);

  return Response.json({ ok: true, sms: smsData }, { status: 200, headers: CORS });
}
