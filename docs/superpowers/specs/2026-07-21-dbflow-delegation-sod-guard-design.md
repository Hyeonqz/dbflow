# 위임 직무분리(SoD) 가드 설계

> 2026-07-21. 부재 위임(PR #14) 후속. 최종 리뷰 Minor#1(직무분리) 해소.
> 근거: DBFlow 제품 비전(규정·내부통제상 사람이 반드시 확인 — 금융·공공). SoD는 핵심 내부통제.

## 1. 문제와 불변식

부재 위임 도입으로 **한 사람이 같은 CR의 결재 슬롯을 2개 이상** 채워 N인 만장일치를 혼자 충족할 수 있다(현재는 감사만 되고 차단은 안 됨):
- **경우 A (직접+대리)**: P1이 직접 결재자 + P2의 대리인 → 자기 슬롯 + P2 슬롯.
- **경우 B (대리+대리)**: P1이 직접 결재자가 아니어도 P2·P3 **둘 다의 대리인**이면 두 슬롯.

**불변식(사용자 확정)**: *한 행위자는 한 CR에서 결재 슬롯을 최대 1개만 채운다*(직접·대리 합산). **항상 강제**(설정 토글 없음 — 비전 정합).

검토↔결재 교차 SoD는 역할로 이미 강제(REVIEWER는 결재 슬롯 불가, 대리인은 동일 역할만)되므로 가드는 **결재 슬롯 집합 안**으로 한정.

## 2. 백엔드 — approve() tx 내 가드

`change-request.service.ts`의 `approve()` 트랜잭션 안, 슬롯(`slot`) 확정 후 **update 직전**(직접·대리 두 경로 공통), CR 행 잠금(`FOR UPDATE`) 하에서 1회 조회:

```ts
const priorByActor = await tx.changeRequestApprover.findFirst({
  where: {
    changeRequestId: id,
    id: { not: slot.id },                               // 지금 채울 슬롯 제외
    OR: [
      { userId: actor.userId, decision: { not: null } }, // 내 직접 슬롯을 이미 결정함
      { decidedById: actor.userId },                     // 내가 이미 대리로 채운 슬롯
    ],
  },
  select: { id: true },
});
if (priorByActor) {
  throw new ConflictException('직무분리 정책상 한 변경요청에 두 번(직접·대리 포함) 결재할 수 없습니다.');
}
```

- **차단 범위**: 세 경우 모두 — 직접→대리, 대리→직접, 대리→대리.
- **정상 통과**: 자기 유일 슬롯을 처음 채우는 경우 → `id != slot.id` 제외 + 다른 슬롯에 내 결정 없음 → 매칭 0. 재결재는 기존 `mine.decision !== null` → "이미 결재하셨습니다"가 계속 처리(중복 아님, 별개 케이스).
- **상태 코드**: 409 Conflict — 상태 기반 충돌(이미 결재함)이라 기존 "이미 결재하셨습니다"(409)와 일관. `FOR UPDATE` 하에서 조회하므로 동시 2호출도 직렬화되어 레이스 없음.
- **위치 정확성**: `slot`이 직접 슬롯이든 대리 슬롯이든 동일하게 적용해야 하므로, `if (!slot) {...}` 처리 이후·`update` 이전에 삽입. `slot.id` 제외가 핵심(자기 자신을 prior로 오인 금지).

## 3. 프론트 — 대리 버튼 + 직접 버튼 둘 다 게이트 (critic Important#2)

`toDetail`에서 **"뷰어가 이 CR에서 이미 결정/대리했는지"** 플래그를 한 번 계산해 `canActAsDelegate` 게이트에 쓰고, **응답에도 `iAlreadyActed`로 노출**해 프론트가 직접 결재 버튼까지 숨기게 한다:

```ts
const actorAlreadyActed =
  approvers.some((a) => a.userId === currentUserId && a.decision !== null) ||
  approvers.some((a) => a.decidedById === currentUserId);

// toDetail 반환에 추가:
iAlreadyActed: actorAlreadyActed,
canActAsDelegate:
  !actorAlreadyActed &&
  ((rest.status === ChangeRequestStatus.SUBMITTED &&
     !!delegatorIds.length && delegatorIds.includes(rest.reviewerId ?? '')) ||
   (rest.status === ChangeRequestStatus.REVIEW_APPROVED &&
     approvers.some((a) => delegatorIds.includes(a.userId) && a.decision === null))),
```

프론트 `[id]/page.tsx`:
- **직접 결재 버튼**(`canApprove` 절1: `role==='APPROVER' && REVIEW_APPROVED && myApprover.decision===null`)은 `canActAsDelegate`와 무관하므로, P1이 P2 대리 슬롯을 **먼저** 채운 뒤 자기 슬롯이 아직 null이면 그대로 떠서 클릭→409가 난다. 이를 막기 위해 **`canApprove` 절1에 `&& !cr.iAlreadyActed` 추가**.
- 대리 버튼은 `canActAsDelegate`(이미 `!actorAlreadyActed` 포함)로 처리됨.
- `lib/api.ts` `ChangeRequestDetail`에 `iAlreadyActed: boolean` 타입 추가.
- `decidedById`는 `DETAIL_INCLUDE.approvers.select`에 **이미 존재**(부재 위임 Task 3). 서버가 플래그를 계산하므로 프론트에 `decidedById`를 노출할 필요는 없음.
- 검토 대리(SUBMITTED 분기)는 결재 슬롯과 무관 — 검토자(REVIEWER)는 결재 슬롯이 없어 `actorAlreadyActed`가 참이 될 수 없으므로 검토 대리 동작 무영향.
- 서버 가드(2절)가 최종 강제이므로 이 플래그는 UX 보조.

## 4. 감사 & 테스트

- **감사**: 별도 액션 없음 — 다른 4xx 게이트(작업창/제출 인원 미달 등)와 동일하게 409 거부는 비감사.
- **유닛**(`change-request.service.spec.ts`):
  - **(critic Important#1) mock `findFirst` 분기 필수**: 기존 `txPrisma`의 `changeRequestApprover.findFirst`는 위임 조회용(`where.userId.in`)으로 하드코딩돼 있다. 가드가 추가하는 두 번째 `findFirst`는 `where.OR`를 쓰므로, mock을 **where-shape로 분기**해야 기존 approve 테스트가 크래시하지 않는다:
    ```ts
    findFirst: ({ where }) => {
      if (where.OR) { // SoD 가드: id != where.id.not && (직접 결정 || decidedById===actor)
        return Promise.resolve(state.approvers.find(a => a.id !== where.id.not &&
          ((a.userId === where.OR[0].userId && a.decision != null) || a.decidedById === where.OR[1].decidedById)) ?? null);
      }
      return Promise.resolve(state.approvers.find(a => where.userId.in.includes(a.userId) && a.decision === null) ?? null); // 위임 조회
    }
    ```
    변경 후 **기존 approve/delegation 테스트 전체 무회귀 확인**(green) 필수.
  1. 직접 결재 후 같은 사람이 대리 슬롯 시도 → 409(SoD, arm1 경로).
  2. 대리로 P2 채운 뒤 같은 사람이 P3 대리 시도 → 409(arm2, 대리+대리).
  3. 대리로 P2 채운 뒤 같은 사람이 자기 직접 슬롯 시도 → 409(arm2, 대리→직접).
  4. 정상 1건(직접 또는 대리 첫 결재)은 통과(무회귀).
  5. SoD 409 메시지가 "이미 결재하셨습니다"(재결재)와 **구별됨**(둘 다 ConflictException이라 message로 단언).
  6. `toDetail`: 이미 결정/대리한 뷰어 → `canActAsDelegate === false` **且 `iAlreadyActed === true`**; 아직 안 한 활성 대리인 → `canActAsDelegate === true`, `iAlreadyActed === false`.
- **라이브 E2E**: P1이 X·Y 두 결재자의 대리인일 때 P1이 X 슬롯 결재 성공 → 이어서 Y 슬롯 결재 시도 **409**, 최종 승인 미도달(다른 사람이 Y 결재해야 함). + 무회귀(위임 없는 정상 흐름).
- **체크리스트 §12**에 SoD 항목 1줄 추가.

## 5. 비범위

- 검토↔결재 교차 SoD(역할로 이미 강제).
- 환경별 SoD on/off 토글(항상 강제 채택).
- 위임 **등록** 시점 제약(등록은 계속 허용 — 행위 시점에만 차단; 등록 차단은 "P1이 이 CR의 결재자인지"를 등록 시점엔 알 수 없어 부적절).
- 부재 위임 스펙(`2026-07-20-dbflow-delegation-design.md`) §8의 SoD 항목(현재 "OOO 위임의 **의도된 동작**", "후속 결정 사항(기본값 감사 기반 허용)")은 본 가드로 전환됨 — 그 문구를 **삭제/교체**(append 아님, critic Minor)해 "SoD는 항상 강제됨(본 스펙으로 구현)"으로 갱신. 자기모순 방지.

## 6. 성공 기준

1. P1이 X 슬롯을 결재(직접 또는 대리)한 뒤, 같은 P1이 같은 CR의 다른 슬롯(대리/직접)을 결재 시도 → 409 + 명확한 SoD 메시지, 슬롯 미변경.
2. P1이 X·Y 둘의 대리인이어도 한 CR에선 한 슬롯만 채울 수 있고, 나머지는 다른 사람이 결재해야 최종 승인.
3. 위임 없는 정상 흐름·대리 첫 결재 1건은 그대로 동작(무회귀).
4. 이미 결재/대리한 뷰어에겐 CR 상세의 대리 결재 버튼이 안 보임(`canActAsDelegate=false`).
4b. 같은 뷰어에겐 **직접 결재 버튼도 안 보임**(`canApprove`에 `!iAlreadyActed` 반영) — 클릭→409 dead-end 제거(critic Important#2).
5. SoD 차단은 감사 로그를 남기지 않음(다른 게이트 거부와 동일 취급).
