import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { describe, expect, it, jest } from '@jest/globals';

import type { KineoProductServing } from '@/application/kineo-product-service';
import {
  parseCheckInEntryId,
  parseCheckInId,
  parseSelectionDecisionId,
  type BodyArea,
} from '@/core/domain/selection-domain';
import type { ProductStartState } from '@/core/product/product-flow';

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

  async submitCheckIn() {
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

  async startRoutine() {
    return {
      ok: true as const,
      value: {
        sessionId: '00000000-0000-0000-0000-000000000204' as never,
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
        stepElapsedMilliseconds: 0,
        contentAvailable: true,
      },
    };
  }

  async refreshRoutine() {
    return { ok: false as const, error: { code: 'invalidState' as const } };
  }

  async pauseRoutine() {
    return { ok: false as const, error: { code: 'invalidState' as const } };
  }

  async resumeRoutine() {
    return { ok: false as const, error: { code: 'invalidState' as const } };
  }

  async advanceRoutine() {
    return { ok: false as const, error: { code: 'invalidState' as const } };
  }

  async resetHistory() {
    return { ok: true as const, value: undefined };
  }

  async deleteAllData() {
    return { ok: true as const, value: undefined };
  }
}

describe('Kineo product app', () => {
  it('runs the complete durable onboarding flow', async () => {
    const view = await render(
      <KineoProductApp service={new OnboardingService()} onDeleted={() => undefined} />,
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
    const onDeleted = jest.fn();
    const view = await render(<KineoProductApp service={service} onDeleted={onDeleted} />);

    await view.findByText('How are you moving?');
    await fireEvent.press(view.getByRole('button', { name: 'Reset demo to first use' }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
  });

  it('runs a short daily check-in into a plan', async () => {
    const service = new OnboardingService();
    await service.confirmAdultEligibility();
    await service.savePrimaryArea('neck');
    await service.saveSecondaryArea();
    await service.acknowledgeSafetyBoundary();
    await service.completeOnboarding();
    const view = await render(
      <KineoProductApp service={service} onDeleted={() => undefined} />,
    );

    await view.findByText('How are you moving?');
    await fireEvent.press(view.getByRole('button', { name: 'Check in' }));
    await view.findByText('Compared with your usual pattern…');
    await fireEvent.press(view.getByRole('button', { name: 'Similar' }));
    await view.findByText('How comfortable does movement feel?');
    await fireEvent.press(view.getByRole('button', { name: 'Okay' }));
    await view.findByText('Your plan for today');
    expect(view.getByText('Balanced')).toBeTruthy();
    await fireEvent.press(view.getByRole('button', { name: 'Begin routine' }));
    await view.findByText('Prototype movement 1');
    expect(view.getByRole('button', { name: 'Continue' })).toBeTruthy();
  });
});
