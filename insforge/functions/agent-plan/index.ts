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

/** Long-lived raw-source corpora. Session uploads can still be searched alongside them. */
const SOURCE_EVIDENCE_TAGS = ['sm_project_default'];

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

function formatEvidenceChunks(
  results: Array<{ chunks?: Array<{ content: string }>; summary?: string | null }>,
): string {
  if (!results?.length) return '(No semantic evidence retrieval hits — infer carefully from profile + question alone.)';
  return results.slice(0, 12).map((r, i) => {
    const bit = (
      r.summary?.trim()
      ?? r.chunks?.map((c) => c.content).filter(Boolean).join(' | ')
      ?? ''
    );
    const cut = bit.length > 800 ? `${bit.slice(0, 800)}…` : bit;
    return `[Evidence ${i + 1}] ${cut}`;
  }).join('\n');
}

function fixtureEvidenceFallback(): string {
  return [
    '[Fixture fallback]',
    'Company: Acme (YC W26)',
    'Cash position: $480,000 as of 2026-05-09',
    'Gross monthly burn: $95,000 as of 2026-05-09',
    'Demo Day: 2026-08-15',
    'Seed round: target $3,000,000; committed $750,000; status in_progress',
    'Acme Ventures: $500,000 verbal commitment',
    'Beta Capital: $250,000 term sheet expiring 2026-06-30',
    'Runway constraint: need a 3-month cushion entering Demo Day',
    'Threat: Beta term sheet expires before Demo Day',
  ].join('\n');
}

type EvidenceResult = { documentId?: string; chunks?: Array<{ content: string }>; summary?: string | null };

function mergeSearchResults(...groups: Array<{ results: EvidenceResult[]; total: number; timing: number }>) {
  const seen = new Set<string>();
  const results = groups.flatMap((group) => group.results).filter((result) => {
    const key = result.documentId ?? JSON.stringify(result);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return {
    results,
    total: results.length,
    timing: groups.reduce((sum, group) => sum + (group.timing ?? 0), 0),
  };
}

function systemPrompt(persona: string, style: string) {
  return `You are a CEO advisor with this profile:\n${persona}\n\nCommunication style: ${style}\n\nYou will be given a strategic question plus retrieved company evidence.\n\nRespond with ONLY a JSON object — no markdown, no explanation:\n{\n  "content": "<one-line decisive conclusion, max 20 words>",\n  "logic_plan": {\n    "steps": [\n      {\n        "claim": "<specific factual claim>",\n        "evidence": [{ "id": "<node_id>", "source": "<url>", "confidence": <0-1> }],\n        "computed": { "<key>": <value> }\n      }\n    ],\n    "computed_runway": {\n      "actual_projected_months": <number>,\n      "cash_zero_date": "<YYYY-MM-DD>",\n      "earliest_fundraise_close": "<YYYY-MM-DD or null>",\n      "is_breached": <boolean>\n    }\n  },\n  "actions": [\n    { "type": "slack_message", "channel": "<#channel>", "body": "<message>" }\n  ],\n  "confidence": <0-1>\n}\nActions may include: slack_message, graph_annotation, calendar_create. Base all numbers on the retrieved evidence.`;
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
    db.database.from('current_state').select('query,session_token').eq('id', 1).single(),
    db.database.from('agents').select('id,persona,style').eq('id', agentId).single(),
  ]);
  logErr('select current_state', stateRes);
  logErr('select agents', agentRes);
  const stateData = stateRes.data as { query: string | null; session_token?: string | null } | null;
  const agentData = agentRes.data;

  if (!stateData || !agentData) {
    return Response.json({ error: 'State or agent not found' }, { status: 404, headers: CORS });
  }

  const token = stateData.session_token ?? null;
  const sm = getClient();
  const tg = token && sm ? tags(token) : null;

  const profileRes = tg && sm && stateData.query
    ? await safeCall(`profile.${agentId}`, EMPTY_PROFILE, () =>
      sm.profile({ containerTag: tg.agent(agentId), q: stateData.query!, threshold: 0.5 }))
    : EMPTY_PROFILE;

  const evidRes = tg && sm && stateData.query
    ? mergeSearchResults(
      await safeCall('search.documents.sources', EMPTY_SEARCH, () =>
        sm.search.documents({
          containerTags: SOURCE_EVIDENCE_TAGS,
          q: stateData.query!,
          limit: 12,
          rerank: true,
        })),
      await safeCall('search.documents.session', EMPTY_SEARCH, () =>
        sm.search.documents({
          containerTags: [tg.evidence],
          q: stateData.query!,
          limit: 12,
          rerank: true,
        })),
    )
    : EMPTY_SEARCH;

  const staticBits = [...(profileRes.profile.static ?? [])].join('\n');
  const dynamicBits = [...(profileRes.profile.dynamic ?? [])].join('\n');
  const evidenceBlock = evidRes.results.length
    ? formatEvidenceChunks(evidRes.results as Array<{ chunks?: Array<{ content: string }>; summary?: string | null }>)
    : fixtureEvidenceFallback();

  console.log(`[agent-plan:${agentId}] sm.profile static=${profileRes.profile.static.length} dynamic=${profileRes.profile.dynamic.length}; evidence hits=${evidRes.results.length}; fallback=${evidRes.results.length === 0}`);

  const userPrompt =
    `Question: ${stateData.query}\n\n` +
    `Profile (static cues):\n${staticBits || '(none)'}\n\n` +
    `Profile (recent / dynamic cues):\n${dynamicBits || '(none)'}\n\n` +
    `Evidence retrieval (chunks / summaries):\n${evidenceBlock}`;

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
  const planId = planRes.data?.id as string | undefined;

  const shortName = personaName(agentId);
  const months = planData.logic_plan.computed_runway?.actual_projected_months;
  const runwayNote = months != null ? ` (computed runway ${months}mo)` : '';

  const evtRes = await db.database.from('event_log').insert([{
    round: 1,
    source: agentId,
    kind: 'plan',
    narration: `${shortName}: "${planData.content}"${runwayNote}`,
  }]);
  logErr('insert event_log', evtRes);

  if (sm && tg && planId) {
    await safeCall(`documents.add plan ${planId}`, undefined, async () => {
      await sm.documents.add({
        containerTag: tg.plans,
        content: JSON.stringify(planData),
        customId: planId,
        metadata: {
          agent_id: agentId,
          round: 1,
          plan_id: planId,
          confidence: planData.confidence ?? 0,
        },
        entityContext: agentData.persona,
      });
      return undefined;
    });
    const thought = `Round 1: proposed "${planData.content}"`;
    await safeCall(`memories.update.${agentId}`, undefined, async () => {
      await sm.memories.updateMemory({
        containerTag: tg.agent(agentId),
        newContent: thought,
      });
      return undefined;
    });
  }

  return new Response(JSON.stringify({ ok: true, plan_id: planId }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
