-- Helper stored procedures for edge functions

-- Wipe all per-session tables atomically
CREATE OR REPLACE FUNCTION truncate_session()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  TRUNCATE plans, decisions, event_log, approvals RESTART IDENTITY CASCADE;
END;
$$;

-- Atomically append a plan_id to current_state.alive_plan_ids
CREATE OR REPLACE FUNCTION append_alive_plan(p_plan_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE current_state
  SET alive_plan_ids = array_append(alive_plan_ids, p_plan_id),
      updated_at = NOW()
  WHERE id = 1;
END;
$$;

-- Reset alive_plan_ids to a new list
CREATE OR REPLACE FUNCTION set_alive_plans(p_plan_ids uuid[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE current_state
  SET alive_plan_ids = p_plan_ids,
      updated_at = NOW()
  WHERE id = 1;
END;
$$;

-- Count votes per plan for a given round, returns rows {plan_id, vote_count}
CREATE OR REPLACE FUNCTION count_votes(p_round int)
RETURNS TABLE(plan_id uuid, vote_count bigint) LANGUAGE sql SECURITY DEFINER AS $$
  SELECT chosen_plan_id AS plan_id, COUNT(*) AS vote_count
  FROM decisions
  WHERE round = p_round
  GROUP BY chosen_plan_id;
$$;
