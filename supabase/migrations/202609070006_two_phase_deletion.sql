-- Prepare a capability without changing account access. Destructive work starts
-- only after the mobile device has durably stored that capability.
create or replace function public.kineo_begin_deletion_for_account(
  p_account_id uuid, p_resume_token_hash text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  job_id uuid;
begin
  if p_resume_token_hash is null or p_resume_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'invalid_recovery_token';
  end if;
  perform 1 from kineo_private.accounts where id = p_account_id and status = 'active' for update;
  if not found then
    raise exception using errcode = '28000', message = 'account_unavailable';
  end if;
  insert into kineo_private.deletion_jobs(account_id, status, resume_token_hash)
    values (p_account_id, 'pending', p_resume_token_hash)
  on conflict (account_id) do update
    set resume_token_hash = excluded.resume_token_hash, updated_at = clock_timestamp()
    where kineo_private.deletion_jobs.status = 'pending'
  returning id into job_id;
  if job_id is null then
    raise exception using errcode = '28000', message = 'deletion_unavailable';
  end if;
  return jsonb_build_object('jobId', job_id, 'status', 'pending');
end;
$$;

create or replace function public.kineo_commit_deletion(p_job_id uuid, p_resume_token_hash text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  job kineo_private.deletion_jobs%rowtype;
  owner_id uuid;
begin
  -- Lock order matches ordinary account mutations and preparation.
  select account_id into owner_id from kineo_private.deletion_jobs
    where id = p_job_id and resume_token_hash = p_resume_token_hash;
  if owner_id is null then
    raise exception using errcode = '28000', message = 'deletion_unavailable';
  end if;
  perform 1 from kineo_private.accounts where id = owner_id for update;
  select * into job from kineo_private.deletion_jobs
    where id = p_job_id and resume_token_hash = p_resume_token_hash for update;
  if not found then
    raise exception using errcode = '28000', message = 'deletion_unavailable';
  end if;
  if job.status <> 'pending' then return; end if;
  update kineo_private.accounts set status = 'deleting', updated_at = clock_timestamp()
    where id = job.account_id;
  update kineo_private.device_installations
    set revoked_at = coalesce(revoked_at, clock_timestamp()), updated_at = clock_timestamp()
    where account_id = job.account_id;
  -- Auth storage is deliberately touched only by this audited privileged
  -- lifecycle routine. Regression tests run against the pinned local Auth schema.
  delete from auth.refresh_tokens where user_id = job.account_id::text;
  delete from auth.sessions where user_id = job.account_id;
  update kineo_private.deletion_jobs set status = 'revokingAccess', updated_at = clock_timestamp()
    where id = job.id;
end;
$$;

create or replace function public.kineo_delete_domain_for_account(p_account_id uuid, p_job_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update kineo_private.deletion_jobs
    set status = 'deletingData', updated_at = clock_timestamp()
    where id = p_job_id and account_id = p_account_id
      and status in ('revokingAccess', 'deletingData', 'deletingAuth');
  if not found then
    raise exception using errcode = '28000', message = 'deletion_unavailable';
  end if;
  delete from kineo_private.accounts where id = p_account_id;
  update kineo_private.deletion_jobs set status = 'deletingAuth', updated_at = clock_timestamp()
    where id = p_job_id and account_id = p_account_id;
end;
$$;

revoke all on function public.kineo_commit_deletion(uuid, text) from public, anon, authenticated;
grant execute on function public.kineo_commit_deletion(uuid, text) to service_role;
