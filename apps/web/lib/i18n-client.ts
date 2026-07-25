import { LOCALE_COOKIE, resolveLocale } from '@/i18n/config';

// lib/api.ts 처럼 React 밖(fetch 에러 등)에서 쓰는 소수 문자열 전용 — 훅을 못 쓰는 곳.
const STRINGS = {
  requestFailed: { en: 'Request failed.', ko: '요청에 실패했습니다.' },
  sessionExpired: { en: 'Your session has expired. Please sign in again.', ko: '세션이 만료되었습니다. 다시 로그인해 주세요.' },
  exportFailed: { en: 'Export failed.', ko: '내보내기에 실패했습니다.' },
  loginFailed: { en: 'Sign-in failed.', ko: '로그인에 실패했습니다.' },
} as const;

export function currentLocale(): 'en' | 'ko' {
  if (typeof document === 'undefined') return 'en';
  const m = document.cookie.match(new RegExp(`${LOCALE_COOKIE}=([^;]+)`));
  return resolveLocale(m?.[1]);
}

export function ct(key: keyof typeof STRINGS): string {
  return STRINGS[key][currentLocale()];
}
