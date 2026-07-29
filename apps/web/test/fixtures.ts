import type {
  Backup,
  ChangeRequestDetail,
  Execution,
  LintResult,
  TargetDatabase,
} from '@/lib/api';
import type { User } from '@/lib/auth';

export function makeUser(over: Partial<User> = {}): User {
  return {
    id: 'u-dev',
    email: 'dev@dbflow.io',
    name: 'Dev',
    department: 'Platform',
    role: 'DEVELOPER',
    ...over,
  };
}

export function makeCr(over: Partial<ChangeRequestDetail> = {}): ChangeRequestDetail {
  return {
    id: 'cr1',
    title: 'Add index on orders',
    targetEnv: 'DEV',
    status: 'DRAFT',
    authorId: 'u-dev',
    authorName: 'Dev',
    reviewerId: 'u-rev',
    reviewerName: 'Rev',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    description: 'ops-42',
    files: [
      {
        id: 'f1',
        changeRequestId: 'cr1',
        order: 0,
        filename: '001_add_index.sql',
        sqlType: 'DDL',
        content: 'CREATE INDEX idx_orders_created ON orders (created_at);',
      },
    ],
    statusHistory: [],
    approvers: [],
    canActAsDelegate: false,
    iAlreadyActed: false,
    ...over,
  };
}

export function makeTargetDb(over: Partial<TargetDatabase> = {}): TargetDatabase {
  return {
    id: 'db1',
    name: 'orders-dev',
    env: 'DEV',
    dbType: 'MYSQL',
    host: 'localhost',
    port: 3306,
    username: 'app',
    database: 'orders',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...over,
  };
}

export function makeLint(over: Partial<LintResult> = {}): LintResult {
  return { changeRequestId: 'cr1', targetEnv: 'DEV', items: [], maxSeverity: 'INFO', ...over };
}

export function makeExecution(over: Partial<Execution> = {}): Execution {
  return {
    id: 'ex1',
    changeRequestId: 'cr1',
    targetDatabaseId: 'db1',
    status: 'SUCCESS',
    startedAt: '2026-07-01T00:00:00.000Z',
    finishedAt: '2026-07-01T00:00:01.000Z',
    triggeredById: 'u-appr',
    createdAt: '2026-07-01T00:00:00.000Z',
    steps: [],
    kind: 'APPLY',
    backupId: 'b1',
    ...over,
  };
}

export function makeBackup(over: Partial<Backup> = {}): Backup {
  return {
    id: 'b1',
    changeRequestId: 'cr1',
    targetDatabaseId: 'db1',
    executionId: 'ex1',
    scope: 'SCHEMA_AND_DATA',
    status: 'SUCCESS',
    location: 'DB',
    sizeBytes: 2048,
    note: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    ...over,
  };
}
