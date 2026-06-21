import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // GCM standard nonce length

/** The encrypted-key columns on the Wallet model. Hex-encoded. */
export interface EncryptedEnvelope {
  encryptedPrivateKey: string;
  encryptionIv: string;
  encryptionAuthTag: string;
}

/** Encrypt with a fresh random IV. Returns the decomposed envelope persisted on the wallet. */
export function encrypt(plaintext: string, masterKey: Buffer): EncryptedEnvelope {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, masterKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    encryptedPrivateKey: ciphertext.toString('hex'),
    encryptionIv: iv.toString('hex'),
    encryptionAuthTag: cipher.getAuthTag().toString('hex'),
  };
}

/** Decrypt; throws if the auth tag does not verify (tampering or wrong key).
 *  Returns a Buffer so the caller can zeroize it after signing (relevant from T-012). */
export function decrypt(envelope: EncryptedEnvelope, masterKey: Buffer): Buffer {
  const decipher = createDecipheriv(ALGORITHM, masterKey, Buffer.from(envelope.encryptionIv, 'hex'));
  decipher.setAuthTag(Buffer.from(envelope.encryptionAuthTag, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.encryptedPrivateKey, 'hex')),
    decipher.final(),
  ]);
}
