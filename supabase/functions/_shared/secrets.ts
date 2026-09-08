const tokenByteCount = 32;

export function randomSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(tokenByteCount));
  return base64Url(bytes);
}

export async function sha256Hex(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value);
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', encoded),
  );
  return [...digest]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}
