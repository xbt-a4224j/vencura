import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decrypt, encrypt } from './aes-256-gcm';

const key = randomBytes(32);

describe('aes-256-gcm', () => {
  it('round-trips plaintext', () => {
    const envelope = encrypt('0xdeadbeef', key);
    expect(decrypt(envelope, key).toString('utf8')).toBe('0xdeadbeef');
  });

  it('uses a fresh IV per call (same input → different ciphertext)', () => {
    expect(encrypt('same', key).encryptedPrivateKey).not.toBe(encrypt('same', key).encryptedPrivateKey);
  });

  it('throws when the auth tag is tampered (GCM authentication)', () => {
    const envelope = encrypt('0xsecret', key);
    const tampered = { ...envelope, encryptionAuthTag: '00'.repeat(16) };
    expect(() => decrypt(tampered, key)).toThrow();
  });

  it('throws when decrypted with the wrong key', () => {
    const envelope = encrypt('0xsecret', key);
    expect(() => decrypt(envelope, randomBytes(32))).toThrow();
  });
});
