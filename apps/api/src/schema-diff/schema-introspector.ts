import { Connection } from 'mysql2/promise';
import { ColumnDef, IndexDef, Schema, TableDef, normalizeType } from './schema-model';

interface ColumnRow {
  TABLE_NAME: string;
  COLUMN_NAME: string;
  COLUMN_TYPE: string;
  IS_NULLABLE: 'YES' | 'NO';
  COLUMN_DEFAULT: string | null;
  EXTRA: string;
}

interface IndexRow {
  TABLE_NAME: string;
  INDEX_NAME: string;
  NON_UNIQUE: number;
  SEQ_IN_INDEX: number;
  COLUMN_NAME: string;
}

/**
 * Reads the live schema of a database from `information_schema` into the
 * normalized {@link Schema} model. Only base tables, their columns and indexes
 * are read (FKs/triggers/etc. are out of the Plan 4 scope).
 */
export async function introspectSchema(connection: Connection, database: string): Promise<Schema> {
  const [columnRows] = await connection.query(
    `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ?
      ORDER BY TABLE_NAME, ORDINAL_POSITION`,
    [database],
  );
  const [indexRows] = await connection.query(
    `SELECT s.TABLE_NAME, s.INDEX_NAME, s.NON_UNIQUE, s.SEQ_IN_INDEX, s.COLUMN_NAME
       FROM information_schema.STATISTICS s
       JOIN information_schema.TABLES t
         ON t.TABLE_SCHEMA = s.TABLE_SCHEMA AND t.TABLE_NAME = s.TABLE_NAME
      WHERE s.TABLE_SCHEMA = ? AND t.TABLE_TYPE = 'BASE TABLE'
      ORDER BY s.TABLE_NAME, s.INDEX_NAME, s.SEQ_IN_INDEX`,
    [database],
  );

  return buildSchema(columnRows as ColumnRow[], indexRows as IndexRow[]);
}

/** Pure assembler — exposed for unit testing without a live connection. */
export function buildSchema(columnRows: ColumnRow[], indexRows: IndexRow[]): Schema {
  const schema: Schema = new Map();

  const tableOf = (name: string): TableDef => {
    let table = schema.get(name);
    if (!table) {
      table = { name, columns: [], indexes: [] };
      schema.set(name, table);
    }
    return table;
  };

  for (const row of columnRows) {
    const column: ColumnDef = {
      name: row.COLUMN_NAME,
      type: normalizeType(row.COLUMN_TYPE),
      nullable: row.IS_NULLABLE === 'YES',
      raw: row.COLUMN_TYPE,
    };
    tableOf(row.TABLE_NAME).columns.push(column);
  }

  // Group index rows (one row per column) into composite IndexDefs.
  const indexAccumulator = new Map<string, IndexDef>();
  for (const row of indexRows) {
    tableOf(row.TABLE_NAME); // ensure table exists even if it had no columns row
    const key = `${row.TABLE_NAME}.${row.INDEX_NAME}`;
    let index = indexAccumulator.get(key);
    if (!index) {
      index = { name: row.INDEX_NAME, columns: [], unique: row.NON_UNIQUE === 0 };
      indexAccumulator.set(key, index);
      tableOf(row.TABLE_NAME).indexes.push(index);
    }
    index.columns.push(row.COLUMN_NAME);
  }

  return schema;
}
