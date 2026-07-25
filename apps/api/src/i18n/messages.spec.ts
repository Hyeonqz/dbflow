import { translate } from './messages';

describe('translate', () => {
  it('존재 키를 로케일별로 반환', () => {
    expect(translate('changeRequest.notFound', 'ko')).toContain('변경요청');
    expect(translate('changeRequest.notFound', 'en')).toMatch(/not found/i);
  });
  it('보간 {param} 치환', () => {
    expect(translate('changeRequest.submitRequiresAssignees', 'en', { required: 2 })).toContain('2');
  });
  it('미존재 키 → key 원문 반환(폴백)', () => {
    expect(translate('nonexistent.key', 'ko')).toBe('nonexistent.key');
  });
});
