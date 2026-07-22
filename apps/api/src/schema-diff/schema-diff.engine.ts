import { DiffItem, IndexDef, Schema, TableDef } from './schema-model';

/**
 * Compares a desired schema against the current one and emits the DDL needed to
 * move current → desired. Pass-1 scope (contract §4.1):
 *  - tables in desired but not current → CREATE_TABLE
 *  - columns: ADD / DROP / MODIFY (type or nullability change)
 *  - indexes (non-PRIMARY, by name): ADD / DROP
 * Tables present only in current are left alone (no DROP_TABLE — §4.3).
 */
export function diffSchemas(desired: Schema, current: Schema): DiffItem[] {
  const items: DiffItem[] = [];

  for (const [tableName, desiredTable] of desired) {
    const currentTable = current.get(tableName);

    if (!currentTable) {
      items.push({
        kind: 'CREATE_TABLE',
        table: tableName,
        statement: desiredTable.rawCreateStatement ?? buildCreateStatement(desiredTable),
        sqlType: 'DDL',
        destructive: false,
      });
      continue;
    }

    items.push(...diffColumns(tableName, desiredTable, currentTable));
    items.push(...diffIndexes(tableName, desiredTable, currentTable));
  }

  return items;
}

function diffColumns(table: string, desired: TableDef, current: TableDef): DiffItem[] {
  const items: DiffItem[] = [];
  const currentByName = new Map(current.columns.map((c) => [c.name, c]));
  const desiredByName = new Map(desired.columns.map((c) => [c.name, c]));

  // Additions and modifications, in desired order.
  for (const dcol of desired.columns) {
    const ccol = currentByName.get(dcol.name);
    if (!ccol) {
      items.push({
        kind: 'ADD_COLUMN',
        table,
        statement: `ALTER TABLE \`${table}\` ADD COLUMN ${dcol.raw};`,
        sqlType: 'DDL',
        destructive: false,
      });
    } else if (ccol.type !== dcol.type || ccol.nullable !== dcol.nullable) {
      items.push({
        kind: 'MODIFY_COLUMN',
        table,
        statement: `ALTER TABLE \`${table}\` MODIFY COLUMN ${dcol.raw};`,
        sqlType: 'DDL',
        destructive: false,
      });
    }
  }

  // Drops, in current order.
  for (const ccol of current.columns) {
    if (!desiredByName.has(ccol.name)) {
      items.push({
        kind: 'DROP_COLUMN',
        table,
        statement: `ALTER TABLE \`${table}\` DROP COLUMN \`${ccol.name}\`;`,
        sqlType: 'DDL',
        destructive: true,
      });
    }
  }

  return items;
}

function diffIndexes(table: string, desired: TableDef, current: TableDef): DiffItem[] {
  const items: DiffItem[] = [];
  const named = (i: IndexDef) => i.name && i.name !== 'PRIMARY';
  const currentByName = new Map(current.indexes.filter(named).map((i) => [i.name, i]));
  const desiredByName = new Map(desired.indexes.filter(named).map((i) => [i.name, i]));

  for (const [name, didx] of desiredByName) {
    if (!currentByName.has(name)) {
      items.push({
        kind: 'ADD_INDEX',
        table,
        statement: buildAddIndex(table, didx),
        sqlType: 'DDL',
        destructive: false,
      });
    }
  }

  for (const [name] of currentByName) {
    if (!desiredByName.has(name)) {
      items.push({
        kind: 'DROP_INDEX',
        table,
        statement: `ALTER TABLE \`${table}\` DROP INDEX \`${name}\`;`,
        sqlType: 'DDL',
        destructive: false,
      });
    }
  }

  return items;
}

function buildAddIndex(table: string, index: IndexDef): string {
  const cols = index.columns.map((c) => `\`${c}\``).join(', ');
  const kind = index.unique ? 'ADD UNIQUE' : 'ADD INDEX';
  return `ALTER TABLE \`${table}\` ${kind} \`${index.name}\` (${cols});`;
}

/** Fallback CREATE for a desired table lacking its original statement. */
function buildCreateStatement(table: TableDef): string {
  const cols = table.columns.map((c) => `  ${c.raw}`).join(',\n');
  return `CREATE TABLE \`${table.name}\` (\n${cols}\n);`;
}
