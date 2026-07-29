import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/dom';

// CI 러너는 로컬보다 느리다. findBy* 기본 1000ms는 19개 테스트 스위트(로컬 ~2.3s)에서
// 여유가 없다. Vitest 자체의 기본 testTimeout(5s)이 실제 행(hang)은 그대로 잡아준다.
configure({ asyncUtilTimeout: 5000 });
