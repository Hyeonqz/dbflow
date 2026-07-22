# 위임 직무분리(SoD) 가드 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** 한 행위자가 한 CR에서 결재 슬롯을 최대 1개만 채우도록 강제(직접+대리, 대리+대리 모두 차단) — 스펙 `docs/superpowers/specs/2026-07-21-dbflow-delegation-sod-guard-design.md`.

**Architecture:** `change-request.service.ts` `approve()` tx 내 가드 1개 + `toDetail`의 `iAlreadyActed` 플래그로 대리·직접 버튼 게이트. 스키마 변경 없음(순수 로직).

**Tech Stack:** NestJS 10 + Prisma 5 + MySQL 8 / Next.js 14.

## Global Constraints

- 불변식: 한 행위자 ≤ CR당 결재 1건. **항상 강제**(설정 없음).
- 가드는 `approve()` tx 안, `FOR UPDATE` 하에서 슬롯 확정 후 update 직전. 409 ConflictException.
- `iAlreadyActed` = 뷰어가 이 CR에서 이미 결정(직접 decision≠null)했거나 대리(decidedById===뷰어)한 슬롯 보유. `canActAsDelegate`·직접 결재 버튼(`canApprove`) 둘 다 게이트.
- 무회귀: 정상 첫 결재 1건은 통과. 검토 대리 무영향(REVIEWER는 결재 슬롯 없음).
- 백엔드 유닛 `new Service(...)` mock. 프론트 tsc+build.

---

### Task 1: 백엔드 — approve() SoD 가드 + toDetail iAlreadyActed (TDD)

**Files:**
- Modify: `apps/api/src/change-request/change-request.service.ts`
- Modify: `apps/api/src/change-request/change-request.service.spec.ts`

**Interfaces:** approve()가 2번째 결재를 409로 차단. toDetail이 `iAlreadyActed: boolean` 반환 + `canActAsDelegate`에 `!actorAlreadyActed` 반영.

- [ ] **Step 1: 실패 테스트 (기존 spec에 append)**

기존 `change-request.service.spec.ts`의 approve `txPrisma` mock을 확장한다. **`changeRequestApprover.findFirst`를 where-shape로 분기**(critic — 기존 위임 조회 shape `where.userId.in`과 신규 가드 shape `where.OR`가 공존):
```ts
findFirst: ({ where }) => {
  if (where.OR) { // SoD 가드: id != where.id.not && (직접 결정 || decidedById===actor)
    return Promise.resolve(
      state.approvers.find((a) => a.id !== where.id?.not &&
        ((a.userId === where.OR[0].userId && a.decision != null) || a.decidedById === where.OR[1].decidedById)) ?? null);
  }
  return Promise.resolve( // 위임 슬롯 조회
    state.approvers.find((a) => where.userId.in.includes(a.userId) && a.decision === null) ?? null);
},
```
신규 테스트(각 outcome 단언):
1. 직접 결재 후 같은 사람이 대리 슬롯 시도 → 409 (state.approvers에 actor의 decided 직접 슬롯 + actor가 대리 가능한 미결정 슬롯).
2. 대리로 P2 채운 뒤 같은 사람이 P3 대리 시도 → 409 (P2 슬롯 decidedById=actor + P3 미결정 + actor가 P3 대리 가능).
3. 대리로 P2 채운 뒤 같은 사람이 자기 직접 슬롯 시도 → 409.
4. 정상 1건(대리 첫 결재 또는 직접 첫 결재)은 통과(status 전이/decidedById 정상).
5. SoD 409 메시지가 "이미 결재하셨습니다"와 다름(message 단언).
6. `toDetail`: 이미 결정/대리한 뷰어 → `canActAsDelegate===false` 且 `iAlreadyActed===true`; 아직 안 한 활성 대리인 → `canActAsDelegate===true`, `iAlreadyActed===false`.

Run `pnpm --filter @dbflow/api test -- change-request.service` → 신규 FAIL.

- [ ] **Step 2: 가드 구현**

`approve()` tx 안, `if (!slot) {...}` 처리 **이후**·`update` **이전**에(스펙 §2 verbatim):
```ts
const priorByActor = await tx.changeRequestApprover.findFirst({
  where: {
    changeRequestId: id,
    id: { not: slot.id },
    OR: [
      { userId: actor.userId, decision: { not: null } },
      { decidedById: actor.userId },
    ],
  },
  select: { id: true },
});
if (priorByActor) {
  throw new ConflictException('직무분리 정책상 한 변경요청에 두 번(직접·대리 포함) 결재할 수 없습니다.');
}
```

- [ ] **Step 3: toDetail iAlreadyActed + canActAsDelegate**

`toDetail`(스펙 §3): 구조분해된 `approvers`·`currentUserId`로 계산해 반환 객체에 추가:
```ts
const actorAlreadyActed =
  approvers.some((a) => a.userId === currentUserId && a.decision !== null) ||
  approvers.some((a) => a.decidedById === currentUserId);
// 반환에:
iAlreadyActed: actorAlreadyActed,
canActAsDelegate:
  !actorAlreadyActed &&
  ((rest.status === ChangeRequestStatus.SUBMITTED &&
     !!delegatorIds.length && delegatorIds.includes(rest.reviewerId ?? '')) ||
   (rest.status === ChangeRequestStatus.REVIEW_APPROVED &&
     approvers.some((a) => delegatorIds.includes(a.userId) && a.decision === null))),
```
(`decidedById`는 `DETAIL_INCLUDE.approvers.select`에 이미 존재 — 확인.)

- [ ] **Step 4: 통과 + 전체 스위트 + 빌드 + Commit**

Run `pnpm --filter @dbflow/api test`(전체 GREEN — 기존 approve/위임 테스트 무회귀) `&& pnpm --filter @dbflow/api build`.
```bash
git add apps/api/src/change-request
git commit -m "feat(api): SoD guard — one actor fills at most one approver slot per CR; iAlreadyActed flag"
```

---

### Task 2: 프론트 — 직접 결재 버튼 게이트 (iAlreadyActed)

**Files:**
- Modify: `apps/web/lib/api.ts` (`ChangeRequestDetail`에 `iAlreadyActed: boolean`)
- Modify: `apps/web/app/(app)/change-requests/[id]/page.tsx`

**Interfaces:** Consumes Task 1의 `iAlreadyActed`.

- [ ] **Step 1: 타입 + 버튼 게이트**

- `lib/api.ts` `ChangeRequestDetail`에 `iAlreadyActed: boolean` 추가.
- `[id]/page.tsx`: 직접 결재 버튼의 `canApprove`(결재자 슬롯 미결정 기반, ~221–223행)에 **`&& !cr.iAlreadyActed` 추가**(스펙 §3 — 대리 슬롯 먼저 채운 뒤 자기 직접 버튼이 떠서 클릭→409 되는 dead-end 제거). 대리 버튼은 `canActAsDelegate`가 이미 `!actorAlreadyActed` 포함(Task 1).

- [ ] **Step 2: tsc + build + Commit**

Run `pnpm --filter @dbflow/web exec tsc --noEmit && pnpm --filter @dbflow/web build`.
```bash
git add apps/web/lib/api.ts "apps/web/app/(app)/change-requests/[id]/page.tsx"
git commit -m "feat(web): gate direct approve button on iAlreadyActed (SoD)"
```

---

### Task 3: 통합 검증 + 문서

**Files:** `docs/feature-checklist.md`, `docs/superpowers/specs/2026-07-20-dbflow-delegation-design.md`(§8 교체).

- [ ] **Step 1: 자동** — `pnpm --filter @dbflow/api test`(전체 GREEN) + `pnpm --filter @dbflow/web exec tsc --noEmit && pnpm --filter @dbflow/web build`.
- [ ] **Step 2: 라이브 E2E**(API 재기동 + 클린 시드; approver2/3는 admin `POST /users`):
  - P1이 X·Y 두 결재자의 대리인 → P1이 X 슬롯 대리 결재 성공 → **이어서 Y 슬롯 결재 시도 409**(SoD), 최종 승인 미도달(다른 사람이 Y 결재해야 함).
  - 무회귀: 위임 없는 정상 검토→결재 흐름 그대로. 대리 첫 결재 1건 정상.
- [ ] **Step 3: 문서**
  - `docs/feature-checklist.md` §12에 1줄: "한 사람은 한 CR에서 결재 1건만(직접+대리 합산) — 2번째 시도 409(SoD)".
  - `docs/superpowers/specs/2026-07-20-dbflow-delegation-design.md` §8의 SoD "의도된 동작/후속 결정" 문구를 **삭제/교체**해 "SoD 항상 강제(2026-07-21 SoD 가드 스펙으로 구현)"로 갱신(critic Minor — append 아님).
```bash
git add docs
git commit -m "docs: SoD checklist entry + update delegation spec §8 (now enforced)"
```

---

## Self-Review (작성자 확인 완료)

- 스펙 커버리지: §2 가드→T1 Step2, §3 iAlreadyActed/버튼→T1 Step3·T2, §4 테스트/mock 분기→T1 Step1, §5 문서→T3. 전 항목 매핑.
- critic 반영: mock findFirst where-shape 분기(T1 S1), 직접 버튼 iAlreadyActed 게이트(T2), §8 교체(T3), direct-first 테스트 케이스(T1 S1 #1).
- 주의: 가드는 `id:{not:slot.id}`로 자기 슬롯 제외(오탐 금지). `decidedById` select 이미 존재. 검토 대리(REVIEWER)는 결재 슬롯 없어 무영향.
