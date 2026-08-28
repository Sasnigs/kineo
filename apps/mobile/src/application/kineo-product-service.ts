import type { BodyArea } from '../core/domain/selection-domain';
import type { PersistenceError } from '../core/persistence/persistence-contract';
import {
  createProfileState,
  defaultWeeklyGoalDays,
  type ProfileState,
  type UserProfile,
} from '../core/persistence/persistence-domain';
import type { ProductResult, ProductStartState } from '../core/product/product-flow';
import type { KineoPersistence } from '../infrastructure/persistence/protected-kineo-store';

export type ProductClock = Readonly<{
  nowMilliseconds(): number;
}>;

export const prototypeSafetyBoundaryVersion = 'prototype-safety-v1';

export interface KineoProductServing {
  loadStartState(): Promise<ProductResult<ProductStartState>>;
  confirmAdultEligibility(): Promise<ProductResult<void>>;
  savePrimaryArea(area: BodyArea): Promise<ProductResult<void>>;
  saveSecondaryArea(area?: BodyArea): Promise<ProductResult<void>>;
  acknowledgeSafetyBoundary(): Promise<ProductResult<void>>;
  completeOnboarding(): Promise<ProductResult<BodyArea>>;
  resetHistory(): Promise<ProductResult<void>>;
  deleteAllData(): Promise<ProductResult<void>>;
}

function persistenceFailure<Value>(
  cause: PersistenceError,
): ProductResult<Value> {
  return { ok: false, error: { code: 'persistence', cause } };
}

const invalidState = Object.freeze({
  ok: false,
  error: Object.freeze({ code: 'invalidState' as const }),
});

export class KineoProductService implements KineoProductServing {
  constructor(
    private readonly store: KineoPersistence,
    private readonly clock: ProductClock,
  ) {}

  async loadStartState(): Promise<ProductResult<ProductStartState>> {
    const profile = await this.store.loadProfileState();
    if (!profile.ok) return persistenceFailure(profile.error);
    const progress = this.onboardingProgress(profile.value?.profile);
    if (progress !== undefined) {
      return { ok: true, value: { kind: 'onboarding', progress } };
    }
    const primaryArea = profile.value?.profile.primaryArea;
    if (primaryArea === undefined) return invalidState;

    const routine = await this.store.loadNonterminalRoutine();
    if (!routine.ok) return persistenceFailure(routine.error);
    if (routine.value !== undefined) {
      return { ok: true, value: { kind: 'unfinishedRoutine', session: routine.value } };
    }
    const attention = await this.store.loadAttentionStates();
    if (!attention.ok) return persistenceFailure(attention.error);
    const firstAttention = attention.value[0];
    return firstAttention === undefined
      ? { ok: true, value: { kind: 'today', primaryArea } }
      : {
          ok: true,
          value: {
            kind: 'attentionRequired',
            area: firstAttention.area,
            expectedAttentionUpdatedAtMilliseconds:
              firstAttention.updatedAtMilliseconds,
          },
        };
  }

  async confirmAdultEligibility(): Promise<ProductResult<void>> {
    const timestamp = this.clock.nowMilliseconds();
    return this.updateProfile((existing) => ({
      onboardingCompletedAtMilliseconds:
        existing?.onboardingCompletedAtMilliseconds,
      adultAcknowledged: true,
      safetyBoundaryVersion: existing?.safetyBoundaryVersion,
      safetyAcknowledgedAtMilliseconds:
        existing?.safetyAcknowledgedAtMilliseconds,
      primaryArea: existing?.primaryArea,
      weeklyGoalDays: existing?.weeklyGoalDays ?? defaultWeeklyGoalDays,
      telemetryChoice: existing?.telemetryChoice ?? 'notOffered',
      createdAtMilliseconds: existing?.createdAtMilliseconds ?? timestamp,
      updatedAtMilliseconds: timestamp,
    }));
  }

  async savePrimaryArea(area: BodyArea): Promise<ProductResult<void>> {
    return this.updateExistingProfile((existing, timestamp) => ({
      ...existing,
      primaryArea: area,
      secondaryArea: undefined,
      safetyBoundaryVersion:
        existing.onboardingCompletedAtMilliseconds === undefined
          ? undefined
          : existing.safetyBoundaryVersion,
      safetyAcknowledgedAtMilliseconds:
        existing.onboardingCompletedAtMilliseconds === undefined
          ? undefined
          : existing.safetyAcknowledgedAtMilliseconds,
      updatedAtMilliseconds: timestamp,
    }));
  }

  async saveSecondaryArea(area?: BodyArea): Promise<ProductResult<void>> {
    return this.updateExistingProfile((existing, timestamp) => {
      if (existing.primaryArea === undefined || area === existing.primaryArea) {
        return undefined;
      }
      return {
        ...existing,
        secondaryArea: area,
        safetyBoundaryVersion:
          existing.onboardingCompletedAtMilliseconds === undefined
            ? prototypeSafetyBoundaryVersion
            : existing.safetyBoundaryVersion,
        updatedAtMilliseconds: timestamp,
      };
    });
  }

  async acknowledgeSafetyBoundary(): Promise<ProductResult<void>> {
    return this.updateExistingProfile((existing, timestamp) =>
      existing.primaryArea === undefined
        ? undefined
        : {
            ...existing,
            safetyBoundaryVersion: prototypeSafetyBoundaryVersion,
            safetyAcknowledgedAtMilliseconds: timestamp,
            updatedAtMilliseconds: timestamp,
          },
    );
  }

  async completeOnboarding(): Promise<ProductResult<BodyArea>> {
    let completedArea: BodyArea | undefined;
    const result = await this.updateExistingProfile((existing, timestamp) => {
      if (
        !existing.adultAcknowledged ||
        existing.primaryArea === undefined ||
        existing.safetyBoundaryVersion === undefined ||
        existing.safetyAcknowledgedAtMilliseconds === undefined
      ) {
        return undefined;
      }
      completedArea = existing.primaryArea;
      return {
        ...existing,
        onboardingCompletedAtMilliseconds:
          existing.onboardingCompletedAtMilliseconds ?? timestamp,
        updatedAtMilliseconds: timestamp,
      };
    });
    if (!result.ok) return result;
    return completedArea === undefined
      ? invalidState
      : { ok: true, value: completedArea };
  }

  async resetHistory(): Promise<ProductResult<void>> {
    const result = await this.store.resetHistory();
    return result.ok ? result : persistenceFailure(result.error);
  }

  async deleteAllData(): Promise<ProductResult<void>> {
    const result = await this.store.deleteAllData();
    return result.ok ? result : persistenceFailure(result.error);
  }

  private onboardingProgress(
    profile: UserProfile | undefined,
  ): Extract<ProductStartState, { kind: 'onboarding' }>['progress'] | undefined {
    if (profile === undefined || !profile.adultAcknowledged) return { step: 'welcome' };
    if (profile.primaryArea === undefined) return { step: 'primaryArea' };
    if (profile.safetyBoundaryVersion === undefined) {
      return {
        step: 'secondaryArea',
        primaryArea: profile.primaryArea,
        selectedArea: profile.secondaryArea,
      };
    }
    if (profile.safetyAcknowledgedAtMilliseconds === undefined) {
      return { step: 'safetyBoundary', primaryArea: profile.primaryArea };
    }
    if (profile.onboardingCompletedAtMilliseconds === undefined) {
      return { step: 'firstCheckIn', primaryArea: profile.primaryArea };
    }
    return undefined;
  }

  private async updateExistingProfile(
    update: (existing: UserProfile, timestamp: number) => UserProfile | undefined,
  ): Promise<ProductResult<void>> {
    return this.updateProfile((existing) =>
      existing === undefined ? undefined : update(existing, this.clock.nowMilliseconds()),
    );
  }

  private async updateProfile(
    update: (existing: UserProfile | undefined) => UserProfile | undefined,
  ): Promise<ProductResult<void>> {
    const loaded = await this.store.loadProfileState();
    if (!loaded.ok) return persistenceFailure(loaded.error);
    const updated = update(loaded.value?.profile);
    if (updated === undefined) return invalidState;
    const state: ProfileState = {
      profile: updated,
      reminderSettings: loaded.value?.reminderSettings,
    };
    const validated = createProfileState(state);
    if (!validated.ok) return { ok: false, error: { code: 'invalidData' } };
    const saved = await this.store.saveProfileState(validated.value);
    return saved.ok ? saved : persistenceFailure(saved.error);
  }
}
