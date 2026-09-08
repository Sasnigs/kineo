type DeletionOperationResult = Readonly<{ error: Readonly<{ code?: string }> | null }>;
export interface DeletionService {
  rpc(name: string, arguments_: Readonly<Record<string, string>>): PromiseLike<DeletionOperationResult>;
  auth: { admin: {
    deleteUser(accountId: string, softDelete: boolean): PromiseLike<DeletionOperationResult>;
  } };
}

export async function completeDeletion(
  service: DeletionService,
  accountId: string,
  jobId: string,
  resumeTokenHash: string,
): Promise<boolean> {
  const committed = await service.rpc('kineo_commit_deletion', {
    p_job_id: jobId, p_resume_token_hash: resumeTokenHash,
  });
  if (committed.error !== null) return false;
  const domain = await service.rpc('kineo_delete_domain_for_account', {
    p_account_id: accountId,
    p_job_id: jobId,
  });
  if (domain.error !== null) return false;
  const deleted = await service.auth.admin.deleteUser(accountId, false);
  // Auth removal may have succeeded before a lost response or process crash.
  if (deleted.error !== null && deleted.error.code !== 'user_not_found') return false;
  const completed = await service.rpc('kineo_complete_deletion', {
    p_job_id: jobId,
    p_resume_token_hash: resumeTokenHash,
  });
  return completed.error === null;
}
