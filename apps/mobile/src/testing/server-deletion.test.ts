import { describe, expect, it } from '@jest/globals';
import { completeDeletion, type DeletionService } from '../../../../supabase/functions/_shared/deletion';

describe('server deletion recovery', () => {
  it('finishes after an interrupted Auth deletion reports the user already missing', async () => {
    const operations: string[] = [];
    const service: DeletionService = {
      rpc: async (name) => { operations.push(name); return { error: null }; },
      auth: { admin: { deleteUser: async () => {
        operations.push('deleteAuth'); return { error: { code: 'user_not_found' } };
      } } },
    };
    expect(await completeDeletion(service, 'account', 'job', 'hash')).toBe(true);
    expect(operations).toEqual([
      'kineo_commit_deletion', 'kineo_delete_domain_for_account', 'deleteAuth', 'kineo_complete_deletion',
    ]);
  });

  it('does not remove data when revocation could not commit', async () => {
    const operations: string[] = [];
    const service: DeletionService = {
      rpc: async (name) => { operations.push(name); return { error: { code: 'unavailable' } }; },
      auth: { admin: { deleteUser: async () => { operations.push('deleteAuth'); return { error: null }; } } },
    };
    expect(await completeDeletion(service, 'account', 'job', 'hash')).toBe(false);
    expect(operations).toEqual(['kineo_commit_deletion']);
  });
});
