import { completeDeletion } from '../_shared/deletion.ts';
import {
  jsonResponse,
  methodNotAllowed,
  readJson,
  serviceClient,
} from '../_shared/http.ts';
import { sha256Hex } from '../_shared/secrets.ts';

Deno.serve(async (request) => {
  if (request.method !== 'POST') return methodNotAllowed();
  const input = await readJson(request);
  if (
    !isRecord(input) ||
    typeof input.jobId !== 'string' ||
    typeof input.resumeToken !== 'string'
  ) {
    return jsonResponse({ error: { code: 'invalid_request' } }, 400);
  }
  let service;
  try {
    service = serviceClient();
  } catch {
    return jsonResponse({ error: { code: 'service_unavailable' } }, 503);
  }
  const resumeTokenHash = await sha256Hex(input.resumeToken);
  const found = await service.rpc('kineo_deletion_job_by_token', {
    p_job_id: input.jobId,
    p_resume_token_hash: resumeTokenHash,
  });
  if (found.error !== null || !isDeletionJob(found.data)) {
    return jsonResponse({ error: { code: 'not_authorized' } }, 401);
  }
  if (found.data.status === 'complete') {
    return jsonResponse({ kind: 'complete' });
  }
  const complete = await completeDeletion(
    service,
    found.data.accountId,
    input.jobId,
    resumeTokenHash,
  );
  return complete
    ? jsonResponse({ kind: 'complete' })
    : jsonResponse({ kind: 'pending' }, 202);
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDeletionJob(
  value: unknown,
): value is Readonly<{ accountId: string; status: string }> {
  return isRecord(value) &&
    typeof value.accountId === 'string' &&
    typeof value.status === 'string';
}
