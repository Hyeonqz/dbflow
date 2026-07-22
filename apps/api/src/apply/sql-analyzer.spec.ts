import { analyzeSql, analyzeStatement, affectedTables, splitSqlStatements } from './sql-analyzer';

describe('splitSqlStatements', () => {
  it('strips comments and tracks start line numbers', () => {
    const stmts = splitSqlStatements(`-- header\nSELECT 1;\n/* block */\nUPDATE t SET a=1;`);
    expect(stmts).toHaveLength(2);
    expect(stmts[0]).toMatchObject({ line: 2 });
    expect(stmts[1].raw).toMatch(/^UPDATE/);
    expect(stmts[1].line).toBe(4);
  });
});

describe('analyzeStatement', () => {
  it.each([
    ['DROP DATABASE foo', 'DROP_DATABASE', null, true],
    ['DROP TABLE `users`', 'DROP_TABLE', 'users', true],
    ['TRUNCATE TABLE logs', 'TRUNCATE', 'logs', true],
    ['CREATE TABLE orders (id INT)', 'CREATE_TABLE', 'orders', true],
    ['ALTER TABLE users ADD COLUMN x INT', 'ALTER_TABLE', 'users', true],
    ['UPDATE accounts SET balance=0 WHERE id=1', 'UPDATE', 'accounts', false],
    ['DELETE FROM sessions WHERE id=1', 'DELETE', 'sessions', false],
    ['INSERT INTO audit (id) VALUES (1)', 'INSERT', 'audit', false],
    ['SELECT * FROM x', 'SELECT', null, false],
  ])('%s -> %s', (sql, kind, table, isDdl) => {
    const a = analyzeStatement(sql);
    expect(a.kind).toBe(kind);
    expect(a.table).toBe(table);
    expect(a.isDdl).toBe(isDdl);
  });

  it('detects WHERE presence for UPDATE/DELETE', () => {
    expect(analyzeStatement('DELETE FROM t').hasWhere).toBe(false);
    expect(analyzeStatement('DELETE FROM t WHERE id=1').hasWhere).toBe(true);
    expect(analyzeStatement('UPDATE t SET a=1').hasWhere).toBe(false);
  });

  it('flags ALTER DROP COLUMN and DROP INDEX', () => {
    expect(analyzeStatement('ALTER TABLE t DROP COLUMN c').alterDropColumn).toBe(true);
    expect(analyzeStatement('ALTER TABLE t DROP INDEX idx').alterDropIndex).toBe(true);
  });
});

describe('affectedTables', () => {
  it('collects distinct tables across files', () => {
    const tables = affectedTables([
      { content: 'UPDATE users SET a=1 WHERE id=1; DELETE FROM users WHERE id=2;' },
      { content: 'ALTER TABLE orders ADD COLUMN x INT;' },
    ]);
    expect(tables.sort()).toEqual(['orders', 'users']);
  });
});

describe('analyzeSql', () => {
  it('analyzes multiple statements in one file', () => {
    const a = analyzeSql('CREATE TABLE a (id INT); INSERT INTO a VALUES (1);');
    expect(a.map((s) => s.kind)).toEqual(['CREATE_TABLE', 'INSERT']);
  });
});
