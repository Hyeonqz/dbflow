# 변경 작업창 · 동결 기간 (Apply Window & Freeze) 설계

> 2026-07-19. Tier-2 B1. 브레인스토밍 확정판.
> 근거: docs/roadmap-tier2-candidates.md B1 — ITIL 변경 캘린더(blackout/maintenance window), Archery 예약실행, Bytebase 스케줄 롤아웃 리서치.

## 1. 목표와 원칙

승인된 변경이라도 **승인된 시간대에만** 적용되도록 시간 축의 통제를 추가한다.

- **작업창(ApplyWindow)**: 환경별 주간 반복 허용 창(예: PROD = 화·목 02:00~04:00). 창이 **하나라도 정의된 환경**은 창 안에서만 적용 가능. **창이 없는 환경은 항상 허용** — 무회귀, DEV는 기본 자유.
- **동결(FreezePeriod)**: 환경별 절대 기간(시작~종료 일시 + 사유). **작업창보다 우선** — 동결 중이면 창 안이라도 차단.
- 게이트 대상은 **apply만**. lint·dry-run(읽기 전용 검사)과 **rollback(비상 복구)은 게이트하지 않는다** — 동결 중 롤백 차단은 오히려 위험.
- 판정 시각은 **Asia/Seoul 벽시계** 기준. **(critic C1) 이는 가정이 아니라 강제 사항이다**:
  - API 프로세스는 `TZ=Asia/Seoul`로 기동해야 한다 — `start.sh`의 API 기동 라인에 `TZ` 주입.
  - **부팅 어서션**: API 부트스트랩에서 `Intl.DateTimeFormat().resolvedOptions().timeZone`을 확인해 `Asia/Seoul`이 아니면 경고 로그 + `GET /apply-schedule` 응답의 `timezone` 필드로 노출(프론트 관리 페이지가 불일치 배너 표시). UTC 컨테이너에서 창이 9시간 밀리는 무증상 오게이트 방지.
- 사용자 확정 사항: 작업창+동결 병행 모델 / **수동 게이트만**(예약 자동 실행 없음, 스케줄러 미도입) / 환경별 정의 / 동결 긴급 우회는 A3(긴급 변경)에서 다룸.

## 2. 데이터 모델 (Prisma)

신규 테이블 2개. 기본 무행 = 전부 허용이므로 데이터 마이그레이션(백필) 불필요.

```prisma
model ApplyWindow {
  id          String    @id @default(cuid())
  env         TargetEnv
  dayOfWeek   Int       // 0=일 ~ 6=토
  startMinute Int       // 0~1439 (02:00 = 120)
  endMinute   Int       // exclusive. start < end 강제(자정 넘김 금지 — 두 창으로 분할 입력)
  @@index([env])
  @@map("apply_window")
}

model FreezePeriod {
  id          String    @id @default(cuid())
  env         TargetEnv
  startsAt    DateTime
  endsAt      DateTime
  reason      String
  createdById String
  createdBy   User      @relation("freezeCreator", fields: [createdById], references: [id])
  createdAt   DateTime  @default(now())
  @@index([env])
  @@map("freeze_period")
}
```

`User`에 `createdFreezes FreezePeriod[] @relation("freezeCreator")` 추가.

## 3. 판정 로직 — `ApplyScheduleService`

```
checkApplyAllowed(env, now = new Date()):
  1. 동결: env의 FreezePeriod 중 startsAt <= now < endsAt 존재
     → { allowed: false, reason: 'FROZEN', freeze: { reason, endsAt } }
  2. 창 무정의: env의 ApplyWindow 0행 → { allowed: true }
  3. 창 매칭: dayOfWeek == now요일 && startMinute <= now분 < endMinute 인 창 존재
     → { allowed: true }
  4. 그 외 → { allowed: false, reason: 'OUT_OF_WINDOW', nextWindow: { dayOfWeek, startMinute, endMinute } }
```

- `nextWindow` = now 이후 7일 내 최근접 창(같은 날 이후 시작 창 포함, 요일 순환 스캔). 창이 있는데 못 찾는 경우는 없음(주간 반복이므로 항상 7일 내 존재).
- `assertApplyAllowed(env)` → 불허 시 `ConflictException(409)`:
  - FROZEN: `동결 기간입니다: {reason} ({endsAt 로컬 포맷}까지)`
  - OUT_OF_WINDOW: `적용 작업창이 아닙니다. 다음 작업창: {요일} {HH:mm}~{HH:mm}`
- **(critic I1) 판정 쿼리 실패 시 예외를 그대로 전파한다(적용 중단 = fail-closed).** 절대 catch 후 `allowed: true`로 폴백하지 않는다 — 일시적 DB 장애가 동결 우회 구멍이 되면 안 된다.
- **(critic M3) 게이트는 '개시 시점' 통제다**: 03:59에 통과한 적용이 백업에 5분 걸려 창 밖에서 SQL이 실행되는 것, 실행 도중 등록된 동결이 진행 중 실행을 중단시키지 않는 것은 **의도된 수용**이다(실행 중단은 더 위험).

## 4. API — `apply-schedule` 모듈 (approval-policy 패턴 준용)

| 라우트 | 권한 | 용도 |
|---|---|---|
| `GET /apply-schedule` | 로그인 공통 | `{ windows: ApplyWindow[], freezes: FreezePeriod[], serverTime, timezone }` — 관리 페이지·상세 배너용. **(critic M4) freezes는 진행중·미래만 반환** — 과거 동결은 게이트에 영향 없는 감사 잔재로 남기고 목록·삭제 대상에서 제외한다(의도된 결정). `timezone`은 부팅 어서션의 결과값(프론트 불일치 경고용). |
| `GET /apply-schedule/status?env=` | 로그인 공통 | `{ allowed, reason?, nextWindow?, freeze? }` — CR 상세 적용 패널 배너. **(critic M1) `env`는 `@IsEnum(TargetEnv)` 필수 쿼리 파라미터** — 누락/오값 400. |
| `POST /apply-schedule/windows` | ADMIN(메서드 레벨 @Roles) | 창 추가 `{ env, dayOfWeek, startMinute, endMinute }` |
| `DELETE /apply-schedule/windows/:id` | ADMIN | 창 삭제 (수정 = 삭제+추가) |
| `POST /apply-schedule/freezes` | ADMIN | 동결 등록 `{ env, startsAt, endsAt, reason }` |
| `DELETE /apply-schedule/freezes/:id` | ADMIN | 동결 해제 |

컨트롤러 레벨 `@Roles` 금지(GET 개방 유지) — approval-policy 컨트롤러와 동일 패턴.

DTO 검증: `dayOfWeek` 0~6 정수, `0 <= startMinute < endMinute <= 1440`(1440 = 24:00 종료 허용 — now분은 0~1439라 exclusive 비교 정상), `startsAt < endsAt`(커스텀 검증), `reason` 1~200자 필수, env는 `@IsEnum(TargetEnv)`.

**(critic I2) 동결 시각 변환 계약**: `<input type="datetime-local">` 값은 **Asia/Seoul 벽시계로 해석**한다. 프론트가 `YYYY-MM-DDTHH:mm` 문자열을 그대로 API에 보내고, API DTO가 KST(+09:00) 고정 오프셋으로 절대 시각(UTC instant)으로 변환해 저장한다(`new Date(\`${value}+09:00\`)`). 브라우저/서버 TZ가 무엇이든 관리자가 입력한 KST 벽시계가 보존된다. 테스트: KST 벽시계 입력 → 저장된 UTC instant 검증.

## 5. 게이트 통합

`ApplyService.apply()`에서 기존 권한 게이트(`assertApplyPermission`)·상태 게이트(`assertApprovalGate`) 직후, 린트·백업·`startExecution` **전에** 1줄:

```ts
await this.schedule.assertApplyAllowed(target.env);
```

- Execution 행 생성 전이므로 거부 시 실패 잔재 없음.
- `ApplyScheduleModule`은 **`exports: [ApplyScheduleService]`** 필수(approval-policy 모듈과 동일). `ApplyModule`이 import, `ApplyService` 생성자 5번째 인자로 주입 — **기존 `apply.service.spec.ts`의 모든 `new ApplyService(...)` 호출부에 schedule mock 추가 필요**(파급 인지).

## 6. 프론트

- **관리 페이지 `/apply-schedule`** ("작업창·동결", ADMIN 전용, 사이드바 ADMIN 그룹에 추가 — 결재 정책 옆):
  - 상단: 환경별 작업창 목록 테이블(환경/요일/시작/종료 + 삭제 버튼) + 추가 폼(환경 셀렉트, 요일 셀렉트, 시간 입력 2개 `<input type="time">`). **(critic I3) 종료 시각 `00:00` 입력은 `endMinute=1440`(자정 종료)으로 매핑**하고 폼에 "종료 00:00 = 24:00(자정)" 힌트 표기 — 22:00~24:00 같은 자연스러운 창을 표현 가능하게.
  - `timezone` 필드가 `Asia/Seoul`이 아니면 페이지 상단에 경고 배너("서버 타임존 불일치 — 창 판정이 어긋날 수 있음").
  - 하단: 동결 목록(환경/기간/사유/등록자 + 해제 버튼) + 등록 폼(`<input type="datetime-local">` 2개 + 사유).
  - sql-review/approval-policy 페이지의 낙관적 반영·에러 배너·토큰 패턴 재사용.
- **CR 상세 적용 패널**: **(critic M2) 마운트 시 `cr.targetEnv`로** `GET /apply-schedule/status?env=` 조회(적용 가능 DB는 이미 CR 환경으로 필터되므로 DB 선택과 무관) → 배너 3종("지금 적용 가능" emerald / "작업창 아님 — 다음: {요일 HH:mm~HH:mm}" amber / "🧊 동결 중: {사유} ({~까지})" red) + 적용 버튼 disabled(서버가 최종 강제이므로 UI는 보조).

## 7. 감사

- `AuditAction` += `APPLY_WINDOW_UPDATED`, `FREEZE_UPDATED`. `AuditTargetType` += `APPLY_SCHEDULE`.
- 창 추가/삭제 → `APPLY_WINDOW_UPDATED` (metadata: `{ op: 'CREATE'|'DELETE', env, dayOfWeek, startMinute, endMinute }`).
- 동결 등록/해제 → `FREEZE_UPDATED` (metadata: `{ op, env, startsAt, endsAt, reason }`).
- 감사 페이지 필터 옵션에 두 액션·대상유형 추가.
- 게이트 거부(409)는 별도 감사하지 않음 — 다른 4xx 게이트(제출 인원 미달 등)와 동일 취급.

## 8. 테스트

- **판정 유닛**(`apply-schedule.service.spec.ts`, `new Service(mockPrisma, mockAudit)` 패턴):
  창 내 허용 / 창 외 거부+nextWindow / 무창 허용 / 동결 우선(창 내여도 거부) / 동결 경계(startsAt==now 거부, endsAt==now 허용) / 창 경계(startMinute==now분 허용, endMinute==now분 거부) / 요일 순환 nextWindow(일요일 밤→화요일 창).
- **게이트**(`apply.service.spec.ts` 기존 mock에 schedule mock 추가): 거부 시 409 + Execution 미생성, 허용 시 기존 플로우 통과.
- **API**: DTO 검증 에러, ADMIN 가드(비ADMIN POST/DELETE 403, GET 200).
- 프론트: tsc + build + 수동(체크리스트 §11 신설).

## 9. 비범위 (명시)

- **예약 자동 실행**(스케줄러, 창 도래 시 무인 적용) — 후속 확장. 이번엔 수동 게이트만.
- **동결 긴급 우회** — A3(긴급 변경 fast-path)에서 다룸.
- **타임존 설정화** — Asia/Seoul 고정(§1의 TZ 강제·어서션으로 보장). 다른 TZ 지원은 비범위.
- **자정 넘김 창** — start < end 강제, 두 창으로 분할 입력.
- **대상 DB 단위 창** — 환경 단위만(결재 정책과 동일 축).

## 10. 성공 기준

1. PROD에 화·목 02:00~04:00 창 설정 → 그 외 시각 PROD 적용 시도 409 + "다음 작업창" 안내, 창 내 적용 성공.
2. 동결 등록(사유 "분기말 동결") → 창 내여도 PROD 적용 409 + 사유 노출, 해제 후 재적용 성공.
3. 창 미설정 환경(DEV)은 기존과 동일하게 항상 적용 가능(무회귀).
4. 동결 중에도 rollback은 정상 동작.
5. 창/동결 변경이 감사 로그에 남고 필터로 조회된다.
6. 비ADMIN은 관리 페이지 접근 불가·mutation 403, 모든 로그인 사용자는 상태 조회 가능.
