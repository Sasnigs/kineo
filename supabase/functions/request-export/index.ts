import {
  authorize,
  jsonResponse,
  methodNotAllowed,
  serverFailure,
} from '../_shared/http.ts';
import { randomSecret, sha256Hex } from '../_shared/secrets.ts';

const millisecondsPerSecond = 1_000;
const secondsPerMinute = 60;
const exportLifetimeMinutes = 15;
const exportLifetimeMilliseconds =
  exportLifetimeMinutes * secondsPerMinute * millisecondsPerSecond;

Deno.serve(async (request) => {
  if (request.method !== 'POST') return methodNotAllowed();
  const authorized = await authorize(request, true);
  if (authorized instanceof Response) return authorized;
  const downloadToken = randomSecret();
  const downloadTokenHash = await sha256Hex(downloadToken);
  const expiresAt = new Date(Date.now() + exportLifetimeMilliseconds);
  const prepared = await authorized.service.rpc(
    'kineo_prepare_export_for_account',
    {
      p_account_id: authorized.accountId,
      p_download_token_hash: downloadTokenHash,
      p_expires_at: expiresAt.toISOString(),
    },
  );
  if (prepared.error !== null || !isRecord(prepared.data)) {
    return serverFailure();
  }
  return jsonResponse({
    kind: 'ready',
    jobId: prepared.data.jobId,
    expiresAtMilliseconds: prepared.data.expiresAtMilliseconds,
    downloadToken,
  });
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
