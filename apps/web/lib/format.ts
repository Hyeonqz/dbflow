import type { Locale } from '@/i18n/config';

/** ISO 문자열을 로케일별 날짜/시간(브라우저 로컬 타임존)으로 포맷. 클라이언트 전용 렌더에서 사용. */
export function formatDateTime(iso: string, locale: Locale = 'en'): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(locale === 'ko' ? 'ko-KR' : 'en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

/** 비즈니스 시각(적용 작업창·동결 등) — 배포 타임존(DBFLOW_TZ, next-intl useTimeZone()) 기준으로 고정 표시. */
export function formatBusinessDateTime(iso: string, locale: Locale = 'en', timeZone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(locale === 'ko' ? 'ko-KR' : 'en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(d);
}
