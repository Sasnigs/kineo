import {
  authorize,
  jsonResponse,
  methodNotAllowed,
  readJson,
  serverFailure,
} from '../_shared/http.ts';
import {
  decodeCursor,
  defaultChangePageSize,
  validateSyncRequest,
} from '../_shared/protocol.ts';
import { prepareAuthoritativePlanCommand } from '../_shared/generated/authoritative-plan.js';

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
    if (command.kind === 'submitCheckIn' || command.kind === 'startRoutine' || command.kind === 'applyAttentionTransition') {
      const context = await authorized.service.rpc(
        'kineo_selection_context_for_account',
        { p_account_id: authorized.accountId },
      );
      if (context.error !== null || !isVersionedContext(context.data)) return serverFailure();
      if (command.kind === 'submitCheckIn') {
        const prepared = prepareAuthoritativePlanCommand(command, context.data);
        if (!prepared.ok) return jsonResponse({ error: { code: 'invalid_plan_context' } }, 409);
        command = { ...command, ...prepared.value };
      } else {
        command = { ...command, authorityVersion: context.data.version };
      }
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

function isVersionedContext(value: unknown): value is Record<string, unknown> & { version: number } {
  return typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'version' in value && typeof value.version === 'number' &&
    Number.isSafeInteger(value.version) && value.version > 0;
}
