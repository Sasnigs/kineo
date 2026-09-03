import type {
  AccountState,
  LegalAcceptance,
} from '../../core/account/account-domain';
import type {
  MutationDisposition,
  SyncChange,
  SyncRequest,
  SyncResponse,
} from '../../core/account/sync-contract';
import type {
  BootstrapPage,
  SyncResult,
  SyncTransport,
} from '../../core/account/sync-module';

type FunctionError = Readonly<{
  context?: Readonly<{ status?: number }>;
  name?: string;
}>;

type FunctionResponse = Readonly<{
  data: unknown;
  error: FunctionError | null;
}>;

export interface SupabaseFunctionsPort {
  invoke(
    functionName: string,
    options: Readonly<{ body: object }>,
  ): PromiseLike<FunctionResponse>;
}

export type ClientMetadata = Readonly<{
  installationId: string;
  appVersion: string;
  platformVersion: string;
}>;

const unauthorizedStatus = 401;
const conflictStatus = 409;
const upgradeRequiredStatus = 426;
const serviceUnavailableStatus = 503;

export class SupabaseSyncTransport implements SyncTransport {
  constructor(
    private readonly functions: SupabaseFunctionsPort,
    private readonly metadata: ClientMetadata,
  ) {}

  async bootstrap(cursor?: string): Promise<SyncResult<BootstrapPage>> {
    try {
      const response = await this.functions.invoke('bootstrap', {
        body: {
          installationId: this.metadata.installationId,
          appVersion: this.metadata.appVersion,
          platformVersion: this.metadata.platformVersion,
          ...(cursor === undefined ? {} : { cursor }),
        },
      });
      if (response.error !== null) return mappedFunctionError(response.error);
      const parsed = parseBootstrapPage(response.data);
      return parsed === undefined
        ? invalidResponse()
        : { ok: true, value: parsed };
    } catch {
      return { ok: false, error: { code: 'offline' } };
    }
  }

  async synchronize(request: SyncRequest): Promise<SyncResult<SyncResponse>> {
    try {
      const response = await this.functions.invoke('sync', {
        body: request,
      });
      if (response.error !== null) return mappedFunctionError(response.error);
      const parsed = parseSyncResponse(response.data);
      return parsed === undefined
        ? invalidResponse()
        : { ok: true, value: parsed };
    } catch {
      return { ok: false, error: { code: 'offline' } };
    }
  }
}

function mappedFunctionError<Value>(error: FunctionError): SyncResult<Value> {
  switch (error.context?.status) {
    case unauthorizedStatus:
      return { ok: false, error: { code: 'authenticationRequired' } };
    case conflictStatus:
      return { ok: false, error: { code: 'conflict' } };
    case upgradeRequiredStatus:
      return { ok: false, error: { code: 'updateRequired' } };
    case serviceUnavailableStatus:
      return { ok: false, error: { code: 'offline' } };
    default:
      return { ok: false, error: { code: 'unexpected' } };
  }
}

function parseBootstrapPage(value: unknown): BootstrapPage | undefined {
  if (!isRecord(value)) return undefined;
  const account = parseAccount(value.account);
  const changes = parseChanges(value.changes);
  if (
    account === undefined ||
    changes === undefined ||
    typeof value.hasMore !== 'boolean' ||
    !isOptionalString(value.nextCursor)
  ) {
    return undefined;
  }
  return {
    account,
    changes,
    ...(typeof value.nextCursor === 'string'
      ? { nextCursor: value.nextCursor }
      : {}),
    hasMore: value.hasMore,
  };
}

function parseSyncResponse(value: unknown): SyncResponse | undefined {
  if (!isRecord(value)) return undefined;
  const changes = parseChanges(value.changes);
  const dispositions = parseDispositions(value.dispositions);
  if (
    (value.accountStatus !== 'active' && value.accountStatus !== 'deleting') ||
    !isPositiveSafeInteger(value.historyEpoch) ||
    changes === undefined ||
    dispositions === undefined ||
    typeof value.hasMore !== 'boolean' ||
    !isOptionalString(value.nextCursor)
  ) {
    return undefined;
  }
  return {
    accountStatus: value.accountStatus,
    historyEpoch: value.historyEpoch,
    changes,
    dispositions,
    ...(typeof value.nextCursor === 'string'
      ? { nextCursor: value.nextCursor }
      : {}),
    hasMore: value.hasMore,
  };
}

function parseAccount(value: unknown): AccountState | undefined {
  if (
    !isRecord(value) ||
    typeof value.accountId !== 'string' ||
    (value.status !== 'active' && value.status !== 'deleting') ||
    !isPositiveSafeInteger(value.historyEpoch) ||
    !Array.isArray(value.legalAcceptances)
  ) {
    return undefined;
  }
  const legalAcceptances: LegalAcceptance[] = [];
  for (const acceptance of value.legalAcceptances) {
    if (
      !isRecord(acceptance) ||
      (acceptance.documentKind !== 'termsOfService' &&
        acceptance.documentKind !== 'privacyPolicy') ||
      typeof acceptance.documentVersion !== 'string' ||
      typeof acceptance.locale !== 'string' ||
      !isPositiveSafeInteger(acceptance.acceptedAtMilliseconds)
    ) {
      return undefined;
    }
    legalAcceptances.push({
      documentKind: acceptance.documentKind,
      documentVersion: acceptance.documentVersion,
      locale: acceptance.locale,
      acceptedAtMilliseconds: acceptance.acceptedAtMilliseconds,
    });
  }
  return {
    accountId: value.accountId,
    status: value.status,
    historyEpoch: value.historyEpoch,
    legalAcceptances,
  };
}

function parseChanges(value: unknown): readonly SyncChange[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const changes: SyncChange[] = [];
  for (const change of value) {
    if (
      !isRecord(change) ||
      typeof change.cursor !== 'string' ||
      change.cursor.length === 0 ||
      typeof change.entityKind !== 'string' ||
      change.entityKind.length === 0 ||
      typeof change.entityId !== 'string' ||
      change.entityId.length === 0 ||
      (change.operation !== 'upsert' &&
        change.operation !== 'delete' &&
        change.operation !== 'reset')
    ) {
      return undefined;
    }
    changes.push({
      cursor: change.cursor,
      entityKind: change.entityKind,
      entityId: change.entityId,
      operation: change.operation,
      ...('payload' in change ? { payload: change.payload } : {}),
    });
  }
  return changes;
}

function parseDispositions(
  value: unknown,
): readonly MutationDisposition[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const dispositions: MutationDisposition[] = [];
  for (const disposition of value) {
    if (!isRecord(disposition) || typeof disposition.mutationId !== 'string') {
      return undefined;
    }
    if (disposition.kind === 'applied' || disposition.kind === 'duplicate') {
      dispositions.push({
        mutationId: disposition.mutationId,
        kind: disposition.kind,
      });
      continue;
    }
    if (
      disposition.kind === 'conflict' &&
      isPositiveSafeInteger(disposition.authoritativeVersion)
    ) {
      dispositions.push({
        mutationId: disposition.mutationId,
        kind: 'conflict',
        authoritativeVersion: disposition.authoritativeVersion,
      });
      continue;
    }
    if (
      disposition.kind === 'rejected' &&
      isRejectionCode(disposition.code)
    ) {
      dispositions.push({
        mutationId: disposition.mutationId,
        kind: 'rejected',
        code: disposition.code,
      });
      continue;
    }
    return undefined;
  }
  return dispositions;
}

function isRejectionCode(
  value: unknown,
): value is Extract<MutationDisposition, { kind: 'rejected' }>['code'] {
  return value === 'invalidCommand' ||
    value === 'staleHistoryEpoch' ||
    value === 'installationRevoked' ||
    value === 'routineOwnedByAnotherInstallation' ||
    value === 'accountDeleting';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || (typeof value === 'string' && value.length > 0);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value > 0;
}

function invalidResponse<Value>(): SyncResult<Value> {
  return { ok: false, error: { code: 'invalidResponse' } };
}
