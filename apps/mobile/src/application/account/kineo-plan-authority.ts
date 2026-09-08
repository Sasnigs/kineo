import type {
  DurationVariant,
  RoutineLevel,
  SelectionDecisionId,
} from '../../core/domain/selection-domain';
import type {
  CheckIn,
  SafetyMutation,
} from '../../core/persistence/persistence-domain';
import type { ProductResult } from '../../core/product/product-flow';
import { createPendingMutation } from '../../core/account/sync-contract';
import type {
  SyncLocalRepository,
  SyncModule,
  SyncOutbox,
} from '../../core/account/sync-module';

export type PlanAuthorization =
  | Readonly<{ kind: 'noPlan' }>
  | Readonly<{
      kind: 'approved';
      decisionId: SelectionDecisionId;
      decisionRevision: number;
      rulesVersion: string;
      catalogVersion: string;
      recommendedLevel: RoutineLevel;
      selectedLevel: RoutineLevel;
      deliveredLevel: RoutineLevel;
      duration: DurationVariant;
    }>;

export interface PlanAuthority {
  authorize(
    checkIn: CheckIn,
    decisionId: SelectionDecisionId,
    decisionRevision: number,
    duration: DurationVariant,
    requestedOverride?: RoutineLevel,
    safetyMutations?: readonly SafetyMutation[],
  ): Promise<ProductResult<PlanAuthorization>>;
}

export class KineoCloudPlanAuthority implements PlanAuthority {
  constructor(
    private readonly accountId: string,
    private readonly installationId: string,
    private readonly sync: SyncModule,
    private readonly repository: SyncLocalRepository & SyncOutbox,
    private readonly nextIdentifier: () => string,
    private readonly nowMilliseconds: () => number,
  ) {}

  async authorize(
    checkIn: CheckIn,
    decisionId: SelectionDecisionId,
    decisionRevision: number,
    duration: DurationVariant,
    requestedOverride?: RoutineLevel,
    safetyMutations: readonly SafetyMutation[] = [],
  ): Promise<ProductResult<PlanAuthorization>> {
    const account = await this.repository.loadAccount();
    if (!account.ok || account.value === undefined) {
      return { ok: false, error: { code: 'accountUnavailable' } };
    }
    const existingPending = await this.repository.pendingMutations();
    if (!existingPending.ok) {
      return { ok: false, error: { code: 'accountUnavailable' } };
    }
    let mutation = existingPending.value.find((candidate) =>
      candidate.command.kind === 'submitCheckIn' &&
      isSameCheckIn(candidate.command.checkIn, checkIn.id) &&
      candidate.command.durationVariant === duration &&
      candidate.command.requestedOverride === requestedOverride
    );
    if (mutation === undefined) {
      const created = createPendingMutation({
        mutationId: this.nextIdentifier(),
        accountId: this.accountId,
        installationId: this.installationId,
        historyEpoch: account.value.historyEpoch,
        createdAtMilliseconds: this.nowMilliseconds(),
        command: {
          kind: 'submitCheckIn',
          checkIn,
          decisionId,
          decisionRevision,
          durationVariant: duration,
          ...(requestedOverride === undefined
            ? {}
            : { requestedOverride }),
          attentionTransitions: safetyMutations.map((mutation) => ({
            ...mutation.event,
            statusAfter: mutation.statusAfter,
            expectedAttentionUpdatedAtMilliseconds: mutation.expectedAttentionUpdatedAtMilliseconds,
          })),
        },
      });
      if (!created.ok) {
        return { ok: false, error: { code: 'serverRejected' } };
      }
      const enqueued = await this.repository.enqueue(created.value);
      if (!enqueued.ok) {
        return { ok: false, error: { code: 'accountUnavailable' } };
      }
      mutation = created.value;
    }
    const allPending = await this.repository.pendingMutations();
    if (!allPending.ok) {
      return { ok: false, error: { code: 'accountUnavailable' } };
    }
    const synchronized = await this.sync.synchronize(allPending.value);
    if (!synchronized.ok) return syncFailure(synchronized.error.code);

    const command = mutation.command;
    if (command.kind !== 'submitCheckIn') {
      return { ok: false, error: { code: 'serverRejected' } };
    }
    const entity = await this.repository.loadSynchronizedEntity(
      'selectionDecision',
      command.decisionId,
    );
    if (!entity.ok) {
      return { ok: false, error: { code: 'accountUnavailable' } };
    }
    if (entity.value === undefined) {
      return checkIn.entries.some((entry) =>
        entry.conditionalSafetyAnswer === 'yes' ||
        entry.conditionalSafetyAnswer === 'notSure'
      )
        ? { ok: true, value: { kind: 'noPlan' } }
        : { ok: false, error: { code: 'serverRejected' } };
    }
    const approval = parseApproval(entity.value);
    return approval === undefined
      ? { ok: false, error: { code: 'serverRejected' } }
      : { ok: true, value: approval };
  }
}

function parseApproval(value: unknown): Extract<PlanAuthorization, { kind: 'approved' }> | undefined {
  if (
    !isRecord(value) ||
    typeof value.decisionId !== 'string' ||
    !isPositiveSafeInteger(value.revision) ||
    typeof value.rulesVersion !== 'string' ||
    typeof value.catalogVersion !== 'string' ||
    !isRoutineLevel(value.recommendedLevel) ||
    !isRoutineLevel(value.selectedLevel) ||
    !isRoutineLevel(value.deliveredLevel) ||
    (value.durationVariant !== 'quick' && value.durationVariant !== 'standard')
  ) {
    return undefined;
  }
  return {
    kind: 'approved',
    decisionId: value.decisionId as SelectionDecisionId,
    decisionRevision: value.revision,
    rulesVersion: value.rulesVersion,
    catalogVersion: value.catalogVersion,
    recommendedLevel: value.recommendedLevel,
    selectedLevel: value.selectedLevel,
    deliveredLevel: value.deliveredLevel,
    duration: value.durationVariant,
  };
}

function isSameCheckIn(value: unknown, checkInId: string): boolean {
  return isRecord(value) && value.id === checkInId;
}

function isRoutineLevel(value: unknown): value is RoutineLevel {
  return value === 'gentle' || value === 'balanced' || value === 'active';
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function syncFailure(
  code: 'offline' | 'authenticationRequired' | 'installationRevoked' |
    'accountDeleting' | 'conflict' | 'updateRequired' | 'invalidResponse' |
    'localPersistence' | 'unexpected',
): ProductResult<never> {
  switch (code) {
    case 'offline':
      return { ok: false, error: { code: 'onlineValidationRequired' } };
    case 'authenticationRequired':
    case 'installationRevoked':
    case 'accountDeleting':
      return { ok: false, error: { code: 'accountUnavailable' } };
    default:
      return { ok: false, error: { code: 'serverRejected' } };
  }
}
