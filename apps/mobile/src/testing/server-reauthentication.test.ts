import { describe, expect, it } from '@jest/globals';

import {
  hasRecentAuthentication,
  recentAuthenticationSeconds,
} from '../../../../supabase/functions/_shared/reauthentication';

const currentSeconds = 1_788_300_000;
const token = (claims: unknown) => `header.${btoa(JSON.stringify(claims))}.signature`;

describe('server recent-authentication policy (verified tokens only)', () => {
  it.each(['password', 'oauth'])('accepts a recent %s authentication', (method) => {
    expect(hasRecentAuthentication(token({
      amr: [{ method, timestamp: currentSeconds }],
    }), currentSeconds)).toBe(true);
  });

  it('does not treat token issuance or refresh as fresh authentication', () => {
    expect(hasRecentAuthentication(token({
      iat: currentSeconds,
      amr: [
        { method: 'password', timestamp: currentSeconds - recentAuthenticationSeconds - 1 },
        { method: 'token_refresh', timestamp: currentSeconds },
      ],
    }), currentSeconds)).toBe(false);
  });

  it.each([
    {},
    { amr: [{ method: 'password', timestamp: currentSeconds + 1 }] },
    { amr: [{ method: 'password', timestamp: String(currentSeconds) }] },
    { amr: [{ method: 'anonymous', timestamp: currentSeconds }] },
    { amr: [{ method: 'recovery', timestamp: currentSeconds }] },
    { amr: 'password' },
  ])('fails closed for unsupported or malformed claims', (claims) => {
    expect(hasRecentAuthentication(token(claims), currentSeconds)).toBe(false);
  });

  it('rejects malformed tokens', () => {
    expect(hasRecentAuthentication('not-a-token', currentSeconds)).toBe(false);
  });
});
