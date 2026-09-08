alter table kineo_private.user_profiles
  add column routine_preference text,
  add column telemetry_choice text not null default 'notOffered'
    check (telemetry_choice in ('notOffered', 'declined', 'optedIn'));

alter table kineo_private.routine_sessions
  add column session_payload jsonb not null
    check (jsonb_typeof(session_payload) = 'object');
