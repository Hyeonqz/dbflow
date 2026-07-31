import { describe, expect, it } from 'vitest';
import { createTranslator } from 'next-intl';
import { waitUnit } from '@/lib/duration';
import ko from '@/messages/ko.json';
import en from '@/messages/en.json';

describe('waitUnit', () => {
  const base = new Date('2026-07-30T12:00:00Z');
  const ago = (ms: number) => new Date(base.getTime() - ms).toISOString();
  const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;

  it('24시간 이상은 일 단위', () => {
    expect(waitUnit(ago(3 * DAY), base)).toEqual({ unit: 'days', count: 3 });
  });
  it('정확히 24시간은 1일', () => {
    expect(waitUnit(ago(DAY), base)).toEqual({ unit: 'days', count: 1 });
  });
  it('1시간 이상 24시간 미만은 시간 단위', () => {
    expect(waitUnit(ago(5 * HOUR), base)).toEqual({ unit: 'hours', count: 5 });
  });
  it('정확히 1시간은 1시간', () => {
    expect(waitUnit(ago(HOUR), base)).toEqual({ unit: 'hours', count: 1 });
  });
  it('1시간 미만은 분 단위', () => {
    expect(waitUnit(ago(7 * MIN), base)).toEqual({ unit: 'minutes', count: 7 });
  });
  it('1분 미만도 0이 아니라 1분으로 보여준다', () => {
    expect(waitUnit(ago(3_000), base)).toEqual({ unit: 'minutes', count: 1 });
  });
  it('미래 시각(시계 오차)도 1분으로 클램프한다', () => {
    expect(waitUnit(new Date(base.getTime() + 5 * MIN).toISOString(), base)).toEqual({
      unit: 'minutes', count: 1,
    });
  });
});

describe('duration strings render in both locales', () => {
  it('ko renders the plural bodies', () => {
    const t = createTranslator({ locale: 'ko', messages: ko, namespace: 'common' });
    expect(t('duration.days', { count: 3 })).toBe('3일');
    expect(t('duration.hours', { count: 5 })).toBe('5시간');
    expect(t('duration.minutes', { count: 7 })).toBe('7분');
  });

  it('en pluralizes one vs other', () => {
    const t = createTranslator({ locale: 'en', messages: en, namespace: 'common' });
    expect(t('duration.days', { count: 1 })).toBe('1 day');
    expect(t('duration.days', { count: 3 })).toBe('3 days');
  });
});
