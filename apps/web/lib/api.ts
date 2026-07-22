import type { Role } from '@/lib/auth';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3001';

// ---------------------------------------------------------------------------
// Auth token helpers (재사용 가능한 인증 토큰 방식 — login 페이지가 저장한 값)
// ---------------------------------------------------------------------------
export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('accessToken');
}

function authHeaders(): Record<string, string> {
  const token = getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * 모든 인증 API 호출의 단일 진입점.
 * - accessToken을 Authorization 헤더로 주입
 * - 401이면 세션 정리 후 로그인으로 이동
 * - 에러 응답 본문의 message를 최대한 살려서 ApiError로 변환
 */
async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...init?.headers,
    },
  });

  if (res.status === 401 && typeof window !== 'undefined') {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('user');
    window.location.href = '/login';
    throw new ApiError(401, '세션이 만료되었습니다. 다시 로그인해 주세요.');
  }

  if (!res.ok) {
    let message = `요청에 실패했습니다. (${res.status})`;
    try {
      const data = await res.json();
      if (data?.message) {
        message = Array.isArray(data.message) ? data.message.join(', ') : String(data.message);
      }
    } catch {
      // JSON이 아닌 에러 본문은 무시하고 기본 메시지 사용
    }
    throw new ApiError(res.status, message);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
export async function login(email: string, password: string) {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error('로그인에 실패했습니다.');
  return res.json() as Promise<{
    accessToken: string;
    user: { id: string; email: string; name: string; role: string; department: string };
  }>;
}

// ---------------------------------------------------------------------------
// User 도메인 타입
// ---------------------------------------------------------------------------
export type UserSummary = {
  id: string;
  name: string;
  department: string;
};

export type AdminUserInput = {
  email: string;
  name: string;
  department: string;
  password: string;
  role: Role;
};

// ---------------------------------------------------------------------------
// Change Request 도메인 타입 (docs/plan2-api-contract.md 합의안 기준)
// ---------------------------------------------------------------------------
export type TargetEnv = 'DEV' | 'STAGING' | 'PROD';
export type SqlType = 'DDL' | 'DML';

export type ChangeRequestStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'REVIEW_APPROVED'
  | 'REVIEW_REJECTED'
  | 'FINAL_APPROVED'
  | 'FINAL_REJECTED'
  | 'APPLIED';

export type ReviewDecision = 'APPROVE' | 'REJECT';

export type ChangeRequestSummary = {
  id: string;
  title: string;
  targetEnv: TargetEnv;
  status: ChangeRequestStatus;
  authorId: string;
  /** 서버가 비정규화해 내려주는 표시 이름. 미제공 시 authorId로 폴백. */
  authorName?: string;
  reviewerId?: string | null;
  reviewerName?: string | null;
  /** 지정된 결재자 이름 목록(순서대로). 이름 미제공 결재자는 null. */
  approverNames: (string | null)[];
  approvalProgress: { approved: number; required: number };
  /** 현재 로그인 사용자가 이 CR의 결재자로 지정되어 있고 아직 결정하지 않았는지 여부. */
  myApprovalPending: boolean;
  createdAt: string;
  updatedAt: string;
};

/** 생성 요청에 보내는 파일 (서버가 order를 자동 부여). */
export type ChangeRequestFileInput = {
  filename: string;
  sqlType: SqlType;
  content: string;
};

/** 상세 응답의 파일 (서버 부여 필드 포함). */
export type ChangeRequestFile = ChangeRequestFileInput & {
  id: string;
  changeRequestId: string;
  order: number;
};

export type StatusHistoryEntry = {
  id: string;
  changeRequestId: string;
  fromStatus: ChangeRequestStatus;
  toStatus: ChangeRequestStatus;
  actorId: string;
  /** 서버가 비정규화해 내려주는 표시 이름. 미제공 시 actorId로 폴백. */
  actorName?: string;
  comment: string | null;
  createdAt: string;
};

export type ChangeRequestApprover = {
  userId: string;
  name: string | null;
  department: string | null;
  order: number;
  decision: ReviewDecision | null;
  comment: string | null;
  decidedAt: string | null;
  /** 대리 결재로 결정된 경우 실제 결정자 이름(본인 결정 시 null). */
  decidedBy: string | null;
};

export type ChangeRequestDetail = Omit<ChangeRequestSummary, 'approverNames' | 'approvalProgress' | 'myApprovalPending'> & {
  description: string;
  files: ChangeRequestFile[];
  statusHistory: StatusHistoryEntry[];
  approvers: ChangeRequestApprover[];
  /** 현재 로그인 사용자가 부재 위임을 통해 이 CR의 검토/결재를 대신 수행할 수 있는지 여부. */
  canActAsDelegate: boolean;
  /** 현재 로그인 사용자가 이 CR에 대해 이미 결정을 내렸는지(직접 또는 대리) 여부. */
  iAlreadyActed: boolean;
};

export type CreateChangeRequestInput = {
  title: string;
  description: string;
  targetEnv: TargetEnv;
  files: ChangeRequestFileInput[];
  reviewerId?: string;
  approverIds?: string[];
};

// ---------------------------------------------------------------------------
// Change Request API 클라이언트
// ---------------------------------------------------------------------------
export function listChangeRequests() {
  return apiFetch<ChangeRequestSummary[]>('/change-requests');
}

export function getChangeRequest(id: string) {
  return apiFetch<ChangeRequestDetail>(`/change-requests/${encodeURIComponent(id)}`);
}

export function createChangeRequest(input: CreateChangeRequestInput) {
  return apiFetch<ChangeRequestDetail>('/change-requests', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function submitChangeRequest(id: string) {
  return apiFetch<ChangeRequestDetail>(`/change-requests/${encodeURIComponent(id)}/submit`, {
    method: 'POST',
  });
}

/** REVIEWER 1차 검토 */
export function reviewChangeRequest(id: string, decision: ReviewDecision, comment: string) {
  return apiFetch<ChangeRequestDetail>(`/change-requests/${encodeURIComponent(id)}/review`, {
    method: 'POST',
    body: JSON.stringify({ decision, comment }),
  });
}

/** APPROVER 최종 결재 */
export function approveChangeRequest(id: string, decision: ReviewDecision, comment: string) {
  return apiFetch<ChangeRequestDetail>(`/change-requests/${encodeURIComponent(id)}/approve`, {
    method: 'POST',
    body: JSON.stringify({ decision, comment }),
  });
}

// ---------------------------------------------------------------------------
// Plan 3 — 대상 DB 레지스트리 + 적용 엔진 (docs/plan3-apply-contract.md 기준)
// ---------------------------------------------------------------------------
export type DbType = 'MYSQL' | 'POSTGRES' | 'MARIADB' | 'ORACLE';
export type ExecutionStatus = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED';

/** 응답 형태(sanitized). 비밀번호는 어떤 응답에도 포함되지 않습니다. */
export type TargetDatabase = {
  id: string;
  name: string;
  env: TargetEnv;
  dbType: DbType;
  host: string;
  port: number;
  username: string;
  database: string;
  createdAt: string;
  updatedAt: string;
};

/** 등록 요청. password는 쓰기 전용(요청에서만 평문 전달). */
export type CreateTargetDatabaseInput = {
  name: string;
  env: TargetEnv;
  dbType: DbType;
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
};

/** 부분 수정. password 미포함 시 기존 유지, 포함 시 재암호화. */
export type UpdateTargetDatabaseInput = Partial<CreateTargetDatabaseInput>;

/** 연결 테스트 결과. 성공/실패 모두 HTTP 200으로 내려옵니다. */
export type TestConnectionResult =
  | { success: true; serverVersion: string; latencyMs: number }
  | { success: false; error: string };

export type ExecutionStep = {
  id: string;
  executionId: string;
  filename: string;
  order: number;
  status: ExecutionStatus;
  error: string | null;
  rowsAffected: number | null;
  durationMs: number | null;
};

export type Execution = {
  id: string;
  changeRequestId: string;
  targetDatabaseId: string;
  status: ExecutionStatus;
  startedAt: string | null;
  finishedAt: string | null;
  triggeredById: string;
  createdAt: string;
  steps: ExecutionStep[];
  /** Plan 5: 적용(APPLY) / 롤백(ROLLBACK) 구분. 미제공 시 APPLY로 간주. */
  kind?: ExecutionKind;
  /** Plan 5: 적용 직전 생성된 백업 1:1 연결. */
  backupId?: string | null;
};

// ---------------------------------------------------------------------------
// 대상 DB 레지스트리 API (전부 APPROVER 권한)
// ---------------------------------------------------------------------------
export function listTargetDatabases() {
  return apiFetch<TargetDatabase[]>('/target-databases');
}

export function getTargetDatabase(id: string) {
  return apiFetch<TargetDatabase>(`/target-databases/${encodeURIComponent(id)}`);
}

export function createTargetDatabase(input: CreateTargetDatabaseInput) {
  return apiFetch<TargetDatabase>('/target-databases', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateTargetDatabase(id: string, input: UpdateTargetDatabaseInput) {
  return apiFetch<TargetDatabase>(`/target-databases/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function deleteTargetDatabase(id: string) {
  return apiFetch<{ id: string; deleted: boolean }>(`/target-databases/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

/** 저장된 자격증명으로 실제 연결을 시도합니다(SELECT 1). */
export function testTargetDatabaseConnection(id: string) {
  return apiFetch<TestConnectionResult>(
    `/target-databases/${encodeURIComponent(id)}/test-connection`,
    { method: 'POST' },
  );
}

// ---------------------------------------------------------------------------
// 적용 엔진 API
// ---------------------------------------------------------------------------
/**
 * 변경요청을 대상 DB에 적용합니다.
 * 권한: DEV는 해당 CR author(DEVELOPER) 또는 APPROVER, STAGING|PROD는 APPROVER만.
 * 실패해도 HTTP 200이며, 성공 여부는 반환된 Execution.status로 판단합니다.
 */
export function applyChangeRequest(id: string, targetDatabaseId: string) {
  return apiFetch<Execution>(`/change-requests/${encodeURIComponent(id)}/apply`, {
    method: 'POST',
    body: JSON.stringify({ targetDatabaseId }),
  });
}

/** 적용 이력 조회 (인증된 모든 역할, 읽기 전용). createdAt DESC. */
export function listExecutions(id: string) {
  return apiFetch<Execution[]>(`/change-requests/${encodeURIComponent(id)}/executions`);
}

// ---------------------------------------------------------------------------
// Plan 4 — 스키마 Diff 생성기 (docs/plan4-schema-diff-contract.md 기준)
// ---------------------------------------------------------------------------
export type DiffKind =
  | 'CREATE_TABLE'
  | 'ADD_COLUMN'
  | 'DROP_COLUMN'
  | 'MODIFY_COLUMN'
  | 'ADD_INDEX'
  | 'DROP_INDEX'
  | 'DROP_TABLE';

export type DiffItem = {
  kind: DiffKind;
  table: string;
  /** 실행 가능한 DDL 한 문장 */
  statement: string;
  sqlType: 'DDL';
  /** 파괴적 변경(DROP_TABLE/DROP_COLUMN) 여부 */
  destructive: boolean;
};

export type CurrentSnapshotSummary = {
  database: string;
  tableCount: number;
  tables: { name: string; columns: number; indexes: number }[];
};

export type SchemaDiffPreviewInput = {
  targetDatabaseId: string;
  /** CREATE TABLE 문 모음(여러 문장 `;` 구분) */
  desiredSchemaSql: string;
};

export type SchemaDiffPreviewResult = {
  targetDatabaseId: string;
  currentSnapshotSummary: CurrentSnapshotSummary;
  diff: DiffItem[];
  hasChanges: boolean;
};

export type ApplyToChangeRequestInput = SchemaDiffPreviewInput & {
  title: string;
  description: string;
};

/**
 * 기준 스키마와 대상 DB 실제 스키마의 차이를 DDL로 미리봅니다.
 * 권한: DEVELOPER(env === DEV 대상만) 또는 APPROVER(전체).
 */
export function previewSchemaDiff(input: SchemaDiffPreviewInput) {
  return apiFetch<SchemaDiffPreviewResult>('/schema-diff/preview', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/**
 * 산출된 차이를 DRAFT 변경요청으로 생성합니다(DEVELOPER, 대상은 DEV만).
 * 차이가 없으면 서버가 409를 반환합니다.
 */
export function applySchemaDiffToChangeRequest(input: ApplyToChangeRequestInput) {
  return apiFetch<ChangeRequestDetail>('/schema-diff/apply-to-change-request', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// ---------------------------------------------------------------------------
// Plan 5 — 적용 안전장치 (docs/plan5-apply-safety-contract.md 기준)
// ---------------------------------------------------------------------------
export type LintSeverity = 'INFO' | 'WARN' | 'BLOCK';
export type ExecutionKind = 'APPLY' | 'ROLLBACK';
export type BackupScope = 'SCHEMA_AND_DATA' | 'SCHEMA_ONLY';
export type BackupStatus = 'SUCCESS' | 'PARTIAL' | 'FAILED';
/** Dry-run 파일 처리 방식: 순수 DML은 트랜잭션 롤백 측정, DDL 포함은 정적 분류. */
export type DryRunMode = 'DML_TX_ROLLBACK' | 'DDL_STATIC';

export type LintItem = {
  filename: string;
  line?: number;
  rule: string;
  /** 환경정책(DEV는 BLOCK→WARN 강등)이 반영된 effective severity. */
  severity: LintSeverity;
  message: string;
};

export type LintResult = {
  changeRequestId: string;
  targetEnv: TargetEnv;
  items: LintItem[];
  maxSeverity: LintSeverity;
};

export type DryRunFile = {
  filename: string;
  mode: DryRunMode;
  /** DML_TX_ROLLBACK일 때만 측정값 제공. */
  affectedRows?: number;
  impact: string;
  destructive: boolean;
};

export type DryRunResult = {
  changeRequestId: string;
  targetDatabaseId: string;
  perFile: DryRunFile[];
};

/** 적용 직전 자동 생성되는 백업(스냅샷 payload는 응답에 미포함). */
export type Backup = {
  id: string;
  changeRequestId: string;
  targetDatabaseId: string;
  executionId: string | null;
  scope: BackupScope;
  status: BackupStatus;
  location: 'DB';
  sizeBytes: number;
  /** 강등/경고 사유 */
  note: string | null;
  createdAt: string;
};

/**
 * CR 파일 전체를 정적 분석해 위험 SQL을 린트합니다(환경정책 반영).
 * STAGING|PROD에서 effective BLOCK이 있으면 적용이 거부됩니다.
 */
export function lintChangeRequest(id: string) {
  return apiFetch<LintResult>(`/change-requests/${encodeURIComponent(id)}/lint`, {
    method: 'POST',
  });
}

/** 적용 영향 미리보기(DML은 트랜잭션 롤백으로 affectedRows 측정, DDL은 미실행 정적 분류). */
export function dryRunChangeRequest(id: string, targetDatabaseId: string) {
  return apiFetch<DryRunResult>(`/change-requests/${encodeURIComponent(id)}/dry-run`, {
    method: 'POST',
    body: JSON.stringify({ targetDatabaseId }),
  });
}

/** 백업 목록 (payload 제외, createdAt DESC). */
export function listBackups(id: string) {
  return apiFetch<Backup[]>(`/change-requests/${encodeURIComponent(id)}/backups`);
}

/**
 * 적용(APPLY) Execution에 연결된 백업 기준으로 롤백합니다.
 * 권한: APPROVER, targetEnv === DEV면 해당 CR author(DEVELOPER)도 가능.
 * kind=ROLLBACK인 새 Execution으로 추적됩니다.
 */
export function rollbackExecution(executionId: string) {
  return apiFetch<Execution>(`/executions/${encodeURIComponent(executionId)}/rollback`, {
    method: 'POST',
  });
}

// ---------------------------------------------------------------------------
// User API
// ---------------------------------------------------------------------------
export function listUsersByRole(role: 'REVIEWER' | 'APPROVER') {
  return apiFetch<UserSummary[]>(`/users?role=${role}`);
}

export function createUser(input: AdminUserInput) {
  return apiFetch<{ id: string }>(`/users`, { method: 'POST', body: JSON.stringify(input) });
}

export type AdminUser = { id: string; email: string; name: string; department: string; role: Role; createdAt: string };
export type Paginated<T> = { items: T[]; total: number; page: number; pageSize: number };

/** 전 역할 페이징 목록 (ADMIN 전용). role=''(전체)은 미전송해 @IsEnum 400을 회피한다. */
export function adminListUsers(params: { page?: number; role?: Role | ''; q?: string }) {
  const qs = new URLSearchParams();
  if (params.page) qs.set('page', String(params.page));
  if (params.role) qs.set('role', params.role);
  if (params.q && params.q.trim()) qs.set('q', params.q.trim());
  return apiFetch<Paginated<AdminUser>>(`/users/admin?${qs.toString()}`);
}

export function getMyProfile() {
  return apiFetch<{ id: string; email: string; name: string; department: string; role: Role; telegramLinked: boolean }>(`/users/me`);
}

export function updateMyProfile(patch: { name?: string; department?: string; telegramChatId?: string }) {
  return apiFetch<unknown>(`/users/me`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function setAssignees(id: string, patch: { reviewerId?: string; approverIds?: string[] }) {
  return apiFetch<unknown>(`/change-requests/${id}/assignees`, { method: 'PATCH', body: JSON.stringify(patch) });
}

// ---------------------------------------------------------------------------
// 감사 로그 API (ADMIN 전용, apps/api/src/audit 기준)
// ---------------------------------------------------------------------------
export type AuditLogRow = {
  id: string;
  createdAt: string;
  actorId: string | null;
  actorName: string | null;
  actorRole: string | null;
  actorDept: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  summary: string;
  metadata: unknown;
  outcome: 'SUCCESS' | 'FAILURE';
  ip: string | null;
  userAgent: string | null;
};

export type AuditQuery = {
  actor?: string;
  action?: string;
  targetType?: string;
  outcome?: string;
  from?: string;
  to?: string;
  page?: number;
};

function auditQueryParams(q: AuditQuery): URLSearchParams {
  return new URLSearchParams(
    Object.entries(q).filter(([, v]) => v != null && v !== '') as [string, string][],
  );
}

export function listAuditLogs(q: AuditQuery) {
  return apiFetch<{ items: AuditLogRow[]; total: number; page: number; pageSize: number }>(
    `/audit-logs?${auditQueryParams(q).toString()}`,
  );
}

/**
 * CSV/JSON 내보내기는 ADMIN 인증이 필요해 `<a href>` 새 창 방식으로는 토큰을 실을 수 없다.
 * apiFetch와 동일하게 Authorization 헤더를 실어 blob으로 받은 뒤 브라우저 다운로드를 트리거한다.
 */
export async function downloadAuditExport(q: AuditQuery, format: 'csv' | 'json') {
  const params = auditQueryParams(q);
  params.set('format', format);
  const res = await fetch(`${API_BASE}/audit-logs/export?${params.toString()}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new ApiError(res.status, `내보내기에 실패했습니다. (${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `audit-logs.${format}`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// SQL 리뷰 정책 API (ADMIN 전용)
// ---------------------------------------------------------------------------
export type SqlReviewLevel = 'DISABLED' | 'INFO' | 'WARN' | 'BLOCK';
export type SqlReviewRuleRow = {
  ruleKey: string;
  base: string;
  message: string;
  levels: { DEV: SqlReviewLevel; STAGING: SqlReviewLevel; PROD: SqlReviewLevel };
};

export function listSqlReviewPolicy() {
  return apiFetch<SqlReviewRuleRow[]>(`/sql-review-policy`);
}

export function updateSqlReviewPolicy(env: string, ruleKey: string, level: SqlReviewLevel) {
  return apiFetch<unknown>(`/sql-review-policy`, {
    method: 'PATCH',
    body: JSON.stringify({ env, ruleKey, level }),
  });
}

// ---------------------------------------------------------------------------
// 결재 정책 API (ADMIN 전용)
// ---------------------------------------------------------------------------
export type ApprovalPolicyRow = { env: 'DEV' | 'STAGING' | 'PROD'; requiredApprovals: number };

export function listApprovalPolicy() {
  return apiFetch<ApprovalPolicyRow[]>(`/approval-policy`);
}

export function updateApprovalPolicy(env: string, requiredApprovals: number) {
  return apiFetch<unknown>(`/approval-policy`, {
    method: 'PATCH',
    body: JSON.stringify({ env, requiredApprovals }),
  });
}

// ---------------------------------------------------------------------------
// 작업창 · 동결 기간 API (ADMIN 전용)
// ---------------------------------------------------------------------------
export type ApplyWindowRow = { id: string; env: TargetEnv; dayOfWeek: number; startMinute: number; endMinute: number };
export type FreezePeriodRow = {
  id: string; env: TargetEnv; startsAt: string; endsAt: string; reason: string;
  createdBy?: { name: string | null };
};
export type ApplySchedule = { windows: ApplyWindowRow[]; freezes: FreezePeriodRow[]; serverTime: string; timezone: string };
export type ScheduleStatus = {
  allowed: boolean;
  reason?: 'FROZEN' | 'OUT_OF_WINDOW';
  nextWindow?: { dayOfWeek: number; startMinute: number; endMinute: number } | null;
  freeze?: { reason: string; endsAt: string };
};

export function getApplySchedule() { return apiFetch<ApplySchedule>(`/apply-schedule`); }
export function getScheduleStatus(env: TargetEnv) { return apiFetch<ScheduleStatus>(`/apply-schedule/status?env=${env}`); }
export function createApplyWindow(input: { env: TargetEnv; dayOfWeek: number; startMinute: number; endMinute: number }) {
  return apiFetch<ApplyWindowRow>(`/apply-schedule/windows`, { method: 'POST', body: JSON.stringify(input) });
}
export function deleteApplyWindow(id: string) {
  return apiFetch<unknown>(`/apply-schedule/windows/${id}`, { method: 'DELETE' });
}
export function createFreeze(input: { env: TargetEnv; startsAt: string; endsAt: string; reason: string }) {
  return apiFetch<FreezePeriodRow>(`/apply-schedule/freezes`, { method: 'POST', body: JSON.stringify(input) });
}
export function deleteFreeze(id: string) {
  return apiFetch<unknown>(`/apply-schedule/freezes/${id}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// 부재 위임 API (REVIEWER·APPROVER·ADMIN)
// ---------------------------------------------------------------------------
export type DelegationRow = {
  id: string; startsAt: string; endsAt: string; reason: string | null;
  delegator: { name: string | null; role: string };
  delegate: { name: string | null; role: string };
  createdBy: { name: string | null };
};

export function listDelegations() { return apiFetch<DelegationRow[]>(`/delegations`); }
export function createDelegation(input: { delegatorId?: string; delegateId: string; startsAt: string; endsAt: string; reason?: string }) {
  return apiFetch<DelegationRow>(`/delegations`, { method: 'POST', body: JSON.stringify(input) });
}
export function deleteDelegation(id: string) {
  return apiFetch<unknown>(`/delegations/${id}`, { method: 'DELETE' });
}
