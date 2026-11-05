import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { constants, createHash, generateKeyPairSync, privateEncrypt, verify } from 'node:crypto';

const mobileRequire = createRequire(new URL('../../apps/mobile/package.json', import.meta.url));
const expoRequire = createRequire(mobileRequire.resolve('expo/package.json'));
const cliRequire = createRequire(expoRequire.resolve('@expo/cli/package.json'));
const certificatesRequire = createRequire(cliRequire.resolve('@expo/code-signing-certificates/package.json'));
const micromatchRequire = createRequire(mobileRequire.resolve('micromatch'));
const braces = micromatchRequire('braces');
const micromatch = mobileRequire('micromatch');
const RSA_TEST_MODULUS_BITS = 2048;
const RSA_TEST_PUBLIC_EXPONENT = 3; // The advisory specifically affects low-exponent keys.
const SIGNATURE_PADDING_BYTE = 0xff;
const SIGNATURE_PREFIX = Buffer.from([0x00, 0x01]);
const SIGNATURE_DELIMITER = Buffer.from([0x00]);
const BYTE_BITS = 8;
const DEEP_PATTERN_DEPTH = 4995; // Below upstream's 10,000-character input limit.
const MAX_PATCHED_NESTING_DEPTH = 100;
const message = Buffer.from('Kineo dependency security fixture, not user data.');
const digest = createHash('sha256').update(message).digest();
const keys = generateKeyPairSync('rsa', { modulusLength: RSA_TEST_MODULUS_BITS, publicExponent: RSA_TEST_PUBLIC_EXPONENT });

test('ordinary brace expansion and Jest/Metro matching stay compatible', () => {
  assert.deepEqual(braces.expand('app/{today,progress,profile}.{ts,tsx}'), [
    'app/today.ts', 'app/today.tsx', 'app/progress.ts', 'app/progress.tsx', 'app/profile.ts', 'app/profile.tsx'
  ]);
  assert.deepEqual(micromatch(['app/today.tsx', 'app/data.json', 'app/profile.ts'], 'app/*.{ts,tsx}'), ['app/today.tsx', 'app/profile.ts']);
  assert.deepEqual(braces.expand('item-{1..3}'), ['item-1', 'item-2', 'item-3']);
});

test('braces rejects deep strings before stack exhaustion, including raised limits', () => {
  for (const [open, close] of [['{', '}'], ['(', ')']]) {
    const input = open.repeat(DEEP_PATTERN_DEPTH) + 'a,b' + close.repeat(DEEP_PATTERN_DEPTH);
    for (const maxDepth of [undefined, Infinity, DEEP_PATTERN_DEPTH]) {
      for (const operation of [braces, braces.expand, braces.stringify]) {
        assert.throws(() => operation(input, { maxDepth }), /exceeds max depth/);
      }
    }
  }
});

test('direct AST traversal is bounded in every recursive public entry point', () => {
  for (const operation of [braces.compile, braces.expand, braces.stringify]) {
    let tree = { type: 'text', value: 'x' };
    for (let depth = 0; depth < DEEP_PATTERN_DEPTH; depth += 1) tree = { type: 'brace', nodes: [tree] };
    const root = { type: 'root', nodes: [tree] };
    assert.throws(() => operation(root), /exceeds max depth/);
  }
  assert.doesNotThrow(() => braces.parse('{'.repeat(MAX_PATCHED_NESTING_DEPTH) + 'x' + '}'.repeat(MAX_PATCHED_NESTING_DEPTH)));
  assert.throws(() => braces.parse('{'.repeat(MAX_PATCHED_NESTING_DEPTH + 1) + 'x' + '}'.repeat(MAX_PATCHED_NESTING_DEPTH + 1)), /exceeds max depth/);
});

// Build deliberately malformed PKCS#1 DigestInfo using a fixture private key.
// This reaches the same verifier path as CVE-2026-85393 without importing an
// exploit or maintaining crypto code. Node/OpenSSL provides an independent oracle.
for (const [consumer, require] of [
  ['Expo CLI', cliRequire], ['Expo code-signing certificates', certificatesRequire]
]) {
  const forge = require('node-forge');
  const publicKey = forge.pki.publicKeyFromPem(keys.publicKey.export({ type: 'spki', format: 'pem' }));
  const privateKey = forge.pki.privateKeyFromPem(keys.privateKey.export({ type: 'pkcs8', format: 'pem' }));
  const asn1 = forge.asn1;
  const value = (type, content, constructed = false) => asn1.create(asn1.Class.UNIVERSAL, type, constructed, content);
  const signatureFor = (includeNull, includeGarbage, nullContents = '') => {
    const algorithm = [value(asn1.Type.OID, asn1.oidToDer(forge.pki.oids.sha256).getBytes())];
    if (includeNull) algorithm.push(value(asn1.Type.NULL, nullContents));
    if (includeGarbage) algorithm.push(value(asn1.Type.OCTETSTRING, 'garbage'));
    const info = value(asn1.Type.SEQUENCE, [value(asn1.Type.SEQUENCE, algorithm, true), value(asn1.Type.OCTETSTRING, digest.toString('binary'))], true);
    const encoded = Buffer.from(asn1.toDer(info).getBytes(), 'binary');
    const paddingLength = RSA_TEST_MODULUS_BITS / BYTE_BITS - SIGNATURE_PREFIX.length - SIGNATURE_DELIMITER.length - encoded.length;
    const block = Buffer.concat([SIGNATURE_PREFIX, Buffer.alloc(paddingLength, SIGNATURE_PADDING_BYTE), SIGNATURE_DELIMITER, encoded]);
    return privateEncrypt({ key: keys.privateKey, padding: constants.RSA_NO_PADDING }, block);
  };

  test(`${consumer}: valid RSA signatures remain valid; tampering fails`, () => {
    const hash = forge.md.sha256.create().update(message.toString('binary'));
    const signature = privateKey.sign(hash);
    assert.equal(publicKey.verify(digest.toString('binary'), signature), true);
    assert.equal(verify('sha256', message, keys.publicKey, Buffer.from(signature, 'binary')), true);
    const altered = Buffer.from(digest); altered[0] ^= 1;
    assert.equal(publicKey.verify(altered.toString('binary'), signature), false);
    for (const includeNull of [false, true]) {
      assert.equal(publicKey.verify(digest.toString('binary'), signatureFor(includeNull, false).toString('binary')), true);
    }
  });

  test(`${consumer}: nested DigestAlgorithm garbage is rejected`, () => {
    for (const includeNull of [false, true]) {
      const signature = signatureFor(includeNull, true);
      assert.equal(verify('sha256', message, keys.publicKey, signature), false);
      assert.throws(() => publicKey.verify(digest.toString('binary'), signature.toString('binary')), /ASN\.1 object does not contain a valid/);
    }
  });

  test(`${consumer}: nonempty NULL parameters cannot hide signature padding`, () => {
    const signature = signatureFor(true, false, 'garbage');
    assert.equal(verify('sha256', message, keys.publicKey, signature), false);
    assert.throws(() => publicKey.verify(digest.toString('binary'), signature.toString('binary')), /ASN\.1 object does not contain a valid/);
  });
}

test('Expo certificate generation, serialization and signature verification still work', () => {
  const expo = cliRequire('@expo/code-signing-certificates');
  const keyPair = expo.convertKeyPairPEMToKeyPair({
    privateKeyPEM: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    publicKeyPEM: keys.publicKey.export({ type: 'spki', format: 'pem' })
  });
  const validityNotBefore = new Date('2000-01-01T00:00:00Z');
  const validityNotAfter = new Date('2100-01-01T00:00:00Z');
  const certificate = expo.generateSelfSignedCodeSigningCertificate({ keyPair, validityNotBefore, validityNotAfter, commonName: 'Kineo test fixture' });
  const restored = expo.convertCertificatePEMToCertificate(expo.convertCertificateToCertificatePEM(certificate));
  assert.doesNotThrow(() => expo.validateSelfSignedCertificate(restored, keyPair));
  const signature = expo.signBufferRSASHA256AndVerify(keyPair.privateKey, restored, message);
  assert.equal(verify('sha256', message, keys.publicKey, Buffer.from(signature, 'base64')), true);
  const csr = expo.convertCSRPEMToCSR(expo.convertCSRToCSRPEM(expo.generateCSR(keyPair, 'Kineo test fixture')));
  assert.equal(csr.verify(), true);
});
