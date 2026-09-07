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
  write(content: string): void;
  remove(): void;
}>;

type ExportFileFactory = () => TemporaryFile;
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
      file = this.createFile();
      if (file.exists()) file.remove();
      file.write(JSON.stringify(data, undefined, exportJsonIndentSpaces));
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
}

function createExpoFile(): TemporaryFile {
  const file = new File(Paths.cache, exportFileName);
  return {
    uri: file.uri,
    exists: () => file.exists,
    write: (content) => file.write(content),
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
