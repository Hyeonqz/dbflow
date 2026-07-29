import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, getChangeRequest } from '@/lib/api';

describe('apiFetch network failures', () => {
  beforeEach(() => {
    localStorage.setItem('accessToken', 'test-token');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('turns an unreachable server into a localized ApiError', async () => {
    // 브라우저가 네트워크 실패를 알리는 방식 그대로 — 원시 TypeError.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(getChangeRequest('cr1')).rejects.toBeInstanceOf(ApiError);
    await expect(getChangeRequest('cr1')).rejects.toThrow('Cannot reach the server');
  });

  it('keeps HTTP error responses untouched', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({ message: 'Already applied.' }),
      }),
    );

    await expect(getChangeRequest('cr1')).rejects.toThrow('Already applied.');
  });
});
