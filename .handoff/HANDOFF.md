# GroundTruth × Supermemory — Implementation Handoff

Generated 2026-05-17. Self-contained: contains the v2 plan, the codebase context already gathered, and the SDK cheat-sheet you'll need to implement without re-reading the conversation.

---

## 0. The user's intent

> "study the supermemory docs … see how to refactor our project to include as much as features in supermemory possible. mini code refactor, max features included in supermemory"

Scope decisions confirmed by the user:
- **Replace BOTH** `agents.memory` JSONB **and** `current_state.neo4j_context` reads with Supermemory.
- **Single-session** memory (purge between sessions).
- **Skip Connections** (no Notion/Drive/Gmail UI).
- Runtime = **server-side only** (Deno edge functions); SDK key never reaches the browser.
- Hackathon-grade: easy to implement, hard to break.

---

## 1. Codebase context (already gathered)

### 1.1 Project layout

```
GroundTruth/
├── design.md                     # Full technical design (read in conversation)
├── package.json                  # { "dependencies": { "supermemory": "^4.21.1" } }
├── .env.local                    # contains SUPERMEMORY_API_KEY=sm_1NcSXmn... (frontend-only today)
├── migrations/
│   ├── 20260509130000_init.sql
│   ├── 20260509131000_helpers.sql
│   ├── 20260509132000_grants.sql
│   ├── 20260509215121_fix-trigger-security-definer.sql
│   └── 20260517000000_agentphone.sql
├── insforge/functions/
│   ├── agent-plan/index.ts       # round 1: persona+memory+graph → LLM → plan
│   ├── agent-vote/index.ts       # rounds 2-3: agents vote on plans
│   ├── agentphone-webhook/index.ts
│   ├── call-user/index.ts
│   ├── execute-action/index.ts   # human approval; fans out to Slack/Calendar
│   ├── start-session/index.ts    # truncate tables, load Neo4j, set query
│   └── tally-round/index.ts      # count votes, eliminate 0-vote plans
└── frontend/src/
    ├── App.tsx                   # orchestrator + realtime subscriptions
    ├── types.ts                  # Plan / Decision / EventLogEntry / SessionState / AgentId
    ├── components/
    │   ├── AgentCard.tsx         # per-agent column: plan + R2 vote + R3 vote
    │   ├── NarratorPanel.tsx     # event_log feed (left rail)
    │   └── ResultPanel.tsx       # right panel: surviving plan(s) + Approve/Reject
    └── lib/insforge.ts           # callFn (POST JSON), insforge SDK init, realtime singleton
```

### 1.2 Postgres schema (from `design.md`)

Single-session model — `/start-session` truncates plans/decisions/event_log/approvals.

```sql
CREATE TABLE current_state (
  id              INT PRIMARY KEY DEFAULT 1,
  query           TEXT,
  round           INT NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'idle',
  alive_plan_ids  UUID[] NOT NULL DEFAULT '{}',
  approvals       JSONB NOT NULL DEFAULT '{}',
  neo4j_context   JSONB,                          -- ← becomes vestigial
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  CHECK (id = 1)
  -- ← we ADD: session_token UUID NOT NULL DEFAULT gen_random_uuid()
);

CREATE TABLE agents (
  id      TEXT PRIMARY KEY,
  persona TEXT NOT NULL,
  style   TEXT NOT NULL,
  memory  JSONB NOT NULL DEFAULT '{"thoughts":[],"recent_actions":[]}'  -- ← becomes vestigial
);

CREATE TABLE plans (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id             TEXT REFERENCES agents(id),
  content              TEXT NOT NULL,
  logic_plan           JSONB NOT NULL,
  actions              JSONB NOT NULL,
  confidence           FLOAT,
  eliminated_at_round  INT,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (agent_id)
);

CREATE TABLE decisions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        TEXT REFERENCES agents(id),
  round           INT NOT NULL CHECK (round IN (2, 3)),
  chosen_plan_id  UUID REFERENCES plans(id),
  is_own_plan     BOOLEAN NOT NULL,
  reasoning       TEXT NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (agent_id, round)
);

CREATE TABLE event_log (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round      INT NOT NULL,
  source     TEXT NOT NULL,
  kind       TEXT NOT NULL,
  narration  TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE approvals (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id     UUID REFERENCES plans(id),
  decision    TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
```

### 1.3 Realtime broadcasts (unchanged)

| Trigger | Event | Payload |
|---|---|---|
| `plans` INSERT | `plan_posted` | full plan row |
| `decisions` INSERT | `vote_posted` | full decision row |
| `event_log` INSERT | `event_logged` | `{round, source, kind, narration}` |
| `current_state` UPDATE | `state_changed` | full state row |

### 1.4 Plan JSONB shape (from `design.md`, canonical)

```json
{
  "content": "Cannot wait. Cut both pending offers, renegotiate AWS, start bridge talks.",
  "logic_plan": {
    "steps": [
      {
        "claim": "Real burn is $180k, not the $120k Notion shows",
        "evidence": [
          { "id": "hs_burn_base_ops", "source": "notion://...", "confidence": 0.85, "stale": true },
          { "id": "hs_hire_sarah", "source": "slack://...", "confidence": 0.92 }
        ],
        "computed": { "current_monthly_burn": 180000 }
      }
    ],
    "computed_runway": {
      "actual_projected_months": 3.2,
      "cash_zero_date": "2026-08-12",
      "earliest_fundraise_close": "2026-08-10",
      "is_breached": true
    }
  },
  "actions": [
    { "type": "slack_message", "channel": "#founders", "body": "..." },
    { "type": "graph_annotation", "target_id": "hs_hire_mike_pending", "annotation": "recommend_rescind" }
  ],
  "confidence": 0.87
}
```

`logic_plan.steps[].evidence[]` has **no `documentDate`** — that's the LLM's evidence schema, not Supermemory's. Don't try to render SM freshness pills on AgentCard.

### 1.5 Current `/agent-plan` shape (the function that gets rewired hardest)

Key reads/writes today (line numbers in `insforge/functions/agent-plan/index.ts`):

- `:34` — parallel read of `current_state(query, neo4j_context)` and `agents(id,persona,style,memory)`
- `:47` — user prompt = `query + JSON.stringify(neo4j_context) + JSON.stringify(memory)`
- `:57` — POST to `${INSFORGE_BASE_URL}/api/ai/chat/completion` with model `anthropic/claude-sonnet-4.5`
  - Response shape: `{ text, metadata }` — strip ```json fences from `text`, JSON.parse it.
- `:82` — insert plan row, capture `id` via `.select('id').single()` ✅ (already correct here)
- `:100-114` — parallel insert event_log + update `agents.memory` JSONB. **This memory update goes away.**

LLM failure fallback at `:74` produces a `confidence: 0` placeholder plan so the round still closes. Preserve that pattern.

### 1.6 Current `/agent-vote` and `/execute-action` have **a bug to fix**

- `agent-vote/index.ts` inserts the decision but does **not** capture `decisionId`. Add `.select('id').single()` so we can use it as Supermemory `customId`.
- `execute-action/index.ts` inserts the approval but does **not** capture `approval.id`. Same fix.

### 1.7 Frontend orchestrator (App.tsx)

- Realtime subscription hoisted to a module-level singleton in `lib/insforge.ts` (StrictMode-safe).
- `refreshFromDb()` is a union-by-id merge that backstops realtime drops.
- `runDebate()` runs rounds 1–3 sequentially, refreshing after each phase.
- Two auto-triggers: SMS-initiated session detected via realtime → auto-orchestrate; `status='complete'` with `caller_phone` → auto-call via `/call-user`.

**Do not touch the orchestrator.** New `<MemoryPanel/>` mounts next to `<ResultPanel/>`.

### 1.8 Existing memories worth respecting

(From `~/.claude/projects/-Users-anne-Documents-projects-GroundTruth/memory/MEMORY.md`)

- **InsForge SDK silent DB errors** — always check `.error` on every PG operation. (SM SDK *does* throw — wrap in `safeCall`.)
- **`realtime.publish` requires SECURITY DEFINER** — already fixed in migration `20260509215121`; don't break.
- **InsForge AI chat completion endpoint** — `/api/ai/chat/completion`, response shape `{text, metadata}`, models need provider prefix.

---

## 2. Supermemory SDK cheat-sheet (verified against `node_modules/supermemory/`)

### 2.1 Container-tag rules (CRITICAL — first draft of plan got this wrong)

- **Charset:** alphanumerics + `-` `_` `.` only. **No `:` allowed.**
- **Max length:** 100 chars.
- Source: `node_modules/supermemory/resources/top-level.d.ts:47`.

✅ Use dots as separators: `gt.evidence`, `gt.s.<uuid>.agent.aggressive_ceo`.

### 2.2 Tag-param-name table (the SDK is inconsistent — get this right)

| Method | Tag field | Source |
|---|---|---|
| `client.add` | `containerTag` (string) | top-level.d.ts:47 |
| `client.profile` | `containerTag` (string) | top-level.d.ts:84 |
| `client.documents.add` | `containerTag` (string) | documents.d.ts:3022 |
| `client.documents.batchAdd` | `containerTag` (string) | documents.d.ts:3051 |
| `client.documents.list` | `containerTags` (string[], deprecated but ONLY option) | documents.d.ts:463 |
| `client.documents.deleteBulk` | `containerTags` (string[]) OR `ids` (string[]) | documents.d.ts:3117 |
| `client.documents.uploadFile` | `containerTags` (string, JSON-encoded array) | documents.d.ts:3133 |
| `client.documents.update` | path arg = SM doc id; body has `containerTags` | documents.d.ts:14 |
| `client.search.documents` | `containerTags` (string[], deprecated) | search.d.ts:375 |
| `client.search.execute` | `containerTags` (string[], deprecated) | search.d.ts:2963 |
| `client.search.memories` | `containerTag` (string) | search.d.ts:5540 |
| `client.memories.updateMemory` | `containerTag` (string) | memories.d.ts:104 |
| `client.memories.forget` | `containerTag` (string) | memories.d.ts:85 |

### 2.3 Reset semantics (CRITICAL — first draft got this wrong)

`documents.deleteBulk` deletes **documents**, not memories. There is no `memories.deleteBulk`. Memories live alongside documents in the container but are written separately via `memories.updateMemory`.

→ **The only reliable single-session reset is container-tag rotation.** Stash a `session_token UUID` on `current_state`, regenerate at `/start-session`, embed in every tag. Previous session's tag becomes orphaned but inert; we additionally `deleteBulk` it for hygiene.

### 2.4 Document update lookup (CRITICAL — first draft got this wrong)

`documents.update(id, ...)` takes the **Supermemory** doc id (returned by `documents.add()`'s `{ id, status }`), **not** the `customId`. Two paths:

- (a) Persist SM id back to Postgres → adds an `sm_id` column. Cleaner long-term, more migration churn.
- (b) **Pick this for hackathon:** at update time, `documents.list({ containerTags: ['gt.s.<token>.plans'], filters: { AND: [{ key: 'plan_id', value: planId, filterType: 'metadata' }] } })` → take `results[0].id` → call `documents.update(smId, ...)`.

### 2.5 Empty-shape fallbacks (CRITICAL — first draft missed this)

The SM SDK throws on error. `safeCall` catches and returns a typed empty so destructuring downstream is safe:

```ts
export const EMPTY_PROFILE = { profile: { static: [], dynamic: [] }, searchResults: undefined };
export const EMPTY_SEARCH  = { results: [], total: 0, timing: 0 };
export const EMPTY_LIST    = { documents: [], page: 1, perPage: 0, total: 0 };
```

Without these, a single SM hiccup crashes `/agent-plan` because we no longer have the PG fallback for memory/evidence.

### 2.6 Resource summary (all 5 resources + 2 top-level methods)

```ts
// Top level
client.add({ content, containerTag, customId?, entityContext?, metadata? })
  → { id: string, status: string }
client.profile({ containerTag, q?, threshold?, filters? })
  → { profile: { static: string[], dynamic: string[] }, searchResults? }

// client.memories
.updateMemory({ containerTag, newContent, id?, content?, forgetAfter?, forgetReason?, metadata?, temporalContext? })
.forget({ containerTag, id?, content?, reason? })

// client.documents
.add({ content, containerTag?, customId?, entityContext?, metadata? })
.batchAdd({ documents, containerTag?, metadata? })       // documents: Array<{ content, customId?, metadata? }>
.update(id, { containerTags?, metadata?, ... })
.list({ containerTags?, filters?, includeContent?, limit?, page?, sort?, order? })
.get(id)
.deleteBulk({ containerTags? | ids? })
.uploadFile({ file, containerTags?, fileType?, metadata?, mimeType? })
.listProcessing()

// client.search
.documents({ q, containerTags?, filters?, limit?, rerank?, rewriteQuery?, chunkThreshold?, includeFullDocs?, includeSummary? })
.execute(...)        // same shape as .documents
.memories({ q, containerTag?, filters?, limit?, rerank?, searchMode?: 'memories'|'hybrid'|'documents', threshold? })

// client.settings
.get()
.update({ ... })       // no idempotency flag in SDK — guard with module-level once-flag

// client.connections.*       ← SKIPPED for this project
```

### 2.7 Filter syntax (used by profile/search/list)

Recursive AND/OR with leaf conditions:

```ts
{ AND: [
  { key: 'plan_id', value: '<uuid>', filterType: 'metadata' },
  { key: 'round',   value: '1',      filterType: 'numeric', numericOperator: '=' },
]}
```

`filterType`: `'metadata' | 'numeric' | 'array_contains' | 'string_contains'`.

### 2.8 Deno import line

```ts
import Supermemory from 'npm:supermemory';
import type { Supermemory as SM } from 'npm:supermemory';
```

---

## 3. The v2 plan (verbatim copy of `~/.claude/plans/now-study-teh-supermemory-scalable-bentley.md`)

### Context

GroundTruth's 3 persona-CEO agents currently read context from two places: `current_state.neo4j_context` and `agents.memory` JSONB. `supermemory@^4.21.1` is installed; `SUPERMEMORY_API_KEY` is in `.env.local`; no code uses it yet.

This plan swaps both reads out: **agents fetch persona + memory via `client.profile()` and evidence via `client.search.documents()`**. Postgres tables stay (drive the realtime UI), Neo4j load still runs (don't break the parallel loader-agent's contract), but the LLM read path becomes Supermemory-only. Single-session — every `/start-session` rotates a session token so prior memories drop off the live tag. No external Connections UI. SDK runs server-side only in Deno edge functions.

### Tag scheme (valid charset only)

- `gt.queries` — every user query, never rotated (lifelong history)
- `gt.s.<token>.agent.aggressive_ceo` / `.conservative_ceo` / `.balanced_ceo` — per-agent, session-scoped
- `gt.s.<token>.evidence` — Neo4j subgraph nodes + summary doc + uploaded files
- `gt.s.<token>.plans` / `.decisions` / `.approvals` — debate artifacts

`<token>` is a UUID stored in `current_state.session_token`, rotated at every `/start-session`.

`customId` per doc:
- Plans/decisions/approvals/queries → matching Postgres UUID
- Evidence nodes → Neo4j node id (e.g. `cash_1`)
- Session summary → `summary.<token>`

### Feature coverage (every method except connections)

| SDK method | Lives in |
|---|---|
| `client.add` | `/start-session` writes query into `gt.queries` |
| `client.profile` | `/agent-plan` & `/agent-vote` (replaces `agents.memory` read) |
| `client.memories.updateMemory` | `/start-session` seeds persona; `/agent-plan` + `/agent-vote` append versioned thoughts |
| `client.memories.forget` | `/tally-round` forgets eliminated plans' thoughts |
| `client.documents.add` | plans, decisions, approvals, session-summary |
| `client.documents.batchAdd` | every Neo4j subgraph node as a `gt.s.<token>.evidence` doc |
| `client.documents.update` | `/tally-round` flips `eliminated_at_round` metadata |
| `client.documents.list` | `/memory-list` reader; `/tally-round` sm-id lookup |
| `client.documents.get` | `/memory-list` deep-link |
| `client.documents.deleteBulk` | `/start-session` hygienic purge of *previous* session's tags |
| `client.documents.uploadFile` | `/upload-evidence` function |
| `client.documents.listProcessing` | `/memory-list` ingestion-status pills |
| `client.search.documents` | `/agent-plan` semantic evidence retrieval |
| `client.search.execute` | `/memory-list?q=...` frontend evidence search |
| `client.search.memories` | `/agent-vote` retrieves rival agents' prior reasoning |
| `client.settings.get` / `update` | `/start-session` bootstrap (once-flag) |

### Schema change (one migration)

`migrations/20260517100000_session_token.sql`:
```sql
ALTER TABLE current_state
  ADD COLUMN session_token UUID NOT NULL DEFAULT gen_random_uuid();
```
`/start-session` issues `UPDATE current_state SET ..., session_token = gen_random_uuid() WHERE id = 1`. Every other edge function reads it.

### Files to add

1. `insforge/functions/_shared/supermemory.ts`
   - `getClient()` reads `SUPERMEMORY_API_KEY`, uses `npm:supermemory`
   - `tags(token, agentId?)` returns `{ agent, evidence, plans, decisions, approvals, queries }`
   - `safeCall<T>(label, fallback, fn)` — try/catch, log `[sm:<label>]`, return `fallback`
   - Empty-shape constants: `EMPTY_PROFILE`, `EMPTY_SEARCH`, `EMPTY_LIST`
   - Module-level `settingsBootstrapped = false` once-flag
2. `insforge/functions/memory-list/index.ts` — POST `{ token, q?, agentId?, filters? }` → parallel `profile` + `documents.list` + `search.execute` + `documents.listProcessing`, combined JSON.
3. `insforge/functions/upload-evidence/index.ts` — multipart → `documents.uploadFile({ containerTags: '<evidence-tag>' })`.

### Files to modify

| File | Change |
|---|---|
| `insforge/functions/start-session/index.ts` | Read prior `session_token` first → `deleteBulk` last-session tags (best-effort). Rotate `session_token` in PG. `safeCall('settings.update', undefined, ...)` once. Build a **session summary doc** flattening DRAINS/REPLENISHES/THREATENS edges into prose, then `documents.batchAdd` per node with `customId = nodeId`, `metadata = { node_type, source_url? }`. `client.add({ containerTag: tags.queries, content: query, customId: queryId })`. Per agent: `memories.updateMemory({ containerTag: tags.agent(id), newContent: persona, forgetAfter: null })` to seed static profile. Stop writing `current_state.neo4j_context`. Neo4j load + Cypher still runs. |
| `insforge/functions/agent-plan/index.ts` | Read `query` and `session_token`. Replace `agents.memory` read with `safeCall('profile.<id>', EMPTY_PROFILE, () => sm.profile({ containerTag: tags.agent(id), q: query, threshold: 0.5 }))`. Replace `neo4j_context` blob with `safeCall('search.evidence', EMPTY_SEARCH, () => sm.search.documents({ containerTags: [tags.evidence], q: query, limit: 12, rerank: true }))`. Build prompt from `profile.static`, `profile.dynamic`, and search results — all guaranteed-arrays. After PG plan insert: `documents.add({ containerTag: tags.plans, content: JSON.stringify(planData), customId: planId, metadata: { agent_id, round: 1, plan_id: planId, confidence }, entityContext: persona })` + `memories.updateMemory({ containerTag: tags.agent(id), newContent: \`Round 1: proposed "${planData.content}"\`, forgetAfter: <session_end>, temporalContext: { documentDate: now } })`. Delete the `agents.memory` PG update. |
| `insforge/functions/agent-vote/index.ts` | Same profile + evidence search pattern. Plus `search.memories({ containerTag: tags.agent(rivalId), q: \`reasoning round ${round-1}\` })` for each rival. **Change PG insert to `.insert([...]).select('id').single()`** to capture `decisionId`. Mirror via `documents.add(...)` + `memories.updateMemory(...)`. |
| `insforge/functions/tally-round/index.ts` | For each eliminated plan: (a) `documents.list({ containerTags: [tags.plans], filters: { AND: [{ key: 'plan_id', value: planId, filterType: 'metadata' }] } })` → resolve SM doc id; (b) `documents.update(smId, { metadata: { eliminated_at_round: round } })`; (c) `memories.forget({ containerTag: tags.agent(ownerId), content: \`Round 1: proposed "${plan.content}"\`, reason: 'plan eliminated' })`. |
| `insforge/functions/execute-action/index.ts` | **Change PG insert to `.insert([...]).select('id').single()`** for `approvalId`. Then `documents.add({ containerTag: tags.approvals, content: JSON.stringify({ plan_id, decision }), customId: approvalId, metadata: { decision, plan_id } })`. |
| `frontend/src/components/MemoryPanel.tsx` *(new)* | Right collapsible drawer, two tabs: **Profile** (per-agent static/dynamic) and **Evidence** (q + filter chips → `/memory-list`). Inline multipart fetch for "📎 attach evidence". Show `listProcessing` pills. |
| `frontend/src/App.tsx` | Mount `<MemoryPanel session={sessionState} />` next to `<ResultPanel/>`. Orchestrator untouched. |
| `frontend/src/types.ts` | Add `session_token?: string` to `SessionState`. |

**Not changed:** `AgentCard.tsx` — its evidence chips come from `logic_plan.steps[].evidence[]` which has no `documentDate`. Freshness pills live only inside MemoryPanel's Evidence tab.

### Env wiring

- `.env.local` already has `SUPERMEMORY_API_KEY`. Edge functions need it too: `insforge secrets set SUPERMEMORY_API_KEY <key>` (insforge-cli).
- Add to `design.md` env-vars list.

### Verification

1. Apply migration; confirm `current_state.session_token` exists.
2. `insforge secrets set SUPERMEMORY_API_KEY ...`; restart edge functions.
3. `cd frontend && npm run dev`. Click Ask with the canonical runway query. Logs:
   - `[sm:settings.update] ok` (first run only)
   - `[sm:deleteBulk gt.s.<prior>.*] purged N` (or "no prior session")
   - `[sm:documents.add summary] id=...`
   - `[sm:documents.batchAdd evidence] +M nodes`
   - `[sm:profile gt.s.<token>.agent.aggressive_ceo] static=K dynamic=L searchHits=J`
   - `[sm:search.documents evidence] hits=H`
4. MemoryPanel: Profile populates after round 1. Evidence returns the session summary + nodes.
5. File upload: attach a small PDF → appears in `listProcessing` → eventually searchable.
6. Elimination: force a 0-vote plan. Logs show sm-id lookup, `documents.update eliminated_at_round=2`, `memories.forget forgotten=true`.
7. Single-session purge: two queries back-to-back. Session 2 profile = `static=persona, dynamic=[]`.
8. Negative test: unset `SUPERMEMORY_API_KEY`. Rounds still complete via PG+realtime. UI shows "memory unavailable" banner.

### Out of scope

- `client.connections.*`
- Removing Neo4j or `agents.memory` column (left inert)
- Realtime broadcasts from SM events
- `sm_id` column on `plans` (use metadata-filter lookup instead)

---

## 4. Implementation order (suggested)

1. **Migration first** — `migrations/20260517100000_session_token.sql`, apply, verify.
2. **`_shared/supermemory.ts`** — getClient, tags(), safeCall, EMPTY_* constants. Unit-test the tag shapes against `[A-Za-z0-9._-]{1,100}`.
3. **Fix the PG insert bugs** in `agent-vote` and `execute-action` (`.select('id').single()`). These are independent of SM and can be reviewed first.
4. **`/start-session`** — token rotation, deleteBulk prior, batchAdd evidence + summary, persona seeding. Verify by reading SM dashboard.
5. **`/agent-plan`** — swap reads, add SM writes. Test with `SUPERMEMORY_API_KEY` unset to confirm fallback path works.
6. **`/agent-vote`** + **`/tally-round`** — same swap pattern.
7. **`/execute-action`** — small mirror write.
8. **`/memory-list`** + **`/upload-evidence`** edge functions.
9. **Frontend `<MemoryPanel/>`** + `App.tsx` mount + `types.ts` addition.
10. End-to-end smoke: two back-to-back queries, eliminate a plan, attach a PDF, kill the env var.

## 5. Gotchas / things I learned the hard way reviewing this

- **`:` is invalid in container tags.** First draft used `gt:agent:aggressive_ceo` everywhere — would have silently broken everything.
- **No `memories.deleteBulk`.** `deleteBulk` is documents-only. Session reset MUST go through tag rotation, not a delete call.
- **`documents.update(id, ...)` takes the SM doc id, not customId.** First draft used `planId` (PG uuid) — would have 404'd.
- **Param-name inconsistency.** Some methods take `containerTag` singular, some `containerTags` plural-deprecated. See §2.2 table.
- **`agent-vote` and `execute-action` don't capture PG insert ids today** — must add `.select('id').single()` before you can mirror them in SM.
- **Don't put SM freshness pills on `AgentCard`.** LLM-produced evidence schema has no `documentDate`. MemoryPanel only.
- **Empty-shape fallbacks are mandatory** — `agent-plan` no longer has a PG fallback for memory/evidence after the swap. Without `EMPTY_PROFILE`/`EMPTY_SEARCH`, an SM hiccup crashes the round.
- **InsForge SDK DB ops never throw** — always `.error` check. But SM SDK *does* throw — use `safeCall`. Two different idioms in the same edge function.
- **Loader contract is sacrosanct.** Another agent owns `loader.js` per `design.md`. Keep the `setupConstraints` + `loadGraph` + Cypher run in `/start-session` even though the result no longer feeds the LLM.

---

## 6. Useful absolute paths

- Plan file: `/Users/anne/.claude/plans/now-study-teh-supermemory-scalable-bentley.md`
- This handoff: `/Users/anne/Documents/projects/GroundTruth/.handoff/HANDOFF.md`
- Design doc: `/Users/anne/Documents/projects/GroundTruth/design.md`
- SDK types: `/Users/anne/Documents/projects/GroundTruth/node_modules/supermemory/resources/*.d.ts`
- Edge functions: `/Users/anne/Documents/projects/GroundTruth/insforge/functions/`
- Frontend: `/Users/anne/Documents/projects/GroundTruth/frontend/src/`
- Memory store: `/Users/anne/.claude/projects/-Users-anne-Documents-projects-GroundTruth/memory/`

End of handoff.
