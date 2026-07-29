import { describe, expect, it } from 'vitest';
import en from './en.json';
import ko from './ko.json';

/** 중첩 객체를 "a.b.c" 형태의 리프 키 목록으로 편다. */
function flatKeys(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
    flatKeys(v, prefix ? `${prefix}.${k}` : k),
  );
}

describe('message catalogs', () => {
  // next-intl은 키 누락 시 throw하지 않고 키 경로를 화면에 그대로 출력한다.
  // 대칭을 강제하는 다른 장치가 없으므로 이 테스트가 유일한 방어선이다.
  it('en and ko expose an identical key set', () => {
    expect(flatKeys(ko).sort()).toEqual(flatKeys(en).sort());
  });
});
