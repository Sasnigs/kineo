import type { LocalPrivacyStore } from '../../application/account/kineo-account-privacy-module';
import type { PrivacyResult } from '../../core/account/account-privacy-module';
import type { KineoPersistence } from '../../core/persistence/kineo-store';
import type { KineoSqliteSyncRepository } from './kineo-sqlite-sync-repository';

export class KineoLocalPrivacyStore implements LocalPrivacyStore {
  constructor(
    private readonly productStore: KineoPersistence,
    private readonly syncRepository: KineoSqliteSyncRepository,
  ) {}

  async resetHistory(historyEpoch: number): Promise<PrivacyResult<void>> {
    const reset = await this.syncRepository.resetForHistoryEpoch(historyEpoch);
    return reset.ok
      ? { ok: true, value: undefined }
      : { ok: false, error: { code: 'localWipeFailed' } };
  }

  async wipeAccount(): Promise<PrivacyResult<void>> {
    const wiped = await this.productStore.deleteAllData();
    return wiped.ok
      ? { ok: true, value: undefined }
      : { ok: false, error: { code: 'localWipeFailed' } };
  }
}
