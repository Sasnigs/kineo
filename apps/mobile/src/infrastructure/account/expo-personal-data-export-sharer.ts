import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import type {
  PersonalDataExport,
  PersonalDataExportSharer,
  PrivacyResult,
} from '../../core/account/account-privacy-module';

const exportFileName = 'kineo-data-export.json';
const jsonMimeType = 'application/json';
const jsonUniformTypeIdentifier = 'public.json';
const exportJsonIndentSpaces = 2;

type TemporaryFile = Readonly<{
  uri: string;
  exists(): boolean;
  write(content: string): void | Promise<void>;
  remove(): void;
}>;

type ExportFileFactory = () => TemporaryFile | Promise<TemporaryFile>;
type ExportSharePort = Readonly<{
  isAvailable(): Promise<boolean>;
  share(uri: string): Promise<void>;
}>;

export class ExpoPersonalDataExportSharer implements PersonalDataExportSharer {
  constructor(
    private readonly createFile: ExportFileFactory = createExpoFile,
    private readonly sharing: ExportSharePort = expoSharing,
  ) {}

  async share(data: PersonalDataExport): Promise<PrivacyResult<void>> {
    let file: TemporaryFile | undefined;
    let result: PrivacyResult<void>;
    try {
      if (!(await this.sharing.isAvailable())) return workflowFailure();
      file = await this.createFile();
      if (file.exists()) file.remove();
      await file.write(JSON.stringify(data, undefined, exportJsonIndentSpaces));
      await this.sharing.share(file.uri);
      result = { ok: true, value: undefined };
    } catch {
      result = workflowFailure();
    }

    if (file !== undefined) {
      try {
        if (file.exists()) file.remove();
      } catch {
        // A sensitive cache file that cannot be removed is an explicit failure.
        return workflowFailure();
      }
    }
    return result;
  }

  async cleanup(): Promise<PrivacyResult<void>> {
    try {
      const file = await this.createFile();
      if (file.exists()) file.remove();
      return { ok: true, value: undefined };
    } catch {
      return workflowFailure();
    }
  }
}

async function createExpoFile(): Promise<TemporaryFile> {
  const { prepareProtectedStorageDirectory, protectDatabaseFiles } = await import('../persistence/protected-storage');
  const directory = await prepareProtectedStorageDirectory();
  if (!directory.ok) throw new Error('Private export storage unavailable.');
  // Remove the previous development implementation's unprotected cache artifact.
  const legacyFile = new File(Paths.cache, exportFileName);
  if (legacyFile.exists) legacyFile.delete();
  const file = new File(directory.value, exportFileName);
  return {
    uri: file.uri,
    exists: () => file.exists,
    write: async (content) => {
      file.create();
      // The existing native operation protects a private file plus any SQLite
      // sidecars. For an export only the file exists; no new native API is needed.
      const protection = await protectDatabaseFiles(file.uri);
      if (!protection.ok) throw new Error('Private export protection unavailable.');
      file.write(content);
    },
    remove: () => file.delete(),
  };
}

const expoSharing: ExportSharePort = {
  isAvailable: Sharing.isAvailableAsync,
  share: (uri) => Sharing.shareAsync(uri, {
    mimeType: jsonMimeType,
    UTI: jsonUniformTypeIdentifier,
  }),
};

function workflowFailure(): PrivacyResult<void> {
  return { ok: false, error: { code: 'workflowFailed' } };
}
