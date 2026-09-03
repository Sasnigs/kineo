import type { Result } from '../shared/result';
import type { LegalAcceptance } from './account-domain';

export const firstHistoryEpoch = 1;

export type SyncCommand =
  | Readonly<{ kind: 'acceptLegal'; acceptance: LegalAcceptance }>
  | Readonly<{
      kind: 'saveProfile';
      expectedVersion: number;
      profile: Readonly<{
        adultAcknowledged: boolean;
        primaryArea?: 'neck' | 'upperMidBack' | 'lowerBack';
        secondaryArea?: 'neck' | 'upperMidBack' | 'lowerBack';
        safetyBoundaryVersion?: string;
        safetyAcknowledgedAtMilliseconds?: number;
        weeklyGoalDays: number;
      }>;
    }>
  | Readonly<{
      kind: 'submitCheckIn';
      checkIn: unknown;
      decisionId: string;
      decisionRevision: number;
      durationVariant: 'quick' | 'standard';
      requestedOverride?: 'gentle' | 'balanced' | 'active';
    }>
  | Readonly<{ kind: 'applyAttentionTransition'; transition: unknown }>
  | Readonly<{ kind: 'startRoutine'; decisionId: string }>
  | Readonly<{ kind: 'recordRoutineEvent'; event: unknown }>
  | Readonly<{ kind: 'submitFeedback'; submission: unknown }>
  | Readonly<{ kind: 'resetHistory' }>;

export type PendingMutation = Readonly<{
  mutationId: string;
  accountId: string;
  installationId: string;
  historyEpoch: number;
  createdAtMilliseconds: number;
  command: SyncCommand;
}>;

export type SyncMutation = Omit<PendingMutation, 'accountId'>;

export type SyncRequest = Readonly<{
  installationId: string;
  cursor?: string;
  mutations: readonly SyncMutation[];
}>;

export type SyncChange = Readonly<{
  cursor: string;
  entityKind: string;
  entityId: string;
  operation: 'upsert' | 'delete' | 'reset';
  payload?: unknown;
}>;

export type MutationDisposition =
  | Readonly<{ mutationId: string; kind: 'applied' }>
  | Readonly<{ mutationId: string; kind: 'duplicate' }>
  | Readonly<{
      mutationId: string;
      kind: 'conflict';
      authoritativeVersion: number;
    }>
  | Readonly<{
      mutationId: string;
      kind: 'rejected';
      code:
        | 'invalidCommand'
        | 'staleHistoryEpoch'
        | 'installationRevoked'
        | 'routineOwnedByAnotherInstallation'
        | 'accountDeleting';
    }>;

export type SyncResponse = Readonly<{
  accountStatus: 'active' | 'deleting';
  historyEpoch: number;
  dispositions: readonly MutationDisposition[];
  changes: readonly SyncChange[];
  nextCursor?: string;
  hasMore: boolean;
}>;

export type SyncContractError =
  | Readonly<{ code: 'invalidIdentifier' }>
  | Readonly<{ code: 'invalidHistoryEpoch' }>
  | Readonly<{ code: 'invalidTimestamp' }>
  | Readonly<{ code: 'duplicateMutation' }>
  | Readonly<{ code: 'ownershipMismatch' }>
  | Readonly<{ code: 'mutationOrder' }>
  | Readonly<{ code: 'invalidCursor' }>;

type PendingMutationInput = PendingMutation;
type SyncRequestInput = Readonly<{
  expectedAccountId: string;
  installationId: string;
  cursor?: string;
  mutations: readonly PendingMutation[];
}>;

const uuidShape =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function isIdentifier(value: string): boolean {
  return uuidShape.test(value);
}

export function createPendingMutation(
  input: PendingMutationInput,
): Result<PendingMutation, SyncContractError> {
  if (
    !isIdentifier(input.mutationId) ||
    !isIdentifier(input.accountId) ||
    !isIdentifier(input.installationId)
  ) {
    return { ok: false, error: { code: 'invalidIdentifier' } };
  }
  if (
    !Number.isSafeInteger(input.historyEpoch) ||
    input.historyEpoch < firstHistoryEpoch
  ) {
    return { ok: false, error: { code: 'invalidHistoryEpoch' } };
  }
  if (
    !Number.isSafeInteger(input.createdAtMilliseconds) ||
    input.createdAtMilliseconds <= 0
  ) {
    return { ok: false, error: { code: 'invalidTimestamp' } };
  }
  return { ok: true, value: input };
}

export function createSyncRequest(
  input: SyncRequestInput,
): Result<SyncRequest, SyncContractError> {
  if (
    !isIdentifier(input.expectedAccountId) ||
    !isIdentifier(input.installationId)
  ) {
    return { ok: false, error: { code: 'invalidIdentifier' } };
  }
  if (input.cursor !== undefined && input.cursor.trim().length === 0) {
    return { ok: false, error: { code: 'invalidCursor' } };
  }

  const identifiers = new Set<string>();
  let priorTimestamp = 0;
  for (const mutation of input.mutations) {
    if (identifiers.has(mutation.mutationId)) {
      return { ok: false, error: { code: 'duplicateMutation' } };
    }
    identifiers.add(mutation.mutationId);
    if (
      mutation.accountId !== input.expectedAccountId ||
      mutation.installationId !== input.installationId
    ) {
      return { ok: false, error: { code: 'ownershipMismatch' } };
    }
    if (mutation.createdAtMilliseconds < priorTimestamp) {
      return { ok: false, error: { code: 'mutationOrder' } };
    }
    priorTimestamp = mutation.createdAtMilliseconds;
  }

  return {
    ok: true,
    value: {
      installationId: input.installationId,
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      mutations: input.mutations.map(({ accountId: _accountId, ...mutation }) =>
        mutation),
    },
  };
}
