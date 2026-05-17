-- Grant table access to anon role
GRANT SELECT, INSERT, UPDATE, DELETE ON current_state TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON plans TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON decisions TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON event_log TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON approvals TO anon;
GRANT SELECT ON agents TO anon;
GRANT UPDATE ON agents TO anon;

-- Grant execute on helper RPCs to anon role
GRANT EXECUTE ON FUNCTION truncate_session() TO anon;
GRANT EXECUTE ON FUNCTION append_alive_plan(uuid) TO anon;
GRANT EXECUTE ON FUNCTION set_alive_plans(uuid[]) TO anon;
GRANT EXECUTE ON FUNCTION count_votes(int) TO anon;
