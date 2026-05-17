import { createClient } from 'npm:@insforge/sdk';

import Supermemory from 'npm:supermemory';

export const GT_AGENT_IDS = ['aggressive_ceo', 'conservative_ceo', 'balanced_ceo'] as const;

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

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const NULL_UUID = '00000000-0000-0000-0000-000000000000';

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  let query: string;
  let callerPhone: string | undefined;
  try {
    const body = await req.json();
    query = body.query;
    callerPhone = body.caller_phone;
    if (!query?.trim()) throw new Error();
  } catch {
    return new Response(JSON.stringify({ error: 'Body must be { query: string, caller_phone?: string }' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const db = createClient({
    baseUrl: Deno.env.get('INSFORGE_INTERNAL_URL') || Deno.env.get('INSFORGE_BASE_URL')!,
    anonKey: Deno.env.get('ANON_KEY')!,
  });

  const logErr = (label: string, r: { error: unknown }) => {
    if (r.error) console.error(`[start-session:${label}]`, r.error);
  };

  const priorTokRes = await db.database.from('current_state').select('session_token').eq('id', 1).maybeSingle();
  logErr('select prior session_token', priorTokRes);
  const priorToken = priorTokRes.data?.session_token as string | undefined;

  logErr('delete approvals', await db.database.from('approvals').delete().neq('id', NULL_UUID));
  logErr('delete decisions', await db.database.from('decisions').delete().neq('id', NULL_UUID));
  logErr('delete event_log', await db.database.from('event_log').delete().neq('id', NULL_UUID));
  logErr('delete plans', await db.database.from('plans').delete().neq('id', NULL_UUID));

  const agentsSeedRes = await db.database.from('agents').select('id,persona,style');
  logErr('select agents (seed)', agentsSeedRes);
  const agentsForSeed = agentsSeedRes.data ?? [];

  const context = buildContext();

  const newSessionToken = crypto.randomUUID();

  const stateUpdate: Record<string, unknown> = {
    query,
    round: 1,
    status: 'round1',
    neo4j_context: context,
    alive_plan_ids: [],
    approvals: {},
    session_token: newSessionToken,
    updated_at: new Date().toISOString(),
  };
  if (callerPhone !== undefined) stateUpdate.caller_phone = callerPhone;

  logErr('update current_state', await db.database.from('current_state').update(stateUpdate).eq('id', 1));

  logErr('insert event_log', await db.database.from('event_log').insert([{
    round: 1,
    source: 'system',
    kind: 'system',
    narration: callerPhone
      ? `Session triggered via SMS from ${callerPhone}. Context loaded. Dispatching board.`
      : 'New query received. Context loaded. Dispatching board.',
  }]));

  const sm = getClient();
  if (sm) {
    const tg = tags(newSessionToken);
    await bootstrapSettings(sm);

    const priorTags = priorSessionBulkTags(priorToken ?? null);
    await safeCall('deleteBulk prior', undefined, async () => {
      if (!priorTags.length) {
        console.log('[sm:deleteBulk prior] no prior session');
        return undefined;
      }
      const resp = await sm.documents.deleteBulk({ containerTags: priorTags });
      console.log('[sm:deleteBulk prior]', `deleted ${resp?.deletedCount ?? '?'}`);
      return undefined;
    });

    const queryId = crypto.randomUUID();
    await safeCall('queries.add', undefined, async () => {
      await sm.add({
        containerTag: tg.queries,
        content: query,
        customId: queryId,
        metadata: { session_token: newSessionToken },
      });
      console.log('[sm:add query]', `customId=${queryId}`);
      return undefined;
    });

    await Promise.all(agentsForSeed.map((row) =>
      safeCall(`memories.seed.${row.id}`, undefined, async () => {
        await sm.memories.updateMemory({
          containerTag: tg.agent(row.id),
          newContent: `${row.persona}\n\n${row.style}`,
        });
        console.log('[sm:memories.seed]', row.id);
        return undefined;
      })
    ));

    console.log('[sm:start-session]', `session_token=${newSessionToken}`);
  } else {
    console.warn('[sm:start-session] SUPERMEMORY_API_KEY missing — skipping Supermemory ingestion');
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
