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
  if (!results?.length) return '(No semantic evidence retrieval hits.)';
  return results.slice(0, 10).map((r, i) => {
    const bit = (
      r.summary?.trim()
      ?? r.chunks?.map((c) => c.content).filter(Boolean).join(' | ')
      ?? ''
    );
    const cut = bit.length > 600 ? `${bit.slice(0, 600)}…` : bit;
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

function snippetsFromMemorySearch(results: Array<{ memory?: string; chunk?: string }>): string {
  if (!results?.length) return '(none)';
  return results.slice(0, 3).map((r, i) => `  ${i + 1}. ${(r.memory ?? r.chunk ?? '').slice(0, 220)}`).join('\n');
}

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
    db.database.from('current_state').select('query,session_token,alive_plan_ids').eq('id', 1).single(),
    db.database.from('agents').select('id,persona,style').eq('id', agentId).single(),
  ]);
  logErr('select current_state', stateRes);
  logErr('select agents', agentRes);
  const stateData = stateRes.data as {
    query: string | null;
    session_token?: string | null;
    alive_plan_ids: string[] | null;
  } | null;
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

  const token = stateData.session_token ?? null;
  const sm = getClient();
  const tg = token && sm ? tags(token) : null;
  const question = stateData.query ?? '';

  const profileRes = tg && sm && question
    ? await safeCall(`profile.${agentId}.r${round}`, EMPTY_PROFILE, () =>
      sm.profile({ containerTag: tg.agent(agentId), q: question, threshold: 0.5 }))
    : EMPTY_PROFILE;

  const evidRes = tg && sm && question
    ? mergeSearchResults(
      await safeCall(`search.sources.r${round}`, EMPTY_SEARCH, () =>
        sm.search.documents({
          containerTags: SOURCE_EVIDENCE_TAGS,
          q: question,
          limit: 10,
          rerank: true,
        })),
      await safeCall(`search.session.r${round}`, EMPTY_SEARCH, () =>
        sm.search.documents({
          containerTags: [tg.evidence],
          q: question,
          limit: 10,
          rerank: true,
        })),
    )
    : EMPTY_SEARCH;

  const rivals = [...GT_AGENT_IDS].filter((id) => id !== agentId);
  const rivalBlocks: string[] = [];
  for (const rivalId of rivals) {
    if (!tg || !sm) continue;
    const mem = await safeCall(`memories.${rivalId}.r${round}`, EMPTY_SEARCH, () =>
      sm.search.memories({
        containerTag: tg.agent(rivalId),
        q: `reasoning round ${round - 1}`,
        limit: 6,
      }));
    rivalBlocks.push(
      `[Rival memory search: ${rivalId}]\n${snippetsFromMemorySearch(mem.results as Array<{ memory?: string; chunk?: string }>)}`,
    );
  }

  const staticBits = [...(profileRes.profile.static ?? [])].join('\n');
  const dynamicBits = [...(profileRes.profile.dynamic ?? [])].join('\n');
  const evidenceBlock = evidRes.results.length
    ? formatEvidenceChunks(evidRes.results as Array<{ chunks?: Array<{ content: string }>; summary?: string | null }>)
    : fixtureEvidenceFallback();

  const userPrompt =
    `Original question: ${question}\n\n` +
    `Your profile cues (static):\n${staticBits || '(none)'}\n\n` +
    `Your profile cues (dynamic):\n${dynamicBits || '(none)'}\n\n` +
    `Evidence retrieval:\n${evidenceBlock}\n\n` +
    (rivalBlocks.length ? `Rivals' prior reasoning (memory search):\n${rivalBlocks.join('\n\n')}\n\n` : '') +
    `Surviving plans:\n${JSON.stringify(alivePlans, null, 2)}\n\n` +
    `Previous round votes (round ${round - 1}):\n${JSON.stringify(prevDecisions, null, 2)}\n\n` +
    `Your own plan ID: ${ownPlanId ?? 'none (your plan was eliminated)'}`;

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

  const insRes = await db.database.from('decisions').insert([{
    agent_id: agentId,
    round,
    chosen_plan_id: voteData.chosen_plan_id,
    is_own_plan: voteData.is_own_plan,
    reasoning: voteData.reasoning,
  }]).select('id').single();
  logErr('insert decisions', insRes);
  const decisionId = insRes.data?.id as string | undefined;

  const chosenPlan = (alivePlans ?? []).find((p: { id: string }) => p.id === voteData.chosen_plan_id);
  const chosenAgentId = (chosenPlan as { agent_id?: string } | undefined)?.agent_id ?? 'unknown';
  const shortSelf = personaName(agentId);
  const shortChosen = personaName(chosenAgentId);
  const action = voteData.is_own_plan ? 'holds firm on own plan' : `switches → ${shortChosen}'s plan`;

  const evtRes = await db.database.from('event_log').insert([{
    round,
    source: agentId,
    kind: 'vote',
    narration: `${shortSelf} ${action}. Reason: ${voteData.reasoning}`,
  }]);
  logErr('insert event_log', evtRes);

  if (sm && tg && decisionId) {
    await safeCall(`documents.add decision ${decisionId}`, undefined, async () => {
      await sm.documents.add({
        containerTag: tg.decisions,
        content: JSON.stringify({
          chosen_plan_id: voteData.chosen_plan_id,
          is_own_plan: voteData.is_own_plan,
          reasoning: voteData.reasoning,
        }),
        customId: decisionId,
        metadata: {
          agent_id: agentId,
          round,
          chosen_plan_id: voteData.chosen_plan_id,
          is_own_plan: voteData.is_own_plan,
        },
      });
      return undefined;
    });
    await safeCall(`memories.vote.${agentId}.r${round}`, undefined, async () => {
      await sm.memories.updateMemory({
        containerTag: tg.agent(agentId),
        newContent:
          `Round ${round}: voted ${voteData.is_own_plan ? 'own' : 'other'} — ${voteData.reasoning.slice(0, 140)}`,
      });
      return undefined;
    });
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
