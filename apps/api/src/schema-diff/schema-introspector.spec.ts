import { buildSchema } from './schema-introspector';

describe('buildSchema (information_schema assembler)', () => {
  const columnRows = [
    { TABLE_NAME: 'users', COLUMN_NAME: 'id', COLUMN_TYPE: 'int', IS_NULLABLE: 'NO', COLUMN_DEFAULT: null, EXTRA: 'auto_increment' },
    { TABLE_NAME: 'users', COLUMN_NAME: 'email', COLUMN_TYPE: 'varchar(255)', IS_NULLABLE: 'NO', COLUMN_DEFAULT: null, EXTRA: '' },
    { TABLE_NAME: 'users', COLUMN_NAME: 'bio', COLUMN_TYPE: 'TEXT', IS_NULLABLE: 'YES', COLUMN_DEFAULT: null, EXTRA: '' },
  ] as any;

  const indexRows = [
    { TABLE_NAME: 'users', INDEX_NAME: 'PRIMARY', NON_UNIQUE: 0, SEQ_IN_INDEX: 1, COLUMN_NAME: 'id' },
    { TABLE_NAME: 'users', INDEX_NAME: 'uq_email', NON_UNIQUE: 0, SEQ_IN_INDEX: 1, COLUMN_NAME: 'email' },
    { TABLE_NAME: 'users', INDEX_NAME: 'idx_combo', NON_UNIQUE: 1, SEQ_IN_INDEX: 1, COLUMN_NAME: 'email' },
    { TABLE_NAME: 'users', INDEX_NAME: 'idx_combo', NON_UNIQUE: 1, SEQ_IN_INDEX: 2, COLUMN_NAME: 'bio' },
  ] as any;

  it('groups columns under their table and normalizes the type', () => {
    const schema = buildSchema(columnRows, indexRows);
    const users = schema.get('users')!;
    expect(users.columns.map((c) => c.name)).toEqual(['id', 'email', 'bio']);
    expect(users.columns.find((c) => c.name === 'bio')).toMatchObject({
      type: 'text', // lower-cased
      nullable: true,
    });
  });

  it('assembles composite indexes in column order and flags uniqueness', () => {
    const schema = buildSchema(columnRows, indexRows);
    const idx = schema.get('users')!.indexes;
    expect(idx.find((i) => i.name === 'PRIMARY')).toMatchObject({ unique: true, columns: ['id'] });
    expect(idx.find((i) => i.name === 'uq_email')).toMatchObject({ unique: true });
    expect(idx.find((i) => i.name === 'idx_combo')).toMatchObject({
      unique: false,
      columns: ['email', 'bio'],
    });
  });
});
