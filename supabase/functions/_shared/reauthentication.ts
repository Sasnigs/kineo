const secondsPerMinute = 60;
const recentAuthenticationMinutes = 5;
export const recentAuthenticationSeconds =
  recentAuthenticationMinutes * secondsPerMinute;

// Only the account's configured sign-in methods qualify. Refresh, recovery,
// signup and unknown methods must not authorize export or irreversible deletion.
const reauthenticationMethods = new Set(['password', 'oauth']);

/** Call only after verifying this exact token with Supabase Auth. */
export function hasRecentAuthentication(
  verifiedToken: string,
  currentSeconds: number,
): boolean {
  try {
    const payloadPart = verifiedToken.split('.')[1];
    if (payloadPart === undefined) return false;
    const payload: unknown = JSON.parse(atob(
      payloadPart.replaceAll('-', '+').replaceAll('_', '/'),
    ));
    if (
      typeof payload !== 'object' || payload === null ||
      !('amr' in payload) || !Array.isArray(payload.amr)
    ) return false;
    return payload.amr.some((reference: unknown) => {
      if (
        typeof reference !== 'object' || reference === null ||
        !('method' in reference) || typeof reference.method !== 'string' ||
        !reauthenticationMethods.has(reference.method) ||
        !('timestamp' in reference) || typeof reference.timestamp !== 'number' ||
        !Number.isSafeInteger(reference.timestamp)
      ) return false;
      const ageSeconds = currentSeconds - reference.timestamp;
      return ageSeconds >= 0 && ageSeconds <= recentAuthenticationSeconds;
    });
  } catch {
    // Unparseable claims are never evidence of recent authentication.
    return false;
  }
}
