export type WaitUnit = { unit: 'days' | 'hours' | 'minutes'; count: number };

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/**
 * 인박스 행의 대기 기간을 한 단위로만 환산한다("3일 5시간"처럼 합성하지 않는다 — 행이 좁다).
 * 전역 상대시간 도입(로드맵 G6)이 아니라 인박스 전용 최소 헬퍼다.
 */
export function waitUnit(sinceIso: string, now: Date = new Date()): WaitUnit {
  const elapsed = now.getTime() - new Date(sinceIso).getTime();
  // 서버·클라이언트 시계 오차로 음수가 될 수 있다. "0분 대기"보다 "1분 대기"가 정직하다.
  const ms = Math.max(elapsed, MIN);
  if (ms >= DAY) return { unit: 'days', count: Math.floor(ms / DAY) };
  if (ms >= HOUR) return { unit: 'hours', count: Math.floor(ms / HOUR) };
  return { unit: 'minutes', count: Math.max(1, Math.floor(ms / MIN)) };
}
