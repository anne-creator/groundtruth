import { createClient } from 'npm:@insforge/sdk';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const NULL_UUID = '00000000-0000-0000-0000-000000000000';

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  const db = createClient({
    baseUrl: Deno.env.get('INSFORGE_INTERNAL_URL') || Deno.env.get('INSFORGE_BASE_URL')!,
    anonKey: Deno.env.get('ANON_KEY')!,
  });

  const logErr = (label: string, r: { error: unknown }) => {
    if (r.error) console.error(`[reset-session:${label}]`, r.error);
  };

  logErr('delete approvals', await db.database.from('approvals').delete().neq('id', NULL_UUID));
  logErr('delete decisions', await db.database.from('decisions').delete().neq('id', NULL_UUID));
  logErr('delete event_log', await db.database.from('event_log').delete().neq('id', NULL_UUID));
  logErr('delete plans', await db.database.from('plans').delete().neq('id', NULL_UUID));

  logErr('update current_state', await db.database.from('current_state').update({
    query: null,
    round: 0,
    status: 'idle',
    alive_plan_ids: [],
    approvals: {},
    caller_phone: null,
    updated_at: new Date().toISOString(),
  }).eq('id', 1));

  return new Response(JSON.stringify({ ok: true }), {
    status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
