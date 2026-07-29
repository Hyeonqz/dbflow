const TONE_CLASS = {
  error: 'rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-500/15 dark:text-red-300',
  notice:
    'rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
} as const;

/**
 * 단문 에러/알림 표시.
 * - error: 사용자 액션이 실패했거나 본문을 못 불러옴 → assertive(alert)
 * - notice: 배경 조회가 실패해 화면이 진실을 다 말하지 못함 → polite(status)
 * 여백(mt-*)은 톤 클래스에 넣지 않고 호출부가 className으로 준다. 상단 배너는 여백이 없고
 * 패널 내부 알림은 mt-3을 쓰기 때문이다.
 */
export function InlineError({
  message,
  tone = 'error',
  className,
  id,
}: {
  message?: string;
  tone?: 'error' | 'notice';
  className?: string;
  id?: string;
}) {
  if (!message) return null;
  return (
    <p
      id={id}
      role={tone === 'error' ? 'alert' : 'status'}
      className={className ? `${TONE_CLASS[tone]} ${className}` : TONE_CLASS[tone]}
    >
      {message}
    </p>
  );
}
