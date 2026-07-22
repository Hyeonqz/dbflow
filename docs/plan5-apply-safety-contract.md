# Plan 5 — 적용 안전장치 (Apply Safety) API 계약

> 대상: DBFlow `apps/api` (NestJS + Prisma + mysql2)
> 상태: **FE/BE 공용 계약 (1순위 참조 문서)**
> 최종 수정: 2026-06-21
> 범위: 적용 엔진(Plan 3)을 확장하는 4개 안전축 — (A) 위험 SQL 린트, (B) Dry-run,
> (C) 자동 백업, (D) 롤백. 목표: 운영 DB 부분 실패/사고 리스크 제거.

Plan 2/3/4 계약을 보완합니다. 적용 흐름은 Plan 3을 그대로 잇되 **lint(BLOCK 차단) →
백업 생성 → 적용 → Execution에 backupId 연결** 순서로 강화됩니다.

---

## 1. 공통 규약

- Base URL: `http://localhost:3001`, JWT 필수, 가드 `AuthGuard('jwt')` → `RolesGuard`
- 권한은 Plan 3 규칙 재사용:
  - 적용/롤백 — `targetEnv === DEV`: **APPROVER 또는 해당 CR author(DEVELOPER)**.
    `STAGING|PROD`: **APPROVER만**.
  - lint/dry-run(읽기성, 파괴적이지 않음): 위와 동일 권한(적용 가능한 주체만 미리보기).
- 에러: 400 검증, 401 미인증, 403 권한, 404 리소스 없음,
  409 정책 위반(**BLOCK 린트 차단**, 상태/환경 위반, 백업/롤백 불가).

### 1.1 환경변수 추가
```
BACKUP_MAX_ROWS=100000   # 테이블당 데이터 스냅샷 최대 행수(초과 시 schema-only)
```

### 1.2 백업 저장 방식 (결정)
- **DB 저장**(단순/트랜잭셔널): `Backup.payload`(MySQL `LONGTEXT`, JSON 직렬화)에 스냅샷 보관.
  파일시스템 미사용. `location` 은 `"DB"` 고정, `sizeBytes` 는 payload 바이트 길이.

---

## 2. 도메인 enum / 모델

```
LintSeverity   : INFO | WARN | BLOCK          (린트 결과 — 저장 안 함, 계산값)
ExecutionKind  : APPLY | ROLLBACK             (Execution 구분 — 롤백도 Execution류로 추적)
BackupScope    : SCHEMA_AND_DATA | SCHEMA_ONLY
BackupStatus   : SUCCESS | PARTIAL | FAILED   (PARTIAL = 일부 테이블 schema-only로 강등)
```

### 2.1 Backup
```ts
interface Backup {
  id: string;
  changeRequestId: string;
  targetDatabaseId: string;
  executionId: string | null;   // 연결된 Execution(있으면). Execution.backupId 로도 역참조.
  scope: 'SCHEMA_AND_DATA' | 'SCHEMA_ONLY';
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  location: 'DB';
  sizeBytes: number;
  note: string | null;          // 강등/경고 사유
  createdAt: string;
  // payload(JSON 스냅샷)는 목록/상세 응답에 포함하지 않음(용량). 롤백 시 내부 사용.
}
```
payload(JSON) 내부 구조(서버 내부용, 응답 미노출):
```json
{
  "tables": [
    { "name": "users", "existedBefore": true, "schema": "CREATE TABLE `users` ( ... )",
      "dataIncluded": true, "rowCount": 3,
      "columns": ["id","email"], "rows": [[1,"a@x"],[2,"b@x"]] }
  ]
}
```

### 2.2 Execution 확장 (Plan 3)
- `kind: 'APPLY' | 'ROLLBACK'` (기본 APPLY)
- `backupId: string | null` (적용 직전 생성된 백업 1:1 연결)

---

## 3. (A) 위험 SQL 린트

### 3.1 규칙 (base severity)
| rule | 패턴 | base severity |
|------|------|---------------|
| `DROP_DATABASE` | `DROP DATABASE` | BLOCK |
| `DROP_TABLE` | `DROP TABLE` | BLOCK |
| `TRUNCATE` | `TRUNCATE [TABLE]` | BLOCK |
| `DELETE_WITHOUT_WHERE` | `DELETE FROM t` (WHERE 없음) | BLOCK |
| `UPDATE_WITHOUT_WHERE` | `UPDATE t SET ...` (WHERE 없음) | BLOCK |
| `ALTER_DROP_COLUMN` | `ALTER TABLE ... DROP COLUMN` | WARN |
| `DROP_INDEX` | `ALTER ... DROP INDEX` / `DROP INDEX` | INFO |

### 3.2 환경 정책 (effective severity)
- `targetEnv === DEV`: **BLOCK → WARN 으로 강등**(개발 반복 허용, 차단 안 함).
- `targetEnv === STAGING | PROD`: base 그대로. **effective BLOCK 존재 시 적용 거부(409)**.

### 3.3 `POST /change-requests/:id/lint`
- 권한: 해당 CR을 적용 가능한 주체(§1). CR의 파일 전체를 정적 분석.
- **Response `200`** (effective severity 반영, CR.targetEnv 기준)
```json
{
  "changeRequestId": "clx0cr0001",
  "targetEnv": "PROD",
  "items": [
    { "filename": "002_cleanup.sql", "line": 1, "rule": "DELETE_WITHOUT_WHERE",
      "severity": "BLOCK", "message": "WHERE 절 없는 DELETE 는 전체 행을 삭제합니다." }
  ],
  "maxSeverity": "BLOCK"
}
```
변경 위험 없으면 `items: []`, `maxSeverity: "INFO"`.

---

## 4. (B) Dry-run / 미리보기

### 4.1 `POST /change-requests/:id/dry-run`
**Request** `{ "targetDatabaseId": "clx0db0001" }`
- 권한/환경/대상 가시성은 적용과 동일. CR-대상 환경 불일치 시 409.
- 파일별 처리:
  - **순수 DML 파일**: `BEGIN → 실행 → ROLLBACK`(커밋 금지)로 `affectedRows` 측정.
    `mode: "DML_TX_ROLLBACK"`.
  - **DDL 포함 파일**: 비트랜잭션(암묵 커밋)이라 **실행하지 않음**. 정적 분류만.
    `mode: "DDL_STATIC"`, `affectedRows` 생략.

**Response `200`**
```json
{
  "changeRequestId": "clx0cr0001",
  "targetDatabaseId": "clx0db0001",
  "perFile": [
    { "filename": "001_update.sql", "mode": "DML_TX_ROLLBACK", "affectedRows": 3,
      "impact": "UPDATE users", "destructive": false },
    { "filename": "002_alter.sql", "mode": "DDL_STATIC",
      "impact": "ALTER TABLE users (ADD COLUMN)", "destructive": false }
  ]
}
```
> dry-run 은 어떤 변경도 커밋하지 않습니다(DML 은 롤백, DDL 은 미실행).

---

## 5. (C) 자동 백업 + 적용 흐름 통합

### 5.1 적용 절차(강화) — `POST /change-requests/:id/apply` (Plan 3 확장)
1. CR/대상 조회, 환경 일치, RBAC, 승인 게이트 (Plan 3와 동일).
2. **린트 실행**: effective `BLOCK` 존재 시 적용 거부(`409`, 실행/백업 생성 안 함).
3. **백업 생성**(적용 직전):
   - CR 파일에서 영향 테이블 추출.
   - 각 영향 테이블이 대상에 존재하면 `SHOW CREATE TABLE`(스키마) 항상 스냅샷.
   - 행수 ≤ `BACKUP_MAX_ROWS` 면 데이터(행)까지 스냅샷(`SCHEMA_AND_DATA`).
     초과 시 **schema-only 로 강등** + `note` 기록, 백업 `status: PARTIAL`.
   - 대상에 없는(새로 생성될) 테이블은 `existedBefore:false` 로 기록(롤백 시 DROP 근거).
4. **적용 실행**(Plan 3 순차 실행). 생성된 `Execution` 에 `backupId` 연결, `kind: APPLY`.
5. 응답은 Plan 3 Execution 상세 + `backupId` 포함.

> DEV 는 BLOCK 이 WARN 으로 강등되어 차단되지 않지만 **백업은 동일하게 생성**됩니다.

### 5.2 `GET /change-requests/:id/backups` — 백업 목록
- **Response `200`**: `Backup[]` (payload 제외, createdAt DESC).

---

## 6. (D) 롤백

### 6.1 `POST /executions/:id/rollback`
- 권한: APPROVER. `targetEnv === DEV` 면 해당 CR author(DEVELOPER)도 가능(Plan 3 규칙).
- 대상 Execution(kind=APPLY)에 연결된 백업 기준으로 영향 테이블 복구.
- 테이블별 복구 규칙:
  - `existedBefore:false` (적용이 새로 만든 테이블) → **DROP TABLE** 로 되돌림(restorable).
  - `existedBefore:true` + `dataIncluded:true` → 트랜잭션 내 **`DELETE` 후 스냅샷 행 재삽입**(restorable).
  - `existedBefore:true` + `dataIncluded:false` (schema-only/임계초과) → **복구 불가**로 표기(skip).
- 롤백은 `kind: ROLLBACK` 인 **새 Execution** 으로 추적(테이블별 `ExecutionStep`).

**Response `200`** — 롤백 Execution 상세
```json
{
  "id": "clx0rb0001",
  "kind": "ROLLBACK",
  "changeRequestId": "clx0cr0001",
  "targetDatabaseId": "clx0db0001",
  "status": "SUCCESS",
  "backupId": "clx0bk0001",
  "steps": [
    { "filename": "users", "status": "SUCCESS", "rowsAffected": 3, "error": null },
    { "filename": "big_log", "status": "FAILED", "error": "schema-only 백업 — 데이터 복구 불가" }
  ]
}
```

### 6.2 비가역성 한계 (명시)
- **DDL 구조 변경(ALTER ADD/MODIFY COLUMN, ADD INDEX 등)은 자동 되돌리지 않습니다.**
  스키마 스냅샷은 참조용으로 보관되며, 구조 복구는 수동 대응 영역입니다.
- 임계초과/schema-only 테이블의 데이터는 복구할 수 없습니다(스냅샷 미보관).
- `TRUNCATE`/`DROP TABLE` 등 적용 자체가 비가역인 경우, 백업이 데이터 스냅샷을 보유한
  경우에 한해 데이터 재삽입으로 복구합니다.

---

## 7. 엔드포인트 요약표
| Method | Path | Role | 설명 |
|--------|------|------|------|
| POST | `/change-requests/:id/lint` | 적용 가능 주체 | 위험 SQL 린트(환경정책 반영) |
| POST | `/change-requests/:id/dry-run` | 적용 가능 주체 | 영향 미리보기(DML 롤백/DDL 정적) |
| POST | `/change-requests/:id/apply` | 적용 가능 주체 | (Plan 3 확장) lint+백업 통합 적용 |
| GET | `/change-requests/:id/backups` | 적용 가능 주체 | 백업 목록 |
| POST | `/executions/:id/rollback` | APPROVER(DEV는 author도) | 백업 기준 롤백 |
