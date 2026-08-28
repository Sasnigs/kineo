import { randomUUID } from 'expo-crypto';

import type { ProductRuntime } from '@/application/kineo-product-service';

const isoDateLocale = 'en-CA';
const gregorianCalendarId = 'gregorian';

function localDay(): string {
  const timeZoneId = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const parts = new Intl.DateTimeFormat(isoDateLocale, {
    calendar: 'gregory',
    day: '2-digit',
    month: '2-digit',
    timeZone: timeZoneId,
    year: 'numeric',
  }).formatToParts(new Date());
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

export const systemProductRuntime: ProductRuntime = Object.freeze({
  nextIdentifier: randomUUID,
  localDayContext: () => ({
    localDay: localDay(),
    timeZoneId: Intl.DateTimeFormat().resolvedOptions().timeZone,
    calendarId: gregorianCalendarId,
  }),
});
