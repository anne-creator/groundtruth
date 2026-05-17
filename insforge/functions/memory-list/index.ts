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

/** Long-lived raw-source corpora. Session uploads can still be listed alongside them. */
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

const EMPTY_PROC = { documents: [] as Array<{ status?: string; id?: string }> };

type SearchResult = { documentId?: string; title?: string | null; chunks?: Array<{ content?: string }> };

function mergeSearchResults(...groups: Array<{ results: SearchResult[]; total: number; timing: number }>) {
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

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  let agentIdBody: string | undefined;
  let q: string | undefined;
  try {
    const b = await req.json();
    agentIdBody = typeof b.agentId === 'string' ? b.agentId : undefined;
    q = typeof b.q === 'string' ? b.q : undefined;
  } catch {
    return Response.json({ error: 'Body must be JSON' }, { status: 400, headers: CORS });
  }

  const db = createClient({
    baseUrl: Deno.env.get('INSFORGE_INTERNAL_URL') || Deno.env.get('INSFORGE_BASE_URL')!,
    anonKey: Deno.env.get('ANON_KEY')!,
  });

  const stateRes = await db.database.from('current_state').select('session_token,query').eq('id', 1).maybeSingle();

  const sm = getClient();
  const token = stateRes.data?.session_token as string | undefined;
  const sessionQuery = stateRes.data?.query as string | null | undefined;

  if (!sm || !token) {
    return Response.json({
      ok: true,
      unavailable: true,
      sessionQuery,
      profiles: {},
      evidenceList: EMPTY_LIST,
      evidenceSearch: EMPTY_SEARCH,
      processing: EMPTY_PROC,
    }, { headers: CORS });
  }

  let tg;
  try {
    tg = tags(token);
  } catch {
    return Response.json({ ok: true, unavailable: true, sessionQuery }, { headers: CORS });
  }

  const profileQ = ([sessionQuery, q ?? ''].find((x) => x?.trim()) ?? '').trim();

  const targetAgents = agentIdBody && GT_AGENT_IDS.includes(agentIdBody as typeof GT_AGENT_IDS[number])
    ? [agentIdBody as typeof GT_AGENT_IDS[number]]
    : [...GT_AGENT_IDS];

  const profiles: Record<string, typeof EMPTY_PROFILE> = {};
  await Promise.all(targetAgents.map((id) => (async () => {
    profiles[id] = await safeCall(`memory-list.profile.${id}`, EMPTY_PROFILE, () =>
      profileQ.length
        ? sm.profile({ containerTag: tg.agent(id), q: profileQ, threshold: 0.5 })
        : sm.profile({ containerTag: tg.agent(id) }));
  })()));

  const [sourceDocs, sessionEvidenceList] = await Promise.all([
    safeCall('memory-list.source-docs', [] as Array<{ id: string; title?: string | null; summary?: string | null; status?: string }>, () =>
      sm.connections.listDocuments('notion', { containerTags: SOURCE_EVIDENCE_TAGS })),
    safeCall('memory-list.session-evidence', EMPTY_LIST, () =>
      sm.documents.list({
        containerTags: [tg.evidence],
        limit: 40,
        includeContent: false,
      })),
  ]);

  const evidenceList = {
    memories: [...sourceDocs, ...sessionEvidenceList.memories],
    pagination: {
      currentPage: 1,
      totalItems: sourceDocs.length + sessionEvidenceList.memories.length,
      totalPages: 1,
    },
  };

  const trimmedQ = q?.trim() ?? '';
  const evidenceSearch = trimmedQ.length > 0
    ? mergeSearchResults(
      await safeCall('memory-list.search.sources', EMPTY_SEARCH, () =>
        sm.search.execute({
          q: trimmedQ,
          containerTags: SOURCE_EVIDENCE_TAGS,
          limit: 12,
          rerank: true,
        })),
      await safeCall('memory-list.search.session', EMPTY_SEARCH, () =>
        sm.search.execute({
          q: trimmedQ,
          containerTags: [tg.evidence],
          limit: 12,
          rerank: true,
        })),
    )
    : EMPTY_SEARCH;

  const processing = await safeCall('memory-list.processing', EMPTY_PROC, () => sm.documents.listProcessing());

  return Response.json({
    ok: true,
    unavailable: false,
    sessionQuery,
    profiles,
    evidenceList,
    evidenceSearch,
    processing,
  }, { headers: CORS });
}
