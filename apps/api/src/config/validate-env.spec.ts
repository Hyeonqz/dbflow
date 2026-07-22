import { validateEnv } from './validate-env';

const VALID = {
  JWT_SECRET: 'a-sufficiently-long-real-secret-value',
  APP_ENCRYPTION_KEY: 'ab'.repeat(32),
} as NodeJS.ProcessEnv;

describe('validateEnv', () => {
  it('유효한 env는 통과한다', () => {
    expect(validateEnv(VALID)).toEqual([]);
  });

  it('JWT_SECRET 미설정/기본값/짧은 값을 거부한다', () => {
    expect(validateEnv({ ...VALID, JWT_SECRET: undefined })).not.toEqual([]);
    expect(validateEnv({ ...VALID, JWT_SECRET: 'change-me-in-prod' })).not.toEqual([]);
    expect(validateEnv({ ...VALID, JWT_SECRET: 'short' })).not.toEqual([]);
  });

  it('APP_ENCRYPTION_KEY 미설정/제로/비-hex/길이 오류를 거부한다', () => {
    expect(validateEnv({ ...VALID, APP_ENCRYPTION_KEY: undefined })).not.toEqual([]);
    expect(validateEnv({ ...VALID, APP_ENCRYPTION_KEY: '0'.repeat(64) })).not.toEqual([]);
    expect(validateEnv({ ...VALID, APP_ENCRYPTION_KEY: 'zz'.repeat(32) })).not.toEqual([]);
    expect(validateEnv({ ...VALID, APP_ENCRYPTION_KEY: 'ab'.repeat(16) })).not.toEqual([]);
  });
});
