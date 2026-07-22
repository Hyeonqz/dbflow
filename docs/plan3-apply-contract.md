# Plan 3 — 적용 엔진(Apply Engine) + 대상 DB 레지스트리 API 계약

> 대상: DBFlow `apps/api` (NestJS + Prisma + mysql2)
> 상태: **FE/BE 공용 계약 (1순위 참조 문서)**
> 최종 수정: 2026-06-20
> 범위: **Phase A(대상 DB 레지스트리) + Phase B(적용 엔진) + 환경정책**. Phase D(자동 diff)는 제외.

이 문서는 FE가 동시에 참조하는 단일 진실 공급원(SSOT)입니다. Plan 2 계약(`plan2-api-contract.md`)을 보완합니다.

---

## 1. 공통 규약

- Base URL: `http://localhost:3001`
- 인증: 모든 엔드포인트 JWT 필수 (`Authorization: Bearer <accessToken>`)
- 포맷: `application/json; charset=utf-8`, 날짜는 ISO-8601 UTC
- 가드 체인: `AuthGuard('jwt')` → `RolesGuard`

### 1.1 역할 정책 요약
| 영역 | 역할 |
|------|------|
| 대상 DB 레지스트리 — 조회(목록/상세) | **DEVELOPER**(env === DEV 대상만) 또는 **APPROVER**(전체) |
| 대상 DB 레지스트리 — 생성/수정/삭제/연결테스트 | **APPROVER** (최소권한) |
| 변경요청 적용(apply) — `targetEnv === DEV` | **DEVELOPER**(해당 CR의 author) 또는 **APPROVER** |
| 변경요청 적용(apply) — `targetEnv === STAGING \| PROD` | **APPROVER** 만 |
| 적용 이력 조회(executions) | 인증된 모든 역할 (읽기 전용) |

> 가드 구현: 적용 엔드포인트는 `@Roles(DEVELOPER, APPROVER)`로 1차 통과시키고, **서비스 레이어**에서 환경별 세부 권한을 강제합니다.
> - `DEV`: 호출자가 APPROVER 이거나, 해당 CR의 author 본인(DEVELOPER)이어야 함. 그 외 `403`.
> - `STAGING | PROD`: 호출자가 APPROVER 가 아니면 `403`.

### 1.2 자격증명 보안
- 대상 DB 비밀번호는 **AES-256-GCM**으로 암호화해 저장(`passwordEnc`). 평문 저장 금지.
- 암호화 키는 환경변수 **`APP_ENCRYPTION_KEY`** (32바이트 = 64 hex 문자).
- **비밀번호는 어떤 응답에도 절대 포함되지 않습니다.** (요청에서만 평문으로 전달, HTTPS 전제)

### 1.3 공통 에러
| statusCode | 의미 |
|-----------|------|
| 400 | 검증 실패 |
| 401 | 미인증 |
| 403 | 권한 없음(역할 불일치) |
| 404 | 리소스 없음 |
| 409 | 정책/상태 위반(환경 불일치, 승인 게이트 미충족, 동시 적용 충돌, 잘못된 상태전이) |

---

## 2. 도메인 enum

```
DbType          : MYSQL | POSTGRES | MARIADB | ORACLE   (MVP 실행은 MYSQL만)
ExecutionStatus : PENDING | RUNNING | SUCCESS | FAILED
TargetEnv       : DEV | STAGING | PROD        (Plan 2와 공유)
```

상태머신 확장 — APPLY 액션 추가:
```
FINAL_APPROVED ──APPLY──> APPLIED
```

---

## 3. Phase A — 대상 DB 레지스트리

### 3.1 모델 / 응답 형태 (sanitized — password 미포함)
```ts
interface TargetDatabase {
  id: string;
  name: string;
  env: 'DEV' | 'STAGING' | 'PROD';
  dbType: 'MYSQL' | 'POSTGRES' | 'MARIADB' | 'ORACLE';
  host: string;
  port: number;
  username: string;
  database: string;
  createdAt: string;
  updatedAt: string;
  // password / passwordEnc 는 응답에 절대 포함되지 않음
}
```

### 3.2 `POST /target-databases` — 등록 (APPROVER)
**Request**
```json
{
  "name": "운영 MySQL",
  "env": "PROD",
  "dbType": "MYSQL",
  "host": "db.prod.internal",
  "port": 3306,
  "username": "app",
  "password": "s3cr3t",
  "database": "service"
}
```
| 필드 | 규칙 |
|------|------|
| name | string, 1~100자 |
| env | TargetEnv enum |
| dbType | DbType enum, 선택(기본 MYSQL) |
| host | string, 1~255자 |
| port | int, 1~65535 |
| username | string, 1~100자 |
| password | string, 필수, 1자 이상 (암호화 저장) |
| database | string, 1~100자 |

**Response `201`** — sanitized TargetDatabase (password 없음)
```json
{
  "id": "clx0db0001",
  "name": "운영 MySQL",
  "env": "PROD",
  "dbType": "MYSQL",
  "host": "db.prod.internal",
  "port": 3306,
  "username": "app",
  "database": "service",
  "createdAt": "2026-06-18T08:00:00.000Z",
  "updatedAt": "2026-06-18T08:00:00.000Z"
}
```

### 3.3 `GET /target-databases` — 목록 (DEVELOPER: DEV만 · APPROVER: 전체)
- **DEVELOPER**: `env === DEV` 대상만 반환 (개발자 self-apply 시 DEV 대상 선택용).
- **APPROVER**: 전체 반환.
**Response `200`**: `TargetDatabase[]` (createdAt DESC, password 없음)

### 3.4 `GET /target-databases/:id` — 상세 (DEVELOPER: DEV만 · APPROVER: 전체)
- **DEVELOPER**: `env === DEV` 대상만 허용. 그 외(STAGING/PROD)는 존재 노출을 막기 위해 `404`.
- **APPROVER**: 전체 허용.
**Response `200`**: `TargetDatabase` / 없거나 권한 밖이면 `404`

### 3.5 `PATCH /target-databases/:id` — 수정 (APPROVER)
- 부분 수정. `password` 포함 시 재암호화. 미포함 시 기존 유지.
**Request (예)**
```json
{ "host": "db2.prod.internal", "password": "newpw" }
```
**Response `200`**: 갱신된 sanitized TargetDatabase

### 3.6 `DELETE /target-databases/:id` — 삭제 (APPROVER)
**Response `200`**
```json
{ "id": "clx0db0001", "deleted": true }
```

### 3.7 `POST /target-databases/:id/test-connection` — 연결 테스트 (APPROVER)
- 저장된 자격증명을 복호화해 실제 연결(`SELECT 1`) 시도. 성공/실패를 **항상 200**으로 반환.
**Response `200` (성공)**
```json
{ "success": true, "serverVersion": "8.0.36", "latencyMs": 12 }
```
**Response `200` (실패)**
```json
{ "success": false, "error": "Access denied for user 'app'@'...'" }
```

---

## 4. Phase B — 적용 엔진(Apply Engine)

### 4.1 모델 / 응답 형태
```ts
interface ExecutionStep {
  id: string;
  executionId: string;
  filename: string;
  order: number;
  status: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED';
  error: string | null;
  rowsAffected: number | null;
  durationMs: number | null;
}
interface Execution {
  id: string;
  changeRequestId: string;
  targetDatabaseId: string;
  status: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED';
  startedAt: string | null;
  finishedAt: string | null;
  triggeredById: string;
  createdAt: string;
  steps: ExecutionStep[];
}
```

### 4.2 `POST /change-requests/:id/apply` — 적용 (DEV: DEVELOPER author/APPROVER · STAGING|PROD: APPROVER)
**Request**
```json
{ "targetDatabaseId": "clx0db0001" }
```

**적용 절차**
1. ChangeRequest, TargetDatabase 조회 (없으면 `404`)
2. **환경 일치 검사**: `ChangeRequest.targetEnv === TargetDatabase.env` 아니면 `409`
3. **적용 권한 검사(환경별 RBAC)** — 가드는 `@Roles(DEVELOPER, APPROVER)`로 통과시키되, 서비스에서 강제:
   - `env === DEV`: 호출자가 **APPROVER** 이거나 **해당 CR의 author(DEVELOPER) 본인**이어야 함. 아니면 `403`
   - `env === STAGING | PROD`: 호출자가 **APPROVER** 가 아니면 `403`
4. **승인 게이트(환경별 정책)**:
   - `env === DEV`: CR 상태가 거부/적용완료가 아니면 적용 허용 (빠른 dev 반복). 즉 `DRAFT/SUBMITTED/REVIEW_APPROVED/FINAL_APPROVED` 허용, `REVIEW_REJECTED/FINAL_REJECTED/APPLIED`면 `409`
   - `env === STAGING | PROD`: CR 상태가 **반드시 `FINAL_APPROVED`** 여야 함. 아니면 `409`
5. **동시 적용 방지**: 동일 CR에 `RUNNING` Execution이 있으면 `409` (CR 행 `FOR UPDATE` 락으로 직렬화)
6. Execution 생성(`RUNNING`, startedAt 기록) 후 대상 DB에 mysql2로 연결
7. ChangeRequestFile을 `order` 오름차순으로 **순차 실행**, 각 파일마다 ExecutionStep 기록(SUCCESS/FAILED, rowsAffected, durationMs)
8. **첫 실패에서 중단** — 실패 step에 error 기록, 이후 파일은 실행하지 않음(미기록), Execution `FAILED`
9. 전 파일 성공:
   - Execution `SUCCESS`, finishedAt 기록
   - `env === STAGING | PROD`: CR `FINAL_APPROVED → APPLIED` 전이 + StatusHistory 기록
   - `env === DEV`: **CR 상태 변경 없음** (재적용 가능)

> 안전장치: MySQL DDL은 비트랜잭션(암묵 커밋)이므로 파일별 순차 실행 + 중단 지점을 ExecutionStep으로 명확히 남깁니다. 부분 적용 시 SUCCESS step들이 어디까지 반영됐는지 보여줍니다.

**Response `200`** — Execution 상세 (성공)
```json
{
  "id": "clx0ex0001",
  "changeRequestId": "clx0cr0001",
  "targetDatabaseId": "clx0db0001",
  "status": "SUCCESS",
  "startedAt": "2026-06-18T08:10:00.000Z",
  "finishedAt": "2026-06-18T08:10:01.200Z",
  "triggeredById": "clx0usr0003",
  "createdAt": "2026-06-18T08:10:00.000Z",
  "steps": [
    {
      "id": "clx0st0001",
      "executionId": "clx0ex0001",
      "filename": "001_add_email_index.sql",
      "order": 0,
      "status": "SUCCESS",
      "error": null,
      "rowsAffected": 0,
      "durationMs": 34
    }
  ]
}
```

**Response `200`** — 실패 예 (status FAILED, 중단 지점 기록)
```json
{
  "id": "clx0ex0002",
  "changeRequestId": "clx0cr0001",
  "targetDatabaseId": "clx0db0001",
  "status": "FAILED",
  "startedAt": "2026-06-18T08:12:00.000Z",
  "finishedAt": "2026-06-18T08:12:00.300Z",
  "triggeredById": "clx0usr0003",
  "createdAt": "2026-06-18T08:12:00.000Z",
  "steps": [
    {
      "id": "clx0st0010",
      "executionId": "clx0ex0002",
      "filename": "001_ok.sql",
      "order": 0,
      "status": "SUCCESS",
      "error": null,
      "rowsAffected": 1,
      "durationMs": 20
    },
    {
      "id": "clx0st0011",
      "executionId": "clx0ex0002",
      "filename": "002_bad.sql",
      "order": 1,
      "status": "FAILED",
      "error": "You have an error in your SQL syntax ...",
      "rowsAffected": null,
      "durationMs": 5
    }
  ]
}
```

> 실패해도 HTTP는 **200**입니다 (요청 자체는 정상 처리됨). 적용 성공 여부는 `status` 필드로 판단하세요. 실패 시 CR 상태는 `FINAL_APPROVED`로 유지되어 **재시도 가능**합니다.

### 4.3 `GET /change-requests/:id/executions` — 적용 이력 (인증된 모든 역할)
**Response `200`**: `Execution[]` (createdAt DESC, 각 항목 steps 포함)

---

## 5. 환경변수 추가
```
APP_ENCRYPTION_KEY="<64 hex chars = 32 bytes>"   # AES-256-GCM 키
```

---

## 6. 엔드포인트 요약표
| Method | Path | Role | 설명 |
|--------|------|------|------|
| POST | `/target-databases` | APPROVER | 대상 DB 등록 |
| GET | `/target-databases` | DEVELOPER(DEV만)/APPROVER | 목록 |
| GET | `/target-databases/:id` | DEVELOPER(DEV만)/APPROVER | 상세 |
| PATCH | `/target-databases/:id` | APPROVER | 수정 |
| DELETE | `/target-databases/:id` | APPROVER | 삭제 |
| POST | `/target-databases/:id/test-connection` | APPROVER | 연결 테스트 |
| POST | `/change-requests/:id/apply` | DEV: DEVELOPER(author)/APPROVER · STAGING\|PROD: APPROVER | 적용 실행 |
| GET | `/change-requests/:id/executions` | 인증 전체 | 적용 이력 |
