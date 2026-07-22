import { parseDesiredSchema } from './desired-schema-parser';

describe('parseDesiredSchema', () => {
  it('parses a basic table with columns and a PRIMARY KEY line', () => {
    const schema = parseDesiredSchema(`
      CREATE TABLE users (
        id INT NOT NULL AUTO_INCREMENT,
        email VARCHAR(255) NOT NULL,
        name VARCHAR(100) NULL,
        PRIMARY KEY (id)
      );
    `);

    const users = schema.get('users')!;
    expect(users).toBeDefined();
    expect(users.columns.map((c) => c.name)).toEqual(['id', 'email', 'name']);

    const email = users.columns.find((c) => c.name === 'email')!;
    expect(email.type).toBe('varchar(255)');
    expect(email.nullable).toBe(false);

    const name = users.columns.find((c) => c.name === 'name')!;
    expect(name.nullable).toBe(true);

    expect(users.indexes.find((i) => i.name === 'PRIMARY')?.columns).toEqual(['id']);
  });

  it('handles IF NOT EXISTS, backticks, and types with commas in parens', () => {
    const schema = parseDesiredSchema(
      'CREATE TABLE IF NOT EXISTS `orders` (`id` INT, `amount` DECIMAL(10,2) NOT NULL);',
    );
    const orders = schema.get('orders')!;
    expect(orders.columns.map((c) => c.type)).toEqual(['int', 'decimal(10,2)']);
  });

  it('captures inline PRIMARY KEY as a non-nullable column + PRIMARY index', () => {
    const schema = parseDesiredSchema('CREATE TABLE t (id INT PRIMARY KEY, v VARCHAR(10));');
    const t = schema.get('t')!;
    expect(t.columns.find((c) => c.name === 'id')?.nullable).toBe(false);
    expect(t.indexes.find((i) => i.name === 'PRIMARY')?.columns).toEqual(['id']);
  });

  it('parses UNIQUE KEY and KEY index definitions with names', () => {
    const schema = parseDesiredSchema(`
      CREATE TABLE t (
        id INT,
        email VARCHAR(50),
        country VARCHAR(2),
        UNIQUE KEY uq_email (email),
        KEY idx_country (country)
      );
    `);
    const idx = schema.get('t')!.indexes;
    expect(idx.find((i) => i.name === 'uq_email')).toMatchObject({ unique: true, columns: ['email'] });
    expect(idx.find((i) => i.name === 'idx_country')).toMatchObject({
      unique: false,
      columns: ['country'],
    });
  });

  it('skips FOREIGN KEY / CONSTRAINT clauses', () => {
    const schema = parseDesiredSchema(`
      CREATE TABLE t (
        id INT,
        user_id INT,
        CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users (id)
      );
    `);
    const t = schema.get('t')!;
    expect(t.columns.map((c) => c.name)).toEqual(['id', 'user_id']);
    expect(t.indexes).toHaveLength(0);
  });

  it('parses multiple statements and ignores comments and non-CREATE statements', () => {
    const schema = parseDesiredSchema(`
      -- first table
      CREATE TABLE a (id INT);
      /* block comment */
      INSERT INTO a VALUES (1);
      CREATE TABLE b (id INT);
    `);
    expect([...schema.keys()].sort()).toEqual(['a', 'b']);
  });

  it('returns an empty schema when there is no CREATE TABLE', () => {
    expect(parseDesiredSchema('SELECT 1;').size).toBe(0);
  });
});
