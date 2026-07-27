// 테스트 전용 env — fail-fast 검증을 통과하는 유효한 값
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret-0123456789-0123456789';
process.env.APP_ENCRYPTION_KEY =
  process.env.APP_ENCRYPTION_KEY ?? '1111111111111111111111111111111111111111111111111111111111111111';
// 스펙(apply-schedule/delegation)이 KST 오프셋을 어서션하므로, 러너의 로컬 TZ와
// 무관하게 결정적이도록 고정한다(DBFLOW_TZ 도입 후 오프셋 하드코딩 제거의 부작용).
process.env.TZ = process.env.TZ ?? 'Asia/Seoul';
