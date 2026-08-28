import { describe, expect, it } from '@jest/globals';

import {
  parseCheckInEntryId,
  parseCheckInId,
  type ConditionalSafetyAnswer,
} from '../domain/selection-domain';
import {
  createCheckIn,
  createCheckInEntry,
  createLocalDayContext,
  createReminderSettings,
  createSafetyEvent,
  createSafetyMutation,
  createUserProfile,
  defaultWeeklyGoalDays,
  parseLocalDay,
  parseSafetyEventId,
  type CheckInEntry,
  type LocalDayContext,
} from './persistence-domain';

const startedAtMilliseconds = 1_750_000_000_000;
const completedAtMilliseconds = startedAtMilliseconds + 1;
const laterAtMilliseconds = completedAtMilliseconds + 1;
const checkInIdValue = '00000000-0000-0000-0000-000000000001';
const entryIdValue = '00000000-0000-0000-0000-000000000002';
const safetyEventIdValue = '00000000-0000-0000-0000-000000000003';
const safetyBoundaryVersion = 'prototype-safety-v1';
const timeZoneId = 'America/Chicago';
const calendarId = 'gregorian';
const reminderStartMinutes = 540;
const reminderEndMinutes = 600;

function required<Value>(result: { ok: true; value: Value } | { ok: false }): Value {
  if (!result.ok) {
    throw new Error('A persistence-domain fixture failed validation.');
  }
  return result.value;
}

function dayContext(): LocalDayContext {
  return required(
    createLocalDayContext({
      localDay: required(parseLocalDay('2026-08-27')),
      timeZoneId,
      calendarId,
    }),
  );
}

function entry(
  conditionalSafetyAnswer?: ConditionalSafetyAnswer,
): CheckInEntry {
  return required(
    createCheckInEntry({
      id: required(parseCheckInEntryId(entryIdValue)),
      area: 'neck',
      role: 'primary',
      changeReport:
        conditionalSafetyAnswer === undefined ? 'similar' : 'worse',
      movementComfort: 'good',
      conditionalSafetyAnswer,
      submittedAtMilliseconds: completedAtMilliseconds,
    }),
  );
}

describe('Persistence domain', () => {
  it('accepts real local dates and rejects impossible calendar dates', () => {
    expect(parseLocalDay('2024-02-29').ok).toBe(true);
    expect(parseLocalDay('2025-02-29')).toEqual({
      ok: false,
      error: { code: 'invalidDomainValue', field: 'localDay' },
    });
    expect(
      createLocalDayContext({
        localDay: required(parseLocalDay('2026-08-27')),
        timeZoneId: ' ',
        calendarId,
      }),
    ).toEqual({
      ok: false,
      error: { code: 'invalidDomainValue', field: 'dayContext' },
    });
  });

  it('requires a truthful completed onboarding profile', () => {
    const profile = createUserProfile({
      onboardingCompletedAtMilliseconds: completedAtMilliseconds,
      adultAcknowledged: true,
      safetyBoundaryVersion,
      safetyAcknowledgedAtMilliseconds: completedAtMilliseconds,
      primaryArea: 'neck',
      secondaryArea: 'lowerBack',
      weeklyGoalDays: defaultWeeklyGoalDays,
      telemetryChoice: 'notOffered',
      createdAtMilliseconds: startedAtMilliseconds,
      updatedAtMilliseconds: completedAtMilliseconds,
    });
    expect(profile.ok).toBe(true);
    if (profile.ok) {
      expect(Object.isFrozen(profile.value)).toBe(true);
    }

    expect(
      createUserProfile({
        onboardingCompletedAtMilliseconds: completedAtMilliseconds,
        adultAcknowledged: false,
        weeklyGoalDays: defaultWeeklyGoalDays,
        telemetryChoice: 'notOffered',
        createdAtMilliseconds: startedAtMilliseconds,
        updatedAtMilliseconds: completedAtMilliseconds,
      }),
    ).toEqual({
      ok: false,
      error: { code: 'invalidDomainValue', field: 'completedOnboarding' },
    });
  });

  it('requires a valid window only when reminders are enabled', () => {
    expect(
      createReminderSettings({
        enabled: true,
        window: {
          startMinutes: reminderStartMinutes,
          endMinutes: reminderEndMinutes,
        },
        timeZoneId,
        updatedAtMilliseconds: completedAtMilliseconds,
      }).ok,
    ).toBe(true);
    expect(
      createReminderSettings({
        enabled: true,
        updatedAtMilliseconds: completedAtMilliseconds,
      }),
    ).toEqual({
      ok: false,
      error: { code: 'invalidDomainValue', field: 'reminderSettings' },
    });
  });

  it('freezes a completed check-in and enforces conditional answers and roles', () => {
    const entries = [entry('no')];
    const checkIn = createCheckIn({
      id: required(parseCheckInId(checkInIdValue)),
      status: 'completed',
      kind: 'normal',
      primaryArea: 'neck',
      secondaryArea: 'lowerBack',
      startedAtMilliseconds,
      completedAtMilliseconds,
      dayContext: dayContext(),
      entries,
    });
    expect(checkIn.ok).toBe(true);
    entries.length = 0;
    if (checkIn.ok) {
      expect(checkIn.value.entries).toHaveLength(1);
      expect(Object.isFrozen(checkIn.value.entries)).toBe(true);
    }

    expect(
      createCheckInEntry({
        ...entry(),
        changeReport: 'worse',
      }),
    ).toEqual({
      ok: false,
      error: { code: 'invalidDomainValue', field: 'checkInEntry' },
    });
  });

  it('requires exact Attention event shapes and rejects stale mutations', () => {
    const event = required(
      createSafetyEvent({
        id: required(parseSafetyEventId(safetyEventIdValue)),
        area: 'neck',
        kind: 'attentionReaffirmed',
        returnAnswer: 'notSure',
        occurredAtMilliseconds: laterAtMilliseconds,
        dayContext: dayContext(),
      }),
    );
    expect(
      createSafetyMutation({
        event,
        statusAfter: 'attentionRequired',
        expectedAttentionUpdatedAtMilliseconds: completedAtMilliseconds,
      }).ok,
    ).toBe(true);
    expect(
      createSafetyMutation({
        event,
        statusAfter: 'attentionRequired',
        expectedAttentionUpdatedAtMilliseconds: laterAtMilliseconds,
      }),
    ).toEqual({
      ok: false,
      error: { code: 'invalidDomainValue', field: 'safetyMutation' },
    });
  });
});
