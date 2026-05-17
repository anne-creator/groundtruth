import { createClient } from 'npm:@insforge/sdk';

// Called by the frontend when status='complete' and caller_phone is set.
// Places an outbound call via AgentPhone to deliver the winning recommendation.
// The conversation (approve/reject) is handled by /agentphone-webhook (voice path).

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

  // Read state: caller phone + winning plan
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
    ? ` Computed runway: ${runway.actual_projected_months.toFixed(1)} months, with cash zero on ${runway.cash_zero_date ?? 'unknown date'}.`
    : '';
  const confidenceNote = confidence != null ? ` Confidence: ${Math.round(confidence * 100)} percent.` : '';

  const greeting =
    `Hello. This is ${persona}, calling on behalf of your GroundTruth board. ` +
    `Your question was: "${query}". ` +
    `After three rounds of structured debate, the board has reached a recommendation. ` +
    `${persona} says: ${content}.` +
    `${runwayNote}${confidenceNote} ` +
    `Please say "approve" to execute this recommendation, or "reject" to decline.`;

  const systemPrompt =
    `You are ${persona}, an AI board member who has just finished a structured debate. ` +
    `You have called the user to deliver the board's recommendation. ` +
    `Be concise and professional. If the user says "approve", "yes", "confirmed", "do it", or similar — confirm you heard them and say the recommendation will execute. ` +
    `If the user says "reject", "no", "decline", or similar — acknowledge politely and say you will stand by. ` +
    `If the user asks a question about the recommendation, answer briefly in character as ${persona}, then ask again for approve or reject. ` +
    `Keep all responses under 40 words.`;

  // Place the outbound call via AgentPhone
  const agentPhoneKey = Deno.env.get('AGENTPHONE_API_KEY');
  const agentPhoneAgentId = Deno.env.get('AGENTPHONE_AGENT_ID');

  if (!agentPhoneKey || !agentPhoneAgentId) {
    console.error('[call-user] Missing AGENTPHONE_API_KEY or AGENTPHONE_AGENT_ID');
    return Response.json({ error: 'AgentPhone not configured' }, { status: 500, headers: CORS });
  }

  const callBody: Record<string, unknown> = {
    agentId: agentPhoneAgentId,
    toNumber: callerPhone,
    initialGreeting: greeting,
    systemPrompt,
  };

  const numberIdEnv = Deno.env.get('AGENTPHONE_NUMBER_ID');
  if (numberIdEnv) callBody.fromNumberId = numberIdEnv;

  const callRes = await fetch('https://api.agentphone.ai/v1/calls', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${agentPhoneKey}`,
    },
    body: JSON.stringify(callBody),
  });

  if (!callRes.ok) {
    const errText = await callRes.text();
    console.error('[call-user] AgentPhone error', callRes.status, errText);
    return Response.json({ error: `AgentPhone returned ${callRes.status}`, detail: errText }, { status: 502, headers: CORS });
  }

  const callData = await callRes.json();

  // Log the call in event_log
  await db.database.from('event_log').insert([{
    round: 0,
    source: 'system',
    kind: 'system',
    narration: `Board calling ${callerPhone} — ${persona} delivering recommendation.`,
  }]);

  return Response.json({ ok: true, call: callData }, { status: 200, headers: CORS });
}
