import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Symmetric encryption for target-DB credentials (Plan 3).
 *
 * Algorithm: AES-256-GCM (authenticated encryption — tamper-evident).
 * Key: 32 bytes, provided as 64 hex chars via env `APP_ENCRYPTION_KEY`.
 *
 * Stored payload format (single string, colon-delimited hex):
 *   <iv>:<authTag>:<ciphertext>
 * The IV is random per encryption, so identical plaintexts yield distinct
 * ciphertexts. Plaintext secrets are NEVER persisted (see contract §1.2).
 */
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // 96-bit nonce — the recommended size for GCM.
const KEY_BYTES = 32;

function loadKey(): Buffer {
  const hex = process.env.APP_ENCRYPTION_KEY;
  if (!hex) {
    throw new Error('APP_ENCRYPTION_KEY 환경변수가 설정되지 않았습니다.');
  }
  const key = Buffer.from(hex, 'hex');
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `APP_ENCRYPTION_KEY 길이가 올바르지 않습니다. 32바이트(64 hex 문자) 필요, 실제 ${key.length}바이트.`,
    );
  }
  return key;
}

/** Encrypts a UTF-8 secret, returning the `iv:authTag:ciphertext` hex payload. */
export function encryptSecret(plaintext: string): string {
  const key = loadKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('hex'), authTag.toString('hex'), ciphertext.toString('hex')].join(':');
}

/** Decrypts an `iv:authTag:ciphertext` payload produced by {@link encryptSecret}. */
export function decryptSecret(payload: string): string {
  const key = loadKey();
  const parts = payload.split(':');
  if (parts.length !== 3) {
    throw new Error('암호화 페이로드 형식이 올바르지 않습니다.');
  }
  const [ivHex, authTagHex, ciphertextHex] = parts;
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextHex, 'hex')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}
