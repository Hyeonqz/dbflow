import { resolveLocale } from './locale';

describe('resolveLocale', () => {
  it('ko / ko-KR / 다중태그 → ko', () => {
    expect(resolveLocale('ko')).toBe('ko');
    expect(resolveLocale('ko-KR')).toBe('ko');
    expect(resolveLocale('ko,en;q=0.9')).toBe('ko');
  });
  it('en / 미설정 / 미지원 → en', () => {
    expect(resolveLocale('en-US')).toBe('en');
    expect(resolveLocale(undefined)).toBe('en');
    expect(resolveLocale('')).toBe('en');
    expect(resolveLocale('fr')).toBe('en');
  });
});
