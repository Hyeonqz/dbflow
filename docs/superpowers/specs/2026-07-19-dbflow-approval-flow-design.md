# DBFlow — 커스텀 승인 플로우 (환경별 결재 인원) 설계

- 작성일: 2026-07-19 (critic 검수 반영 확정판)
- 상태: 설계 확정
- 범위: 백엔드(`apps/api`) 결재 정책·다중 결재자·승인 수집 + 프론트(`apps/web`) 정책 그리드·생성 폼·상세 진행률
- 목적: "결재자 1명 고정"을 **환경별 필요 결재자 수(N)** 로 승격. 지정된 N명 **전원 승인** 시 최종 승인 — 규제 조직의 다중 결재 요구(예: PROD 2인 결재) 대응. (Tier 1 마지막 항목)

## 1. 배경 (현재 상태)

- 상태머신: `REVIEW_APPROVED ──FINAL_APPROVE──> FINAL_APPROVED` — 결재는 단일 액션.
- 지정(스펙1): `ChangeRequest.approverId`(단일) — 지정 결재자 1명만 `approve` 가능.
- 가시성: APPROVER는 `approverId = me AND status != DRAFT`.
- 생성 폼: 결재자 드롭다운 1개. 제출 시 reviewerId/approverId 필수.

## 2. 확정 결정 (브레인스토밍 + critic 검수)

| # | 결정 | 채택 |
|---|---|---|
| 범위 | 환경별 결재 **인원 수**만 (다단계 체인·M-of-N·조건부·검토자 다중화 비목표) | ✅ |
| 승인 성립 | 지정 N명 **전원 승인**. 한 명이라도 반려 → 즉시 반려 | ✅ |
| 기본값 | 전 환경 `1` (무회귀) | ✅ |
| 지정 모델 | 단일 `approverId` → **`ChangeRequestApprover` 조인 1개로 통합**(결정 컬럼 포함, 별도 Approval 테이블 없음 — 검수 #3A) | ✅ |
| 생성 검증 | **생성 시 optional / 제출 시에만 정책 개수 강제** (schema-diff 경유 생성 무파손 — 검수 #1A) | ✅ |
| 재지정 | 조인 행 **전체 교체** — 제거된 결재자의 결정도 함께 삭제(부활 이상 원천 차단 — 검수 #2A). 이력은 감사 로그(CR_ASSIGNEES_CHANGED)로 보존 | ✅ |
| 동시성 | **인터랙티브 `$transaction` + CR 행 `FOR UPDATE` 락**(`apply.service.ts` `startExecution` 선례) — 검수 #5 | ✅ |
| 정책 API | GET=로그인 사용자(생성 폼용), **PATCH만 ADMIN** (메서드 레벨 가드 — 검수 #4A) | ✅ |
| 승인 순서 | 동시 허용(순차 강제 없음) | ✅ |

## 3. 데이터 모델

```prisma
enum ApprovalDecision { APPROVE  REJECT }

model ApprovalPolicy {
  id                String    @id @default(cuid())
  env               TargetEnv @unique
  requiredApprovals Int       @default(1)      // API에서 1..5 검증
  updatedAt         DateTime  @updatedAt

  @@map("approval_policy")
}

model ChangeRequestApprover {
  id              String            @id @default(cuid())
  changeRequestId String
  userId          String
  order           Int                               // 표시 순서(승인 순서 강제 아님)
  decision        ApprovalDecision?                 // null = 대기(pending)
  comment         String?           @db.Text
  decidedAt       DateTime?

  changeRequest ChangeRequest @relation(fields: [changeRequestId], references: [id], onDelete: Cascade)
  user          User          @relation("assignedApprover", fields: [userId], references: [id])

  @@unique([changeRequestId, userId])
  @@index([userId])
  @@map("change_request_approver")
}
```

- **단일 테이블 통합**(검수 #3A): 지정과 결정을 `ChangeRequestApprover` 한 테이블이 담는다. `decision=null`이 "대기". 재지정=행 교체이므로 제거된 결재자의 결정은 자연 소멸(stale 부활 이상 없음). 개별 승인/반려의 영구 감사 증빙은 AuditLog(`CR_APPROVED`)가 담당.
- **`ChangeRequest.approverId` 제거**: relation("approver")·`@@index([approverId])` 포함. `reviewerId`는 단일 유지. `User.approvingRequests` relation 제거, `assignedApprover` 신설.
- **마이그레이션 순서(필수)**: ①`change_request_approver`·`approval_policy` 테이블 생성 → ②**백필**: `approverId IS NOT NULL`인 CR마다 조인 1행(`userId=approverId, order=0, decision=null`) INSERT → ③`approverId` FK 제약·인덱스·컬럼 drop → ④`ApprovalPolicy` 3행(DEV/STAGING/PROD, `requiredApprovals=1`)을 **고정 id로 데이터 마이그레이션 INSERT**(sql-review 선례 `migration.sql`의 고정-id 방식, 선택적 seed 아님). 진행 중(SUBMITTED/REVIEW_APPROVED) CR도 조인 1행 이전으로 계속 결재 가능(기본 정책 1과 일치 — 무회귀).
- 감사 enum: `AuditAction`에 `APPROVAL_POLICY_UPDATED`, `AuditTargetType`에 `APPROVAL_POLICY` 추가.

## 4. 승인 수집 로직 (인터랙티브 트랜잭션 + 행 락)

새 상태를 추가하지 않는다. `REVIEW_APPROVED`가 "결재 수집 중"을 겸한다. **`applyTransition`(배열형 `$transaction`) 재사용 불가** — 집계 후 조건부 전이는 인터랙티브 트랜잭션이 필요하다(검수 #2). `startExecution`의 `SELECT … FOR UPDATE` 선례를 따른다.

`approve(actor, id, {decision, comment})` — `this.prisma.$transaction(async (tx) => { … })`:
1. `tx.$queryRaw` `SELECT id, status FROM ChangeRequest WHERE id = ? FOR UPDATE` — **CR 행 락**(경쟁 승인 직렬화).
2. 상태 검증: `REVIEW_APPROVED`가 아니면 409(기존 규칙).
3. 게이트: `tx.changeRequestApprover.findUnique({ changeRequestId_userId })` — 미지정이면 403, `decision != null`이면 409(중복 결정 불가).
4. 결정 기록: 해당 조인 행 update(`decision, comment, decidedAt=now`).
5. 분기:
   - `REJECT` → `getNextStatus(status, 'FINAL_REJECT')`로 전이 + StatusHistory + AuditLog(`CR_APPROVED`, metadata `{decision:'REJECT', comment}`) — **한 명의 반려로 종결**.
   - `APPROVE` → 같은 tx에서 재집계: `현재 지정자 중 decision='APPROVE' 수 == 지정자 총수` 이면 `FINAL_APPROVE` 전이 + StatusHistory + AuditLog. 미달이면 **전이·StatusHistory 없음**, AuditLog만(`CR_APPROVED`, metadata `{decision:'APPROVE', progress:'1/2'}`).
- 락 덕분에 "A·B 동시 마지막 승인 → 둘 다 count 미달로 미전이(stuck)" 경쟁이 불가능하다(직렬화되어 마지막 승인자가 반드시 전이시킴).
- **성립 기준은 정책이 아니라 그 CR의 현재 지정자 수**다. 정책은 "제출 시 몇 명을 지정해야 하는가"의 입력 검증이며, 정책 변경은 진행 중 CR에 소급되지 않는다.
- 부분 승인의 타임라인: StatusHistory 대신 **detail의 `approvers`(각자 decision/decidedAt)를 프론트가 별도 렌더**(§7).

## 5. 생성·제출·재지정

- **생성**: DTO `approverId` → `approverIds?: string[]`(**optional** — 검수 #1A). 값이 있으면: 중복 없음·전원 APPROVER 역할(`assertAssigneeRoles`를 `findMany({id:{in}, role})` 배치 조회로 확장 — 검수 N+1 지적)·reviewer와 별개 검증. **개수는 생성 시 강제하지 않는다** → schema-diff `applyToChangeRequest`(approverIds 미전달) 경로 무파손. 생성 감사 metadata도 `approverIds`(복수)로.
- **제출**: reviewerId 존재 + **지정 결재자 수 == 대상환경 정책 `requiredApprovals`** 검증(불일치 400, 기존 "미지정 400" 확장).
- **재지정**(`setAssignees`): `approverIds: string[]`로 **조인 행 전체 교체**(deleteMany+createMany, 같은 tx). 제거된 결재자의 결정은 행과 함께 삭제(검수 #2A — 부활 이상 없음, 재추가 시 pending부터). 권한 규칙 동일(DRAFT=작성자, 이후 ADMIN). 감사 `CR_ASSIGNEES_CHANGED`(metadata에 이전/신규 approverIds).

## 6. 정책 API·관리 UI

신규 `src/approval-policy` 모듈(sql-review 구조 참조하되 **가드는 메서드 레벨** — 검수: sql-review처럼 컨트롤러 레벨 @Roles(ADMIN)로 복제하면 생성 폼이 깨짐):
- `GET /approval-policy` — **로그인 사용자 누구나**(생성 폼이 환경별 필요 인원을 조회). 3행 반환.
- `PATCH /approval-policy` — **ADMIN 전용**(`@Roles(Role.ADMIN)` 메서드 레벨). `{env, requiredApprovals}`(`@IsInt @Min(1) @Max(5)`) upsert. 감사 `APPROVAL_POLICY_UPDATED`(metadata from/to).
- 프론트 `/(app)/approval-policy` — ADMIN 전용 페이지. 환경별 숫자 입력(1~5). 사이드바 ADMIN 네비. 감사 필터 옵션(`APPROVAL_POLICY_UPDATED`/`APPROVAL_POLICY`) 추가.

## 7. 가시성·요약·상세·프론트

- **APPROVER 가시성**: `approvers: { some: { userId: me } }` + `status != DRAFT`.
- **요약(summary) 확장**: `SUMMARY_SELECT`에 `approvers: { select: { userId, decision }, orderBy: { order } }` + user 조인(이름). `toSummary(row, currentUserId)`가 평탄화: `approverNames: string[]`, `approvalProgress: { approved, required: 지정자수 }`, **`myApprovalPending: boolean`**(내가 지정자이고 decision=null이고 status=REVIEW_APPROVED). ※ SUMMARY_SELECT는 정적 상수 유지 가능 — 사용자 의존 필드는 select가 아니라 **toSummary에서 계산**(approvers를 로드하므로).
- **KPI/필터(검수 #3)**: 대시보드 APPROVER "결재 대기" match를 status 단독이 아니라 **`myApprovalPending`** 기준으로 교체(이미 승인한 결재자에게 대기로 집계되는 오류 제거). REVIEWER/DEVELOPER 카드 로직은 불변.
- **상세**: `DETAIL_INCLUDE`에 approvers(+user 이름·부서, decision/comment/decidedAt) 포함. 프론트 `[id]` 페이지: 결재자별 상태 리스트("홍길동 승인 · 김철수 대기"), 진행률 배지("결재 1/2"), 내가 pending 지정자면 승인/반려 버튼(결정했으면 내 결정 표시). **부분 승인은 StatusHistory에 없으므로 approvers 데이터로 별도 렌더**. `AssigneePanel`은 단일 셀렉트 → **N개 셀렉트 배열**(재지정도 배열) 재작성 — 파급 큼(§9).
- **생성 폼**: 환경 선택 → `GET /approval-policy`로 해당 env의 `requiredApprovals` 조회 → 결재자 셀렉트 **N개** 렌더(중복 선택 방지). 폼 제출 시엔 N명 채움 권장 UI(제출 API가 최종 강제).

## 8. 무회귀

- 정책 기본 전 환경 `1` → 생성 폼 셀렉트 1개, 전원(=1명) 승인 = 현행 동일.
- 기존 CR: `approverId` → 조인 1행 백필로 의미 보존(진행 중 CR 포함).
- schema-diff 경유 생성: 검증이 제출 시점이므로 무파손(검수 #1A).
- DEV 특성 명시: DEV는 `REVIEW_APPROVED` 상태에서도 apply 가능(`DEV_BLOCKED_STATUSES`에 미포함)하므로 **DEV에서 결재 수집은 apply를 막지 않는다** — 현행 동작이며 유지(다중 결재의 실효 대상은 STAGING/PROD).
- apply 게이트(`assertApprovalGate`)는 status 기반이라 무영향(검수로 확인됨).

## 9. 영향 범위 (검수 "What's Missing" 반영 — 구현 계획의 태스크 분해 기준)

- **백엔드 `change-request.service.ts` (최대 파급)**:
  - `getOrThrow` select의 `approverId` → `approvers` 관계 로드로 교체(approve 게이트가 의존).
  - `SUMMARY_SELECT`/`DETAIL_INCLUDE`의 `approverId/approver` → `approvers` 중첩으로 교체, `toSummary`/`toDetail` 평탄화 복수형 재작성(+`myApprovalPending`/`approvalProgress` 계산).
  - `submit()` 게이트: `!approverId` → "지정 수 == 정책" 검증(ApprovalPolicy 조회 — ApprovalPolicyService 주입).
  - `approve()`: §4 인터랙티브 tx + FOR UPDATE 재작성(applyTransition은 submit/review 경로에 그대로 존치).
  - `setAssignees` + `AssigneesDto`: `approverIds: string[]` 전체 교체.
  - `create()`: `approverIds` optional 처리 + `assertAssigneeRoles` 배치화 + 감사 metadata 복수형.
  - `visibilityWhere` APPROVER 분기.
- **기타 백엔드**: `schema.prisma`+마이그레이션(§3 순서 엄수), `create-change-request.dto.ts`(approverIds), `src/approval-policy`(신규 module/service/controller/dto — GET 로그인/PATCH ADMIN), 감사 enum 2종. `schema-diff.service.ts`는 **무변경**(create optional 덕).
- **프론트**: `lib/api.ts`(타입 전면 — `approverId/approverName` 제거, `approverNames/approvalProgress/myApprovalPending/approvers` 추가, 정책 API), 생성 폼(N개 셀렉트+정책 조회), 상세(`AssigneePanel` 재작성·결재 진행 UI·approvers 렌더), 대시보드(APPROVER 카드 `myApprovalPending`), `/(app)/approval-policy`(신규), 사이드바, `audit/page.tsx` 필터 옵션.
- **테스트 파급(구체)**: `change-request.service.spec.ts` — approve 게이트·전이 픽스처를 조인 mock(`approvers: [{userId, decision}]`)으로 전환. **`$transaction` mock이 배열형 가정인 테스트와 "tx 배열 길이 3" 단언 테스트는 재작성 필요**(approve가 인터랙티브 tx로 바뀜; submit/review는 배열형 유지라 해당 테스트는 존치). 신규 테스트: 전원 승인 집계, 부분 승인 무전이+감사, 반려 즉시 종결, 중복 결정 409, 미지정 403, 제출 시 정책 개수 검증, 재지정 행 교체.
- **교차 스펙 각주**: 텔레그램 스펙(`2026-07-17-dbflow-assignments-profiles-telegram-design.md` §5)은 `approverId` 단수와 "결재자 1명 알림"을 전제 — 본 스펙이 그 컬럼을 제거하므로 **스펙2 구현 시 다중 결재자 팬아웃(전원 알림, 부분/최종 승인 구분)으로 재설계 필요**. 양 스펙에 상호 참조 각주.

## 10. 비목표 (YAGNI)

- 다단계 승인 체인, M-of-N, 위험도/린트 조건부 승인, 검토자 다중화, 순차 승인 강제, 승인 위임/대결, 정책의 진행 중 CR 소급, 결재 알림(텔레그램 스펙2 후속 — §9 각주 참조), 제거된 결재자의 결정 이력 별도 보존(AuditLog로 갈음).

## 11. 성공 기준

- ADMIN이 `/approval-policy`에서 환경별 필요 결재자 수 설정(기본 전부 1), 변경이 감사에 남고 감사 필터로 조회된다.
- PROD 정책 2 설정 시: 생성 폼 결재자 2명 요구(UI) + 제출 시 2명 미지정이면 400, 2명 전원 승인 시에만 `FINAL_APPROVED`, 1명 승인 시 상세에 "결재 1/2"과 결재자별 상태 표시, 한 명 반려 시 즉시 `FINAL_REJECTED`.
- 동시 승인 경쟁에서도 정확히 한 번 전이(FOR UPDATE 직렬화) — stuck 없음.
- 같은 결재자 중복 결정 409, 미지정 사용자 결재 403.
- 이미 승인한 결재자의 대시보드 "결재 대기"에 해당 CR이 잡히지 않는다(`myApprovalPending`).
- 기본 정책(전부 1)에서 현행과 완전 동일(무회귀) — schema-diff 경유 생성 포함, 기존 테스트(재작성분 제외) 통과.
- 기존 CR의 단일 결재자가 조인으로 백필되어 계속 결재 가능.
