import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { deleteProtectedStore } from './protected-storage';

const mockCalls: string[] = [];
const mockInspection = {
  path: '/private/kineo',
  backupExcluded: true,
  completeProtectionVerified: true,
  completeProtectionSupported: true,
};
jest.mock(
  '../../../modules/kineo-storage-protection/src/KineoStorageProtectionModule',
  () => ({
    __esModule: true,
    default: {
      isProtectedDataAvailableAsync: jest.fn(async () => true),
      preparePrivateDirectoryAsync: jest.fn(async () => mockInspection),
      protectDatabaseFilesAsync: jest.fn(async () => [mockInspection]),
      beginDeletionAsync: jest.fn(async () => {
        mockCalls.push('marker');
        return mockInspection;
      }),
      deletePrivateStorageAsync: jest.fn(async () => {
        mockCalls.push('delete');
        return true;
      }),
      finishDeletionAsync: jest.fn(async () => {
        mockCalls.push('finish');
        return true;
      }),
    },
  }),
);

describe('protected storage deletion', () => {
  beforeEach(() => {
    mockCalls.length = 0;
    jest.clearAllMocks();
  });

  it('persists the marker before closing and removing the store', async () => {
    const close = jest.fn(async () => {
      mockCalls.push('close');
    });

    await expect(deleteProtectedStore(close)).resolves.toEqual({ ok: true, value: undefined });
    expect(mockCalls).toEqual(['marker', 'close', 'delete', 'finish']);
  });

  it('keeps the marker and does not delete when close fails', async () => {
    const close = jest.fn(async () => {
      mockCalls.push('close');
      throw new Error('injected close failure');
    });

    await expect(deleteProtectedStore(close)).resolves.toEqual({
      ok: false,
      error: { code: 'deletionFailed' },
    });
    expect(mockCalls).toEqual(['marker', 'close']);
  });
});
