/** @jest-environment node */

import { describe, expect, it, jest } from '@jest/globals';

import { createProfileState, defaultWeeklyGoalDays } from '../../core/persistence/persistence-domain';
import { KineoSqliteStore } from './kineo-sqlite-store';
import { migrateKineoDatabase } from './kineo-schema';
import { ProtectedKineoStore } from './protected-kineo-store';
import { NodeSqliteTestDatabase } from './testing/node-sqlite-test-database';

const timestamp = 1_750_000_000_000;

function profile() {
  const result = createProfileState({
    profile: {
      adultAcknowledged: true,
      weeklyGoalDays: defaultWeeklyGoalDays,
      telemetryChoice: 'notOffered',
      createdAtMilliseconds: timestamp,
      updatedAtMilliseconds: timestamp,
    },
  });
  if (!result.ok) throw new Error('Profile fixture validation failed.');
  return result.value;
}

describe('protected Kineo store', () => {
  it('poisons the instance after a post-commit protection failure', async () => {
    const database = new NodeSqliteTestDatabase();
    const migrated = await migrateKineoDatabase(database, timestamp);
    if (!migrated.ok) throw new Error('Migration fixture failed.');
    const cleanup = jest.fn(async () => undefined);
    const store = new ProtectedKineoStore(
      new KineoSqliteStore(database),
      async () => ({ ok: false, error: { code: 'storageProtectionFailed' } }),
      cleanup,
      async () => ({ ok: true, value: undefined }),
    );

    await expect(store.saveProfileState(profile())).resolves.toEqual({
      ok: false,
      error: { code: 'storageProtectionFailed' },
    });
    await expect(store.loadProfileState()).resolves.toEqual({
      ok: false,
      error: { code: 'storageProtectionFailed' },
    });
    expect(cleanup).toHaveBeenCalledTimes(1);

    const freshStore = new KineoSqliteStore(database);
    await expect(freshStore.loadProfileState()).resolves.toEqual({ ok: true, value: profile() });
    await database.closeAsync();
  });

  it('does not run protection after a rejected write', async () => {
    const database = new NodeSqliteTestDatabase();
    const migrated = await migrateKineoDatabase(database, timestamp);
    if (!migrated.ok) throw new Error('Migration fixture failed.');
    const verify = jest.fn(async () => ({ ok: true, value: undefined }) as const);
    const store = new ProtectedKineoStore(
      new KineoSqliteStore(database),
      verify,
      async () => undefined,
      async () => ({ ok: true, value: undefined }),
    );
    const invalid = { ...profile(), profile: { ...profile().profile, weeklyGoalDays: -1 } };

    await expect(store.saveProfileState(invalid)).resolves.toEqual({
      ok: false,
      error: { code: 'constraintViolation', constraint: 'domainInvariant' },
    });
    expect(verify).not.toHaveBeenCalled();
    await database.closeAsync();
  });

  it('makes the store unavailable as soon as full deletion starts', async () => {
    const database = new NodeSqliteTestDatabase();
    const migrated = await migrateKineoDatabase(database, timestamp);
    if (!migrated.ok) throw new Error('Migration fixture failed.');
    const store = new ProtectedKineoStore(
      new KineoSqliteStore(database),
      async () => ({ ok: true, value: undefined }),
      async () => undefined,
      async () => ({ ok: false, error: { code: 'deletionFailed' } }),
    );

    await expect(store.deleteAllData()).resolves.toEqual({
      ok: false,
      error: { code: 'deletionFailed' },
    });
    await expect(store.loadProfileState()).resolves.toEqual({
      ok: false,
      error: { code: 'storeDeleted' },
    });
    await database.closeAsync();
  });
});
