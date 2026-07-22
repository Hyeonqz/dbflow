# DBFlow — 환경별 SQL 리뷰 정책 설계

- 작성일: 2026-07-19
- 상태: 설계 확정 대기 (사용자 검토 전)
- 범위: 백엔드(`apps/api`) lint 엔진 정책화 + 정책 저장/API + 프론트(`apps/web`) 관리자 정책 페이지
- 목적: 지금 코드에 하드코딩된 "규칙별 심각도 + DEV 강등"을 **환경별 설정 가능한 SQL 리뷰 정책**으로 승격 (Bytebase의 SQL Review Policy에 대응, 거버넌스 강화)

## 1. 배경 (현재 상태)

`apps/api/src/apply/lint.engine.ts`:
- **7개 규칙이 코드에 하드코딩** — `DROP_DATABASE`/`DROP_TABLE`/`TRUNCATE`/`DELETE_WITHOUT_WHERE`/`UPDATE_WITHOUT_WHERE`(base `BLOCK`), `ALTER_DROP_COLUMN`(base `WARN`), `DROP_INDEX`(base `INFO`). 각 규칙은 `matches(stmt)` matcher를 가짐.
- **환경 동작도 하드코딩** — `effectiveSeverity(base, env)`: DEV는 `BLOCK`→`WARN` 강등, STAGING/PROD는 base 유지.
- `lintFiles(files, env)` → `LintResult`. 적용 게이트(`apply.service.ts`)가 STAGING/PROD에서 effective `BLOCK`을 차단(409), DEV는 통과.

한계: 조직이 규칙 강도를 환경별로 조정할 수 없다(예: 특정 팀은 DEV에서도 `TRUNCATE`를 막고 싶음, 또는 `DROP_INDEX`를 끄고 싶음).

## 2. 강제 수준 (enforcement level)

규칙 × 환경마다 수준을 지정한다: **`DISABLED` / `INFO` / `WARN` / `BLOCK`**
- `BLOCK` — 적용(apply) 게이트에서 차단(현행 그대로).
- `WARN` / `INFO` — 자문(비차단). 미리보기·상세에 표시만.
- `DISABLED` — 규칙 끔(탐지해도 보고하지 않음).

기존 `LintSeverity`(INFO/WARN/BLOCK)와 프론트 뱃지(`LintSeverityBadge`)를 그대로 재사용하고 `DISABLED`만 추가.

## 3. 데이터 모델

```prisma
enum SqlReviewLevel { DISABLED  INFO  WARN  BLOCK }

model SqlReviewRule {
  id        String        @id @default(cuid())
  env       TargetEnv
  ruleKey   String                       // 코드 규칙 카탈로그의 key (예: 'DROP_TABLE')
  level     SqlReviewLevel
  updatedAt DateTime      @updatedAt

  @@unique([env, ruleKey])
  @@index([env])
  @@map("sql_review_rule")
}
```
- **규칙 카탈로그는 코드 정의 유지** — `ruleKey`, 설명, matcher는 `lint.engine.ts`에 남는다(탐지 로직은 코드). 정책은 각 규칙의 `level`만 저장.
- 모든 `env × ruleKey` 조합(3 × 7 = 21행)을 **데이터 마이그레이션으로 삽입**한다(선택적 `seed.ts`가 아님). `start.sh`는 `--seed` 없이도 `prisma migrate deploy`를 항상 돌리므로, 21행을 마이그레이션에 넣어야 재기동 경로에서도 행 존재가 보장된다(C1 무회귀). `seed.ts`에도 dev 편의로 동일 upsert를 둘 수 있으나 진실 소스는 마이그레이션.
- **DISABLED는 관리 그리드 드롭다운 전용 값**이다(뱃지 아님). DISABLED 규칙은 LintItem이 생성되지 않으므로 프론트 `LintSeverityBadge`(INFO/WARN/BLOCK)에는 도달하지 않는다 — `badges.tsx` 수정 불필요.

## 4. 기본 정책 = 현행 동작 재현 (무회귀)

seed가 현재 `effectiveSeverity`를 그대로 재현한다:

| ruleKey | DEV | STAGING | PROD |
|---|---|---|---|
| DROP_DATABASE / DROP_TABLE / TRUNCATE / DELETE_WITHOUT_WHERE / UPDATE_WITHOUT_WHERE | `WARN` | `BLOCK` | `BLOCK` |
| ALTER_DROP_COLUMN | `WARN` | `WARN` | `WARN` |
| DROP_INDEX | `INFO` | `INFO` | `INFO` |

→ 기능 도입만으로는 lint/게이트 동작이 **바뀌지 않는다**. 이후 관리자가 셀 단위로 조정.

## 5. 엔진 변경 (순수성 유지)

- `lint.engine.ts`: `lintFiles(files, policy)`로 시그니처 변경 — `policy: Map<string, SqlReviewLevel>`(ruleKey→level, 해당 env 기준). 각 매칭 규칙의 level을 정책에서 조회:
  - `DISABLED` → 건너뜀(항목 미생성).
  - `INFO`/`WARN`/`BLOCK` → 해당 severity로 LintItem 생성.
  - 정책에 key 없음 → **`effectiveSeverity(base, env)`로 폴백**(코드 base가 아님). ⚠️ **`effectiveSeverity`는 삭제하지 않고 폴백 함수로 존치**한다 — DEV 강등(BLOCK→WARN)을 잃으면 무회귀가 깨진다(C1). 이 폴백을 위해 `lintFiles`는 `env`도 함께 받거나, 서비스가 결손 시 `effectiveSeverity`로 채운 완전한 Map을 넘긴다(후자 권장 — 엔진은 순수 Map만 소비).
- 엔진(`lint.engine.ts`)은 **DB 무의존**(정책 Map을 인자로 받음) → 단위테스트 유지. (참고: `apply.service.ts`는 이미 Prisma·Backup·Audit에 의존하므로 `SqlReviewService` 주입은 기존 패턴과 일관 — 새로 "불순"해지는 것은 없다.)
- 정책 로딩은 신규 `SqlReviewService.getPolicyMap(env): Promise<Map<ruleKey, level>>` — 해당 env의 DB 행을 규칙 카탈로그와 병합해 **7개 전 규칙에 대해 완전한 Map**을 반환(결손은 `effectiveSeverity(base, env)`로 채움). **캐싱 없음**(env당 7행·적용당 1회 조회, 캐시는 정책 반영 지연 버그만 유발).
- **조회 실패 시(fail-closed→base)**: `getPolicyMap`이 DB 예외로 실패하면 적용을 통째로 막지 않고, 카탈로그 base(=`effectiveSeverity`) Map으로 폴백해 진행(안전 규칙은 코드 base로 유지). 예외는 로깅.

## 6. 소비처 (정책 적용 지점)

`lintFiles`의 **실제 호출부는 2곳뿐**(`apply.service.ts`의 적용 게이트 + lint 미리보기 `lint()`): 둘 다 `SqlReviewService.getPolicyMap(cr.targetEnv)` → `lintFiles(files, policyMap)`로 교체.
- `apply.service.ts` 적용 lint 게이트(BLOCK 차단) — 현행 게이트 로직/배치 그대로(게이트는 `startExecution` 트랜잭션 **밖**에서 실행되므로 `getPolicyMap`도 트랜잭션 밖), severity 소스만 정책.
- lint 미리보기 엔드포인트(`POST /change-requests/:id/lint`, DEVELOPER/APPROVER) — 조기 노출. (미리보기 권한은 그대로; 정책 로딩은 내부 서비스 호출이라 ADMIN 무관.)
- CR 상세 화면의 lint 표시는 위 미리보기 결과를 그대로 렌더 → 자동 반영.
- **dry-run은 대상 아님**: `dry-run.service.ts`는 `lintFiles`/severity를 소비하지 않고 자체 `destructive` 분류만 쓴다 → 이번 범위에서 dry-run에 lint를 붙이지 않는다(YAGNI).
- `ApplyModule`이 `SqlReviewService`를 주입받도록 provider/import 등록(§10).

## 7. 정책 API (ADMIN)

신규 `src/sql-review` 모듈 (관리 화면 전용 → 컨트롤러 클래스 레벨 **ADMIN 전용**):
- `GET /sql-review-policy` — **ADMIN 전용**. 규칙 카탈로그(ruleKey·설명·base) + 환경별 현재 level을 합쳐 반환(그리드 렌더용).
- `PATCH /sql-review-policy` — **ADMIN 전용**. body `{ env, ruleKey, level }` → upsert. 유효 ruleKey/env/level 검증.

> 참고: lint 실행 시점(적용/미리보기)에 개발자 등 일반 사용자가 보는 정책 반영은 이 엔드포인트가 아니라 **`SqlReviewService.getPolicyMap(env)` 내부 서비스 호출**로 이뤄진다(엔드포인트는 관리 그리드 전용).

## 8. 관리 UI (ADMIN)

- `apps/web/app/(app)/sql-review/page.tsx` — ADMIN 아니면 "접근 불가". `PageHeader title="SQL 리뷰 정책"`.
- **규칙 × 환경 그리드**: 행=규칙(key + 설명), 열=DEV/STAGING/PROD, 셀=level 드롭다운(DISABLED/INFO/WARN/BLOCK). 변경 시 `PATCH` 저장(셀 단위 or 저장 버튼). 기존 시맨틱 토큰·테이블 패턴 재사용.
- 사이드바 ADMIN 메뉴에 "SQL 리뷰 정책"(`/sql-review`) 추가.

## 9. 감사 연동

- 정책 변경 시 `AuditAction`에 `SQL_POLICY_UPDATED`, `AuditTargetType`에 `SQL_REVIEW_POLICY`를 추가하고, `SqlReviewService.update`에서 `AuditService.record`(targetType=`SQL_REVIEW_POLICY`, targetId=`${env}:${ruleKey}`, metadata `{env, ruleKey, from, to}`). 감사 로그(이미 구현)와 자연 연동.

## 10. 영향 범위 / 리스크

- **백엔드**:
  - `schema.prisma`(+마이그레이션: `SqlReviewRule` 모델·`SqlReviewLevel` enum·`SqlReviewPolicyRule` 21행 데이터 삽입).
  - `lint.engine.ts`(`lintFiles` 시그니처 정책화; **`effectiveSeverity`는 폴백으로 존치**).
  - `src/sql-review`(신규 module/service/controller/dto — 규칙 카탈로그 노출 + getPolicyMap + update).
  - `apply.service.ts`(2개 호출부에 `SqlReviewService.getPolicyMap` 주입) + `apply.module.ts`(`SqlReviewService` 등록/import).
  - `AuditAction`(+`SQL_POLICY_UPDATED`), `AuditTargetType`(+`SQL_REVIEW_POLICY`).
- **프론트**: `lib/api.ts`(정책 조회/수정), `app/(app)/sql-review/`(신규 그리드), `components/sidebar.tsx`(ADMIN 네비), `components/icons.tsx`(아이콘), **`app/(app)/audit/page.tsx`의 하드코딩 `ACTION_OPTIONS`/`TARGET_TYPE_OPTIONS`에 새 감사 enum 값 추가**(안 하면 감사 필터에서 정책 변경 이벤트 필터 불가 — M2).
- **테스트 파급(M3)**:
  - `apply.service.spec.ts`는 서비스를 `new ApplyService(prisma, backups, audit)`로 **수동 인스턴스화** → `SqlReviewService` mock 인자 추가(`getPolicyMap`이 기본 정책 Map 반환). lint 게이트 회귀 테스트(DEV 통과/PROD 차단)가 그대로 통과해야 함.
  - `lint.engine.spec.ts`의 `effectiveSeverity` 직접 검증 테스트 → 폴백 존치에 맞춰 유지/재작성, 그리고 `lintFiles(files, policyMap)` 기반 케이스 추가.
- **리스크**: 무회귀는 (a) 데이터 마이그레이션 21행 + (b) `effectiveSeverity` 폴백 존치로 이중 보장. 기본 정책 Map == 현행 동작임을 검증하는 회귀 테스트를 게이트 스펙에 명시.
- **신규 규칙 추가 워크플로우**: 코드 카탈로그에 규칙을 추가하면 반드시 **동반 데이터 마이그레이션**으로 21→24행처럼 새 `ruleKey`의 정책 행을 삽입한다(누락 시 폴백 경로를 타므로 base로만 동작).

## 11. 비목표 (YAGNI)

- 커스텀 규칙 추가 UI(탐지 matcher는 코드). 대상DB별 정책(환경 단위로 충분). Bytebase 200+ 룰(현 7개 + 향후 코드 추가). 규칙별 파라미터(예: 네이밍 컨벤션 정규식) — 후속.
- **DISABLE 하한(floor) 없음**: ADMIN은 PROD에서도 어떤 규칙이든 `DISABLED`로 끌 수 있다(예: `DROP_DATABASE`). 통제는 **사후 감사(`SQL_POLICY_UPDATED`)** 로만 한다. 조직 요건상 특정 규칙의 PROD DISABLE 금지가 필요하면 PATCH DTO 검증에 하한을 추가(후속).

## 12. 성공 기준

- 관리자가 `/sql-review`에서 규칙×환경 수준을 조정하고 저장할 수 있다.
- 저장된 정책이 **lint 미리보기·적용 게이트**에 반영된다(예: DEV에서 `TRUNCATE`를 `BLOCK`으로 올리면 DEV 적용이 차단됨). ※ dry-run은 lint를 소비하지 않으므로 대상 아님.
- 기본 정책은 현행 동작을 **정확히 재현(무회귀)** — 기존 apply/lint 테스트 그대로 통과. `--seed` 없이 `migrate deploy`만 한 재기동 경로에서도 DEV 강등이 유지된다(데이터 마이그레이션 + 폴백 이중 보장).
- `DISABLED` 규칙은 어디에도 표시되지 않는다(LintItem 미생성).
- 정책 변경이 감사 로그(`SQL_POLICY_UPDATED` / targetType `SQL_REVIEW_POLICY`)에 남고, 감사 페이지 필터에서 조회된다.
- 엔진(`lint.engine.ts`)은 DB 없이 단위테스트 가능(정책 Map 주입).
