import { decryptSecret, encryptSecret } from './encryption.util';

// Deterministic 32-byte test key (64 hex chars).
const TEST_KEY = '0'.repeat(64);

describe('encryption.util (AES-256-GCM)', () => {
  const original = process.env.APP_ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.APP_ENCRYPTION_KEY = TEST_KEY;
  });

  afterAll(() => {
    process.env.APP_ENCRYPTION_KEY = original;
  });

  it('round-trips a secret back to its plaintext', () => {
    const secret = 's3cr3t-p@ss';
    expect(decryptSecret(encryptSecret(secret))).toBe(secret);
  });

  it('produces a different ciphertext each time (random IV)', () => {
    const a = encryptSecret('same');
    const b = encryptSecret('same');
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe('same');
    expect(decryptSecret(b)).toBe('same');
  });

  it('emits the iv:authTag:ciphertext format and never leaks plaintext', () => {
    const payload = encryptSecret('plaintext-value');
    expect(payload.split(':')).toHaveLength(3);
    expect(payload).not.toContain('plaintext-value');
  });

  it('rejects a tampered ciphertext (GCM auth failure)', () => {
    const [iv, tag, ct] = encryptSecret('secret').split(':');
    const flipped = ct.startsWith('a') ? `b${ct.slice(1)}` : `a${ct.slice(1)}`;
    expect(() => decryptSecret([iv, tag, flipped].join(':'))).toThrow();
  });

  it('throws when the key is missing', () => {
    delete process.env.APP_ENCRYPTION_KEY;
    expect(() => encryptSecret('x')).toThrow(/APP_ENCRYPTION_KEY/);
  });

  it('throws when the key is the wrong length', () => {
    process.env.APP_ENCRYPTION_KEY = 'abcd';
    expect(() => encryptSecret('x')).toThrow(/32바이트/);
  });

  it('rejects a malformed payload', () => {
    expect(() => decryptSecret('not-a-valid-payload')).toThrow(/형식/);
  });
});
