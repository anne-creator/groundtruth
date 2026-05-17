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

function summarizeAction(action: PlanAction): string {
  switch (action.type) {
    case 'slack_message':
      return `Slack → ${action.channel ?? '?'}: ${action.body ?? ''}`;
    case 'graph_annotation':
      return `Annotate ${action.target_id ?? '?'}: ${action.annotation ?? ''}`;
    case 'calendar_create':
      return `Calendar: ${action.title ?? '?'} at ${action.date ?? '?'}`;
    default:
      return JSON.stringify(action);
  }
}

interface NotionRichTextChunk {
  content: string;
  annotations?: Record<string, unknown>;
}

function richText(chunks: NotionRichTextChunk[]) {
  return chunks.map((c) => ({
    type: 'text',
    text: { content: c.content.slice(0, 1800) },
    ...(c.annotations ? { annotations: c.annotations } : {}),
  }));
}

interface PlanRow {
  agent_id: string;
  content: string;
  logic_plan: { steps?: Array<{ claim?: string }> } | null;
  actions: PlanAction[] | null;
  confidence: number | null;
}

async function appendApprovedToNotion(plan: PlanRow): Promise<void> {
  const token = Deno.env.get('NOTION_API_KEY');
  const pageId = Deno.env.get('NOTION_PAGE_ID');
  if (!token || !pageId) return;

  const shortName = personaName(plan.agent_id);
  const title = `Approved: ${shortName} — ${plan.content}`;
  const confidencePct = plan.confidence != null ? `${Math.round(plan.confidence * 100)}%` : 'n/a';
  const meta = `Agent: ${plan.agent_id} · Confidence: ${confidencePct} · Decided: ${new Date().toISOString()}`;

  const nested: Array<Record<string, unknown>> = [
    {
      object: 'block',
      type: 'paragraph',
      paragraph: { rich_text: richText([{ content: meta, annotations: { italic: true, color: 'gray' } }]) },
    },
  ];

  const steps = plan.logic_plan?.steps ?? [];
  if (steps.length > 0) {
    nested.push({
      object: 'block',
      type: 'heading_3',
      heading_3: { rich_text: richText([{ content: 'Reasoning' }]) },
    });
    for (const step of steps) {
      const claim = String(step?.claim ?? '').trim();
      if (!claim) continue;
      nested.push({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: { rich_text: richText([{ content: claim }]) },
      });
    }
  }

  const actions = plan.actions ?? [];
  if (actions.length > 0) {
    nested.push({
      object: 'block',
      type: 'heading_3',
      heading_3: { rich_text: richText([{ content: 'Actions' }]) },
    });
    for (const a of actions) {
      nested.push({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: { rich_text: richText([{ content: summarizeAction(a) }]) },
      });
    }
  }

  const body = {
    children: [
      {
        object: 'block',
        type: 'to_do',
        to_do: {
          rich_text: richText([{ content: title }]),
          checked: false,
          children: nested,
        },
      },
    ],
  };

  try {
    const res = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error('[execute-action:notion]', res.status, await res.text());
    }
  } catch (err) {
    console.error('[execute-action:notion]', err);
  }
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

  const tokRes = await db.database.from('current_state').select('session_token').eq('id', 1).single();
  logErr('select session_token', tokRes);

  const [apprRes, stateRes] = await Promise.all([
    db.database.from('approvals').insert([{ plan_id: planId, decision }]).select('id').single(),
    db.database.from('current_state').update({ status: decision, updated_at: new Date().toISOString() }).eq('id', 1),
  ]);
  logErr('insert approvals', apprRes);
  logErr('update current_state', stateRes);
  const approvalId = apprRes.data?.id as string | undefined;

  const token = tokRes.data?.session_token as string | undefined;
  const sm = getClient();
  const tg = token && sm ? tags(token) : null;
  if (sm && tg && approvalId) {
    await safeCall(`documents.approval.${approvalId}`, undefined, async () => {
      await sm.documents.add({
        containerTag: tg.approvals,
        content: JSON.stringify({ plan_id: planId, decision }),
        customId: approvalId,
        metadata: {
          decision,
          plan_id: planId,
        },
      });
      return undefined;
    });
  }

  const planRowRes = await db.database
    .from('plans')
    .select('agent_id,content,logic_plan,actions,confidence')
    .eq('id', planId)
    .single();
  logErr('select plan', planRowRes);
  const planRow = planRowRes.data as PlanRow | null;

  let actionCount = 0;
  if (decision === 'approved' && planRow) {
    const actions = planRow.actions ?? [];
    actionCount = actions.length;
    await Promise.all([
      ...actions.map((a) => {
        if (a.type === 'slack_message') return fireSlack(a);
        if (a.type === 'calendar_create') return fireCalendar(a);
        return Promise.resolve();
      }),
      appendApprovedToNotion(planRow),
    ]);
  }

  const agentId = planRow?.agent_id ?? planId;
  const shortName = personaName(agentId);

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
