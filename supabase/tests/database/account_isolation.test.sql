begin;

select plan(8);

select has_schema('kineo_private', 'private Kineo schema exists');
select table_owner_is('kineo_private', 'accounts', current_user, 'migration owner owns accounts');
select is(
  has_table_privilege('authenticated', 'kineo_private.accounts', 'select'),
  false,
  'authenticated clients cannot select accounts'
);
select is(
  has_table_privilege('authenticated', 'kineo_private.check_ins', 'insert'),
  false,
  'authenticated clients cannot insert check-ins'
);
select is(
  has_table_privilege('authenticated', 'kineo_private.routine_sessions', 'update'),
  false,
  'authenticated clients cannot update routines'
);
select is(
  has_schema_privilege('authenticated', 'kineo_private', 'usage'),
  false,
  'authenticated clients cannot use private schema'
);
select isnt_empty(
  $$select 1 from pg_indexes
    where schemaname = 'kineo_private'
      and indexname = 'one_unfinished_routine_per_account'$$,
  'unfinished routine uniqueness is enforced'
);
select is(
  prosrc like '%auth.uid()%',
  true,
  'Account ownership is derived from verified JWT context'
)
from pg_proc
where proname = 'current_account_id'
  and pronamespace = 'kineo_private'::regnamespace;

select * from finish();
rollback;
