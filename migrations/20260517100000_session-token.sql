-- Rotates per-session Supermemory container tags via current_state.session_token
ALTER TABLE current_state
  ADD COLUMN IF NOT EXISTS session_token UUID NOT NULL DEFAULT gen_random_uuid();
