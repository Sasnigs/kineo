import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.114.0';

export async function completeDeletion(
  service: SupabaseClient,
  accountId: string,
  jobId: string,
  resumeTokenHash: string,
): Promise<boolean> {
  const domain = await service.rpc('kineo_delete_domain_for_account', {
    p_account_id: accountId,
    p_job_id: jobId,
  });
  if (domain.error !== null) return false;
  const deleted = await service.auth.admin.deleteUser(accountId, false);
  if (deleted.error !== null) return false;
  const completed = await service.rpc('kineo_complete_deletion', {
    p_job_id: jobId,
    p_resume_token_hash: resumeTokenHash,
  });
  return completed.error === null;
}
