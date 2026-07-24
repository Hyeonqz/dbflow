import type { Locale } from '@/i18n/config';

/** ISO 문자열을 로케일별 날짜/시간(Asia/Seoul 고정)으로 포맷. 클라이언트 전용 렌더에서 사용. */
export function formatDateTime(iso: string, locale: Locale = 'en'): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(locale === 'ko' ? 'ko-KR' : 'en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Seoul',
  }).format(d);
}
