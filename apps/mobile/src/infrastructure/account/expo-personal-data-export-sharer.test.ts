import { describe, expect, it, jest } from '@jest/globals';

import { ExpoPersonalDataExportSharer } from './expo-personal-data-export-sharer';

describe('ExpoPersonalDataExportSharer', () => {
  it('does not share data when preparing protected storage fails', async () => {
    const share = jest.fn(async () => undefined);
    const sharer = new ExpoPersonalDataExportSharer(
      async () => { throw new Error('protected storage unavailable'); },
      { isAvailable: async () => true, share },
    );
    await expect(sharer.share({})).resolves.toEqual({ ok: false, error: { code: 'workflowFailed' } });
    expect(share).not.toHaveBeenCalled();
  });

  it('removes an interrupted export before opening account data', async () => {
    let exists = true;
    const sharer = new ExpoPersonalDataExportSharer(() => ({
      uri: 'file:///private/kineo-data-export.json', exists: () => exists,
      write: () => undefined, remove: () => { exists = false; },
    }));
    await expect(sharer.cleanup()).resolves.toEqual({ ok: true, value: undefined });
    expect(exists).toBe(false);
  });
  it('returns a typed failure if file metadata becomes unavailable during cleanup', async () => {
    let shared = false;
    const sharer = new ExpoPersonalDataExportSharer(
      () => ({
        uri: 'file:///cache/kineo-data-export.json',
        exists: () => {
          if (shared) throw new Error('protected data unavailable');
          return false;
        },
        write: () => undefined,
        remove: () => undefined,
      }),
      { isAvailable: async () => true, share: async () => { shared = true; } },
    );
    await expect(sharer.share({})).resolves.toEqual({
      ok: false, error: { code: 'workflowFailed' },
    });
  });

  it('shares structured JSON and removes the temporary file', async () => {
    let exists = false;
    let written = '';
    const remove = jest.fn(() => { exists = false; });
    const share = jest.fn(async () => undefined);
    const sharer = new ExpoPersonalDataExportSharer(
      () => ({
        uri: 'file:///cache/kineo-data-export.json',
        exists: () => exists,
        write: (content) => { written = content; exists = true; },
        remove,
      }),
      { isAvailable: async () => true, share },
    );

    await expect(sharer.share({ formatVersion: 'kineo-export-v1' })).resolves.toEqual({
      ok: true,
      value: undefined,
    });
    expect(JSON.parse(written)).toEqual({ formatVersion: 'kineo-export-v1' });
    expect(share).toHaveBeenCalledWith('file:///cache/kineo-data-export.json');
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('reports failure when sensitive-file cleanup fails', async () => {
    let exists = false;
    const sharer = new ExpoPersonalDataExportSharer(
      () => ({
        uri: 'file:///cache/kineo-data-export.json',
        exists: () => exists,
        write: () => { exists = true; },
        remove: () => { throw new Error('protected file unavailable'); },
      }),
      { isAvailable: async () => true, share: async () => undefined },
    );

    await expect(sharer.share({})).resolves.toEqual({
      ok: false,
      error: { code: 'workflowFailed' },
    });
  });
});
