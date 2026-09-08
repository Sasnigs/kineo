import {
  authorize,
  jsonResponse,
  methodNotAllowed,
  readJson,
  serverFailure,
} from '../_shared/http.ts';
import { sha256Hex } from '../_shared/secrets.ts';

Deno.serve(async (request) => {
  if (request.method !== 'POST') return methodNotAllowed();
  const authorized = await authorize(request, true);
  if (authorized instanceof Response) return authorized;
  const input = await readJson(request);
  if (
    !isRecord(input) ||
    typeof input.jobId !== 'string' ||
    typeof input.downloadToken !== 'string'
  ) {
    return jsonResponse({ error: { code: 'invalid_request' } }, 400);
  }
  const consumed = await authorized.service.rpc(
    'kineo_consume_export_for_account',
    {
      p_account_id: authorized.accountId,
      p_job_id: input.jobId,
      p_download_token_hash: await sha256Hex(input.downloadToken),
    },
  );
  return consumed.error === null
    ? jsonResponse({ export: consumed.data })
    : serverFailure();
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
