import { describe, expect, it } from '@jest/globals';

import {
  minimumPasswordCharacterCount,
  validateEmailCredentials,
  validateLegalAcceptance,
} from './account-domain';

const validPassword = 'correct horse battery staple';
const legalAcceptedAtMilliseconds = 1_788_300_000_000;

describe('account domain', () => {
  it('normalizes a valid email and accepts a long passphrase', () => {
    expect(validateEmailCredentials({
      email: '  PERSON@Example.COM ',
      password: validPassword,
    })).toEqual({
      ok: true,
      value: {
        email: 'person@example.com',
        password: validPassword,
      },
    });
  });

  it('rejects malformed email and passwords below the configured character floor', () => {
    expect(validateEmailCredentials({
      email: 'not-an-email',
      password: 'x'.repeat(minimumPasswordCharacterCount),
    })).toEqual({ ok: false, error: { code: 'invalidEmail' } });

    expect(validateEmailCredentials({
      email: 'person@example.com',
      password: 'x'.repeat(minimumPasswordCharacterCount - 1),
    })).toEqual({ ok: false, error: { code: 'passwordTooShort' } });
  });

  it('counts Unicode characters rather than UTF-16 code units', () => {
    const emoji = '🙂';
    expect(validateEmailCredentials({
      email: 'person@example.com',
      password: emoji.repeat(minimumPasswordCharacterCount),
    }).ok).toBe(true);
  });

  it('requires a versioned legal document with a supported locale', () => {
    expect(validateLegalAcceptance({
      documentKind: 'privacyPolicy',
      documentVersion: '2026-09-02',
      locale: 'en-US',
      acceptedAtMilliseconds: legalAcceptedAtMilliseconds,
    })).toEqual({
      ok: true,
      value: {
        documentKind: 'privacyPolicy',
        documentVersion: '2026-09-02',
        locale: 'en-US',
        acceptedAtMilliseconds: legalAcceptedAtMilliseconds,
      },
    });

    expect(validateLegalAcceptance({
      documentKind: 'privacyPolicy',
      documentVersion: '',
      locale: 'en-US',
      acceptedAtMilliseconds: legalAcceptedAtMilliseconds,
    })).toEqual({ ok: false, error: { code: 'invalidLegalAcceptance' } });
  });
});
