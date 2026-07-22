# Plan 2 — 변경요청 승인 워크플로우 API 계약

> 대상: DBFlow `apps/api` (NestJS + Prisma)
> 상태: **FE/BE 공용 계약 (1순위 참조 문서)**
> 최종 수정: 2026-06-18
> 작성: 백엔드(senior BE)

이 문서는 FE 개발자가 동시에 참조하는 **단일 진실 공급원(SSOT)** 입니다. 변경 시 반드시 양쪽에 공지합니다.

---

## 1. 공통 규약

### 1.1 Base URL / 포맷
- Base URL: `http://localhost:3001` (개발 기본 포트)
- 모든 요청/응답: `application/json; charset=utf-8`
- 날짜: ISO-8601 UTC 문자열 (예: `2026-06-18T05:12:30.000Z`)
- ID: `cuid` 문자열 (예: `clx0abc123...`)

### 1.2 인증
- 모든 `/change-requests` 엔드포인트는 **JWT 필수**.
- 헤더: `Authorization: Bearer <accessToken>`
- 토큰은 `POST /auth/login` 응답의 `accessToken` 사용.
- 가드 체인: `AuthGuard('jwt')` → `RolesGuard` (기존 재사용).

### 1.3 역할(Role)
| Role | 설명 | 권한 |
|------|------|------|
| `DEVELOPER` | 개발자 | 변경요청 생성·제출 |
| `REVIEWER` | DBA(검토자) | review 승인/반려 |
| `APPROVER` | 결재자 | final 승인/반려 |

### 1.4 공통 에러 응답
NestJS 표준 예외 포맷을 따릅니다.

```json
{
  "statusCode": 400,
  "message": ["title should not be empty"],
  "error": "Bad Request"
}
```

| statusCode | 의미 | 발생 예 |
|-----------|------|---------|
| `400` | 검증 실패 | DTO 유효성 위반, 잘못된 enum 값 |
| `401` | 미인증 | 토큰 없음/만료 |
| `403` | 권한 없음 | 역할 불일치, author 아님 |
| `404` | 리소스 없음 | 존재하지 않는 changeRequestId |
| `409` | 상태 전이 위반 | 잘못된 상태에서 전이 시도 (예: DRAFT가 아닌데 submit) |

---

## 2. 도메인 enum

### 2.1 `TargetEnv`
```
DEV | STAGING | PROD
```

### 2.2 `SqlType`
```
DDL | DML
```

### 2.3 `ChangeRequestStatus` (상태 머신)
```
DRAFT
SUBMITTED
REVIEW_APPROVED
REVIEW_REJECTED
FINAL_APPROVED
FINAL_REJECTED
APPLIED
```

### 2.4 상태 전이도
```
DRAFT ──submit(DEVELOPER=author)──> SUBMITTED
SUBMITTED ──review APPROVE(REVIEWER)──> REVIEW_APPROVED
SUBMITTED ──review REJECT(REVIEWER)───> REVIEW_REJECTED   [종료]
REVIEW_APPROVED ──approve APPROVE(APPROVER)──> FINAL_APPROVED
REVIEW_APPROVED ──approve REJECT(APPROVER)───> FINAL_REJECTED [종료]
FINAL_APPROVED ──(apply)──> APPLIED   [엔드포인트 보류 — 향후 예정]
```

**정책 결정 (PM 확정):**
- **반려(REVIEW_REJECTED / FINAL_REJECTED)는 종료 상태**입니다. 재오픈/재제출 없음. 작성자는 새 변경요청을 생성합니다.
- **APPLIED 전이는 이번 범위에서 보류**합니다. enum·상태머신에는 정의되어 있으나 전이 엔드포인트(`/apply`)는 아직 제공하지 않습니다. (실제 SQL 적용 단계는 별도 Plan에서 구현)

---

## 3. 엔드포인트

### 3.1 `POST /change-requests` — 변경요청 생성

- **권한**: `DEVELOPER`
- **결과 상태**: `DRAFT`
- 생성자(`authorId`)는 JWT 토큰의 사용자로 자동 설정됩니다.

**Request Body**
```json
{
  "title": "회원 테이블 인덱스 추가",
  "description": "조회 성능 개선을 위한 email 컬럼 인덱스 추가",
  "targetEnv": "PROD",
  "files": [
    {
      "filename": "001_add_email_index.sql",
      "sqlType": "DDL",
      "content": "CREATE INDEX idx_user_email ON \"User\"(email);"
    },
    {
      "filename": "002_backfill.sql",
      "sqlType": "DML",
      "content": "UPDATE \"User\" SET status = 'ACTIVE' WHERE status IS NULL;"
    }
  ]
}
```

**검증 규칙**
| 필드 | 규칙 |
|------|------|
| `title` | string, 필수, 1~200자 |
| `description` | string, 필수, 1~2000자 |
| `targetEnv` | `TargetEnv` enum 중 하나, 필수 |
| `files` | 배열, **최소 1개**, 각 항목 검증 |
| `files[].filename` | string, 필수, 1~255자 |
| `files[].sqlType` | `SqlType` enum 중 하나, 필수 |
| `files[].content` | string, 필수, 비어있지 않음 |

> `files[].order`는 클라이언트가 보내지 않습니다. 서버가 **배열 순서대로 0부터** 자동 부여합니다.

**Response `201 Created`** — 생성된 상세 (files 포함, statusHistory 빈 배열)
```json
{
  "id": "clx0cr0001",
  "title": "회원 테이블 인덱스 추가",
  "description": "조회 성능 개선을 위한 email 컬럼 인덱스 추가",
  "targetEnv": "PROD",
  "status": "DRAFT",
  "authorId": "clx0usr0001",
  "authorName": "개발자",
  "createdAt": "2026-06-18T05:12:30.000Z",
  "updatedAt": "2026-06-18T05:12:30.000Z",
  "files": [
    {
      "id": "clx0f0001",
      "changeRequestId": "clx0cr0001",
      "filename": "001_add_email_index.sql",
      "sqlType": "DDL",
      "content": "CREATE INDEX idx_user_email ON \"User\"(email);",
      "order": 0
    },
    {
      "id": "clx0f0002",
      "changeRequestId": "clx0cr0001",
      "filename": "002_backfill.sql",
      "sqlType": "DML",
      "content": "UPDATE \"User\" SET status = 'ACTIVE' WHERE status IS NULL;",
      "order": 1
    }
  ],
  "statusHistory": []
}
```

---

### 3.2 `GET /change-requests` — 목록 조회 (역할별 필터)

- **권한**: 인증된 모든 역할
- **역할별 필터 정책 (PM 확정 — "역할별 관련 건만")**:

| 역할 | 노출 대상 |
|------|-----------|
| `DEVELOPER` | **본인이 작성한** 변경요청 전체 (모든 상태) |
| `REVIEWER` | `DRAFT`를 **제외한** 전체 (검토 대기/이력 확인) |
| `APPROVER` | `REVIEW_APPROVED` 이후 단계만 (`REVIEW_APPROVED`, `FINAL_APPROVED`, `FINAL_REJECTED`, `APPLIED`) |

- 정렬: `createdAt DESC` (최신순)
- 목록 응답은 **files / statusHistory를 포함하지 않는 요약 형태**입니다. (상세는 3.3에서)

**Response `200 OK`**
```json
[
  {
    "id": "clx0cr0001",
    "title": "회원 테이블 인덱스 추가",
    "targetEnv": "PROD",
    "status": "SUBMITTED",
    "authorId": "clx0usr0001",
    "authorName": "개발자",
    "createdAt": "2026-06-18T05:12:30.000Z",
    "updatedAt": "2026-06-18T05:20:00.000Z"
  }
]
```

---

### 3.3 `GET /change-requests/:id` — 상세 조회

- **권한**: 인증된 모든 역할 (가시성은 목록 정책과 동일하게 적용 — 권한 없는 건 접근 시 `404`)
- `files`(order ASC)와 `statusHistory`(createdAt ASC) **포함**.

**Response `200 OK`**
```json
{
  "id": "clx0cr0001",
  "title": "회원 테이블 인덱스 추가",
  "description": "조회 성능 개선을 위한 email 컬럼 인덱스 추가",
  "targetEnv": "PROD",
  "status": "REVIEW_APPROVED",
  "authorId": "clx0usr0001",
  "authorName": "개발자",
  "createdAt": "2026-06-18T05:12:30.000Z",
  "updatedAt": "2026-06-18T06:00:00.000Z",
  "files": [
    {
      "id": "clx0f0001",
      "changeRequestId": "clx0cr0001",
      "filename": "001_add_email_index.sql",
      "sqlType": "DDL",
      "content": "CREATE INDEX idx_user_email ON \"User\"(email);",
      "order": 0
    }
  ],
  "statusHistory": [
    {
      "id": "clx0h0001",
      "changeRequestId": "clx0cr0001",
      "fromStatus": "DRAFT",
      "toStatus": "SUBMITTED",
      "actorId": "clx0usr0001",
      "actorName": "개발자",
      "comment": null,
      "createdAt": "2026-06-18T05:20:00.000Z"
    },
    {
      "id": "clx0h0002",
      "changeRequestId": "clx0cr0001",
      "fromStatus": "SUBMITTED",
      "toStatus": "REVIEW_APPROVED",
      "actorId": "clx0usr0002",
      "actorName": "검토자",
      "comment": "인덱스 적절합니다.",
      "createdAt": "2026-06-18T06:00:00.000Z"
    }
  ]
}
```

**`404 Not Found`**: 존재하지 않거나, 요청자 역할 정책상 접근 불가한 경우.

---

### 3.4 `POST /change-requests/:id/submit` — 제출

- **권한**: `DEVELOPER` **이면서 해당 요청의 author** (둘 다 만족해야 함, 아니면 `403`)
- **전이**: `DRAFT → SUBMITTED`
- **선행조건 위반 시 `409`**: 현재 상태가 `DRAFT`가 아닌 경우
- Request Body: **없음**
- statusHistory에 `{ from: DRAFT, to: SUBMITTED, actorId: <author>, comment: null }` 기록.

**Response `200 OK`**: 3.3과 동일한 상세 객체 (갱신된 status).

---

### 3.5 `POST /change-requests/:id/review` — 검토 결정

- **권한**: `REVIEWER`
- **전이**:
  - `decision: "APPROVE"` → `SUBMITTED → REVIEW_APPROVED`
  - `decision: "REJECT"` → `SUBMITTED → REVIEW_REJECTED` (종료)
- **선행조건 위반 시 `409`**: 현재 상태가 `SUBMITTED`가 아닌 경우

**Request Body**
```json
{
  "decision": "APPROVE",
  "comment": "인덱스 적절합니다."
}
```

| 필드 | 규칙 |
|------|------|
| `decision` | `"APPROVE"` \| `"REJECT"`, 필수 |
| `comment` | string, 선택 (REJECT 시 권장), 0~2000자 |

**Response `200 OK`**: 갱신된 상세 객체. statusHistory에 전이 + comment 기록.

---

### 3.6 `POST /change-requests/:id/approve` — 최종 결재

- **권한**: `APPROVER`
- **전이**:
  - `decision: "APPROVE"` → `REVIEW_APPROVED → FINAL_APPROVED`
  - `decision: "REJECT"` → `REVIEW_APPROVED → FINAL_REJECTED` (종료)
- **선행조건 위반 시 `409`**: 현재 상태가 `REVIEW_APPROVED`가 아닌 경우

**Request Body**: 3.5와 동일 (`decision`, `comment`)

**Response `200 OK`**: 갱신된 상세 객체.

---

## 4. DTO 타입 요약 (FE 참고용 TypeScript)

```ts
type TargetEnv = 'DEV' | 'STAGING' | 'PROD';
type SqlType = 'DDL' | 'DML';
type ChangeRequestStatus =
  | 'DRAFT' | 'SUBMITTED'
  | 'REVIEW_APPROVED' | 'REVIEW_REJECTED'
  | 'FINAL_APPROVED' | 'FINAL_REJECTED'
  | 'APPLIED';
type Decision = 'APPROVE' | 'REJECT';

// 요청
interface CreateChangeRequestBody {
  title: string;
  description: string;
  targetEnv: TargetEnv;
  files: { filename: string; sqlType: SqlType; content: string }[];
}
interface DecisionBody {
  decision: Decision;
  comment?: string;
}

// 응답
interface ChangeRequestFile {
  id: string;
  changeRequestId: string;
  filename: string;
  sqlType: SqlType;
  content: string;
  order: number;
}
interface StatusHistory {
  id: string;
  changeRequestId: string;
  fromStatus: ChangeRequestStatus;
  toStatus: ChangeRequestStatus;
  actorId: string;
  actorName: string | null; // 비정규화된 표시 이름 (User 조인). 없으면 null → FE는 actorName ?? actorId
  comment: string | null;
  createdAt: string;
}
interface ChangeRequestSummary {
  id: string;
  title: string;
  targetEnv: TargetEnv;
  status: ChangeRequestStatus;
  authorId: string;
  authorName: string | null; // 비정규화된 표시 이름 (User 조인). 없으면 null → FE는 authorName ?? authorId
  createdAt: string;
  updatedAt: string;
}
interface ChangeRequestDetail extends ChangeRequestSummary {
  description: string;
  files: ChangeRequestFile[];
  statusHistory: StatusHistory[];
}
```

---

## 5. 엔드포인트 요약표

| Method | Path | Role | 전이 | Body |
|--------|------|------|------|------|
| POST | `/change-requests` | DEVELOPER | → DRAFT | CreateChangeRequestBody |
| GET | `/change-requests` | 전체(역할필터) | - | - |
| GET | `/change-requests/:id` | 전체(가시성) | - | - |
| POST | `/change-requests/:id/submit` | DEVELOPER=author | DRAFT→SUBMITTED | - |
| POST | `/change-requests/:id/review` | REVIEWER | SUBMITTED→REVIEW_* | DecisionBody |
| POST | `/change-requests/:id/approve` | APPROVER | REVIEW_APPROVED→FINAL_* | DecisionBody |
