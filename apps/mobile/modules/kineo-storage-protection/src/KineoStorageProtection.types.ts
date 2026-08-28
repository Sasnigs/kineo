export type ProtectedPathInspection = Readonly<{
  path: string;
  uri: string;
  backupExcluded: boolean;
  completeProtectionVerified: boolean;
  completeProtectionSupported: boolean;
}>;
