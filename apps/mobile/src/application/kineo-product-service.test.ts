/** @jest-environment node */

import { describe, expect, it } from '@jest/globals';

import { KineoSqliteStore } from '../infrastructure/persistence/kineo-sqlite-store';
import { migrateKineoDatabase } from '../infrastructure/persistence/kineo-schema';
import { ProtectedKineoStore } from '../infrastructure/persistence/protected-kineo-store';
import { NodeSqliteTestDatabase } from '../infrastructure/persistence/testing/node-sqlite-test-database';
import { KineoProductService } from './kineo-product-service';

const initialTimestamp = 1_750_000_000_000;
const nextTimestamp = initialTimestamp + 1;

async function makeService() {
  const database = new NodeSqliteTestDatabase();
  const migrated = await migrateKineoDatabase(database, initialTimestamp);
  if (!migrated.ok) throw new Error('Product-service migration failed.');
  let timestamp = initialTimestamp;
  const store = new ProtectedKineoStore(
    new KineoSqliteStore(database),
    async () => ({ ok: true, value: undefined }),
    async () => undefined,
    async () => ({ ok: true, value: undefined }),
  );
  return {
    database,
    service: new KineoProductService(store, {
      nowMilliseconds: () => timestamp,
    }),
    advanceClock: () => {
      timestamp = nextTimestamp;
    },
  };
}

describe('Kineo product service onboarding', () => {
  it('restores every durable onboarding checkpoint', async () => {
    const { database, service, advanceClock } = await makeService();
    await expect(service.loadStartState()).resolves.toEqual({
      ok: true,
      value: { kind: 'onboarding', progress: { step: 'welcome' } },
    });
    await service.confirmAdultEligibility();
    await expect(service.loadStartState()).resolves.toEqual({
      ok: true,
      value: { kind: 'onboarding', progress: { step: 'primaryArea' } },
    });
    await service.savePrimaryArea('neck');
    await expect(service.loadStartState()).resolves.toEqual({
      ok: true,
      value: {
        kind: 'onboarding',
        progress: { step: 'secondaryArea', primaryArea: 'neck' },
      },
    });
    await service.saveSecondaryArea('lowerBack');
    await expect(service.loadStartState()).resolves.toEqual({
      ok: true,
      value: {
        kind: 'onboarding',
        progress: { step: 'safetyBoundary', primaryArea: 'neck' },
      },
    });
    advanceClock();
    await service.acknowledgeSafetyBoundary();
    await expect(service.loadStartState()).resolves.toEqual({
      ok: true,
      value: {
        kind: 'onboarding',
        progress: { step: 'firstCheckIn', primaryArea: 'neck' },
      },
    });
    await expect(service.completeOnboarding()).resolves.toEqual({ ok: true, value: 'neck' });
    await expect(service.loadStartState()).resolves.toEqual({
      ok: true,
      value: { kind: 'today', primaryArea: 'neck' },
    });
    await database.closeAsync();
  });

  it('rejects duplicate selected areas without changing the checkpoint', async () => {
    const { database, service } = await makeService();
    await service.confirmAdultEligibility();
    await service.savePrimaryArea('upperMidBack');
    await expect(service.saveSecondaryArea('upperMidBack')).resolves.toEqual({
      ok: false,
      error: { code: 'invalidState' },
    });
    await expect(service.loadStartState()).resolves.toEqual({
      ok: true,
      value: {
        kind: 'onboarding',
        progress: { step: 'secondaryArea', primaryArea: 'upperMidBack' },
      },
    });
    await database.closeAsync();
  });
});
