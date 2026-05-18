import { type ChangeEvent, useCallback, useEffect, useState } from 'react';
import type { SessionState } from '../types';
import { AGENTS, AGENT_LABELS, type AgentId } from '../types';
import { callFn, FUNCTIONS_URL } from '../lib/insforge';

interface ProcessingDoc {
  id?: string;
  status?: string;
}

interface ListMem {
  id: string;
  title?: string | null;
  summary?: string | null;
  status?: string;
  customId?: string | null;
}

interface MemoryPayload {
  ok?: boolean;
  unavailable?: boolean;
  profiles?: Record<string, {
    profile: { static?: string[]; dynamic?: string[] };
  }>;
  evidenceList?: {
    memories: ListMem[];
  };
  evidenceSearch?: {
    results: Array<{ title?: string | null; documentId?: string; chunks?: Array<{ content?: string }> }>;
    total?: number;
  };
  processing?: { documents?: ProcessingDoc[] };
}

export default function MemoryPanel({ session }: { session: SessionState | null }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'profile' | 'evidence'>('profile');
  const [loading, setLoading] = useState(false);
  const [payload, setPayload] = useState<MemoryPayload | null>(null);
  const [evidenceQ, setEvidenceQ] = useState('');
  const [hint, setHint] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const q = evidenceQ.trim() || undefined;
      const r = (await callFn('memory-list', { q })) as MemoryPayload;
      setPayload(r);
      setHint(null);
    } catch {
      setPayload({ unavailable: true });
      setHint('memory-list failed');
    } finally {
      setLoading(false);
    }
  }, [evidenceQ]);

  useEffect(() => {
    if (!open) return;
    void refresh();
  }, [open, session?.session_token, session?.status, session?.updated_at, refresh]);

  async function onFile(ev: ChangeEvent<HTMLInputElement>) {
    const f = ev.target.files?.[0];
    ev.target.value = '';
    if (!f) return;
    setHint(null);
    const fd = new FormData();
    fd.append('file', f);
    const res = await fetch(`${FUNCTIONS_URL}/upload-evidence`, { method: 'POST', body: fd });
    const j = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; id?: string; status?: string } | null;
    if (!res.ok || !j?.ok) {
      setHint(j?.error ?? `upload ${res.status}`);
      return;
    }
    setHint(`Upload queued (${j.status ?? '?'} · ${j.id?.slice(0, 8) ?? ''})`);
    await refresh();
  }

  const unavailable = !!(payload?.unavailable || hint === 'memory-list failed');

  return (
    <aside style={{
      width: open ? 300 : 40,
      flexShrink: 0,
      borderLeft: '1px solid #E7D8C4',
      background: '#FFFDF8',
      display: 'flex',
      flexDirection: 'column',
      minHeight: 0,
      transition: 'width 160ms ease',
    }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={open ? 'Collapse Memory' : 'Open Memory'}
        style={{
          height: 40,
          border: 'none',
          borderBottom: '1px solid #E7D8C4',
          background: '#F6EFE3',
          color: '#6F5D4C',
          cursor: 'pointer',
          fontSize: open ? 12 : 16,
          fontWeight: 600,
        }}
      >
        {open ? 'Supermemory ◀' : '▸'}
      </button>

      {open && (
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', padding: '10px 12px', gap: 10 }}>
          {!session?.session_token && session?.status !== 'idle' && (
            <div style={{ fontSize: 11, color: '#D9962B', background: '#FFF7E8', border: '1px solid #E7D8C4', borderRadius: 6, padding: 8 }}>
              Session token missing — migrate DB or redeploy `/start-session` with `session_token` column.
            </div>
          )}

          {unavailable && (
            <div style={{ fontSize: 11, color: '#D9962B', background: '#FFF7E8', border: '1px solid #E7D8C4', borderRadius: 6, padding: 8 }}>
              Memory unavailable ({hint ?? 'SUPERMEMORY_API_KEY not set or edge misconfigured'}). Debate continues without Supermemory-backed profile/evidence in the dashboard.
            </div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            {(['profile', 'evidence'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                style={{
                  flex: 1,
                  padding: '6px 0',
                  borderRadius: 6,
                  border: tab === t ? '1px solid #3B73D9' : '1px solid #E7D8C4',
                  background: tab === t ? '#FFF7E8' : '#FFFFFF',
                  color: tab === t ? '#3B73D9' : '#6F5D4C',
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontSize: 11,
                  textTransform: 'capitalize',
                }}
              >
                {t}
              </button>
            ))}
          </div>

          {loading && (
            <div style={{ fontSize: 11, color: '#9A8772' }}>Loading…</div>
          )}
          {!loading && hint && !unavailable && (
            <div style={{ fontSize: 11, color: '#3B73D9' }}>{hint}</div>
          )}

          {tab === 'profile' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {AGENTS.map((id) => {
                const pf = payload?.profiles?.[id]?.profile ?? { static: [], dynamic: [] };
                const st = pf.static ?? [];
                const dy = pf.dynamic ?? [];
                return (
                  <div key={id} style={{ border: '1px solid #EFE3D2', borderRadius: 8, background: '#FFFFFF', padding: 10 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6, color: '#6F5D4C' }}>
                      {AGENT_LABELS[id as AgentId]}
                    </div>
                    <div style={{ fontSize: 11, color: '#9A8772', marginBottom: 4 }}>Static</div>
                    <pre style={{
                      whiteSpace: 'pre-wrap',
                      margin: '0 0 8px 0',
                      fontSize: 11,
                      fontFamily: 'ui-monospace, monospace',
                      color: '#2A2118',
                    }}
                    >
                      {st.length ? st.join('\n\n') : '—'}
                    </pre>
                    <div style={{ fontSize: 11, color: '#9A8772', marginBottom: 4 }}>Dynamic</div>
                    <pre style={{
                      whiteSpace: 'pre-wrap',
                      margin: 0,
                      fontSize: 11,
                      fontFamily: 'ui-monospace, monospace',
                      color: '#2A2118',
                    }}
                    >
                      {dy.length ? dy.join('\n\n') : '—'}
                    </pre>
                  </div>
                );
              })}
            </div>
          )}

          {tab === 'evidence' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  value={evidenceQ}
                  onChange={(e) => setEvidenceQ(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void refresh(); }}
                  placeholder="Search evidence chunks…"
                  style={{
                    flex: 1,
                    background: '#FFFFFF',
                    border: '1px solid #E7D8C4',
                    borderRadius: 6,
                    padding: '6px 10px',
                    color: '#2A2118',
                    fontSize: 12,
                    outline: 'none',
                  }}
                />
                <button
                  type="button"
                  onClick={() => void refresh()}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 6,
                    border: 'none',
                    background: '#3B73D9',
                    color: '#FFFFFF',
                    fontWeight: 600,
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  Go
                </button>
              </div>

              <label style={{ fontSize: 11, color: '#6F5D4C' }}>
                📎 Attach evidence file
                <input type="file" onChange={(e) => void onFile(e)} style={{ display: 'block', marginTop: 6, fontSize: 11, color: '#2A2118' }} />
              </label>

              <div style={{ fontSize: 11, fontWeight: 600, color: '#9A8772', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 4 }}>
                Ingestion
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {(payload?.processing?.documents ?? []).slice(0, 12).map((d, i) => (
                  <span
                    key={d.id ?? i}
                    style={{
                      fontSize: 10,
                      padding: '2px 8px',
                      borderRadius: 999,
                      background: '#FFF7E8',
                      border: '1px solid #E7D8C4',
                      color: '#6F5D4C',
                    }}
                  >
                    {(d.status ?? '?').slice(0, 24)}
                  </span>
                ))}
                {(payload?.processing?.documents?.length ?? 0) === 0 && (
                  <span style={{ fontSize: 11, color: '#9A8772' }}>No uploads processing</span>
                )}
              </div>

              <div style={{ fontSize: 11, fontWeight: 600, color: '#9A8772', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 4 }}>
                Documents ({payload?.evidenceList?.memories?.length ?? 0})
              </div>
              <ul style={{ margin: 0, paddingLeft: 16, color: '#2A2118', fontSize: 11 }}>
                {(payload?.evidenceList?.memories ?? []).slice(0, 20).map((m) => (
                  <li key={m.id} style={{ marginBottom: 4 }}>
                    {m.title ?? m.customId ?? m.id}: <span style={{ color: '#9A8772' }}>{m.status}</span>
                  </li>
                ))}
              </ul>

              {Boolean(evidenceQ.trim()) && (
                <>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#9A8772', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 4 }}>
                    Search ({payload?.evidenceSearch?.total ?? 0})
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 16, color: '#2A2118', fontSize: 11 }}>
                    {(payload?.evidenceSearch?.results ?? []).slice(0, 8).map((r, i) => {
                      const chunkText = (r.chunks?.map((c) => c.content).filter(Boolean).join(' · ') ?? '').trim();
                      const preview = chunkText.length > 200 ? `${chunkText.slice(0, 200)}…` : chunkText;
                      return (
                      <li key={r.documentId ?? i} style={{ marginBottom: 6 }}>
                        <div style={{ color: '#6F5D4C' }}>{r.title ?? r.documentId}</div>
                        {preview ? (
                          <div style={{ color: '#9A8772', fontSize: 10 }}>{preview}</div>
                        ) : null}
                      </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
