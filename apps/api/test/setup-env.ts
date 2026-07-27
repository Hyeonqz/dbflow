// 테스트 전용 env — fail-fast 검증을 통과하는 유효한 값
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret-0123456789-0123456789';
process.env.APP_ENCRYPTION_KEY =
  process.env.APP_ENCRYPTION_KEY ?? '1111111111111111111111111111111111111111111111111111111111111111';
// TZ는 여기서 정할 수 없다 — V8/ICU가 프로세스 시작 시점의 타임존을 캐시하므로
// setupFiles 단계에서 process.env.TZ를 바꿔도 Date/Intl은 이를 무시한다.
// (러너의 로컬 TZ가 우연히 맞으면 통과하고 UTC 러너에서는 깨지는 상태가 된다.)
// 그래서 package.json의 test 스크립트가 `TZ=Asia/Seoul jest`로 프로세스를 띄운다.
