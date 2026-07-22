# Plan 4 — 스키마 Diff 생성기 (Schema Diff → 변경요청 자동 생성) API 계약

> 대상: DBFlow `apps/api` (NestJS + Prisma + mysql2)
> 상태: **FE/BE 공용 계약 (1순위 참조 문서)**
> 최종 수정: 2026-06-21
> 범위: 기준(desired) 스키마와 대상 DB 실제 스키마를 비교해 차이를 DDL로 산출(preview),
> 그 결과를 DRAFT ChangeRequest로 투입(apply-to-change-request).

이 문서는 FE가 동시에 참조하는 단일 진실 공급원(SSOT)입니다. Plan 2(`plan2-api-contract.md`),
Plan 3(`plan3-apply-contract.md`) 계약을 보완합니다.

핵심 흐름: **자동 diff 생성 → DRAFT CR 투입 → 기존 승인 게이트(Plan 2/3) 그대로 적용**.
즉 DEV는 작성자 self-apply로 빠르게, STAGING/PROD는 정식 승인 후 적용됩니다.

---

## 1. 공통 규약

- Base URL: `http://localhost:3001`
- 인증: 모든 엔드포인트 JWT 필수 (`Authorization: Bearer <accessToken>`)
- 포맷: `application/json; charset=utf-8`
- 가드 체인: `AuthGuard('jwt')` → `RolesGuard`

### 1.1 역할 정책
| 영역 | 역할 |
|------|------|
| Diff 미리보기 `POST /schema-diff/preview` | **DEVELOPER**(env === DEV 대상만) 또는 **APPROVER**(전체) |
| 변경요청 생성 `POST /schema-diff/apply-to-change-request` | **DEVELOPER**(작성자) — 대상은 DEV만 |

> 대상 DB 가시성은 Plan 3 규칙을 재사용합니다: DEVELOPER는 `env === DEV` 대상만 접근,
> 그 외 대상은 존재를 숨기기 위해 `404`. 자격증명(암호화된 password)은 서비스 내부에서만
> 복호화되며 어떤 응답에도 노출되지 않습니다.

### 1.2 공통 에러
| statusCode | 의미 |
|-----------|------|
| 400 | 검증 실패 / desired SQL 파싱 불가 |
| 401 | 미인증 |
| 403 | 권한 없음 |
| 404 | 대상 DB 없음(또는 가시성 밖) |
| 409 | 차이 없음(생성 불가) / 정책 위반 |

---

## 2. 도메인 형태

### 2.1 DiffItem
```ts
type DiffKind =
  | 'CREATE_TABLE'     // 대상에 없는 테이블 신규 생성
  | 'ADD_COLUMN'       // 컬럼 추가
  | 'DROP_COLUMN'      // 컬럼 삭제 (destructive)
  | 'MODIFY_COLUMN'    // 컬럼 타입/널 변경
  | 'ADD_INDEX'        // 인덱스 추가
  | 'DROP_INDEX'       // 인덱스 삭제
  | 'DROP_TABLE';      // (예약) 1차 범위 미생성 — 아래 4.3 참조

interface DiffItem {
  kind: DiffKind;
  table: string;       // 대상 테이블명
  statement: string;   // 실행 가능한 DDL 한 문장
  sqlType: 'DDL';
  destructive: boolean; // 파괴적 변경 여부 (DROP_TABLE/DROP_COLUMN = true)
}
```

### 2.2 CurrentSnapshotSummary
```ts
interface CurrentSnapshotSummary {
  database: string;        // 대상 DB 스키마명
  tableCount: number;
  tables: { name: string; columns: number; indexes: number }[];
}
```

---

## 3. `POST /schema-diff/preview` — Diff 미리보기 (DEVELOPER[DEV만]/APPROVER)

**Request**
```json
{
  "targetDatabaseId": "clx0db0001",
  "desiredSchemaSql": "CREATE TABLE users (\n  id INT NOT NULL AUTO_INCREMENT,\n  email VARCHAR(255) NOT NULL,\n  name VARCHAR(100) NULL,\n  PRIMARY KEY (id),\n  UNIQUE KEY uq_users_email (email)\n);"
}
```
| 필드 | 규칙 |
|------|------|
| targetDatabaseId | string, 필수 |
| desiredSchemaSql | string, 필수. `CREATE TABLE` 문 모음(여러 문장 `;` 구분) |

**동작**
1. 대상 DB 조회(가시성 적용, 없으면 `404`).
2. 대상 DB(mysql2)의 현재 스키마를 `information_schema`에서 introspect.
3. `desiredSchemaSql`을 파싱(아래 4.x 한계 참조)해 목표 상태 산출.
4. 목표 vs 현재 비교 → `DiffItem[]`.

**Response `200`**
```json
{
  "targetDatabaseId": "clx0db0001",
  "currentSnapshotSummary": {
    "database": "service",
    "tableCount": 1,
    "tables": [{ "name": "users", "columns": 2, "indexes": 1 }]
  },
  "diff": [
    {
      "kind": "ADD_COLUMN",
      "table": "users",
      "statement": "ALTER TABLE `users` ADD COLUMN `name` VARCHAR(100) NULL;",
      "sqlType": "DDL",
      "destructive": false
    },
    {
      "kind": "ADD_INDEX",
      "table": "users",
      "statement": "ALTER TABLE `users` ADD UNIQUE `uq_users_email` (`email`);",
      "sqlType": "DDL",
      "destructive": false
    }
  ],
  "hasChanges": true
}
```

차이가 없으면 `diff: []`, `hasChanges: false` 로 `200` 반환.

---

## 4. 비교 범위와 파서 한계 (중요)

### 4.1 1차 비교 범위 (구현됨)
- **누락 테이블**: desired에 있고 현재 없으면 `CREATE_TABLE` (desired 원문 그대로 실행).
- **컬럼**: 추가(`ADD_COLUMN`) / 삭제(`DROP_COLUMN`) / 타입·널 변경(`MODIFY_COLUMN`).
- **인덱스**: 추가(`ADD_INDEX`) / 삭제(`DROP_INDEX`). PRIMARY 제외(비교 안 함).

### 4.2 desired DDL 파서 한계 (의도적 단순화)
- `CREATE TABLE [IF NOT EXISTS] name ( ... )` 형태만 인식. 그 외 문장은 무시.
- 컬럼 인식: `이름 타입 [NOT NULL|NULL] [DEFAULT x] [AUTO_INCREMENT] [PRIMARY KEY]`.
- 인덱스 인식: `PRIMARY KEY (...)`, `[UNIQUE] KEY|INDEX 이름 (...)`. **인덱스는 이름 필수**(무명 인덱스 비교 불가).
- 미지원: 외래키(FOREIGN KEY/CONSTRAINT)·생성컬럼·파티션·체크제약·테이블옵션(ENGINE/CHARSET 등은 무시).
- 타입 비교는 **문자열 정규화 비교**(소문자/공백 정리). 예: `INT` 와 `int` 동일 취급.
  display width·부호·콜레이션 차이는 오탐/미탐 가능 — 검토 단계에서 확인 필요.
- `DEFAULT` 값 차이만 있는 변경은 1차 범위에서 **감지하지 않음**(타입/널 변경만 MODIFY).

### 4.3 `DROP_TABLE` (예약, 1차 미생성)
- desired에 없는(현재에만 있는) 테이블은 **삭제하지 않습니다.** 부분 desired 스키마로 인한
  의도치 않은 대량 삭제를 막기 위함입니다. `DROP_TABLE` kind는 향후 "전체 동기화 모드"를 위해
  enum에만 예약되어 있고 1차 구현은 생성하지 않습니다.

### 4.4 destructive 플래그
- `DROP_TABLE`, `DROP_COLUMN` → `destructive: true`.
- 그 외(`CREATE_TABLE`/`ADD_COLUMN`/`MODIFY_COLUMN`/`ADD_INDEX`/`DROP_INDEX`) → `false`.
  (`MODIFY_COLUMN`은 데이터 손실 가능성이 있으나 1차에선 false로 두며 검토에서 판단.)

---

## 5. `POST /schema-diff/apply-to-change-request` — Diff → DRAFT 변경요청 (DEVELOPER)

**Request**
```json
{
  "targetDatabaseId": "clx0db0001",
  "desiredSchemaSql": "CREATE TABLE users ( ... );",
  "title": "users 스키마 정합화",
  "description": "기준 스키마와 DEV 대상 차이 자동 반영"
}
```
| 필드 | 규칙 |
|------|------|
| targetDatabaseId | string, 필수 |
| desiredSchemaSql | string, 필수 |
| title | string, 1~200자 |
| description | string, 1~2000자 |

**동작**
1. preview 와 동일하게 diff 산출.
2. `hasChanges === false` 면 `409`(차이 없음 — 생성 불가).
3. diff 문장들을 `files[]`로 변환(순서대로):
   - `filename`: `001_<kind소문자>.sql`, `002_...` 자동 부여
   - `sqlType`: `DDL`
   - `content`: 해당 `statement`
4. 기존 ChangeRequest 서비스를 재사용해 **DRAFT** CR 생성.
   `targetEnv` = 대상 DB의 `env`, `authorId` = 호출 개발자.
5. 생성된 CR 상세(Plan 2 detail 형태) 반환.

**Response `201`** — Plan 2 `ChangeRequest` detail (status `DRAFT`, files 포함, authorName denormalized)
```json
{
  "id": "clx0cr0099",
  "title": "users 스키마 정합화",
  "description": "기준 스키마와 DEV 대상 차이 자동 반영",
  "targetEnv": "DEV",
  "status": "DRAFT",
  "authorId": "clx0usr0001",
  "authorName": "개발자",
  "files": [
    { "id": "...", "filename": "001_add_column.sql", "sqlType": "DDL", "content": "ALTER TABLE `users` ADD COLUMN `name` VARCHAR(100) NULL;", "order": 0 }
  ],
  "statusHistory": [],
  "createdAt": "2026-06-21T08:00:00.000Z",
  "updatedAt": "2026-06-21T08:00:00.000Z"
}
```

이후 흐름은 Plan 2/3 그대로: DEV는 작성자 self-apply, STAGING/PROD는 제출→검토→승인→적용.

---

## 6. 엔드포인트 요약표
| Method | Path | Role | 설명 |
|--------|------|------|------|
| POST | `/schema-diff/preview` | DEVELOPER(DEV만)/APPROVER | 스키마 차이 미리보기 |
| POST | `/schema-diff/apply-to-change-request` | DEVELOPER | 차이를 DRAFT CR로 생성 |
