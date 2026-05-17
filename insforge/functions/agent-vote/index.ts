import { createClient } from 'npm:@insforge/sdk';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function systemPrompt(persona: string, style: string, round: number) {
  return `You are a CEO advisor with this profile:\n${persona}\n\nCommunication style: ${style}\n\nIt is round ${round} of a structured debate. Choose the plan you believe is BEST — you may vote for your own or switch.\n\nRespond with ONLY a JSON object — no markdown, no explanation:\n{\n  "chosen_plan_id": "<uuid>",\n  "is_own_plan": <boolean>,\n  "reasoning": "<2-3 sentences grounded in evidence>"\n}`;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  let agentId: string;
  let round: number;
  try {
    ({ agent_id: agentId, round } = await req.json());
    if (!agentId || ![2, 3].includes(round)) throw new Error();
  } catch {
    return new Response(JSON.stringify({ error: 'Body must be { agent_id: string, round: 2|3 }' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  const db = createClient({
    baseUrl: Deno.env.get('INSFORGE_INTERNAL_URL') || Deno.env.get('INSFORGE_BASE_URL')!,
    anonKey: Deno.env.get('ANON_KEY')!,
  });

  const logErr = (label: string, r: { error: unknown }) => {
    if (r.error) console.error(`[agent-vote:${agentId}:r${round}:${label}]`, r.error);
  };

  const [stateRes, agentRes] = await Promise.all([
    db.database.from('current_state').select('query,alive_plan_ids').eq('id', 1).single(),
    db.database.from('agents').select('id,persona,style,memory').eq('id', agentId).single(),
  ]);
  logErr('select current_state', stateRes);
  logErr('select agents', agentRes);
  const stateData = stateRes.data;
  const agentData = agentRes.data;

  if (!stateData || !agentData) {
    return new Response(JSON.stringify({ error: 'State or agent not found' }), { status: 404, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  const alivePlanIds: string[] = stateData.alive_plan_ids ?? [];

  const [alivePlansRes, prevDecisionsRes, ownPlanRes] = await Promise.all([
    db.database.from('plans').select('id,agent_id,content,logic_plan,confidence').in('id', alivePlanIds),
    db.database.from('decisions').select('agent_id,chosen_plan_id,is_own_plan,reasoning').eq('round', round - 1),
    db.database.from('plans').select('id').eq('agent_id', agentId).maybeSingle(),
  ]);
  logErr('select alive plans', alivePlansRes);
  logErr('select prev decisions', prevDecisionsRes);
  logErr('select own plan', ownPlanRes);
  const alivePlans = alivePlansRes.data;
  const prevDecisions = prevDecisionsRes.data;
  const ownPlan = ownPlanRes.data;

  const ownPlanId = ownPlan?.id;

  const userPrompt = `Original question: ${stateData.query}\n\nSurviving plans:\n${JSON.stringify(alivePlans, null, 2)}\n\nPrevious round votes (round ${round - 1}):\n${JSON.stringify(prevDecisions, null, 2)}\n\nYour memory: ${JSON.stringify(agentData.memory)}\n\nYour own plan ID: ${ownPlanId ?? 'none (your plan was eliminated)'}`;

  let voteData: { chosen_plan_id: string; is_own_plan: boolean; reasoning: string };

  try {
    const aiRes = await fetch(`${Deno.env.get('INSFORGE_BASE_URL')}/api/ai/chat/completion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${Deno.env.get('ANON_KEY')}` },
      body: JSON.stringify({
        model: 'anthropic/claude-sonnet-4.5',
        messages: [
          { role: 'system', content: systemPrompt(agentData.persona, agentData.style, round) },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.5,
      }),
    });
    if (!aiRes.ok) throw new Error(`AI ${aiRes.status} ${await aiRes.text()}`);
    const raw = (await aiRes.json()).text.trim().replace(/^```json\s*|\s*```$/g, '');
    voteData = JSON.parse(raw);
    if (!alivePlanIds.includes(voteData.chosen_plan_id)) {
      voteData.chosen_plan_id = alivePlanIds[0];
      voteData.reasoning = '(Fallback: choice not in alive set.) ' + voteData.reasoning;
    }
  } catch (err) {
    console.error('LLM vote failure', agentId, round, err);
    const fallbackId = ownPlanId && alivePlanIds.includes(ownPlanId) ? ownPlanId : alivePlanIds[0];
    voteData = { chosen_plan_id: fallbackId, is_own_plan: fallbackId === ownPlanId, reasoning: 'Unable to deliberate; defaulting to previous position.' };
  }

  logErr('insert decisions', await db.database.from('decisions').insert([{
    agent_id: agentId,
    round,
    chosen_plan_id: voteData.chosen_plan_id,
    is_own_plan: voteData.is_own_plan,
    reasoning: voteData.reasoning,
  }]));

  const chosenPlan = (alivePlans ?? []).find((p: { id: string }) => p.id === voteData.chosen_plan_id);
  const chosenAgentId = (chosenPlan as { agent_id?: string } | undefined)?.agent_id ?? 'unknown';
  const shortSelf = agentId.replace(/_ceo$/, '').replace(/_/g, ' ');
  const shortChosen = chosenAgentId.replace(/_ceo$/, '').replace(/_/g, ' ');
  const action = voteData.is_own_plan ? 'holds firm on own plan' : `switches → ${shortChosen}'s plan`;

  const [evtRes, memRes] = await Promise.all([
    db.database.from('event_log').insert([{
      round,
      source: agentId,
      kind: 'vote',
      narration: `${shortSelf} ${action}. Reason: ${voteData.reasoning}`,
    }]),
    db.database.from('agents').update({
      memory: {
        ...agentData.memory,
        thoughts: [
          ...(agentData.memory?.thoughts ?? []),
          `Round ${round}: voted for ${voteData.is_own_plan ? 'own' : shortChosen + "'s"} plan — ${voteData.reasoning.slice(0, 80)}`,
        ],
      },
    }).eq('id', agentId),
  ]);
  logErr('insert event_log', evtRes);
  logErr('update agents', memRes);

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
