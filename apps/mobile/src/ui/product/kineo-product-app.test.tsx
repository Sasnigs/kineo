import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { describe, expect, it, jest } from '@jest/globals';

import type { KineoProductServing } from '@/application/kineo-product-service';
import type { RoutineSessionId } from '@/core/content/routine-session-snapshot';
import {
  parseCheckInEntryId,
  parseCheckInId,
  parseSelectionDecisionId,
  type BodyArea,
} from '@/core/domain/selection-domain';
import type {
  CheckInResult,
  ProfilePresentation,
  ProgressPresentation,
  ProductResult,
  ProductStartState,
  RoutineEndReason,
} from '@/core/product/product-flow';

import { KineoProductApp } from './kineo-product-app';

function required<Value>(result: { ok: true; value: Value } | { ok: false }): Value {
  if (!result.ok) throw new Error('UI fixture identifier is invalid.');
  return result.value;
}

class OnboardingService implements KineoProductServing {
  private state: ProductStartState = {
    kind: 'onboarding',
    progress: { step: 'welcome' },
  };
  deleteResult: ProductResult<void> = { ok: true, value: undefined };
  reminderAuthorization: ProfilePresentation['reminderAuthorization'] = 'notDetermined';
  progress: ProgressPresentation = {
    participationDayCount: 0,
    weeklyParticipationDayCount: 0,
    weeklyGoalDays: 3,
    recentSessions: [],
    areas: [],
  };

  async loadStartState() {
    return { ok: true as const, value: this.state };
  }

  async confirmAdultEligibility() {
    this.state = { kind: 'onboarding', progress: { step: 'primaryArea' } };
    return { ok: true as const, value: undefined };
  }

  async savePrimaryArea(area: BodyArea) {
    this.state = {
      kind: 'onboarding',
      progress: { step: 'secondaryArea', primaryArea: area },
    };
    return { ok: true as const, value: undefined };
  }

  async saveSecondaryArea() {
    this.state = {
      kind: 'onboarding',
      progress: { step: 'safetyBoundary', primaryArea: 'neck' },
    };
    return { ok: true as const, value: undefined };
  }

  async acknowledgeSafetyBoundary() {
    this.state = {
      kind: 'onboarding',
      progress: { step: 'firstCheckIn', primaryArea: 'neck' },
    };
    return { ok: true as const, value: undefined };
  }

  async completeOnboarding() {
    this.state = { kind: 'today', primaryArea: 'neck' };
    return { ok: true as const, value: 'neck' as const };
  }

  async respondToAttentionReturn() {
    return { ok: false as const, error: { code: 'invalidState' as const } };
  }

  async beginAttentionCorrection() {
    return { ok: false as const, error: { code: 'invalidState' as const } };
  }

  async submitAttentionCorrection() {
    return { ok: false as const, error: { code: 'invalidState' as const } };
  }

  async beginCheckIn() {
    return {
      ok: true as const,
      value: {
        checkInId: required(parseCheckInId('00000000-0000-0000-0000-000000000201')),
        primaryEntryId: required(parseCheckInEntryId('00000000-0000-0000-0000-000000000202')),
        primaryArea: 'neck' as const,
        startedAtMilliseconds: 1_750_000_000_000,
        dayContext: {
          localDay: '2025-06-15' as never,
          timeZoneId: 'America/Chicago',
          calendarId: 'gregorian',
        },
      },
    };
  }

  async submitCheckIn(): Promise<ProductResult<CheckInResult>> {
    return {
      ok: true as const,
      value: {
        kind: 'plan' as const,
        plan: {
          decisionId: required(parseSelectionDecisionId('00000000-0000-0000-0000-000000000203')),
          checkInId: required(parseCheckInId('00000000-0000-0000-0000-000000000201')),
          primaryArea: 'neck' as const,
          includedAreas: ['neck'] as const,
          recommendedLevel: 'balanced' as const,
          gentlerLevel: 'gentle' as const,
          selectedLevel: 'balanced' as const,
          deliveredLevel: 'balanced' as const,
          duration: 'standard' as const,
          explanationKeys: ['reason.balanced_checkin'],
          itemCount: 7,
          nominalSeconds: 600,
          pauseTodayAvailable: false,
        },
      },
    };
  }

  async revisePlan() {
    return { ok: false as const, error: { code: 'invalidState' as const } };
  }

  async pauseToday() {
    return { ok: false as const, error: { code: 'invalidState' as const } };
  }

  async startRoutine() {
    return {
      ok: true as const,
      value: {
        sessionId: '00000000-0000-0000-0000-000000000204' as never,
        decisionId: required(parseSelectionDecisionId('00000000-0000-0000-0000-000000000203')),
        primaryArea: 'neck' as const,
        includedAreas: ['neck'] as const,
        selectedLevel: 'balanced' as const,
        deliveredLevel: 'balanced' as const,
        duration: 'standard' as const,
        status: 'inProgress' as const,
        currentStepIndex: 0,
        totalStepCount: 1,
        currentItem: {
          kind: 'movement' as const,
          sourceOwnerId: 'kineo.primary.neck.balanced.standard.v1' as never,
          sourceOwnerRevision: 1 as never,
          sourceRole: 'primary_template' as const,
          sourceArea: 'neck' as const,
          itemId: 'kineo.primary.neck.balanced.standard.v1.item.1' as never,
          localizedTitle: 'Prototype movement 1',
          movementId: 'kineo.prototype.movement.neck.base.1.v1' as never,
          movementRevision: 1 as never,
          localizedInstruction: 'Move at a comfortable pace.',
          localizedSafetyCue: 'Stop if this feels wrong.',
          accessibleDescription: 'Prototype movement demonstration.',
          scheduledDose: {
            kind: 'timed' as const,
            activeSeconds: 60,
            estimatedSeconds: 60,
          },
          availableAlternatives: [] as const,
        },
        stepElapsedMilliseconds: 60_000,
        contentAvailable: true,
      },
    };
  }

  async refreshRoutine() {
    return { ok: false as const, error: { code: 'invalidState' as const } };
  }

  async pauseRoutine() {
    const started = await this.startRoutine();
    return started.ok
      ? { ok: true as const, value: { ...started.value, status: 'paused' as const } }
      : started;
  }

  async resumeRoutine() {
    return this.startRoutine();
  }

  async advanceRoutine() {
    const started = await this.startRoutine();
    if (!started.ok) return started;
    return {
      ok: true as const,
      value: {
        ...started.value,
        status: 'completed' as const,
        currentStepIndex: 1,
        currentItem: undefined,
      },
    };
  }

  async skipRoutineStep() {
    return { ok: false as const, error: { code: 'invalidState' as const } };
  }

  async selectRoutineAlternative() {
    return { ok: false as const, error: { code: 'invalidState' as const } };
  }

  async endRoutine(_sessionId: RoutineSessionId, reason: RoutineEndReason) {
    const started = await this.startRoutine();
    return started.ok
      ? {
          ok: true as const,
          value: {
            ...started.value,
            status: reason === 'safety' ? 'safetyStopped' as const : 'stopped' as const,
            currentItem: undefined,
          },
        }
      : started;
  }

  async submitFeedback() {
    return { ok: true as const, value: undefined };
  }

  async loadProgress() {
    return { ok: true as const, value: this.progress };
  }

  async loadProfile() {
    return {
      ok: true as const,
      value: {
        reminderAuthorization: this.reminderAuthorization,
        profile: {
          onboardingCompletedAtMilliseconds: 1_750_000_000_000,
          adultAcknowledged: true,
          safetyBoundaryVersion: 'prototype-safety-v1',
          safetyAcknowledgedAtMilliseconds: 1_750_000_000_000,
          primaryArea: 'neck' as const,
          weeklyGoalDays: 3,
          telemetryChoice: 'notOffered' as const,
          createdAtMilliseconds: 1_750_000_000_000,
          updatedAtMilliseconds: 1_750_000_000_000,
        },
      },
    };
  }

  async reconcileReminder() {
    return { ok: true as const, value: undefined };
  }

  async openReminderSettings() {
    return { ok: true as const, value: undefined };
  }

  async saveAreaPreferences() {
    return this.loadProfile();
  }

  async enableReminder() {
    return this.loadProfile();
  }

  async disableReminder() {
    return this.loadProfile();
  }

  async resetHistory() {
    return { ok: true as const, value: undefined };
  }

  async deleteAllData() {
    return this.deleteResult;
  }
}

class AttentionService extends OnboardingService {
  async submitCheckIn() {
    return {
      ok: true as const,
      value: {
        kind: 'attentionRequired' as const,
        area: 'neck' as const,
        responseEventId: '00000000-0000-0000-0000-000000000205' as never,
        expectedAttentionUpdatedAtMilliseconds: 1_750_000_000_001,
      },
    };
  }
}

class OmittedSecondaryPlanService extends OnboardingService {
  async submitCheckIn(): Promise<ProductResult<CheckInResult>> {
    const result = await super.submitCheckIn();
    if (!result.ok || result.value.kind !== 'plan') return result;
    return {
      ok: true,
      value: {
        kind: 'plan',
        plan: {
          ...result.value.plan,
          omittedSecondaryArea: 'upperMidBack',
        },
      },
    };
  }
}

describe('Kineo product app', () => {
  it('runs the complete durable onboarding flow', async () => {
    const view = await render(
      <KineoProductApp service={new OnboardingService()} onStoreRestartRequired={() => undefined} />,
    );

    await view.findByText('A routine shaped around how you feel now.');
    await fireEvent.press(view.getByRole('button', { name: 'Get started' }));
    expect(view.getByText('Are you 18 or older?')).toBeTruthy();

    await fireEvent.press(view.getByRole('button', { name: 'Yes, I’m 18 or older' }));
    await view.findByText('Where would you like to start?');
    await fireEvent.press(view.getByRole('radio', { name: 'Neck' }));
    await fireEvent.press(view.getByRole('button', { name: 'Continue' }));

    await view.findByText('Anything else to include?');
    await fireEvent.press(view.getByRole('button', { name: 'Just focus on my main area' }));
    await view.findByText('You stay in control.');
    expect(view.getByText(/not intended for a new injury/)).toBeTruthy();
    expect(view.getByText(/seek appropriate professional help/)).toBeTruthy();
    await fireEvent.press(view.getByRole('button', { name: 'I understand' }));

    await view.findByText('Let’s make this useful.');
    await fireEvent.press(view.getByRole('button', { name: 'Continue to Today' }));
    await view.findByText('How are you moving?');
    expect(view.getByRole('button', { name: 'Check in' })).toBeTruthy();
  });

  it('calls the testing reset only after deletion succeeds', async () => {
    const service = new OnboardingService();
    await service.confirmAdultEligibility();
    await service.savePrimaryArea('neck');
    await service.saveSecondaryArea();
    await service.acknowledgeSafetyBoundary();
    await service.completeOnboarding();
    const onStoreRestartRequired = jest.fn();
    const view = await render(
      <KineoProductApp
        service={service}
        onStoreRestartRequired={onStoreRestartRequired}
      />,
    );

    await view.findByText('How are you moving?');
    await fireEvent.press(view.getByRole('button', { name: 'Reset demo to first use' }));
    await waitFor(() => expect(onStoreRestartRequired).toHaveBeenCalledTimes(1));
  });

  it('runs a short daily check-in into a plan', async () => {
    const service = new OnboardingService();
    await service.confirmAdultEligibility();
    await service.savePrimaryArea('neck');
    await service.saveSecondaryArea();
    await service.acknowledgeSafetyBoundary();
    await service.completeOnboarding();
    const view = await render(
      <KineoProductApp service={service} onStoreRestartRequired={() => undefined} />,
    );

    await view.findByText('How are you moving?');
    await fireEvent.press(view.getByRole('button', { name: 'Check in' }));
    await view.findByText('Compared with your usual pattern…');
    await fireEvent.press(view.getByRole('button', { name: 'Similar' }));
    await view.findByText('How comfortable does movement feel?');
    await fireEvent.press(view.getByRole('button', { name: 'Okay' }));
    await view.findByText('Your plan for today');
    expect(view.getByText('Balanced')).toBeTruthy();
    expect(view.getByText('Your check-in supports a Balanced option today.')).toBeTruthy();
    await fireEvent.press(view.getByRole('button', { name: 'Begin routine' }));
    await view.findByText('Prototype movement 1');
    expect(view.getByRole('button', { name: 'Continue' })).toBeTruthy();
    await fireEvent.press(view.getByRole('button', { name: 'Continue' }));
    await view.findByText('How did neck feel afterward?');
    await fireEvent.press(view.getByRole('button', { name: 'About the same' }));
    await view.findByText('You made a choice for today.');
    await fireEvent.press(view.getByRole('button', { name: 'Done' }));
    await view.findByText('How are you moving?');
    await fireEvent.press(view.getByRole('tab', { name: 'Progress' }));
    await view.findByText('Progress without pressure');
    expect(view.getByText('Your patterns will appear here')).toBeTruthy();
    await fireEvent.press(view.getByRole('tab', { name: 'Profile' }));
    await waitFor(() => expect(view.getByRole('header', { name: 'Profile' })).toBeTruthy());
    expect(view.getByText('Health app context')).toBeTruthy();
    expect(view.getByText('App information')).toBeTruthy();
  });

  it('lets a user correct the conditional question before submission', async () => {
    const service = new OnboardingService();
    await service.confirmAdultEligibility();
    await service.savePrimaryArea('neck');
    await service.saveSecondaryArea();
    await service.acknowledgeSafetyBoundary();
    await service.completeOnboarding();
    const view = await render(
      <KineoProductApp service={service} onStoreRestartRequired={() => undefined} />,
    );

    await fireEvent.press(await view.findByRole('button', { name: 'Check in' }));
    await fireEvent.press(await view.findByRole('button', { name: 'Worse' }));
    await fireEvent.press(await view.findByRole('button', { name: 'Okay' }));
    await view.findByText('Is this new, sudden, or unusual for you?');
    await fireEvent.press(view.getByRole('button', { name: 'I selected that by mistake' }));
    await view.findByText('Compared with your usual pattern…');
  });

  it('shows immediate guidance instead of an immediate return-to-usual bypass', async () => {
    const service = new AttentionService();
    await service.confirmAdultEligibility();
    await service.savePrimaryArea('neck');
    await service.saveSecondaryArea();
    await service.acknowledgeSafetyBoundary();
    await service.completeOnboarding();
    const view = await render(
      <KineoProductApp service={service} onStoreRestartRequired={() => undefined} />,
    );

    await fireEvent.press(await view.findByRole('button', { name: 'Check in' }));
    await fireEvent.press(await view.findByRole('button', { name: 'Worse' }));
    await fireEvent.press(await view.findByRole('button', { name: 'Limited' }));
    await fireEvent.press(await view.findByRole('button', { name: 'Yes' }));
    await view.findByText('Kineo cannot guide this change.');
    expect(view.queryByRole('button', { name: 'Review now' })).toBeNull();
  });

  it('names a secondary area omitted by content fallback', async () => {
    const service = new OmittedSecondaryPlanService();
    await service.confirmAdultEligibility();
    await service.savePrimaryArea('neck');
    await service.saveSecondaryArea();
    await service.acknowledgeSafetyBoundary();
    await service.completeOnboarding();
    const view = await render(
      <KineoProductApp service={service} onStoreRestartRequired={() => undefined} />,
    );

    await fireEvent.press(await view.findByRole('button', { name: 'Check in' }));
    await fireEvent.press(await view.findByRole('button', { name: 'Similar' }));
    await fireEvent.press(await view.findByRole('button', { name: 'Okay' }));
    expect(await view.findByText(/Upper & mid back is not included/)).toBeTruthy();
  });

  it('shows private area history without implying causation', async () => {
    const service = new OnboardingService();
    await service.confirmAdultEligibility();
    await service.savePrimaryArea('neck');
    await service.saveSecondaryArea();
    await service.acknowledgeSafetyBoundary();
    await service.completeOnboarding();
    service.progress = {
      participationDayCount: 1,
      weeklyParticipationDayCount: 1,
      weeklyGoalDays: 3,
      recentSessions: [{
        sessionId: '00000000-0000-0000-0000-000000000204' as never,
        localDay: '2025-06-15' as never,
        status: 'completed',
        deliveredLevel: 'balanced',
        areas: ['neck'],
      }],
      areas: [{
        area: 'neck',
        checkInCount: 1,
        completedRoutineCount: 1,
        participationCount: 1,
        qualifyingOutcomeCount: 1,
        activeUnlocked: false,
        latestResponse: 'same',
        responses: { better: 0, same: 1, worse: 0 },
        history: [{
          localDay: '2025-06-15' as never,
          changeReport: 'similar',
          movementComfort: 'okay',
          routine: {
            status: 'completed',
            deliveredLevel: 'balanced',
            response: 'same',
          },
        }],
      }],
    };
    const view = await render(
      <KineoProductApp service={service} onStoreRestartRequired={() => undefined} />,
    );

    await view.findByText('How are you moving?');
    await fireEvent.press(view.getByRole('tab', { name: 'Progress' }));
    await fireEvent.press(await view.findByRole('button', { name: 'Neck · 1 check-ins' }));
    expect(view.getByText('Similar · Okay')).toBeTruthy();
    expect(view.getByText(/does not claim that one caused another/)).toBeTruthy();
  });

  it('freezes routine menus and keeps safety guidance behind an explicit choice', async () => {
    const service = new OnboardingService();
    await service.confirmAdultEligibility();
    await service.savePrimaryArea('neck');
    await service.saveSecondaryArea();
    await service.acknowledgeSafetyBoundary();
    await service.completeOnboarding();
    const view = await render(
      <KineoProductApp
        service={service}
        onStoreRestartRequired={() => undefined}
      />,
    );

    await view.findByText('How are you moving?');
    await fireEvent.press(view.getByRole('button', { name: 'Check in' }));
    await fireEvent.press(await view.findByRole('button', { name: 'Similar' }));
    await fireEvent.press(await view.findByRole('button', { name: 'Okay' }));
    await fireEvent.press(await view.findByRole('button', { name: 'Begin routine' }));
    await fireEvent.press(await view.findByRole('button', { name: 'More options' }));
    await view.findByText('What do you need?');
    await fireEvent.press(view.getByRole('button', { name: 'Something feels wrong' }));
    await view.findByText('Stop if something feels wrong.');
    await fireEvent.press(view.getByRole('button', { name: 'I tapped this by mistake' }));
    await view.findByText('Your place is saved.');
    await fireEvent.press(view.getByRole('button', { name: 'End routine' }));
    await view.findByText('End this routine now?');
    await fireEvent.press(view.getByRole('button', { name: 'Keep routine paused' }));
    await view.findByText('Your place is saved.');
  });

  it('requires confirmation before resetting profile history', async () => {
    const service = new OnboardingService();
    await service.confirmAdultEligibility();
    await service.savePrimaryArea('neck');
    await service.saveSecondaryArea();
    await service.acknowledgeSafetyBoundary();
    await service.completeOnboarding();
    const reset = jest.spyOn(service, 'resetHistory');
    const view = await render(
      <KineoProductApp service={service} onStoreRestartRequired={() => undefined} />,
    );

    await view.findByText('How are you moving?');
    await fireEvent.press(view.getByRole('tab', { name: 'Profile' }));
    await view.findByRole('header', { name: 'Profile' });
    await fireEvent.press(view.getByRole('button', { name: 'Reset History' }));
    expect(reset).not.toHaveBeenCalled();
    await view.findByRole('header', { name: 'Reset history?' });
    await fireEvent.press(view.getByRole('button', { name: 'Reset history' }));
    await waitFor(() => expect(reset).toHaveBeenCalledTimes(1));
  });

  it('offers iPhone Settings after reminder permission is denied', async () => {
    const service = new OnboardingService();
    service.reminderAuthorization = 'denied';
    await service.confirmAdultEligibility();
    await service.savePrimaryArea('neck');
    await service.saveSecondaryArea();
    await service.acknowledgeSafetyBoundary();
    await service.completeOnboarding();
    const openSettings = jest.spyOn(service, 'openReminderSettings');
    const view = await render(
      <KineoProductApp service={service} onStoreRestartRequired={() => undefined} />,
    );

    await fireEvent.press(await view.findByRole('tab', { name: 'Profile' }));
    await fireEvent.press(await view.findByRole('button', { name: 'Open iPhone Settings' }));
    await waitFor(() => expect(openSettings).toHaveBeenCalledTimes(1));
  });

  it('restarts the protected store after a failed deletion attempt', async () => {
    const service = new OnboardingService();
    await service.confirmAdultEligibility();
    await service.savePrimaryArea('neck');
    await service.saveSecondaryArea();
    await service.acknowledgeSafetyBoundary();
    await service.completeOnboarding();
    service.deleteResult = {
      ok: false,
      error: { code: 'persistence', cause: { code: 'deletionFailed' } },
    };
    const onStoreRestartRequired = jest.fn();
    const view = await render(
      <KineoProductApp
        service={service}
        onStoreRestartRequired={onStoreRestartRequired}
      />,
    );

    await view.findByText('How are you moving?');
    await fireEvent.press(view.getByRole('tab', { name: 'Profile' }));
    await view.findByRole('header', { name: 'Profile' });
    await fireEvent.press(view.getByRole('button', { name: 'Delete All Data' }));
    await fireEvent.press(view.getByRole('button', { name: 'Delete all data' }));
    await waitFor(() => expect(onStoreRestartRequired).toHaveBeenCalledTimes(1));
  });
});
