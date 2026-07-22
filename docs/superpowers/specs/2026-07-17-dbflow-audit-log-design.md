# DBFlow — 감사 로그(Audit Log) 설계

- 작성일: 2026-07-17
- 상태: 설계 확정 대기(critic 리뷰 반영)
- 범위: 백엔드(`apps/api`) 감사 기록·조회·내보내기 + 프론트(`apps/web`) 관리자 감사 페이지
- 목적: 규제·내부통제 조직이 "누가·언제·무엇을·왜" 변경했는지 **불변·조회·내보내기 가능한 증빙**을 남긴다 (CLAUDE.md 제품 비전의 1순위 구매 트리거).

## 1. 배경

DBFlow는 검토·결재 절차를 강제하지만, 그 활동의 **종합 감사 추적**이 없다. 기존 `StatusHistory`는 CR 상태 전이만(도메인 타임라인용) 남긴다. 규제 시장(금융·공공)은 로그인·권한거부·설정변경·적용까지 포함한 교차-도메인 감사 증빙과 tamper-resistance를 요구한다.

## 2. 원칙 / 비목표

**원칙**
- 의미 있는 **도메인 이벤트를 서비스 레벨에서 명시 기록**(HTTP 인터셉터 아님) — 감사관이 원하는 건 raw HTTP가 아니라 "PROD CR을 누가 승인했나".
- 성공 이벤트는 명시 호출, **보안 실패(로그인 실패·권한거부)는 글로벌 ExceptionFilter**로 포착.
- **append-only** + DB 레벨 변조 차단.

**비목표(YAGNI)**
- 읽기 쿼리 감사(쿼리 콘솔 없음), SIEM 실시간 스트리밍, 해시체인 tamper-evidence(추가 시점 §9에 명기), 데이터 마스킹 연동.
- dry-run·lint·연결테스트·diff preview 등 비파괴/읽기 액션은 감사하지 않음(소음 방지).

## 3. 데이터 모델 (`AuditLog`, append-only)

```prisma
enum AuditAction {
  LOGIN_SUCCESS
  LOGIN_FAILURE
  ACCESS_DENIED            // 403(RolesGuard/서비스 게이트)
  USER_CREATED
  USER_PROFILE_UPDATED     // 자가 프로필 수정(updateMe). role 변경 엔드포인트는 현재 없음(§8-G)
  CR_CREATED
  CR_SUBMITTED
  CR_REVIEWED
  CR_APPROVED
  CR_ASSIGNEES_CHANGED
  CR_APPLIED
  CR_ROLLED_BACK
  TARGET_DB_CREATED
  TARGET_DB_UPDATED
  TARGET_DB_DELETED
}

enum AuditTargetType { CHANGE_REQUEST  USER  TARGET_DATABASE  EXECUTION  AUTH }
enum AuditOutcome    { SUCCESS  FAILURE }

model AuditLog {
  id          String          @id @default(cuid())
  createdAt   DateTime        @default(now())
  // 행위자 스냅샷(행위 시점 값 — 사용자가 나중에 바뀌어도 증빙 보존). FK 아님(append-only 영속성).
  actorId     String?         // 로그인 실패 등 미인증 시 null 가능
  actorName   String?
  actorRole   String?
  actorDept   String?
  action      AuditAction
  targetType  AuditTargetType
  targetId    String?
  summary     String          @db.Text   // 사람이 읽는 한 줄
  metadata    Json?                       // 민감정보 제외(§5)
  outcome     AuditOutcome    @default(SUCCESS)
  ip          String?
  userAgent   String?         @db.Text

  @@index([createdAt])
  @@index([actorId])
  @@index([action])
  @@index([targetType, targetId])
}
```

- `actorId`는 **FK로 걸지 않는다**(스냅샷으로 영속성 확보; user 삭제 경로는 현재 없으나 append-only 원칙과 일관).
- `AuditLog`는 다른 모델과 관계를 갖지 않는다(독립 append-only 테이블).

## 4. 캡처 아키텍처

### 4.1 actor 스냅샷 확보 — 추가 쿼리 0 (리뷰 B)
`JwtStrategy.validate`(`apps/api/src/auth/jwt.strategy.ts`)는 이미 매 요청 `usersService.findById()`로 User 전체를 로드한다. 반환 페이로드를 확장:
- `CurrentUserPayload`(`current-user.decorator.ts`)에 `name`, `department` 추가(role은 이미 있음).
- `validate()`가 `{ userId, role, name, department }` 반환.
- **JWT 토큰 payload 자체는 확장하지 않는다**(department 변경 시 재로그인 전까지 stale 되는 것을 방지).
- `AuditService.record(...)`는 actor 스냅샷을 인자로 받고, 호출부(서비스)는 `request.user`(=CurrentUserPayload)를 그대로 전달.

### 4.2 성공 이벤트 — 서비스 레벨 명시 기록 (리뷰 A·E)
`AuditService`(신규 `src/audit`)의 `record()`를 **도메인 서비스** 안에서 호출한다(컨트롤러 아님 → `schema-diff.service.applyToChangeRequest`가 `ChangeRequestService.create`를 재사용하는 경로도 자동 포함).

**트랜잭션 경계**:
- **CR 상태 전이(submit/review/approve)**: `change-request.service.ts`의 `applyTransition` 내부 `$transaction([...])` **배열에 `auditLog.create`를 한 줄 추가** → 상태변경·StatusHistory·AuditLog가 원자적으로 커밋(발산 방지).
- **CR 지정변경(setAssignees)**: 해당 update와 함께 기록.
- **적용/롤백(apply/rollback)**: 실제 변경은 **원격 MySQL**에서 일어나 로컬 `$transaction`으로 감쌀 수 없다. `Execution`+`ExecutionStep`이 이미 durable 증빙이므로, AuditLog(`CR_APPLIED`/`CR_ROLLED_BACK`)는 **Execution 확정 직후**(`apply.service.ts`의 `finalizeSuccess`의 `ops` 배열 또는 그 직후) 기록. 감사 기록이 실패해도 Execution이 증빙으로 남음을 명시.
- **사용자 생성/프로필수정, 대상DB 생성/수정/삭제**: 각 서비스 메서드에서 성공 직후 기록(단일 write라 트랜잭션 이슈 없음).

### 4.3 실패 이벤트 — 글로벌 ExceptionFilter (리뷰 C)
성공 후 명시 호출 방식은 실패를 못 잡는다(예외가 먼저 throw). 규제상 **로그인 실패·권한거부는 필수 감사 대상**이므로 `AuditExceptionFilter`(신규, `app.useGlobalFilters`) 하나로 포착:
- `UnauthorizedException` on `/auth/login` → `LOGIN_FAILURE`(actor 미상, 시도 이메일은 metadata에, IP/UA 기록).
- `ForbiddenException`(RolesGuard·서비스 게이트) → `ACCESS_DENIED`(actor=request.user, 대상 경로/리소스 metadata).
- 그 외 예외는 감사하지 않음(도메인 검증 실패 등은 소음). 필터는 로깅 후 예외를 그대로 재던진다(응답 동작 불변).

## 5. 민감정보 / 중복 방지

- **대상DB 비밀번호·passwordEnc 절대 미기록.** TARGET_DB_UPDATED는 metadata에 값 대신 `credentialChanged: true` 플래그만.
- **SQL 본문은 복제하지 않음** — 원본은 `ChangeRequestFile`에 불변 보존되므로 AuditLog는 CR id·파일 참조만(로그 비대·유출 방지).
- StatusHistory와 CR 전이가 양쪽에 남는 중복은 **관심사 분리로 수용**(StatusHistory=도메인 타임라인, AuditLog=교차도메인 증빙). §4.2대로 같은 트랜잭션에서 써 발산 방지.

## 6. 불변성 / 변조 차단 (리뷰 D)

- 앱 레벨: 생성·조회 API만. **수정·삭제 엔드포인트·서비스 메서드 없음.**
- DB 레벨: 마이그레이션에 **MySQL 트리거** 추가 — `audit_log` 테이블의 `BEFORE UPDATE`/`BEFORE DELETE`에서 `SIGNAL SQLSTATE '45000'`로 차단. 앱 계정이 UPDATE/DELETE 권한을 갖더라도 물리적으로 거부.
- 해시체인 tamper-evidence는 보류(§9). 트리거로 MVP tamper-resistance 확보.

## 7. 조회 / 내보내기 / 권한

- **ADMIN 전용** `/audit-logs` API + 프론트 `(app)/audit` 페이지.
  - 필터: 행위자, 액션, 대상유형, 기간(from/to), outcome. **커서 또는 offset 페이지네이션**(무기한 누적 대비).
  - `GET /audit-logs?actor=&action=&targetType=&from=&to=&outcome=&page=`.
- **내보내기**: `GET /audit-logs/export?<filters>&format=csv|json` — 필터된 결과를 CSV/JSON로. metadata(JSON)는 CSV에서 문자열 직렬화. 대용량은 스트리밍 응답(청크)로.
- 프론트: 테이블(시각·행위자·액션·대상·결과) + 상세(메타데이터 펼침) + 필터 바 + "내보내기" 버튼. 기존 시맨틱 토큰/테이블 패턴 재사용.

## 8. 결정 사항 요약 (critic 반영)

| # | 결정 | 채택 |
|---|---|---|
| A | audit 트랜잭션 경계 | CR 전이=`$transaction` 내부 / apply·rollback=Execution 확정 후 |
| B | actor 스냅샷 | `JwtStrategy.validate` 반환 확장(추가쿼리 0), 토큰 미확장 |
| C | 실패 감사 | 글로벌 ExceptionFilter(LOGIN_FAILURE·ACCESS_DENIED) |
| D | 불변성 | 앱레벨 + MySQL 트리거(UPDATE/DELETE 차단) |
| E | 기록 레이어 | 서비스 레벨 |
| G | USER_PROFILE_UPDATED 범위 | 자가 프로필 수정만(role 변경 엔드포인트 부재) |

**F(보존기간) — 사용자 확인 필요**: MVP는 **무기한 보존**으로 두되, 규제 요건(예: 5~7년 + legal hold)과 PIPA 데이터최소화 사이의 정책은 조직 요건에 맞춰 확정 필요. 설정형 보존정책은 후속 과제.

## 9. 영향 범위 / 후속

- **신규**: `src/audit`(module·service·controller·`AuditExceptionFilter`), `AuditLog` 모델+마이그레이션(+트리거), 프론트 `(app)/audit/page.tsx`, api 클라이언트·사이드바 ADMIN 네비 항목.
- **수정**: `jwt.strategy.ts`·`current-user.decorator.ts`(actor 스냅샷 필드), `change-request.service.ts`(`applyTransition`·`setAssignees`에 audit), `apply.service.ts`·`rollback.service.ts`(확정 후 audit), `users.service.ts`·`target-database.service.ts`(성공 후 audit), `auth.service.ts`(LOGIN_SUCCESS), `main.ts`(글로벌 필터).
- **후속(YAGNI/차기)**: 해시체인 tamper-evidence, 설정형 보존기간+legal hold, INSERT-only DB 계정 분리, export 스트리밍 최적화, 관리자 user-수정(생기면 USER_ROLE_CHANGED 추가).

## 10. 성공 기준

- 로그인(성공·실패), 사용자 생성/프로필수정, CR 생성/제출/검토/결재/지정변경, 적용/롤백, 대상DB 생성/수정/삭제가 모두 AuditLog에 남는다.
- 권한거부(403)와 로그인 실패가 `ACCESS_DENIED`/`LOGIN_FAILURE`로 기록된다.
- AuditLog는 API로도 DB 직접 UPDATE/DELETE로도 변조 불가(트리거).
- 대상DB 비밀번호·SQL 본문이 로그에 중복 저장되지 않는다.
- ADMIN이 감사 페이지에서 필터·조회하고 CSV/JSON로 내보낼 수 있다.
- 감사 기록 실패가 도메인 트랜잭션을 깨지 않는다(CR 전이는 원자적, apply는 Execution이 증빙).
