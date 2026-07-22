# DBFlow — 지정 검토/결재 · 프로필 · 설정 모달 · 텔레그램 알림 설계

- 작성일: 2026-07-17
- 상태: 설계 확정 (구현 미착수)
- 범위: 백엔드(`apps/api`) 스키마·API + 프론트(`apps/web`) + 텔레그램 외부 연동
- 선행: `feat/web-dashboard-redesign`(대시보드 리디자인)이 머지/유지된 상태를 전제

## 1. 배경 / 목적

현재 검토·결재는 **역할만 맞으면 아무나** 수행할 수 있다(백엔드 `visibilityWhere()`가 역할 기준). 실무에선 검토자·결재자가 여러 명이므로, 변경요청마다 **특정 담당자를 지정**하고 그 사람에게 **텔레그램으로 검토 요청/결과를 알림**하려 한다. 또한 계정에 **이름·부서**를 부여하고, 흩어진 개인 설정(테마 등)을 **우상단 설정 모달**로 모은다.

확정된 결정(브레인스토밍):
- 계정 생성은 **관리자(신규 `ADMIN` 역할)**가 수행 (이름·부서·역할·이메일·초기 비번).
- 변경요청당 **검토자 1명 + 결재자 1명**을 생성 시 지정. 지정된 사람만 검토/결재.
- 텔레그램은 **설정 모달에서 chat ID 수동 입력**, 봇 토큰은 서버 env. 실제 발송 구현.
- 설정 모달: **테마 / 텔레그램 chat ID / 내 프로필(이름·부서)**. 비밀번호 변경은 이번 범위 밖(YAGNI).
- 부서는 **자유 입력 텍스트**.

## 2. 비목표 (YAGNI)

- 검토자·결재자 다중 지정(각 1명으로 고정).
- 공개 회원가입(관리자 생성만).
- 텔레그램 `/start` webhook 자동 링크(수동 chat ID로 대체).
- 비밀번호 변경, 이메일 알림, 인앱 알림센터.
- 지정자 변경 이력의 별도 감사 로그(StatusHistory로 충분).

## 3. 두 스펙으로 분해

| 스펙 | 내용 | 구현 순서 |
|---|---|---|
| **스펙 1** | ADMIN 역할 + 계정 생성 · 프로필(부서) · CR 검토/결재 지정 · 사이드바 표시 | 먼저 |
| **스펙 2** | 설정 모달(테마/텔레그램/프로필) · 텔레그램 알림 발송 | 다음 |

스펙 2는 스펙 1의 `User.telegramChatId`, `ChangeRequest.reviewerId/approverId`에 의존한다. 각각 spec→plan→구현 사이클.

---

## 4. 스펙 1 — 지정 검토/결재 + 프로필 + 관리자

### 4.1 스키마 변경 (`prisma/schema.prisma`)

```prisma
enum Role { DEVELOPER  REVIEWER  APPROVER  ADMIN }   // ADMIN 추가

model User {
  // ...기존 필드
  department     String                                   // 신규(필수)
  telegramChatId String?                                  // 신규(스펙2 사용)
  // 관계: author/reviewer/approver 3개로 분화 (named relations)
  changeRequests     ChangeRequest[] @relation("author")
  reviewingRequests  ChangeRequest[] @relation("reviewer")
  approvingRequests  ChangeRequest[] @relation("approver")
  statusHistories StatusHistory[]
  executions      Execution[]
}

model ChangeRequest {
  // ...기존 필드
  reviewerId String?                                      // 신규(제출 시 필수)
  approverId String?                                      // 신규(제출 시 필수)
  author   User  @relation("author",   fields: [authorId],   references: [id])
  reviewer User? @relation("reviewer", fields: [reviewerId], references: [id])
  approver User? @relation("approver", fields: [approverId], references: [id])
  @@index([reviewerId])
  @@index([approverId])
}
```

- 마이그레이션: 컬럼은 nullable(`reviewerId/approverId`) 또는 기본값. `department`는 필수라 기존 행 백필 필요 → 마이그레이션에서 기존 유저 `department` 기본값(예: '미지정') 부여 후 NOT NULL.
- `seed.ts`: 기존 3계정에 `department` 부여(개발자→'개발팀', 검토자→'DBA팀', 결재자→'인프라팀'), **admin 계정 추가**(`admin@dbflow.io` / ADMIN / '운영팀').

### 4.2 API (`apps/api`)

**Users 모듈 — 신설 (리뷰 M3)**
현재 `src/users`엔 `UsersService`만 있고 `AuthModule`의 provider로만 등록돼 있다. **`UsersModule` + `UsersController`를 신설**하고 `AppModule.imports`에 등록한다. `UsersService.create` 시그니처에 `department` 추가.
- `POST /users` — **ADMIN 전용**(`@Roles('ADMIN')`). body: email·name·department·role·password. argon2 해시 후 생성.
- `GET /users?role=REVIEWER|APPROVER` — 지정 후보 목록(id·name·department만 노출). 인증 필요.
- `GET /users/me` — 내 프로필(email·name·department·role·telegramChatId 유무).
- `PATCH /users/me` — 이름·부서·telegramChatId 수정(본인).

**ChangeRequest 변경**
- `createChangeRequest` DTO에 `reviewerId`·`approverId` 추가(생성 시 저장·선택). 값이 지정 역할과 일치하는지 검증(reviewer는 REVIEWER, approver는 APPROVER). **자기 자신 지정 불가**는 role 불일치로 자연 차단(작성자=DEVELOPER).
- `submitChangeRequest`: reviewerId·approverId 미지정이면 400. (생성 시엔 선택, 제출 시 필수)
- **권한 게이트**: `reviewChangeRequest`는 `actor.id === cr.reviewerId`만, `approveChangeRequest`는 `actor.id === cr.approverId`만(아니면 403).
- **지정자 재지정** (리뷰 M4, 사용자 결정):
  - `status === DRAFT`: **작성자**가 reviewer/approver 변경 가능(생성 폼 재사용 or `PATCH /change-requests/:id/assignees`).
  - `status !== DRAFT`: **ADMIN**만 오버라이드 재지정 가능(부재·퇴사 대응).
- **`getOrThrow` select 확장** (리뷰 m2): 현재 `id/status/authorId`만 select → 게이트·알림용으로 `reviewerId/approverId`, 그리고 발송 시 author/reviewer/approver의 `telegramChatId`·`name`을 포함(별도 조회 or include).

**가시성(`visibilityWhere`) 변경 + status 게이트 (리뷰 B1·결정①)**

| 역할 | where 조건 | 설명 |
|---|---|---|
| DEVELOPER | `authorId = me` | 내가 쓴 것(기존 유지) |
| REVIEWER | `reviewerId = me AND status != DRAFT` | 나에게 지정된, **제출된 것만**(초안 미노출) |
| APPROVER | `approverId = me AND status != DRAFT` | 나에게 지정된, 제출된 것만 |
| ADMIN | (목록 API 접근 제외) | 관리자는 `/users`만 사용 → 목록 라우팅에서 배제(결정②) |

이 매트릭스가 이전 `2026-07-12` 스펙 §12.1(status-스코프 가정)을 **폐기·대체**한다. 대응하는 프론트 KPI/필터 재작성은 §4.4 참조.

### 4.3 프론트 (`apps/web`)

- **사용자 관리 페이지** `/(app)/users`(ADMIN): 사용자 목록(이름·부서·역할·이메일) + 생성 폼. 사이드바에 ADMIN에게만 "사용자 관리" 노출.
- **CR 생성 폼**: 검토자·결재자 **드롭다운**(`GET /users?role=` 결과). 필수 표시.
- **CR 상세**: 지정 검토자/결재자 이름·부서 표시.
- **사이드바 하단**: 2줄 —
  ```
  홍길동 | IT본부
  검토자(DBA)
  ```
  `ROLE_LABEL[role]` 재사용, `department`는 `User`에 추가된 필드. `lib/auth.ts`의 `User` 타입에 `department` 추가(로그인 응답에도 포함).
- 로그인 응답(`/auth/login`)에 `department` 포함하도록 백엔드 반영.
- **`useCurrentUser`를 Context로 승격 (리뷰 M1)**: 현재 훅은 마운트 시 localStorage를 1회만 읽어 설정 저장 후 사이드바가 즉시 안 바뀐다. `UserProvider`로 승격해 `{user, setUser}`를 공유 → 설정 모달 저장 시 `setUser`로 즉시 리렌더. `AppShell`/`Sidebar`/설정 모달이 같은 소스 사용.

### 4.4 ADMIN 역할 · Role 파급 · KPI/필터 재작성 (리뷰 B2·B1)

`ADMIN`을 `Role`에 추가하면 프론트의 exhaustive `Record<Role,…>` 4곳이 깨진다. 아래를 함께 갱신한다.
- `lib/auth.ts`: `Role` 유니온에 `'ADMIN'` 추가, `ROLE_LABEL`에 `ADMIN: '관리자'` 추가.
- **ADMIN 라우팅**: ADMIN 로그인/진입 시 `/dashboard`가 아니라 `/users`로 리다이렉트(대시보드는 ADMIN 카드가 없음). 로그인 후 이동·`/dashboard` 가드에 ADMIN 분기.
- `dashboard/page.tsx`: `ROLE_ACTION`·`CARDS_BY_ROLE`는 ADMIN 키를 두지 않고 ADMIN을 라우팅에서 배제(도달 시 `/users`로 보냄).
- **KPI 매트릭스 재작성**(지정 기반): 대시보드 KPI는 `listChangeRequests()`(=내 담당) 응답을 그대로 집계하면 되므로 역할별 분기가 단순해진다.
  - DEVELOPER: 내 작성 중(DRAFT) / 내 진행 중(SUBMITTED∪REVIEW_APPROVED) / 내 반려 / 내 완료
  - REVIEWER: 검토 대기(SUBMITTED) / 결재 대기(REVIEW_APPROVED) / 반려 / 완료 — **전부 "나에게 지정된" 것** (이제 응답에 SUBMITTED 포함됨)
  - APPROVER: 검토 진행(SUBMITTED) / 결재 대기(REVIEW_APPROVED) / 반려 / 완료 — 나에게 지정된 것
- **필터탭 재작성**(`change-requests/page.tsx`): `filtersForRole`의 "결재자는 SUBMITTED 숨김" 규칙 **제거**(이제 지정된 SUBMITTED가 응답에 담김). `DEFAULT_FILTER_BY_ROLE`도 지정 기반에 맞게 점검. → 옛 스펙 §12.1 폐기와 일관.

---

## 5. 스펙 2 — 설정 모달 + 텔레그램 알림

### 5.1 텔레그램 발송 (`apps/api`)

- **`src/notification`(신규)**: `TelegramService.send(chatId, text)` — `https://api.telegram.org/bot<TOKEN>/sendMessage` 로 `fetch` POST(Node 22 전역 fetch 사용, 추가 의존성 없음). 토큰(`TELEGRAM_BOT_TOKEN`) 또는 chatId 없으면 **조용히 no-op**(로그만).
- **발송 격리 (리뷰 m3)**: 알림은 상태 전이 **`$transaction` 커밋 이후**에만 호출(롤백된 전이의 오알림 방지). `await` 하지 않는 fire-and-forget이되 반드시 `.catch()`로 삼켜 unhandled rejection·응답 지연이 워크플로우에 전파되지 않게 한다. `fetch`에 timeout(AbortSignal) 부여.
- **알림 트리거**(각 도메인 서비스에서 호출):
  1. `submit` → 지정 **검토자**에게 "🔔 새 검토 요청: {제목}"
  2. 검토 **승인** → **작성자**에게 "검토 승인됨", **결재자**에게 "🔔 결재 요청: {제목}"
  3. 검토 **반려** → **작성자**에게 "검토 반려: {코멘트}"
  4. 최종 **승인** → **작성자**에게 "최종 승인됨"
  5. 최종 **반려** → **작성자**에게 "최종 반려: {코멘트}"
- `POST /users/me/telegram/test` — 저장된(또는 방금 입력한) chatId로 테스트 메시지 발송, 성공/실패 반환.
- env 문서화: **레포 루트 `.env.example`**(apps/api 아님, 리뷰 m3)에 `TELEGRAM_BOT_TOKEN=` 추가.

### 5.2 설정 모달 (`apps/web`)

- **톱니 아이콘 위치 (리뷰 m1)**: 현재 데스크톱 `AppShell`엔 상단바가 없다(header는 `lg:hidden`). → `AppShell` 메인 영역 최상단에 **얇은 우측 정렬 헤더 행**을 추가해 톱니 버튼을 우상단에 두거나, 모바일 상단바(현존)의 우측과 통일. 데스크톱·모바일 모두 우상단에 노출.
- 모달 섹션(단순 수직 or 탭):
  1. **테마** — 라이트/다크/시스템 3-상태(기존 `ThemeToggle` 로직을 모달로 이전, **사이드바 토글 제거**).
  2. **텔레그램** — chat ID 입력·저장(`PATCH /users/me`), "테스트 발송" 버튼(`POST /users/me/telegram/test`), 안내(“봇에게 먼저 말 걸어야 함”).
  3. **내 프로필** — 이름·부서 수정(`PATCH /users/me`), 이메일·역할은 읽기전용.
- 모달 컴포넌트 `components/settings-modal.tsx`(신규). 접근성: Esc 닫기, 포커스 트랩 최소, 배경 클릭 닫기.
- 저장 성공 시 `UserProvider.setUser`로 Context 갱신(+localStorage) → 사이드바 이름·부서 **즉시 반영**(§4.3 Context 승격에 의존).

---

## 6. 데이터 흐름 요약

- 계정 생성: ADMIN → `POST /users` → DB. 지정 후보는 `GET /users?role=`.
- CR 생성: 개발자가 reviewer/approver 선택 → CR에 저장. 제출 시 텔레그램 → 검토자.
- 검토/결재: 지정자만 수행 → StatusHistory 기록 + 텔레그램 → 작성자/결재자.
- 프로필/테마/텔레그램 설정: 설정 모달 → `PATCH /users/me` / localStorage(테마).

## 7. 영향 범위

- **백엔드**:
  - `schema.prisma`(+마이그레이션: Role에 ADMIN, User.department/telegramChatId, CR.reviewerId/approverId + 3중 named relation).
  - `seed.ts`(부서 부여 + admin 계정).
  - `src/users`(**모듈·컨트롤러 신설** + AppModule 등록, `create`에 department).
  - `src/change-request`(create DTO·submit 검증·review/approve 게이트·visibilityWhere·getOrThrow select 확장·재지정 엔드포인트).
  - `src/auth`(로그인 응답에 department, JWT/`RolesGuard`는 ADMIN 가산이라 대체로 안전).
  - `src/notification`(신규 TelegramService), 루트 `.env.example`.
- **프론트**:
  - `lib/auth.ts`(**Role 유니온에 ADMIN**, `ROLE_LABEL` ADMIN, `User.department`, **`useCurrentUser`→`UserProvider` Context 승격**).
  - `lib/api.ts`(users API·`/users/me`·telegram·CR 지정 필드·재지정).
  - `dashboard/page.tsx`(**`CARDS_BY_ROLE`·`ROLE_ACTION` 갱신 + KPI 지정 기반 재작성 + ADMIN 배제**).
  - `change-requests/page.tsx`(**`filtersForRole`·`DEFAULT_FILTER_BY_ROLE` 재작성**).
  - `components/sidebar.tsx`(2줄 이름·부서/역할, 테마 토글 제거, ADMIN "사용자 관리" 노출).
  - `components/app-shell.tsx`(우상단 톱니 헤더 행 + ADMIN 라우팅), `components/settings-modal.tsx`(신규), `components/theme.tsx`(토글을 모달에서 사용).
  - `app/(app)/users/`(신규 관리자 페이지), CR 생성 폼(reviewer/approver 드롭다운)·상세(지정자 표시).
- **문서 정합**: 이전 `2026-07-12` 리디자인 스펙 §12.1(KPI 매트릭스)·§12.3(테마=사이드바 하단)은 이 스펙이 **대체**함 — 해당 스펙에 "→ 2026-07-17 스펙으로 대체됨" 주석 추가.

## 8. 리스크 / 주의

- **User↔ChangeRequest 3중 관계**: Prisma named relation 필수(안 하면 스키마 검증 실패). `reviewer/approver` 관계 `onDelete`는 향후 유저 삭제 기능 추가 시 `SetNull` 명시(현재 삭제 엔드포인트 없어 무해).
- **B1 파급**: 가시성 변경이 KPI/필터탭을 뒤집으므로 §4.4의 재작성을 반드시 동반(안 하면 세 역할 대시보드가 배포 즉시 오작동).
- **B2 파급**: ADMIN을 Role에 넣으면 `Record<Role,…>` 4곳 tsc 에러 + ADMIN `/dashboard` 크래시 → §4.4대로 4곳 갱신·ADMIN 라우팅 필수.
- **마이그레이션 백필**: `department` NOT NULL 전환 시 기존 행에 기본값 부여 후 제약. 이미 제출된(non-DRAFT) CR이 있으면 reviewer/approver null이라 지정 가시성에서 고아가 됨 → **현재 seed엔 CR이 없음**(유저만). 실데이터가 생기기 전 적용 권장, 있으면 백필 절차 필요.
- **텔레그램 격리**: 트랜잭션 커밋 후 fire-and-forget + `.catch()` + timeout(§5.1). 발송 실패가 워크플로우를 막지 않음.
- **초기 비밀번호 전달**: ADMIN이 초기 비번 설정 → 사용자에게 out-of-band 전달 가정(비번 변경은 이번 범위 밖).

## 9. 성공 기준

- ADMIN이 이름·부서·역할로 계정을 만들 수 있다.
- 개발자가 CR 생성 시 검토자·결재자를 지정하고, 지정된 사람만 검토·결재할 수 있다.
- 사이드바에 `이름 | 부서` / `역할`이 표시된다.
- 우상단 톱니 → 설정 모달에서 테마·텔레그램 chat ID·프로필을 바꿀 수 있다.
- 제출 시 지정 검토자에게, 검토/결재 결과 시 작성자(및 결재자)에게 텔레그램 알림이 실제로 도착한다(토큰·chatId 설정 시).
- 토큰·chatId 미설정이어도 워크플로우는 정상 동작(알림만 생략).
