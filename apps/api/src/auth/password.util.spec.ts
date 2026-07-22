import { hashPassword, verifyPassword } from './password.util';

describe('password util', () => {
  it('hashes and verifies a correct password', async () => {
    const hash = await hashPassword('s3cret!');
    expect(hash).not.toEqual('s3cret!');
    expect(await verifyPassword(hash, 's3cret!')).toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('s3cret!');
    expect(await verifyPassword(hash, 'wrong')).toBe(false);
  });
});
