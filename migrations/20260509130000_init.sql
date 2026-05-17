-- GroundTruth schema

-- Realtime channel
INSERT INTO realtime.channels (pattern, description, enabled)
VALUES ('groundtruth:session', 'GroundTruth debate session events', TRUE)
ON CONFLICT DO NOTHING;

-- Singleton session state
CREATE TABLE current_state (
  id              INT PRIMARY KEY DEFAULT 1,
  query           TEXT,
  round           INT NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'idle',
  alive_plan_ids  UUID[] NOT NULL DEFAULT '{}',
  approvals       JSONB NOT NULL DEFAULT '{}',
  neo4j_context   JSONB,
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  CHECK (id = 1)
);
INSERT INTO current_state (id) VALUES (1);

-- Static agent personas, seeded once
CREATE TABLE agents (
  id      TEXT PRIMARY KEY,
  persona TEXT NOT NULL,
  style   TEXT NOT NULL,
  memory  JSONB NOT NULL DEFAULT '{"thoughts":[],"recent_actions":[]}'
);

INSERT INTO agents (id, persona, style) VALUES
  ('aggressive_ceo',
   'Aggressive CEO: maximises speed and decisive action; willing to make painful cuts now to avoid existential risk later.',
   'Blunt, data-driven, confrontational. Leads with worst-case numbers. Pushes for immediate action. Uses phrases like "we cannot wait" and "the math is clear."'),
  ('conservative_ceo',
   'Conservative CEO: preserves optionality and team morale; prefers incremental moves over irreversible ones.',
   'Measured, cautious, relationship-focused. Highlights risks of over-correction. Uses phrases like "let''s not panic" and "preserve what we have."'),
  ('balanced_ceo',
   'Balanced CEO: synthesises both views; seeks the highest-conviction minimum viable action.',
   'Analytical, bridge-building. Weighs trade-offs explicitly. Uses phrases like "both are right about X" and "the key question is timing."');

-- Plans (one per agent per query)
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

-- Decisions (rounds 2 & 3)
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

-- Narration feed
CREATE TABLE event_log (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round      INT NOT NULL,
  source     TEXT NOT NULL,
  kind       TEXT NOT NULL,
  narration  TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Human approval
CREATE TABLE approvals (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id     UUID REFERENCES plans(id),
  decision    TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Realtime trigger functions ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION trg_plans_broadcast()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM realtime.publish(
    'groundtruth:session',
    'plan_posted',
    to_jsonb(NEW)
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION trg_decisions_broadcast()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM realtime.publish(
    'groundtruth:session',
    'vote_posted',
    to_jsonb(NEW)
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION trg_event_log_broadcast()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM realtime.publish(
    'groundtruth:session',
    'event_logged',
    jsonb_build_object(
      'id',         NEW.id,
      'round',      NEW.round,
      'source',     NEW.source,
      'kind',       NEW.kind,
      'narration',  NEW.narration,
      'created_at', NEW.created_at
    )
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION trg_current_state_broadcast()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM realtime.publish(
    'groundtruth:session',
    'state_changed',
    to_jsonb(NEW)
  );
  RETURN NEW;
END;
$$;

-- ─── Attach triggers ────────────────────────────────────────────────────────

CREATE TRIGGER plans_after_insert
  AFTER INSERT ON plans
  FOR EACH ROW EXECUTE FUNCTION trg_plans_broadcast();

CREATE TRIGGER decisions_after_insert
  AFTER INSERT ON decisions
  FOR EACH ROW EXECUTE FUNCTION trg_decisions_broadcast();

CREATE TRIGGER event_log_after_insert
  AFTER INSERT ON event_log
  FOR EACH ROW EXECUTE FUNCTION trg_event_log_broadcast();

CREATE TRIGGER current_state_after_update
  AFTER UPDATE ON current_state
  FOR EACH ROW EXECUTE FUNCTION trg_current_state_broadcast();
