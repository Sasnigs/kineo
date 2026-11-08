import { act, fireEvent, render } from '@testing-library/react-native';
import { afterEach, describe, expect, it, jest } from '@jest/globals';

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
  PlanPresentation,
  RoutinePresentation,
  ProfilePresentation,
  ProgressPresentation,
  ProductResult,
  ProductStartState,
  RoutineEndReason,
} from '@/core/product/product-flow';

import * as Video from 'expo-video';

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

  async loadStartState(): Promise<ProductResult<ProductStartState>> {
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

  weeklyGoalDays = 3;
  async saveWeeklyGoalDays(days: number) { this.weeklyGoalDays = days; return { ok: true as const, value: undefined }; }

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
          explanations: [{
            key: 'reason.balanced_checkin',
            parameters: { area: 'neck' },
          }],
          itemCount: 7,
          nominalSeconds: 600,
          pauseTodayAvailable: false,
        },
      },
    };
  }

  async revisePlan(): Promise<ProductResult<PlanPresentation>> {
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
          weeklyGoalDays: this.weeklyGoalDays,
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
          omittedSecondary: {
            area: 'upperMidBack',
            reason: 'contentUnavailable',
          },
        },
      },
    };
  }
}

class SkippedSecondaryPlanService extends OnboardingService {
  async submitCheckIn(): Promise<ProductResult<CheckInResult>> {
    const result = await super.submitCheckIn();
    if (!result.ok || result.value.kind !== 'plan') return result;
    return {
      ok: true,
      value: {
        kind: 'plan',
        plan: {
          ...result.value.plan,
          omittedSecondary: {
            area: 'upperMidBack',
            reason: 'secondaryUnanswered',
          },
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

    await view.findByText('Make room for how you feel today.');
    await fireEvent.press(view.getByRole('button', { name: 'Find your starting point' }));
    expect(view.getByText('Are you 18 or older?')).toBeTruthy();

    await chooseV11Answer(view, 'Yes, I’m 18 or older');
    await view.findByText('Where would you like to focus?');
    await fireEvent.press(view.getByRole('radio', { name: 'Neck' }));
    await fireEvent.press(view.getByRole('button', { name: 'Continue' }));

    await view.findByText('One more area?');
    await fireEvent.press(view.getByRole('button', { name: 'Just neck for now' }));
    await fireEvent.press(await view.findByRole('button', { name: 'Set my intention' }));
    await view.findByText('You stay in control');
    expect(view.getByText(/not intended for a new injury/)).toBeTruthy();
    expect(view.getByText(/Seek appropriate professional help/)).toBeTruthy();
    await fireEvent.press(view.getByRole('button', { name: 'I understand' }));

    await view.findByText('A small loop. Built around you.');
    await fireEvent.press(view.getByRole('button', { name: 'Go to Today' }));
    await view.findByRole('button', { name: 'Check in' });
    expect(view.getByRole('button', { name: 'Check in' })).toBeTruthy();
  });

  it('calls the testing reset only after deletion succeeds', async () => {
  const service=await phase4ReadyService(); const restart=jest.fn();
  const view=await render(<KineoProductApp service={service} onStoreRestartRequired={restart}/>);
  await fireEvent.press(await view.findByRole('tab',{name:'You'}));
  await fireEvent.press(view.getByRole('button',{name:'Privacy & your data'}));
  await fireEvent.press(view.getByRole('button',{name:'Delete all data'}));
  expect(restart).not.toHaveBeenCalled();
  await fireEvent.press(view.getByRole('button',{name:'Delete all data'}));
  expect(await view.findByRole('header',{name:'Your account has been deleted.'})).toBeTruthy();
  await fireEvent.press(view.getByRole('button',{name:'Back to welcome'}));
  expect(restart).toHaveBeenCalledTimes(1);
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

    await view.findByRole('button', { name: 'Check in' });
    await fireEvent.press(view.getByRole('button', { name: 'Check in' }));
    await view.findByText('Compared with your usual pattern…');
    await chooseV11Answer(view, 'Similar');
    await view.findByText('How does movement feel?');
    await chooseV11Answer(view, 'Okay');
    await view.findByText('A steady starting point.');
    expect(view.getByText('Balanced')).toBeTruthy();
    expect(view.getByText('Your neck check-in supports a Balanced option today.')).toBeTruthy();
    await fireEvent.press(view.getByRole('button', { name: 'Begin routine' }));
    await view.findByRole('header',{name:'Your sequence is complete.'});
    expect(view.getByRole('button', { name: 'Finish routine' })).toBeTruthy();
    await fireEvent.press(view.getByRole('button', { name: 'Finish routine' }));
    await view.findByText('How did your neck feel afterward?');
    await fireEvent.press(view.getByRole('radio', { name: 'About the same' }));
    await fireEvent.press(view.getByRole('button',{name:'Save response'}));
    await view.findByRole('header',{name:'A little time. Well considered.'});
    expect(view.getByText('Routine saved')).toBeTruthy();
    expect(view.getByText("Recorded")).toBeTruthy();
    expect(view.getByText('Balanced · Standard')).toBeTruthy();
    expect(view.getByRole('button', { name: 'View session' })).toBeTruthy();
    await fireEvent.press(view.getByRole('button', { name: 'Done' }));
    await view.findByRole('button', { name: 'Check in' });
    await fireEvent.press(view.getByRole('tab', { name: 'History' }));
    await view.findByRole('header', { name: 'Start with one check-in.' });
    await fireEvent.press(view.getByRole('tab',{name:'You'}));
    expect(await view.findByRole('header',{name:'Make it work for you.'})).toBeTruthy();
    expect(view.getByRole('button',{name:'Focus areas'})).toBeTruthy();
    expect(view.getByRole('button',{name:'Privacy & your data'})).toBeTruthy();
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
    await chooseV11Answer(view, 'Worse');
    await chooseV11Answer(view, 'Okay');
    await view.findByText('Is this a new or unusual change?');
    await fireEvent.press(view.getByRole('button', { name: 'Back' }));
    await view.findByText('How does movement feel?');
    await fireEvent.press(view.getByRole('button', { name: 'Back' }));
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
    await chooseV11Answer(view, 'Worse');
    await chooseV11Answer(view, 'Limited');
    await chooseV11Answer(view, 'Yes');
    await view.findByText('No routine right now.');
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
    await chooseV11Answer(view, 'Similar');
    await chooseV11Answer(view, 'Okay');
    expect(await view.findByText(/Upper & mid back is not included/)).toBeTruthy();
  });

  it('states when the user skipped a secondary area', async () => {
    const service = new SkippedSecondaryPlanService();
    await service.confirmAdultEligibility();
    await service.savePrimaryArea('neck');
    await service.saveSecondaryArea();
    await service.acknowledgeSafetyBoundary();
    await service.completeOnboarding();
    const view = await render(
      <KineoProductApp service={service} onStoreRestartRequired={() => undefined} />,
    );

    await fireEvent.press(await view.findByRole('button', { name: 'Check in' }));
    await chooseV11Answer(view, 'Similar');
    await chooseV11Answer(view, 'Okay');
    expect(await view.findByText(
      'Upper & mid back was skipped for today’s check-in and is not included.',
    )).toBeTruthy();
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

    await view.findByRole('button', { name: 'Check in' });
    await fireEvent.press(view.getByRole('tab', { name: 'History' }));
    expect(view.getByRole('header',{name:'Browse by area'})).toBeTruthy();
    await fireEvent.press(await view.findByRole('button', { name: 'View Neck history' }));
    expect(view.getByRole('header',{name:'15 June'})).toBeTruthy();
    expect(view.getByText('About your usual pattern · Okay movement')).toBeTruthy();
    expect(view.getByText(/does not claim one caused another/)).toBeTruthy();
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

    await view.findByRole('button', { name: 'Check in' });
    await fireEvent.press(view.getByRole('button', { name: 'Check in' }));
    await chooseV11Answer(view, 'Similar');
    await chooseV11Answer(view, 'Okay');
    if (view.queryByRole('button', { name: 'Review your plan' })) await fireEvent.press(view.getByRole('button', { name: 'Review your plan' }));
    await fireEvent.press(await view.findByRole('button', { name: 'Begin routine' }));
    await fireEvent.press(await view.findByRole('button', { name: 'Something feels wrong' }));
    await view.findByRole('header',{name:'Listen to that feeling.'});
    await fireEvent.press(view.getByRole('button', { name: 'I tapped this by mistake' }));
    await view.findByRole('header',{name:'Your place is saved.'});
    await fireEvent.press(view.getByRole('button', { name: 'End routine' }));
    await view.findByRole('header',{name:'End this routine here?'});
    await fireEvent.press(view.getByRole('button', { name: 'Keep my place' }));
    await view.findByRole('header',{name:'Your place is saved.'});
  });

  it('requires confirmation before resetting profile history', async () => {
  const service=await phase4ReadyService(); const restart=jest.fn();
  const view=await render(<KineoProductApp service={service} onStoreRestartRequired={restart}/>);
  await fireEvent.press(await view.findByRole('tab',{name:'You'}));
  await fireEvent.press(view.getByRole('button',{name:'Privacy & your data'}));
  const reset=jest.spyOn(service,'resetHistory');
  await fireEvent.press(view.getByRole('button',{name:'Reset history'}));
  expect(reset).not.toHaveBeenCalled();
  expect(view.getByRole('header',{name:'Start a fresh history—not a new account.'})).toBeTruthy();
  await fireEvent.press(view.getByRole('button',{name:'Reset history'}));
  expect(reset).toHaveBeenCalledTimes(1);
  expect(view.getByRole('header',{name:'Your preferences are still here.'})).toBeTruthy();
  });

  it('offers iPhone Settings after reminder permission is denied', async () => {
  const service=await phase4ReadyService(); service.reminderAuthorization='denied';
  const settings=jest.spyOn(service,'openReminderSettings');const view=await render(<KineoProductApp service={service} onStoreRestartRequired={()=>undefined}/>);
  await fireEvent.press(await view.findByRole('tab',{name:'You'}));await fireEvent.press(view.getByRole('button',{name:'Reminders'}));
  expect(view.getByRole('header',{name:'No reminder has been scheduled.'})).toBeTruthy();
  await fireEvent.press(view.getByRole('button',{name:'Open device settings'}));expect(settings).toHaveBeenCalledTimes(1);
  });

  it('restarts the protected store after a failed deletion attempt', async () => {
  const service=await phase4ReadyService(); const restart=jest.fn();
  const view=await render(<KineoProductApp service={service} onStoreRestartRequired={restart}/>);
  await fireEvent.press(await view.findByRole('tab',{name:'You'}));
  await fireEvent.press(view.getByRole('button',{name:'Privacy & your data'}));
  service.deleteResult={ok:false,error:{code:'persistence',cause:{code:'deletionFailed'}}};
  await fireEvent.press(view.getByRole('button',{name:'Delete all data'}));
  await fireEvent.press(view.getByRole('button',{name:'Delete all data'}));
  expect(view.queryByRole('header',{name:'Your account has been deleted.'})).toBeNull();
  expect(restart).toHaveBeenCalledTimes(1);
  });
});

const phase2StepSeconds = 60;
const phase2StepCount = 2;

it('keeps the old duration selected and Begin disabled until the plan revision commits', async () => {
  const service = new OnboardingService();
  const fixture = await service.submitCheckIn();
  if (!fixture.ok || fixture.value.kind !== 'plan') throw new Error('Plan fixture missing');
  const standardPlan: PlanPresentation = { ...fixture.value.plan, itemCount: phase2StepCount,
    nominalSeconds: phase2StepSeconds * phase2StepCount,
    sequence: [
      { id: 'authored-glide', kind: 'movement', area: 'neck', title: 'Authored neck glide', estimatedSeconds: phase2StepSeconds },
      { id: 'authored-nod', kind: 'movement', area: 'neck', title: 'Authored seated nod', estimatedSeconds: phase2StepSeconds },
    ] };
  jest.spyOn(service, 'loadStartState').mockResolvedValue({ ok: true, value: { kind: 'unfinishedPlan', plan: standardPlan } });
  let finishRevision: ((result: ProductResult<PlanPresentation>) => void) | undefined;
  const revision = new Promise<ProductResult<PlanPresentation>>(resolve => { finishRevision = resolve; });
  const revise = jest.spyOn(service, 'revisePlan').mockReturnValue(revision);
  const start = jest.spyOn(service, 'startRoutine');
  const view = await render(<KineoProductApp service={service} onStoreRestartRequired={() => undefined} />);
  await fireEvent.press(await view.findByRole('button', { name: 'Review your plan' }));
  expect(await view.findByText('Authored neck glide')).toBeTruthy();
  expect(view.getByText('Authored seated nod')).toBeTruthy();
  await fireEvent.press(view.getByRole('radio', { name: 'Quick · 5 min' }));
  expect(revise).toHaveBeenCalledWith(standardPlan.checkInId, 'quick', 'balanced');
  expect(view.getByRole('radio', { name: 'Standard · 10 min' }).props.accessibilityState.checked).toBe(true);
  expect(view.getByRole('button', { name: 'Begin routine' }).props.accessibilityState.disabled).toBe(true);
  await fireEvent.press(view.getByRole('button', { name: 'Begin routine' }));
  expect(start).not.toHaveBeenCalled();
  await act(() => finishRevision?.({ ok: true, value: { ...standardPlan, duration: 'quick' } }));
  expect(view.getByRole('radio', { name: 'Quick · 5 min' }).props.accessibilityState.checked).toBe(true);
  expect(view.getByRole('button', { name: 'Begin routine' }).props.accessibilityState.disabled).toBe(false);
  await fireEvent.press(view.getByRole('button', { name: 'Your sequence' }));
  expect(view.queryByText('Authored neck glide')).toBeNull();
});

const phase3RunningElapsed = 0;
const phase3CompletedElapsed = 60_000;
afterEach(() => { jest.restoreAllMocks(); });

async function phase3ServiceWithRoutine(elapsedMilliseconds: number) {
  const service = new OnboardingService();
  const started = await service.startRoutine();
  if (!started.ok) throw new Error('Routine fixture missing');
  const routine: RoutinePresentation = { ...started.value, stepElapsedMilliseconds: elapsedMilliseconds };
  jest.spyOn(service, 'loadStartState').mockResolvedValue({ ok: true, value: { kind: 'unfinishedRoutine', routine } });
  return { service, routine };
}

it('keeps Continue locked during counting and resolves to one completion badge from authoritative elapsed time', async () => {
  const running=await phase3ServiceWithRoutine(phase3RunningElapsed);const view=await render(<KineoProductApp service={running.service} onStoreRestartRequired={()=>undefined}/>);
  expect(await view.findByText('01:00')).toBeTruthy();expect(view.getByText('In progress · 1 min step')).toBeTruthy();
  expect(view.queryByText('Your pace')).toBeNull();expect(view.getByRole('button',{name:'Continue when timer ends',disabled:true})).toBeTruthy();
  await fireEvent.press(view.getByRole('button',{name:'Skip'}));
  expect(view.getByRole('header',{name:'Move past this step?'})).toBeTruthy();
  const complete=await phase3ServiceWithRoutine(phase3CompletedElapsed);await view.rerender(<KineoProductApp service={complete.service} onStoreRestartRequired={()=>undefined}/>);
  expect(await view.findByText('Routine complete')).toBeTruthy();expect(view.queryByRole('progressbar')).toBeNull();
  expect(view.getByRole('button',{name:'Finish routine',disabled:false})).toBeTruthy();expect(view.queryByRole('button',{name:'Pause'})).toBeNull();
});

it('keeps transition content and Continue reachable without redundant movement transport controls', async () => {
  const { service, routine } = await phase3ServiceWithRoutine(phase3RunningElapsed);
  if (!routine.currentItem) throw new Error('Step fixture missing');
  const transition: RoutinePresentation = { ...routine, currentItem: { ...routine.currentItem,
    kind: 'transition', localizedTitle: 'Prototype content', availableAlternatives: [] } };
  jest.spyOn(service, 'loadStartState').mockResolvedValue({ ok: true, value: { kind: 'unfinishedRoutine', routine: transition } });
  const view = await render(<KineoProductApp service={service} onStoreRestartRequired={() => undefined} />);
  expect(await view.findByRole('header', { name: 'Between movements' })).toBeTruthy();
  expect(view.getByRole('image',{name:'Between movements'})).toBeTruthy();
  expect(view.getByText('Next step ready · 30 sec rest')).toBeTruthy();
  expect(view.queryByRole('progressbar')).toBeNull();
  expect(view.queryByRole('button', { name: 'Pause' })).toBeNull();
  expect(view.queryByRole('button', { name: 'Skip this step' })).toBeNull();
  expect(view.getByRole('button', { name: 'Continue to movement' }).props.accessibilityState.disabled).toBe(false);
  expect(view.queryByRole('button', { name: 'End routine' })).toBeNull();
});

it('saves a safety-stopped record without falsely claiming a participation day', async () => {
  const { service, routine } = await phase3ServiceWithRoutine(phase3CompletedElapsed);
  jest.spyOn(service, 'loadStartState').mockResolvedValue({ ok: true, value: { kind: 'unfinishedRoutine',
    routine: { ...routine, status: 'safetyStopped', currentItem: undefined } } });
  const view = await render(<KineoProductApp service={service} onStoreRestartRequired={() => undefined} />);
  await fireEvent.press(await view.findByRole('button', { name: 'Skip response' }));
  expect(await view.findByRole('header',{name:'A little time. Well considered.'})).toBeTruthy();
  expect(view.getByText('Not counted')).toBeTruthy();
  expect(view.queryByText("Today's participation: Recorded")).toBeNull();
});

it('leaves video release to expo-video rather than pausing an already released native player on unmount', async () => {
  const player=jest.spyOn(Video,'useVideoPlayer');const {service}=await phase3ServiceWithRoutine(phase3RunningElapsed);
  const view=await render(<KineoProductApp service={service} onStoreRestartRequired={()=>undefined}/>);
  await view.findByRole('header',{name:'Neck mobility'});expect(player).not.toHaveBeenCalled();
  expect(view.getByText('Sample media · pending review')).toBeTruthy();
});

async function phase4ReadyService() {
  const service = new OnboardingService();
  await service.completeOnboarding();
  return service;
}

function phase4AccountActions() {
  return {
    provider: 'email' as const,
    resetHistory: jest.fn(async (_password?: string): Promise<ProductResult<void>> => ({ ok: true, value: undefined })),
    prepareExport: jest.fn(async (_password?: string): Promise<ProductResult<void>> => ({ok:true,value:undefined})),
    shareExport: jest.fn(async (): Promise<ProductResult<void>> => ({ok:true,value:undefined})),
    exportData: jest.fn(async (_password?: string): Promise<ProductResult<void>> => ({ ok: true, value: undefined })),
    changePassword: jest.fn(async (_current: string, _replacement: string): Promise<ProductResult<void>> => ({ ok: true, value: undefined })),
    deleteAccount: jest.fn(async (_password?: string): Promise<ProductResult<void>> => ({ ok: true, value: undefined })),
    logout: jest.fn(async (_discard: boolean): Promise<ProductResult<void>> => ({ ok: true, value: undefined })),
  };
}

it('keeps empty Progress and Profile on the v1.1 shell with selected tab semantics', async () => {
  const service=await phase4ReadyService(); const restart=jest.fn();
  const view=await render(<KineoProductApp service={service} onStoreRestartRequired={restart}/>);
  await fireEvent.press(await view.findByRole('tab',{name:'You'}));
  expect(view.getByRole('header',{name:'Make it work for you.'})).toBeTruthy();
  for(const name of ['Your routine','Preferences','Account & data','About Kineo'])expect(view.getByRole('header',{name})).toBeTruthy();
  await fireEvent.press(view.getByRole('tab',{name:'History'}));expect(view.getByRole('header',{name:'Start with one check-in.'})).toBeTruthy();
  expect(view.getByRole('tab',{name:'History',selected:true})).toBeTruthy();
});

it('keeps area drafts selected, clears a second area, and saves only on explicit activation', async () => {
  const service=await phase4ReadyService(); const restart=jest.fn();
  const view=await render(<KineoProductApp service={service} onStoreRestartRequired={restart}/>);
  await fireEvent.press(await view.findByRole('tab',{name:'You'}));
  const save=jest.spyOn(service,'saveAreaPreferences');await fireEvent.press(view.getByRole('button',{name:'Focus areas'}));
  expect(view.getByRole('checkbox',{name:'Neck',checked:true})).toBeTruthy();
  await fireEvent.press(view.getByRole('checkbox',{name:'Upper & mid back'}));expect(save).not.toHaveBeenCalled();
  await fireEvent.press(view.getByRole('checkbox',{name:'Neck'}));
  await fireEvent.press(view.getByRole('button',{name:'Save areas'}));expect(save).toHaveBeenCalledWith('upperMidBack',undefined);
  expect(view.getByRole('header',{name:'Make it work for you.'})).toBeTruthy();
});

it('keeps reset cancellation inert and sends the labeled password only on confirmed export', async () => {
  const service=await phase4ReadyService();const accountActions=phase4AccountActions();const restart=jest.fn();
  const view=await render(<KineoProductApp service={service} accountActions={accountActions} onStoreRestartRequired={restart}/>);
  await fireEvent.press(await view.findByRole('tab',{name:'You'}));
  await fireEvent.press(view.getByRole('button',{name:'Privacy & your data'}));
  await fireEvent.press(view.getByRole('button',{name:'Reset history'}));expect(view.getByText('What stays')).toBeTruthy();
  await fireEvent.press(view.getByRole('button',{name:'Keep my history'}));expect(accountActions.resetHistory).not.toHaveBeenCalled();
  await fireEvent.press(view.getByRole('button',{name:'Export my data'}));await fireEvent.changeText(view.getByLabelText('Confirm your password'),'private-password');
  expect(accountActions.prepareExport).not.toHaveBeenCalled();await fireEvent.press(view.getByRole('button',{name:'Create private export'}));
  expect(accountActions.prepareExport).toHaveBeenCalledWith('private-password');expect(view.getByRole('header',{name:'Your private export is ready.'})).toBeTruthy();
  expect(accountActions.shareExport).not.toHaveBeenCalled();await fireEvent.press(view.getByRole('button',{name:'Open share sheet'}));expect(accountActions.shareExport).toHaveBeenCalledTimes(1);
});

it('exposes a password mismatch alert, disables submission, and updates only matching passwords', async () => {
  const service = await phase4ReadyService();
  const accountActions = phase4AccountActions();
  const view = await render(<KineoProductApp service={service} accountActions={accountActions} onStoreRestartRequired={() => undefined} />);
  await fireEvent.press(await view.findByRole('tab', { name: 'You' }));
  await fireEvent.press(view.getByRole('button',{name:'Account security'}));
  await fireEvent.press(view.getByRole('button', { name: 'Change password' }));
  await fireEvent.changeText(view.getByLabelText('Current password'), 'current-password');
  await fireEvent.changeText(view.getByLabelText('New password'), 'a-long-replacement-password');
  await fireEvent.changeText(view.getByLabelText('Confirm new password'), 'different-password');
  expect(view.getByRole('alert').props.accessibilityLabel).toContain('The passwords do not match.');
  expect(view.getByRole('button', { name: 'Update password', disabled: true })).toBeTruthy();
  await fireEvent.press(view.getByRole('button', { name: 'Update password' }));
  expect(accountActions.changePassword).not.toHaveBeenCalled();
  await fireEvent.changeText(view.getByLabelText('Confirm new password'), 'a-long-replacement-password');
  await fireEvent.press(view.getByRole('button', { name: 'Update password' }));
  expect(accountActions.changePassword).toHaveBeenCalledWith('current-password', 'a-long-replacement-password');
  expect(view.getByRole('header', { name: 'Your password has changed.' })).toBeTruthy();
});

it('keeps deletion cancellable and routes sign-out choices to the existing account commands', async () => {
  const service=await phase4ReadyService();const accountActions=phase4AccountActions();const restart=jest.fn();
  const view=await render(<KineoProductApp service={service} accountActions={accountActions} onStoreRestartRequired={restart}/>);
  await fireEvent.press(await view.findByRole('tab',{name:'You'}));
  await fireEvent.press(view.getByRole('button',{name:'Privacy & your data'}));
  await fireEvent.press(view.getByRole('button',{name:'Delete all data'}));await fireEvent.press(view.getByRole('button',{name:'Keep my account'}));
  expect(accountActions.deleteAccount).not.toHaveBeenCalled();await fireEvent.press(view.getByRole('button',{name:'Back'}));
  await fireEvent.press(view.getByRole('button',{name:'Account security'}));await fireEvent.press(view.getByRole('button',{name:'Sign out'}));
  expect(accountActions.logout).not.toHaveBeenCalled();await fireEvent.press(view.getByRole('button',{name:'Sign out'}));
  expect(accountActions.logout).toHaveBeenCalledWith(false);expect(restart).toHaveBeenCalledTimes(1);
});

it('keeps recoverable product errors on the v1.1 shell and retries without replacing store data', async () => {
  const service = await phase4ReadyService();
  const load = jest.spyOn(service, 'loadStartState')
    .mockResolvedValueOnce({ ok: false, error: { code: 'invalidState' } });
  const view = await render(<KineoProductApp service={service} onStoreRestartRequired={() => undefined} />);
  expect(await view.findByRole('header', { name: 'We can’t continue from here.' })).toBeTruthy();
  expect(view.getByTestId('v11-screen-scroll')).toBeTruthy();
  await fireEvent.press(view.getByRole('button', { name: 'Try again' }));
  expect(await view.findByRole('button', { name: 'Check in' })).toBeTruthy();
  expect(load).toHaveBeenCalledTimes(2);
});

async function chooseV11Answer(view: Awaited<ReturnType<typeof render>>, label: string) {
  const mapped = label === 'No' ? 'No, it’s my usual recurring pattern' : label === 'Yes' || label === 'Not sure' ? 'Yes, or I’m not sure' : label;
  const radio = view.queryByRole('radio', { name: mapped });
  if (radio) { await fireEvent.press(radio); await fireEvent.press(view.getByRole('button', { name: 'Continue' }));
    if(view.queryByRole('button',{name:'Review your plan'})) await fireEvent.press(view.getByRole('button',{name:'Review your plan'}));
  }
  else await fireEvent.press(await view.findByRole('button', { name: label }));
}

it('keeps a check-in choice local until Continue and preserves it when returning from Why we ask', async () => {
  const service=await phase4ReadyService(); const submit=jest.spyOn(service,'submitCheckIn');
  const view=await render(<KineoProductApp service={service} onStoreRestartRequired={()=>undefined} />);
  await fireEvent.press(await view.findByRole('button',{name:'Check in'}));
  expect(view.getByRole('button',{name:'Continue',disabled:true})).toBeTruthy();
  await fireEvent.press(view.getByRole('radio',{name:'Similar'}));
  expect(submit).not.toHaveBeenCalled();
  expect(view.getByRole('header',{name:'Compared with your usual pattern…'})).toBeTruthy();
  await fireEvent.press(view.getByRole('button',{name:'Why we ask'}));
  expect(view.getByRole('header',{name:'Your usual pattern is personal.'})).toBeTruthy();
  await fireEvent.press(view.getByRole('button',{name:'Back to my check-in'}));
  // A help excursion must preserve the selected answer before it is committed.
  expect(view.getByRole('radio',{name:'Similar',checked:true})).toBeTruthy();
  await fireEvent.press(view.getByRole('button',{name:'Continue'}));
  expect(view.getByRole('header',{name:'How does movement feel?'})).toBeTruthy();
  await fireEvent.press(view.getByRole('button',{name:'Back'}));
  await fireEvent.press(view.getByRole('button',{name:'Back'}));
  expect(view.getByRole('header',{name:'Start with how you feel.'})).toBeTruthy();
  expect(submit).not.toHaveBeenCalled();
});

it('saves the weekly intention and keeps it selected when returning from the boundary', async () => {
  const service=new OnboardingService(); await service.confirmAdultEligibility(); await service.savePrimaryArea('neck');
  const save=jest.spyOn(service,'saveWeeklyGoalDays');
  const saveSecond=jest.spyOn(service,'saveSecondaryArea');
  const view=await render(<KineoProductApp service={service} onStoreRestartRequired={()=>undefined} />);
  await fireEvent.press(await view.findByRole('button',{name:'Just neck for now'}));
  expect(saveSecond).not.toHaveBeenCalled();
  const checkpoint=await service.loadStartState();
  expect(checkpoint.ok && checkpoint.value.kind==='onboarding' && checkpoint.value.progress.step).toBe('secondaryArea');
  await fireEvent.press(view.getByRole('radio',{name:'4 days a week'}));
  expect(save).not.toHaveBeenCalled();
  await fireEvent.press(view.getByRole('button',{name:'Set my intention'}));
  expect(save).toHaveBeenCalledWith(4);
  expect(saveSecond).toHaveBeenCalledWith(undefined);
  await fireEvent.press(view.getByRole('button',{name:'Back'}));
  expect(await view.findByRole('radio',{name:'4 days a week',checked:true})).toBeTruthy();
});

it('opens the read-only movement preview and explanation without starting a routine', async () => {
  const service=await phase4ReadyService(); const result=await service.submitCheckIn();
  if(!result.ok || result.value.kind!=='plan') throw new Error('Missing plan fixture');
  const plan:PlanPresentation={...result.value.plan,sequence:[{id:'preview-step',kind:'movement',area:'neck',title:'Authored neck glide',estimatedSeconds:phase2StepSeconds}]};
  jest.spyOn(service,'loadStartState').mockResolvedValue({ok:true,value:{kind:'unfinishedPlan',plan}});
  const start=jest.spyOn(service,'startRoutine');
  const view=await render(<KineoProductApp service={service} onStoreRestartRequired={()=>undefined} />);
  await fireEvent.press(await view.findByRole('button',{name:'Review your plan'}));
  await fireEvent.press(view.getByRole('button',{name:'Preview'}));
  expect(view.getByRole('header',{name:'Authored neck glide.'})).toBeTruthy();
  expect(view.getAllByText('Sample media · pending review')).toHaveLength(1);
  expect(start).not.toHaveBeenCalled();
  await fireEvent.press(view.getByRole('button',{name:'Back to sequence'}));
  await fireEvent.press(view.getByRole('button',{name:'Why this plan'}));
  expect(view.getByRole('header',{name:'Nothing mysterious here.'})).toBeTruthy();
  await fireEvent.press(view.getByRole('button',{name:'Back to my plan'}));
  expect(view.getByRole('button',{name:'Begin routine'})).toBeTruthy();
  expect(start).not.toHaveBeenCalled();
});

it('attributes why-plan reasons to their actual area and renders global reasons once', async () => {
  const service=await phase4ReadyService();const result=await service.submitCheckIn();
  if(!result.ok||result.value.kind!=='plan')throw new Error('Missing plan fixture');
  const plan:PlanPresentation={...result.value.plan,includedAreas:['neck','upperMidBack'],explanations:[
    {key:'reason.movement_limited',parameters:{area:'neck'}},
    {key:'reason.balanced_checkin',parameters:{area:'upperMidBack'}},
    {key:'reason.user_gentler_override',parameters:{}},
  ]};
  jest.spyOn(service,'loadStartState').mockResolvedValue({ok:true,value:{kind:'unfinishedPlan',plan}});
  const view=await render(<KineoProductApp service={service} onStoreRestartRequired={()=>undefined} />);
  await fireEvent.press(await view.findByRole('button',{name:'Review your plan'}));
  await fireEvent.press(view.getByRole('button',{name:'Why this plan'}));
  expect(view.getAllByText('Movement felt limited around neck today.')).toHaveLength(1);
  expect(view.getAllByText('Your upper & mid back check-in supports a Balanced option today.')).toHaveLength(1);
  expect(view.getAllByText('You chose a gentler option for today.')).toHaveLength(1);
});

it('uses approved canvas movement labels for prototype media while keeping authored step identity for preview', async () => {
  const service=await phase4ReadyService();const result=await service.submitCheckIn();
  if(!result.ok||result.value.kind!=='plan')throw new Error('Missing plan fixture');
  const plan:PlanPresentation={...result.value.plan,sequence:[{id:'prototype-neck-step',kind:'movement',area:'neck',title:'Prototype movement 1',estimatedSeconds:phase2StepSeconds}]};
  jest.spyOn(service,'loadStartState').mockResolvedValue({ok:true,value:{kind:'unfinishedPlan',plan}});
  const view=await render(<KineoProductApp service={service} onStoreRestartRequired={()=>undefined} />);
  await fireEvent.press(await view.findByRole('button',{name:'Review your plan'}));
  expect(view.getByText('Neck mobility')).toBeTruthy();expect(view.queryByText('Prototype movement 1')).toBeNull();
  await fireEvent.press(view.getByRole('button',{name:'Preview'}));
  expect(view.getByRole('header',{name:'Neck mobility.'})).toBeTruthy();
});
