import type { Result } from '../shared/result';

export const minimumPasswordCharacterCount = 15;
export const legalDocumentKinds = [
  'termsOfService',
  'privacyPolicy',
] as const;

export type LegalDocumentKind = (typeof legalDocumentKinds)[number];

export type EmailCredentials = Readonly<{
  email: string;
  password: string;
}>;

export type LegalAcceptance = Readonly<{
  documentKind: LegalDocumentKind;
  documentVersion: string;
  locale: string;
  acceptedAtMilliseconds: number;
}>;

export type AccountStatus = 'active' | 'deleting';

export type AccountState = Readonly<{
  accountId: string;
  status: AccountStatus;
  historyEpoch: number;
  legalAcceptances: readonly LegalAcceptance[];
}>;

export type AccountValidationError =
  | Readonly<{ code: 'invalidEmail' }>
  | Readonly<{ code: 'passwordTooShort' }>
  | Readonly<{ code: 'invalidLegalAcceptance' }>;

const emailShape = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const localeShape = /^[a-z]{2,3}(?:-[A-Z]{2})?$/u;

function isNonEmpty(value: string): boolean {
  return value.trim().length > 0;
}

export function validateEmailCredentials(
  input: EmailCredentials,
): Result<EmailCredentials, AccountValidationError> {
  const email = input.email.trim().toLocaleLowerCase('en-US');
  if (!emailShape.test(email)) {
    return { ok: false, error: { code: 'invalidEmail' } };
  }
  if ([...input.password].length < minimumPasswordCharacterCount) {
    return { ok: false, error: { code: 'passwordTooShort' } };
  }
  return { ok: true, value: { email, password: input.password } };
}

export function validateLegalAcceptance(
  input: LegalAcceptance,
): Result<LegalAcceptance, AccountValidationError> {
  if (
    !legalDocumentKinds.includes(input.documentKind) ||
    !isNonEmpty(input.documentVersion) ||
    !localeShape.test(input.locale) ||
    !Number.isSafeInteger(input.acceptedAtMilliseconds) ||
    input.acceptedAtMilliseconds <= 0
  ) {
    return { ok: false, error: { code: 'invalidLegalAcceptance' } };
  }
  return { ok: true, value: input };
}
