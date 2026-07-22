import { lintFiles, effectiveSeverity, RULE_CATALOG, type PolicyMap } from './lint.engine';

function mapOf(entries: Record<string, string>): PolicyMap {
  return new Map(Object.entries(entries) as any);
}

describe('lintFiles(files, policy)', () => {
  const dropTable = [{ filename: 'a.sql', content: 'DROP TABLE users;' }];

  it('emits BLOCK when policy sets the rule to BLOCK', () => {
    const r = lintFiles(dropTable, mapOf({ DROP_TABLE: 'BLOCK' }));
    expect(r.maxSeverity).toBe('BLOCK');
    expect(r.items[0].rule).toBe('DROP_TABLE');
  });

  it('emits WARN when policy downgrades the rule', () => {
    const r = lintFiles(dropTable, mapOf({ DROP_TABLE: 'WARN' }));
    expect(r.maxSeverity).toBe('WARN');
  });

  it('skips the rule entirely when DISABLED', () => {
    const r = lintFiles(dropTable, mapOf({ DROP_TABLE: 'DISABLED' }));
    expect(r.items).toHaveLength(0);
  });
});

describe('effectiveSeverity (fallback, retained)', () => {
  it('downgrades BLOCK→WARN on DEV', () => {
    expect(effectiveSeverity('BLOCK', 'DEV' as any)).toBe('WARN');
  });
  it('keeps base on STAGING/PROD', () => {
    expect(effectiveSeverity('BLOCK', 'PROD' as any)).toBe('BLOCK');
  });
});

describe('RULE_CATALOG', () => {
  it('exposes 7 rules with key/base/message (no matcher)', () => {
    expect(RULE_CATALOG).toHaveLength(7);
    expect(RULE_CATALOG.map((r) => r.ruleKey)).toContain('DROP_TABLE');
    expect((RULE_CATALOG as any)[0].matches).toBeUndefined();
  });
});
