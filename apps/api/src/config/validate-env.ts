/**
 * 부팅 전 env 로드 + fail-fast 검증 (단일 지점).
 * main.ts의 "첫 번째 import"여야 한다 — auth.module 등이 모듈 스코프에서
 * process.env를 읽기 전에 .env 로드가 끝나 있어야 하기 때문.
 */

function tryLoadDotenv() {
  // Node 20.12+/22 내장. cwd(개발: apps/api)의 .env를 로드하고, 없으면(컨테이너) 무시.
  // 이미 설정된 process.env를 덮어쓰지 않는다.
  const p = process as NodeJS.Process & { loadEnvFile?: (path?: string) => void };
  try {
    p.loadEnvFile?.();
  } catch {
    /* .env 없음 — 컨테이너/CI는 process env 사용 */
  }
}

export function validateEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const errors: string[] = [];

  const jwt = env.JWT_SECRET;
  if (!jwt || jwt === 'change-me-in-prod' || jwt.length < 16) {
    errors.push(
      'JWT_SECRET이 없거나 기본값/16자 미만입니다. 생성: openssl rand -hex 32',
    );
  }

  const key = env.APP_ENCRYPTION_KEY;
  if (!key || !/^[0-9a-fA-F]{64}$/.test(key) || /^0+$/.test(key)) {
    errors.push(
      'APP_ENCRYPTION_KEY는 64자 hex여야 하며 전부 0일 수 없습니다. 생성: openssl rand -hex 32',
    );
  }

  const tz = env.DBFLOW_TZ;
  if (tz) {
    try {
      new Intl.DateTimeFormat(undefined, { timeZone: tz });
    } catch {
      errors.push(`DBFLOW_TZ가 유효한 IANA 타임존이 아닙니다: ${tz}`);
    }
  }

  return errors;
}

tryLoadDotenv();
if (process.env.NODE_ENV !== 'test') {
  const errors = validateEnv();
  if (errors.length > 0) {
    // eslint-disable-next-line no-console
    console.error(`[dbflow] 부팅 중단 — 환경변수 오류:\n- ${errors.join('\n- ')}`);
    process.exit(1);
  }
  // 검증 통과 후 프로세스 TZ를 배포 타임존으로 고정 — app.module 등 이후 모든 모듈의
  // Date 파싱/판정/포맷이 이 값을 따르도록 다른 모듈이 평가되기 전에 설정한다.
  // 빈 문자열은 미설정으로 취급(?? 대신 ||) — ''는 ICU가 Etc/Unknown으로 풀어 UTC로 조용히 새는 버그가 있었다.
  process.env.TZ = process.env.DBFLOW_TZ || 'Asia/Seoul';
}
