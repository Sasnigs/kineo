export type ProtectedPathInspection = Readonly<{
  path: string;
  backupExcluded: boolean;
  completeProtectionVerified: boolean;
  completeProtectionSupported: boolean;
}>;
