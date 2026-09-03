import {
  authorize,
  jsonResponse,
  methodNotAllowed,
  readJson,
  serverFailure,
} from '../_shared/http.ts';

Deno.serve(async (request) => {
  if (request.method !== 'POST') return methodNotAllowed();
  const authorized = await authorize(request, true);
  if (authorized instanceof Response) return authorized;
  const input = await readJson(request);
  if (
    !isRecord(input) ||
    typeof input.installationId !== 'string' ||
    typeof input.mutationId !== 'string' ||
    typeof input.historyEpoch !== 'number'
  ) {
    return jsonResponse({ error: { code: 'invalid_request' } }, 400);
  }
  const applied = await authorized.service.rpc(
    'kineo_apply_mutation_for_account',
    {
      p_account_id: authorized.accountId,
      p_mutation_id: input.mutationId,
      p_installation_id: input.installationId,
      p_history_epoch: input.historyEpoch,
      p_command: { kind: 'resetHistory' },
    },
  );
  if (applied.error !== null || !isRecord(applied.data)) {
    return serverFailure();
  }
  if (applied.data.kind !== 'applied' && applied.data.kind !== 'duplicate') {
    return jsonResponse({ error: { code: 'reset_rejected' } }, 409);
  }
  const state = await authorized.service.rpc('kineo_changes_for_account', {
    p_account_id: authorized.accountId,
    p_after_sequence: 0,
    p_page_size: 1,
  });
  return state.error === null &&
    isRecord(state.data) &&
    typeof state.data.historyEpoch === 'number'
    ? jsonResponse({ historyEpoch: state.data.historyEpoch })
    : serverFailure();
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
