import {
  authorize,
  jsonResponse,
  methodNotAllowed,
  readJson,
  serverFailure,
} from '../_shared/http.ts';
import { validateBootstrapRequest } from '../_shared/protocol.ts';

Deno.serve(async (request) => {
  if (request.method !== 'POST') return methodNotAllowed();
  const authorized = await authorize(request);
  if (authorized instanceof Response) return authorized;
  const raw = await readJson(request);
  const input = validateBootstrapRequest(
    typeof raw === 'object' && raw !== null
      ? { ...raw, appVersion: 'revoke', platformVersion: 'revoke' }
      : raw,
  );
  if (input === undefined) return jsonResponse({ error: { code: 'invalid_request' } }, 400);
  const result = await authorized.service.rpc(
    'kineo_revoke_installation_for_account',
    {
      p_account_id: authorized.accountId,
      p_installation_id: input.installationId,
    },
  );
  return result.error === null
    ? jsonResponse({ status: 'revoked' })
    : serverFailure();
});
