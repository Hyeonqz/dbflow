/**
 * Normalized, source-agnostic representation of a relational schema. Both the
 * live-DB introspector and the desired-DDL parser produce this shape so the
 * diff engine can compare them without knowing their origin.
 */

export interface ColumnDef {
  name: string;
  /** Normalized SQL type for comparison, e.g. `int`, `varchar(255)` (lower-cased). */
  type: string;
  nullable: boolean;
  /** Original column definition text, used to emit ADD/MODIFY statements. */
  raw: string;
}

export interface IndexDef {
  /** Index name. `PRIMARY` for the primary key. */
  name: string;
  columns: string[];
  unique: boolean;
}

export interface TableDef {
  name: string;
  columns: ColumnDef[];
  indexes: IndexDef[];
  /** Original `CREATE TABLE` statement (desired side only) for CREATE_TABLE emission. */
  rawCreateStatement?: string;
}

/** A whole schema keyed by table name. */
export type Schema = Map<string, TableDef>;

export type DiffKind =
  | 'CREATE_TABLE'
  | 'ADD_COLUMN'
  | 'DROP_COLUMN'
  | 'MODIFY_COLUMN'
  | 'ADD_INDEX'
  | 'DROP_INDEX'
  | 'DROP_TABLE';

export interface DiffItem {
  kind: DiffKind;
  table: string;
  statement: string;
  sqlType: 'DDL';
  destructive: boolean;
}

export interface CurrentSnapshotSummary {
  database: string;
  tableCount: number;
  tables: { name: string; columns: number; indexes: number }[];
}

/** Lower-cases and collapses whitespace for textual type/identifier comparison. */
export function normalizeType(type: string): string {
  return type.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Builds the snapshot summary the preview endpoint returns. */
export function summarize(database: string, current: Schema): CurrentSnapshotSummary {
  const tables = [...current.values()].map((t) => ({
    name: t.name,
    columns: t.columns.length,
    indexes: t.indexes.length,
  }));
  return { database, tableCount: tables.length, tables };
}
