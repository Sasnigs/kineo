import {
  authorize,
  methodNotAllowed,
  readJson,
  serverFailure,
  jsonResponse,
} from '../_shared/http.ts';
import {
  decodeCursor,
  defaultChangePageSize,
  validateBootstrapRequest,
} from '../_shared/protocol.ts';

Deno.serve(async (request) => {
  if (request.method !== 'POST') return methodNotAllowed();
  const authorized = await authorize(request);
  if (authorized instanceof Response) return authorized;
  const input = validateBootstrapRequest(await readJson(request));
  if (input === undefined) return jsonResponse({ error: { code: 'invalid_request' } }, 400);
  const cursor = decodeCursor(input.cursor);
  if (cursor === undefined) return jsonResponse({ error: { code: 'invalid_cursor' } }, 400);

  const { data, error } = await authorized.service.rpc(
    'kineo_bootstrap_for_account',
    {
      p_account_id: authorized.accountId,
      p_installation_id: input.installationId,
      p_app_version: input.appVersion,
      p_platform_version: input.platformVersion,
      p_after_sequence: cursor,
      p_page_size: defaultChangePageSize,
    },
  );
  return error === null ? jsonResponse(data) : serverFailure();
});
