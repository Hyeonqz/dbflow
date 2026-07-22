import { parseDesiredSchema } from './desired-schema-parser';
import { diffSchemas } from './schema-diff.engine';
import { Schema } from './schema-model';

// Both sides are normalized Schemas; the parser is a convenient way to build them.
const schemaOf = (sql: string): Schema => parseDesiredSchema(sql);

describe('diffSchemas', () => {
  it('emits CREATE_TABLE for a table missing from the target', () => {
    const desired = schemaOf('CREATE TABLE users (id INT, PRIMARY KEY (id));');
    const current = schemaOf('CREATE TABLE other (id INT);');

    const diff = diffSchemas(desired, current);
    expect(diff).toHaveLength(1);
    expect(diff[0]).toMatchObject({ kind: 'CREATE_TABLE', table: 'users', destructive: false });
    expect(diff[0].statement).toMatch(/^CREATE TABLE users/);
  });

  it('emits ADD_COLUMN for a new column', () => {
    const desired = schemaOf('CREATE TABLE t (id INT, email VARCHAR(255) NOT NULL);');
    const current = schemaOf('CREATE TABLE t (id INT);');

    const diff = diffSchemas(desired, current);
    expect(diff).toEqual([
      expect.objectContaining({
        kind: 'ADD_COLUMN',
        table: 't',
        destructive: false,
        statement: 'ALTER TABLE `t` ADD COLUMN `email` VARCHAR(255) NOT NULL;',
      }),
    ]);
  });

  it('emits DROP_COLUMN (destructive) for a removed column', () => {
    const desired = schemaOf('CREATE TABLE t (id INT);');
    const current = schemaOf('CREATE TABLE t (id INT, legacy VARCHAR(10));');

    const diff = diffSchemas(desired, current);
    expect(diff).toEqual([
      expect.objectContaining({
        kind: 'DROP_COLUMN',
        table: 't',
        destructive: true,
        statement: 'ALTER TABLE `t` DROP COLUMN `legacy`;',
      }),
    ]);
  });

  it('emits MODIFY_COLUMN on a type change', () => {
    const desired = schemaOf('CREATE TABLE t (v VARCHAR(20));');
    const current = schemaOf('CREATE TABLE t (v VARCHAR(10));');

    const diff = diffSchemas(desired, current);
    expect(diff[0]).toMatchObject({ kind: 'MODIFY_COLUMN', table: 't' });
    expect(diff[0].statement).toBe('ALTER TABLE `t` MODIFY COLUMN `v` VARCHAR(20);');
  });

  it('emits MODIFY_COLUMN on a nullability change', () => {
    const desired = schemaOf('CREATE TABLE t (v INT NOT NULL);');
    const current = schemaOf('CREATE TABLE t (v INT NULL);');

    expect(diffSchemas(desired, current)[0]).toMatchObject({ kind: 'MODIFY_COLUMN' });
  });

  it('emits ADD_INDEX and DROP_INDEX by name, ignoring PRIMARY', () => {
    const desired = schemaOf(
      'CREATE TABLE t (id INT, c VARCHAR(2), PRIMARY KEY (id), KEY idx_new (c));',
    );
    const current = schemaOf(
      'CREATE TABLE t (id INT, c VARCHAR(2), PRIMARY KEY (id), KEY idx_old (c));',
    );

    const diff = diffSchemas(desired, current);
    const kinds = diff.map((d) => d.kind);
    expect(kinds).toContain('ADD_INDEX');
    expect(kinds).toContain('DROP_INDEX');
    expect(kinds).not.toContain('CREATE_TABLE'); // PRIMARY unchanged -> no noise
    expect(diff.find((d) => d.kind === 'ADD_INDEX')?.statement).toBe(
      'ALTER TABLE `t` ADD INDEX `idx_new` (`c`);',
    );
  });

  it('emits ADD UNIQUE for a unique index', () => {
    const desired = schemaOf('CREATE TABLE t (e VARCHAR(50), UNIQUE KEY uq_e (e));');
    const current = schemaOf('CREATE TABLE t (e VARCHAR(50));');
    expect(diffSchemas(desired, current)[0].statement).toBe(
      'ALTER TABLE `t` ADD UNIQUE `uq_e` (`e`);',
    );
  });

  it('produces no diff for identical schemas', () => {
    const sql = 'CREATE TABLE t (id INT, email VARCHAR(255) NOT NULL, PRIMARY KEY (id));';
    expect(diffSchemas(schemaOf(sql), schemaOf(sql))).toEqual([]);
  });

  it('does NOT drop tables present only in the target (pass-1 §4.3)', () => {
    const desired = schemaOf('CREATE TABLE keep (id INT);');
    const current = schemaOf('CREATE TABLE keep (id INT); CREATE TABLE extra (id INT);');
    expect(diffSchemas(desired, current)).toEqual([]);
  });
});
