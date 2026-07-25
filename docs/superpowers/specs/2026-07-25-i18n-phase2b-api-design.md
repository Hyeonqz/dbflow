# i18n Phase 2b — api 예외 메시지 국제화 (영어 기본 + 한국어) 설계

> 2026-07-25. M3(i18n)의 Phase 2b. Phase 2a(웹)에 이어 백엔드 예외 메시지를 국제화. 전략 `docs/open-source-strategy.md` §6-5.
> 범위: NestJS 서비스가 throw하는 **사용자 노출 예외 메시지 45개**. 라이브러리 미도입(경량 키+필터 방식).

## 목표와 종료 기준

**목표**: API가 요청 로케일(앱에서 고른 언어)에 맞춰 예외 메시지를 반환한다. 기본 영어, 한국어 선택.

**종료 기준**:
1. `Accept-Language: ko`로 예외를 유발하면 한국어 메시지, `en`(또는 헤더 없음)이면 영어 메시지가 응답 `message`에 담긴다.
2. 웹에서 언어를 한국어로 두면 API 에러 토스트도 한국어로 보인다(웹이 앱 로케일을 `Accept-Language`로 전송).
3. 45개 서비스 예외의 하드코딩 한국어 문자열이 전부 메시지 키로 이전된다(서비스 파일 grep으로 한국어 예외 문자열 0).
4. 기존 jest 테스트 전체 통과(한국어 메시지를 assert하던 spec들은 key 기준으로 갱신).

**스코프 제외**(별도 관심사):
- 감사 로그에 **저장되는** 요약문(`audit-exception.filter.ts`의 `'로그인 실패'`·`'권한 거부'`, 서비스의 audit summary) — 과거 DB 기록이라 저장 시점 언어 유지. 표시는 Phase 2a에서 이미 영역된 웹 UI가 담당.
- class-validator 검증 메시지 — 현재 영어 기본, 후순위.
- `crypto/encryption.util.ts`의 내부 `Error`(`32바이트`/`형식`) — 사용자 노출 API 에러 아님(기동/암호화 내부 오류). 유지.

## 현황 (2026-07-25 조사)

45개 예외(한국어) 분포: change-request(14), apply(6), delegation(5), apply-schedule(5), target-database(3), rollback(3), dry-run(3), schema-diff(2), apply-policy(2), sql-review(1), auth(1). 보간 포함 4개. 필터는 `audit-exception.filter.ts`(전역 `@Catch()`, `super.catch` 위임, main.ts에 등록). 웹 프록시는 `accept-language`를 이미 forward하나, `lib/api.ts`는 앱 로케일을 헤더로 보내지 않음(현재 브라우저 언어만 전달됨).

## 아키텍처

### ① 로케일 전달 (웹)
- `apps/web/lib/api.ts`: `apiFetch`가 `Accept-Language: <앱 로케일>` 헤더를 추가. 앱 로케일은 `dbflow_locale` 쿠키에서(기존 `lib/i18n-client.ts`의 쿠키 읽기 재사용 — `currentLocale()`를 export). 직접 fetch 2곳(`login` L72, `downloadAuditExport` L605)에도 동일 헤더 추가.
- 프록시(`app/api/[...path]/route.ts`)는 이미 `accept-language`를 forward하므로 무변경. 백엔드가 이 헤더를 읽음.

### ② api i18n 모듈 (신규)
- `apps/api/src/i18n/locale.ts`: `type Locale = 'en' | 'ko'`; `resolveLocale(acceptLanguage?: string): Locale` — `Accept-Language` 값의 첫 언어 태그 primary subtag를 파싱(`ko-KR`→`ko`, `ko,en;q=0.9`→`ko`), en/ko 아니면 `'en'`.
- `apps/api/src/i18n/messages.ts`: `const MESSAGES: Record<Locale, Record<string, string>>` — key→템플릿, ICU식 `{param}`. `en`이 기준, `ko`가 대응. `translate(key: string, locale: Locale, args?: Record<string,string|number>): string` — 키 조회(미존재 시 en 폴백, 그래도 없으면 key 원문 반환) + `{param}` 치환.
- 키 네임스페이스 = 도메인: `changeRequest.*`, `apply.*`, `delegation.*`, `applySchedule.*`, `targetDatabase.*`, `rollback.*`, `dryRun.*`, `schemaDiff.*`, `sqlReview.*`, `auth.*`.

### ③ 예외 throw 규약 변경
- 하드코딩 문자열 대신 `{ key, args }` 페이로드로 던진다. 상태코드는 예외 클래스가 그대로 결정:
  - `throw new NotFoundException('변경요청을 찾을 수 없습니다.')` → `throw new NotFoundException({ key: 'changeRequest.notFound' })`
  - 보간: `` throw new BadRequestException(`제출하려면 검토자 1명과 결재자 ${required}명을 지정해야 합니다.`) `` → `throw new BadRequestException({ key: 'changeRequest.submitRequiresAssignees', args: { required } })`
- 카탈로그 예:
  - en `"changeRequest.submitRequiresAssignees": "Submitting requires 1 reviewer and {required} approver(s)."`
  - ko `"changeRequest.submitRequiresAssignees": "제출하려면 검토자 1명과 결재자 {required}명을 지정해야 합니다."`

### ④ 필터에서 번역
- `audit-exception.filter.ts`의 `catch()`에서 `super.catch` **이전에** 번역: 예외가 `HttpException`이고 `getResponse()`가 `{ key: string, args? }` 객체면, 요청 `accept-language`로 `resolveLocale` → `translate(key, locale, args)` → `new HttpException(message, exception.getStatus())`로 재구성해 `super.catch(translated, host)`. 아니면 기존대로 `super.catch(exception, host)`.
- 기존 audit 기록 로직(login-failure, forbidden)은 그대로 유지(예외 클래스 instanceof 검사라 페이로드 변경과 무관). 표준 에러 응답 형태 `{ statusCode, message }` 유지.

## 컴포넌트 경계

- `i18n/locale.ts`(로케일 파싱) · `i18n/messages.ts`(카탈로그+translate) — 순수 함수, 단위 테스트 용이. 필터는 이 둘만 의존.
- 각 서비스는 `{key,args}`만 던짐 — i18n 세부를 모름(카탈로그·로케일은 필터 책임).

## 구현 순서 (플랜에서 태스크화)

1. **인프라 + 증명**: `i18n/locale.ts`(+spec) · `i18n/messages.ts`(+spec, translate/폴백) · 필터 번역 로직 · 웹 `lib/api.ts` Accept-Language 전송. change-request의 예외 1~2개를 key로 이전해 en/ko 응답을 e2e로 증명.
2~N. **서비스별 예외 이전**: 한 서비스(또는 소그룹)씩 한국어 예외를 key로 이전 + en/ko 카탈로그 추가 + 해당 spec 갱신(한국어 message assert → key assert 또는 상태코드 assert). 순서: change-request(14) → apply+rollback+dry-run+apply-policy(14) → apply-schedule(5) → delegation(5) → target-database(3) → schema-diff(2) → sql-review+auth(2).
- 각 태스크 게이트: `pnpm --filter @dbflow/api test` 통과 + 대상 서비스 `grep`으로 한국어 예외 문자열 0 + en/ko 카탈로그 키 파리티.

## 테스트 영향

기존 spec 중 예외 한국어 메시지를 정규식으로 assert하는 것들(`delegation.service.spec` `/같은 역할/`·`/시작/`, `apply-schedule.service.spec` `/시작이 종료보다/` 등)은 서비스가 이제 **key**를 던지므로 깨진다 — 해당 태스크에서 assert를 key 기준(`/delegation.sameRole/`)이나 예외 타입/상태로 갱신. crypto 등 스코프 밖 Error assert는 무변경.

## 검증 계획

- 단위: `resolveLocale`(ko/ko-KR/en/빈값/미지원 → 기대 로케일), `translate`(존재키·미존재키 폴백·보간).
- 통합: 각 서비스 태스크 후 `pnpm --filter @dbflow/api test` 통과.
- e2e(인프라 태스크): api에 `Accept-Language: ko`/`en`으로 예외 유발 요청 → 응답 `message`가 각 언어. (컨트롤러가 실행; 공유 트리라 격리 방식으로.)
- 최종: `grep -rn "throw new .*Exception([^)]*[가-힣]" apps/api/src --include=*.ts | grep -v spec` → 0. 웹에서 한국어 모드로 API 에러가 한국어 표시.

## 리스크

- **Accept-Language 파싱**: 다양한 포맷(`ko-KR`, 다중 태그, q값) — 첫 태그 primary subtag만 취하는 단순 파서로 충분(en/ko 2개뿐).
- **{key,args} 페이로드와 NestJS 응답 형태**: `HttpException`에 객체를 던지면 `getResponse()`가 그 객체를 반환 — 필터가 가로채므로 클라이언트엔 표준 `{statusCode,message}`만 노출됨(key 누출 없음). 인프라 태스크에서 응답 본문으로 확정.
- **일부 서비스가 필터 밖에서 에러 전달?**: 모든 HTTP 예외는 전역 필터를 거침(main.ts 등록). 비-HTTP 경로 없음.
