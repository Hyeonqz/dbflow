import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  // tsconfig의 jsx:"preserve"(Next 전용)를 esbuild가 물려받으므로 자동 런타임을 명시해야 한다.
  // 이 줄이 없으면 JSX가 변환되지 않아 모든 테스트가 실패한다.
  esbuild: { jsx: 'automatic' },
  // tsconfig.json의 paths("@/*": ["./*"])와 이중 원천이다. 한쪽을 바꾸면 다른 쪽도 바꿔야 한다.
  resolve: { alias: { '@': path.resolve(__dirname, '.') } },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['{app,components,lib,messages}/**/*.test.{ts,tsx}'],
    // 각 테스트 전에 spy를 원복한다. 없으면 Task 6의 vi.spyOn(window,'confirm')이 다음
    // 테스트로 새어 confirm()이 계속 true를 반환한다 — clearAllMocks는 호출 기록만 지우고
    // mockReturnValue는 남기기 때문이다(실측 확인). beforeEach가 재설정하는 vi.fn() 모듈
    // mock에는 영향이 없다(적용 전후 결과 동일함을 실측 확인).
    restoreMocks: true,
  },
});
