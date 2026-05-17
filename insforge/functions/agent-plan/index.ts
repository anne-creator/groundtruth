import { createClient } from 'npm:@insforge/sdk';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function systemPrompt(persona: string, style: string) {
  return `You are a CEO advisor with this profile:\n${persona}\n\nCommunication style: ${style}\n\nYou will be given a strategic question and financial context from the company knowledge graph.\n\nRespond with ONLY a JSON object — no markdown, no explanation:\n{\n  "content": "<one-line decisive conclusion, max 20 words>",\n  "logic_plan": {\n    "steps": [\n      {\n        "claim": "<specific factual claim>",\n        "evidence": [{ "id": "<node_id>", "source": "<url>", "confidence": <0-1> }],\n        "computed": { "<key>": <value> }\n      }\n    ],\n    "computed_runway": {\n      "actual_projected_months": <number>,\n      "cash_zero_date": "<YYYY-MM-DD>",\n      "earliest_fundraise_close": "<YYYY-MM-DD or null>",\n      "is_breached": <boolean>\n    }\n  },\n  "actions": [\n    { "type": "slack_message", "channel": "<#channel>", "body": "<message>" }\n  ],\n  "confidence": <0-1>\n}\nActions may include: slack_message, graph_annotation, calendar_create. Base all numbers on the graph context.`;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  let agentId: string;
  try {
    ({ agent_id: agentId } = await req.json());
    if (!agentId) throw new Error();
  } catch {
    return Response.json({ error: 'Body must be { agent_id: string }' }, { status: 400, headers: CORS });
  }

  const db = createClient({
    baseUrl: Deno.env.get('INSFORGE_INTERNAL_URL') || Deno.env.get('INSFORGE_BASE_URL')!,
    anonKey: Deno.env.get('ANON_KEY')!,
  });

  const logErr = (label: string, r: { error: unknown }) => {
    if (r.error) console.error(`[agent-plan:${agentId}:${label}]`, r.error);
  };

  const [stateRes, agentRes] = await Promise.all([
    db.database.from('current_state').select('query,neo4j_context').eq('id', 1).single(),
    db.database.from('agents').select('id,persona,style,memory').eq('id', agentId).single(),
  ]);
  logErr('select current_state', stateRes);
  logErr('select agents', agentRes);
  const stateData = stateRes.data;
  const agentData = agentRes.data;

  if (!stateData || !agentData) {
    return Response.json({ error: 'State or agent not found' }, { status: 404, headers: CORS });
  }

  const userPrompt = `Question: ${stateData.query}\n\nGraph context:\n${JSON.stringify(stateData.neo4j_context, null, 2)}\n\nPrevious memory:\n${JSON.stringify(agentData.memory)}`;

  let planData: {
    content: string;
    logic_plan: { steps: unknown[]; computed_runway: { actual_projected_months?: number } };
    actions: unknown[];
    confidence: number;
  };

  try {
    const aiRes = await fetch(`${Deno.env.get('INSFORGE_BASE_URL')}/api/ai/chat/completion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${Deno.env.get('ANON_KEY')}` },
      body: JSON.stringify({
        model: 'anthropic/claude-sonnet-4.5',
        messages: [
          { role: 'system', content: systemPrompt(agentData.persona, agentData.style) },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.7,
      }),
    });
    if (!aiRes.ok) throw new Error(`AI ${aiRes.status} ${await aiRes.text()}`);
    const raw = (await aiRes.json()).text.trim().replace(/^```json\s*|\s*```$/g, '');
    planData = JSON.parse(raw);
  } catch (err) {
    console.error('LLM failure', agentId, err);
    planData = {
      content: `${agentId.replace(/_/g, ' ')}: unable to generate plan at this time.`,
      logic_plan: { steps: [], computed_runway: { actual_projected_months: 0 } },
      actions: [],
      confidence: 0,
    };
  }

  const planRes = await db.database
    .from('plans')
    .insert([{
      agent_id: agentId,
      content: planData.content,
      logic_plan: planData.logic_plan,
      actions: planData.actions,
      confidence: planData.confidence,
    }])
    .select('id')
    .single();
  logErr('insert plans', planRes);
  const planId = planRes.data?.id;

  const shortName = agentId.replace(/_ceo$/, '').replace(/_/g, ' ');
  const months = planData.logic_plan.computed_runway?.actual_projected_months;
  const runwayNote = months != null ? ` (computed runway ${months}mo)` : '';

  const [evtRes, memRes] = await Promise.all([
    db.database.from('event_log').insert([{
      round: 1,
      source: agentId,
      kind: 'plan',
      narration: `${shortName}: "${planData.content}"${runwayNote}`,
    }]),
    db.database.from('agents').update({
      memory: {
        ...agentData.memory,
        thoughts: [...(agentData.memory?.thoughts ?? []), `Round 1: proposed "${planData.content}"`],
        recent_actions: [`plan:${planId}`],
      },
    }).eq('id', agentId),
  ]);
  logErr('insert event_log', evtRes);
  logErr('update agents', memRes);

  return new Response(JSON.stringify({ ok: true, plan_id: planId }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
