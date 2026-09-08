import {
  authorize,
  jsonResponse,
  methodNotAllowed,
  serverFailure,
} from '../_shared/http.ts';
import { randomSecret, sha256Hex } from '../_shared/secrets.ts';

Deno.serve(async (request) => {
  if (request.method !== 'POST') return methodNotAllowed();
  const authorized = await authorize(request, true);
  if (authorized instanceof Response) return authorized;
  const resumeToken = randomSecret();
  const resumeTokenHash = await sha256Hex(resumeToken);
  const begun = await authorized.service.rpc(
    'kineo_begin_deletion_for_account',
    {
      p_account_id: authorized.accountId,
      p_resume_token_hash: resumeTokenHash,
    },
  );
  if (begun.error !== null || !isDeletionJob(begun.data)) {
    return serverFailure();
  }
  // Preparation is deliberately non-destructive. The client must persist this
  // capability before calling deletion-status to commit/resume deletion.
  return jsonResponse({
    kind: 'pending',
    jobId: begun.data.jobId,
    resumeToken,
  }, 202);
});

function isDeletionJob(
  value: unknown,
): value is Readonly<{ jobId: string }> {
  return typeof value === 'object' &&
    value !== null &&
    'jobId' in value &&
    typeof value.jobId === 'string';
}
