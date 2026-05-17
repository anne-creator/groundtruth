-- Trigger functions call realtime.publish() which the anon role cannot execute.
-- Make them SECURITY DEFINER so they run with the function owner's privileges.

ALTER FUNCTION trg_plans_broadcast() SECURITY DEFINER;
ALTER FUNCTION trg_decisions_broadcast() SECURITY DEFINER;
ALTER FUNCTION trg_event_log_broadcast() SECURITY DEFINER;
ALTER FUNCTION trg_current_state_broadcast() SECURITY DEFINER;
