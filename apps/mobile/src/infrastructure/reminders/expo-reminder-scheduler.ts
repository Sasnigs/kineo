import * as Notifications from 'expo-notifications';

import type { ReminderWindow } from '@/core/persistence/persistence-domain';
import type {
  ReminderAuthorization,
  ReminderResult,
  ReminderScheduling,
} from '@/core/product/reminder-scheduling';

const dailyReminderIdentifier = 'kineo.daily-check-in';
const notificationTitle = 'Kineo';
const notificationBody = 'Your Kineo check-in is ready.';
const minutesPerHour = 60;

function authorization(
  status: Awaited<ReturnType<typeof Notifications.getPermissionsAsync>>,
): ReminderAuthorization {
  switch (status.ios?.status) {
    case Notifications.IosAuthorizationStatus.NOT_DETERMINED:
      return 'notDetermined';
    case Notifications.IosAuthorizationStatus.AUTHORIZED:
    case Notifications.IosAuthorizationStatus.EPHEMERAL:
      return 'authorized';
    case Notifications.IosAuthorizationStatus.PROVISIONAL:
      return 'provisional';
    case Notifications.IosAuthorizationStatus.DENIED:
      return 'denied';
    default:
      return status.granted
        ? 'authorized'
        : status.canAskAgain
          ? 'notDetermined'
          : 'denied';
  }
}

export class ExpoReminderScheduler implements ReminderScheduling {
  async authorizationStatus(): Promise<ReminderResult<ReminderAuthorization>> {
    try {
      return {
        ok: true,
        value: authorization(await Notifications.getPermissionsAsync()),
      };
    } catch {
      return { ok: false, error: { code: 'unavailable' } };
    }
  }

  async requestAuthorization(): Promise<ReminderResult<ReminderAuthorization>> {
    try {
      const status = await Notifications.requestPermissionsAsync({
        ios: { allowAlert: true, allowSound: true },
      });
      return { ok: true, value: authorization(status) };
    } catch {
      return { ok: false, error: { code: 'unavailable' } };
    }
  }

  async replaceDailyReminder(
    window: ReminderWindow,
    timeZoneId: string,
  ): Promise<ReminderResult<void>> {
    const status = await this.authorizationStatus();
    if (
      !status.ok ||
      (status.value !== 'authorized' && status.value !== 'provisional')
    ) {
      return { ok: false, error: { code: 'unavailable' } };
    }
    const hour = Math.floor(window.startMinutes / minutesPerHour);
    const minute = window.startMinutes % minutesPerHour;
    const cancelled = await this.cancelExisting();
    if (!cancelled.ok) return cancelled;
    try {
      await Notifications.scheduleNotificationAsync({
        identifier: dailyReminderIdentifier,
        content: {
          title: notificationTitle,
          body: notificationBody,
          sound: 'default',
          data: { route: 'today' },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
          repeats: true,
          hour,
          minute,
          timezone: timeZoneId,
        },
      });
      return { ok: true, value: undefined };
    } catch {
      return { ok: false, error: { code: 'schedulingFailed' } };
    }
  }

  async cancelAll(): Promise<ReminderResult<void>> {
    return this.cancelExisting();
  }

  private async cancelExisting(): Promise<ReminderResult<void>> {
    try {
      const requests = await Notifications.getAllScheduledNotificationsAsync();
      if (requests.some(({ identifier }) => identifier === dailyReminderIdentifier)) {
        await Notifications.cancelScheduledNotificationAsync(dailyReminderIdentifier);
      }
      return { ok: true, value: undefined };
    } catch {
      return { ok: false, error: { code: 'cancellationFailed' } };
    }
  }
}

export const expoReminderScheduler = new ExpoReminderScheduler();
