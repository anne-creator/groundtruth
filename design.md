# GroundTruth — Technical Design

InsForge backend + Vercel frontend. 3 persona agents debate over a Neo4j knowledge graph; human approves.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Backend | InsForge Edge Functions (Deno) |
| Database | InsForge Postgres |
| Realtime | InsForge broadcast (Postgres triggers) |
| Graph | Neo4j AuraDB Free (managed) |
| LLM | `claude-sonnet-4-6` via `client.ai` |
| Frontend | React + TypeScript on Vercel |
| Loader | `loader.js` — built in parallel by separate coding agent against `neo4j-loader-spec.json` |

**Hosting note:** Neo4j cannot run on Vercel (stateless serverless). AuraDB is the answer; URI + password go in InsForge env vars.

---

## Postgres Schema

Single-session model. New query wipes everything. No `session_id` column anywhere.

```sql
-- Singleton: id=1, always overwritten
CREATE TABLE current_state (
  id              INT PRIMARY KEY DEFAULT 1,
  query           TEXT,
  round           INT NOT NULL DEFAULT 0,         -- 0=idle, 1|2|3=active
  status          TEXT NOT NULL DEFAULT 'idle',   -- idle|round1|round2|round3|complete|approved|rejected
  alive_plan_ids  UUID[] NOT NULL DEFAULT '{}',   -- shrinks as plans die
  approvals       JSONB NOT NULL DEFAULT '{}',    -- {plan_id: count} for current round only
  neo4j_context   JSONB,                          -- cached graph dump from /start-session
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  CHECK (id = 1)
);

-- Static, seeded once. 3 personas only — no narrator agent.
CREATE TABLE agents (
  id      TEXT PRIMARY KEY,    -- aggressive_ceo|conservative_ceo|balanced_ceo
  persona TEXT NOT NULL,
  style   TEXT NOT NULL,
  memory  JSONB NOT NULL DEFAULT '{"thoughts":[],"recent_actions":[]}'
);

-- One plan per agent per query. Created in round 1 only.
CREATE TABLE plans (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id             TEXT REFERENCES agents(id),
  content              TEXT NOT NULL,             -- one-line conclusion
  logic_plan           JSONB NOT NULL,            -- { steps: [{claim, evidence[], computed?}], computed_runway: {...} }
  actions              JSONB NOT NULL,            -- [{type, ...}] executable steps
  confidence           FLOAT,
  eliminated_at_round  INT,                       -- NULL = alive
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (agent_id)
);

-- One decision per agent per round, rounds 2 and 3 only.
CREATE TABLE decisions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        TEXT REFERENCES agents(id),
  round           INT NOT NULL CHECK (round IN (2, 3)),
  chosen_plan_id  UUID REFERENCES plans(id),
  is_own_plan    BOOLEAN NOT NULL,
  reasoning       TEXT NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (agent_id, round)
);

-- Inline narration feed. Each agent function writes its own line.
CREATE TABLE event_log (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round      INT NOT NULL,
  source     TEXT NOT NULL,        -- agent_id | 'system'
  kind       TEXT NOT NULL,        -- 'plan' | 'vote' | 'eliminated' | 'consensus' | 'system'
  narration  TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Final human action.
CREATE TABLE approvals (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id     UUID REFERENCES plans(id),  -- which plan the human picked
  decision    TEXT NOT NULL,              -- 'approved' | 'rejected'
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
```

`/start-session` always: `TRUNCATE plans, decisions, event_log, approvals`, then `UPDATE current_state SET ... WHERE id = 1`.

---

## Realtime Broadcasts

Same `realtime.publish` pattern as ForgeRedemption. One channel: `groundtruth:session`.

| Trigger | Event | Payload |
|---|---|---|
| `plans` INSERT | `plan_posted` | full plan row |
| `decisions` INSERT | `vote_posted` | full decision row |
| `event_log` INSERT | `event_logged` | `{round, source, kind, narration}` |
| `current_state` UPDATE | `state_changed` | full state row |

Frontend subscribes once on mount; renders all UI from these four event streams.

---

## Loader Integration Boundary

```
┌──────────────────────────────────────────────────────────────────┐
│  /start-session  (our edge function)                             │
│                                                                  │
│    import { loadGraph, setupConstraints } from './loader.js'     │
│    import fixture from './hyperspell-output-fixture.json'        │
│                                                                  │
│    await setupConstraints(neo4jSession)                          │
│    await loadGraph(fixture, neo4jSession)   // event-driven      │
│    const ctx = await neo4jSession.run(RUNWAY_SUBGRAPH_CYPHER)    │
│    ...write ctx → current_state.neo4j_context                   │
└──────────────────────────────────────────────────────────────────┘
```

Other coding agent owns `loader.js` (built against `neo4j-loader-spec.json`). We import it. When real Hyperspell is wired up later, replace the fixture import with an API call; `loadGraph()` signature is unchanged.

**Cypher used by `/start-session` to build context:**

```cypher
MATCH (cash:CashPosition)
OPTIONAL MATCH (drainer)-[d:DRAINS]->(cash)
OPTIONAL MATCH (rep_src)-[r:REPLENISHES]->(cash)
OPTIONAL MATCH (threat)-[t:THREATENS]->(rc:RunwayConstraint)
RETURN
  cash { .* } AS cash,
  collect(DISTINCT { node: drainer { .*, labels: labels(drainer) }, edge: properties(d) }) AS drains,
  collect(DISTINCT { node: rep_src { .*, labels: labels(rep_src) }, edge: properties(r) }) AS replenishes,
  collect(DISTINCT { node: threat { .*, labels: labels(threat) }, edge: properties(t) }) AS threats
```

Result is the JSON each agent reads from `current_state.neo4j_context`.

---

## Edge Functions (5)

Frontend orchestrates rounds — backend functions are stateless. No race conditions because there's a single caller deciding when each batch is "done."

### `POST /start-session`
**Body:** `{ query }`
1. `TRUNCATE plans, decisions, event_log, approvals`
2. Open Neo4j session → `setupConstraints` → `loadGraph(fixture)` → run subgraph Cypher → close
3. `UPDATE current_state SET query, round=1, status='round1', neo4j_context=ctx, alive_plan_ids='{}', approvals='{}'`
4. INSERT event_log: `("system", "system", "New query received. Loading graph and dispatching agents.")`
5. Return `{ ok: true }`

### `POST /agent-plan` (round 1)
**Body:** `{ agent_id }`
1. Read `current_state` (query + neo4j_context) and `agents` row (persona, style, memory)
2. LLM call with strict JSON system prompt → `{ content, logic_plan, actions, confidence }`
3. INSERT into `plans`
4. INSERT into `event_log`: one-liner like `"Aggressive CEO: cut 2 offers, raise now (computed runway 3.1mo)."`
5. UPDATE `current_state.alive_plan_ids` with `array_append`
6. Update agent memory (append thought)
7. On LLM failure: insert persona-shaped fallback plan with `confidence: 0` so the round can still close

### `POST /agent-vote` (rounds 2 & 3)
**Body:** `{ agent_id, round }`
1. Read `current_state` (alive_plan_ids), all alive plans, all decisions from previous round, agent memory
2. LLM call → `{ chosen_plan_id, is_own_plan, reasoning }`
3. INSERT into `decisions`
4. INSERT into `event_log`: `"Balanced CEO switches → Conservative's plan. Reason: ..."`  or  `"Aggressive CEO holds firm. Reason: ..."`
5. Update agent memory

### `POST /tally-round`
**Body:** `{ round }`
1. **Round 1:** no votes to tally. Set `status='round2'`, `round=2`. INSERT event_log: `"Round 1 complete. 3 plans on the table."` Done.
2. **Rounds 2 & 3:** count votes per plan from `decisions WHERE round = $round`. Write to `current_state.approvals`.
3. Find plans with 0 votes → set `eliminated_at_round = $round` → remove from `alive_plan_ids` → event_log: `"Round 2: Aggressive's plan eliminated (0 votes). 2 plans remain."`
4. **Termination:**
   - If `len(alive_plan_ids) == 1` OR `round == 3`: set `status='complete'`. event_log: `"Consensus reached on Conservative's plan."` (or `"Round 3 ends with N plans tied — user chooses."`)
   - Else: set `status='round3'`, `round=3`. event_log advances round.
5. Reset `current_state.approvals = '{}'` for next round if continuing.

### `POST /execute-action`
**Body:** `{ plan_id, decision }`
1. INSERT into `approvals`
2. UPDATE `current_state.status = decision`
3. If `approved`: read plan's `actions[]`, fan out to Slack/Calendar APIs (one fetch per action)
4. INSERT event_log: `"Human approved Conservative's plan. Firing 4 actions."`

---

## Round Flow (frontend orchestrator)

```ts
// App.tsx — single source of orchestration
async function ask(query: string) {
  await fetch('/start-session', { body: { query }})

  // Round 1: generate plans
  await Promise.all(AGENTS.map(id =>
    fetch('/agent-plan', { body: { agent_id: id }})))
  await fetch('/tally-round', { body: { round: 1 }})

  // Round 2: vote
  await Promise.all(AGENTS.map(id =>
    fetch('/agent-vote', { body: { agent_id: id, round: 2 }})))
  await fetch('/tally-round', { body: { round: 2 }})

  // Round 3: only if state still says round3 (not collapsed to consensus)
  const { status } = await getState()
  if (status === 'round3') {
    await Promise.all(AGENTS.map(id =>
      fetch('/agent-vote', { body: { agent_id: id, round: 3 }})))
    await fetch('/tally-round', { body: { round: 3 }})
  }
  // status is now 'complete' — UI shows Approve/Reject
}
```

UI doesn't *wait* for renders — realtime events drive panel updates as they arrive in parallel with the awaits.

---

## Frontend Layout

```
┌──────────────────┬──────────────────────────────────────┬───────────────┐
│  Narrator        │  Agent Cards (3 columns)             │  Result Panel │
│  (left panel)    │                                      │               │
│                  │  ┌──────────┐  ┌──────────┐  ┌─────┐│  Surviving    │
│  event_log feed  │  │Aggressive│  │Conserv.  │  │Bal. ││  plan(s) +    │
│  appended live   │  │  Plan    │  │  Plan    │  │Plan ││  evidence     │
│                  │  │  R2 vote │  │  R2 vote │  │R2 v ││               │
│                  │  │  R3 vote │  │  R3 vote │  │R3 v ││  [ Approve ]  │
│                  │  └──────────┘  └──────────┘  └─────┘│  [ Reject  ]  │
├──────────────────┴──────────────────────────────────────┴───────────────┤
│  [ What should we do about runway? ___________________ ]   [Ask]        │
└─────────────────────────────────────────────────────────────────────────┘
```

**Agent card structure** (stacks vertically as rounds progress):
- **R1 plan:** `content`, collapsible `logic_plan.steps[]` with citations (hyperspell_id + source_url + confidence), `confidence` badge, freshness pills on stale evidence
- **R2 vote:** colored arrow → which plan; `reasoning`; "held own" vs "switched" indicator
- **R3 vote:** same shape as R2
- **Eliminated state:** card grays out, strikethrough, "Eliminated R2" badge

**Realtime subscription:**
```ts
insforge.realtime.channel('groundtruth:session')
  .on('plan_posted',    e => addPlan(e))
  .on('vote_posted',    e => addVote(e))
  .on('event_logged',   e => appendNarration(e))
  .on('state_changed',  e => updateGlobals(e))
  .subscribe()
```

**On Ask click:** local state resets, `ask(query)` runs. No manual wipe — `/start-session` handled it server-side and `state_changed` broadcasts will reset everything.

---

## Env Vars

**InsForge edge functions:**
```
INSFORGE_BASE_URL
ANON_KEY
AGENTPHONE_API_KEY       # from agentphone.ai dashboard
AGENTPHONE_AGENT_ID      # ID of the agent you created on AgentPhone
AGENTPHONE_NUMBER_ID     # (optional) specific phone number ID for caller ID
SLACK_BOT_TOKEN
GOOGLE_SERVICE_ACCOUNT_JSON
```
(`ANTHROPIC_API_KEY` is implicit via `client.ai`.)
Neo4j vars removed — no longer needed.

**Vercel frontend:**
```
VITE_INSFORGE_URL
VITE_INSFORGE_ANON_KEY
VITE_FUNCTIONS_URL       # base URL for edge function calls
```

**AgentPhone setup (one-time):**
1. Create an agent on agentphone.ai
2. Set its webhook URL to: `{INSFORGE_BASE_URL}/functions/v1/agentphone-webhook`
3. Provision a phone number and attach it to the agent
4. Copy Agent ID → `AGENTPHONE_AGENT_ID`, Number ID → `AGENTPHONE_NUMBER_ID`

---

## Plan JSONB Shape (canonical)

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
      },
      {
        "claim": "$150k AWS hit lands June 1",
        "evidence": [{ "id": "hs_burn_aws", "confidence": 0.95 }]
      },
      {
        "claim": "Earliest fundraise close 2026-08-10 — 2 days BEFORE cash-zero",
        "evidence": [{ "id": "hs_meet_sequoia", "confidence": 0.4 }]
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
    { "type": "graph_annotation", "target_id": "hs_hire_mike_pending", "annotation": "recommend_rescind" },
    { "type": "graph_annotation", "target_id": "hs_hire_elena_pending", "annotation": "recommend_rescind" },
    { "type": "calendar_create", "title": "Bridge call: Sequoia partner", "date": "2026-05-12T15:00" }
  ],
  "confidence": 0.87
}
```

Different personas produce different `computed_runway` numbers — that's where debate lives. Aggressive may assume both pending offers rejected; conservative assumes both accepted. Same graph, different priors.

---

## Build Order

| Phase | Task | Owns |
|---|---|---|
| 1 | Postgres schema + triggers + seed agents | us |
| 1 | `loader.js` against spec + fixture | other coding agent (parallel) |
| 2 | `/start-session` (with loader import stubbed) | us |
| 2 | Neo4j AuraDB instance + env vars | us |
| 3 | `/agent-plan` system prompt + LLM call + plan write | us |
| 3 | `/agent-vote` + `/tally-round` | us |
| 4 | Frontend: orchestrator, realtime subscriptions, agent cards | us |
| 5 | `/execute-action` Slack + Calendar wiring | us |
| 6 | End-to-end demo rehearsal | us |

When `loader.js` arrives, `/start-session` adds two import lines + two `await` calls. No other change in our pipeline.
