import {
  authorize,
  jsonResponse,
  methodNotAllowed,
  readJson,
  serverFailure,
} from '../_shared/http.ts';
import {
  createAuthoritativePlan,
  decodeCursor,
  defaultChangePageSize,
  validateSyncRequest,
} from '../_shared/protocol.ts';

Deno.serve(async (request) => {
  if (request.method !== 'POST') return methodNotAllowed();
  const authorized = await authorize(request);
  if (authorized instanceof Response) return authorized;
  const input = validateSyncRequest(await readJson(request));
  if (input === undefined) return jsonResponse({ error: { code: 'invalid_request' } }, 400);
  const cursor = decodeCursor(input.cursor);
  if (cursor === undefined) return jsonResponse({ error: { code: 'invalid_cursor' } }, 400);

  const dispositions: unknown[] = [];
  for (const mutation of input.mutations) {
    let command = mutation.command;
    if (command.kind === 'submitCheckIn') {
      const history = await authorized.service.rpc(
        'kineo_active_history_for_account',
        { p_account_id: authorized.accountId },
      );
      if (history.error !== null) return serverFailure();
      const plan = createAuthoritativePlan(
        command,
        isNumericRecord(history.data) ? history.data : {},
      );
      command = {
        ...command,
        ...(plan === undefined ? {} : { authoritativePlan: plan }),
      };
    }
    const applied = await authorized.service.rpc(
      'kineo_apply_mutation_for_account',
      {
        p_account_id: authorized.accountId,
        p_mutation_id: mutation.mutationId,
        p_installation_id: mutation.installationId,
        p_history_epoch: mutation.historyEpoch,
        p_command: command,
      },
    );
    if (applied.error !== null) return serverFailure();
    dispositions.push(applied.data);
  }

  const pulled = await authorized.service.rpc('kineo_changes_for_account', {
    p_account_id: authorized.accountId,
    p_after_sequence: cursor,
    p_page_size: defaultChangePageSize,
  });
  if (
    pulled.error !== null ||
    typeof pulled.data !== 'object' ||
    pulled.data === null ||
    Array.isArray(pulled.data)
  ) {
    return serverFailure();
  }
  return jsonResponse({
    ...pulled.data,
    dispositions,
  });
});

function isNumericRecord(value: unknown): value is Record<string, number> {
  return typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((item) =>
      typeof item === 'number' && Number.isSafeInteger(item) && item >= 0
    );
}
