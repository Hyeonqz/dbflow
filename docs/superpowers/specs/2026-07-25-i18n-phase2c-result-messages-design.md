# i18n Phase 2c — 반환형(성공 응답) 메시지 국제화 설계

> 2026-07-25. M3(i18n) 마무리 단계. Phase 2b(예외 메시지) 리뷰가 남긴 후속 항목.
> 규모가 작아(4파일·10문자열) 스펙에 구현 순서를 포함하고 별도 계획 문서는 두지 않는다.

## 배경

Phase 2b는 **throw되는 예외**를 국제화했다(전역 필터가 `{key,args}`를 요청 로케일로 번역). 그러나 **정상 응답 payload에 실려 나가는 메시지**는 필터를 거치지 않아 한국어로 남아 있다. 한국어 모드에서는 문제가 없지만, 기본 로케일인 영어 모드에서 이 문장들만 한국어로 보여 Phase 2b가 해결한 혼합 UX 문제가 이 경로에서 재발한다.

## 목표와 종료 기준

**목표**: 사용자에게 보이는 반환형 메시지 10개가 활성 로케일로 표시된다.

**종료 기준**:
1. 영어 모드에서 SQL 검토(lint) 목록·백업 note·롤백 오류·연결 테스트 오류가 영어로 표시된다.
2. 한국어 모드에서 같은 항목이 한국어로 표시된다.
3. 대상 4개 api 파일에 해당 한국어 문자열이 남지 않는다.
4. api 테스트 전체 통과, 웹 빌드+tsc 통과, 웹 카탈로그 en/ko 파리티 유지.

## 대상 (10개)

| # | 문자열 | api 위치 | 웹 표시 |
|---|---|---|---|
| 1-7 | lint 룰 설명 7개 | `apps/api/src/apply/lint.engine.ts` RULES[].message | 변경요청 상세 "SQL 검토" 목록 |
| 8 | `MVP는 MYSQL 대상만 연결을 지원합니다.` | `target-database.service.ts:130` | 대상DB `t('testFailure', {error})` |
| 9 | `일부 테이블이 BACKUP_MAX_ROWS 초과로…` | `apply/backup.service.ts:87` | 상세 `backup.note` |
| 10 | `schema-only 백업 — 데이터 복구 불가…` | `apply/rollback.service.ts:142` | 상세 실행 단계 오류 |

## 스코프 제외 (Phase 2b 경계의 연장)

- **감사 로그에 저장되는** summary/comment (`rollback:86`, `apply:168,357`, `auth:27`, `target-database:55,107,121`, `sql-review:57`) — 과거 DB 기록이므로 저장 시점 언어 유지.
- 서버 콘솔·부팅 거부 메시지 (`main.ts:13`, `validate-env.ts`, `bootstrap.service.ts` 로거) — 운영자용, 브라우저 노출 아님.
- `crypto/encryption.util.ts` 내부 Error — 암호화 내부 오류.
- 데모 시드 사용자 이름/부서 (`bootstrap.service.ts` DEMO_USERS) — 데모 데이터.
- MySQL 드라이버가 반환하는 실행 오류 원문 — 디버깅상 원문 유지가 유리.
- class-validator 검증 메시지 — 이미 영어. 한국어 현지화는 후순위(별도 트랙).

## 접근 — 코드화된 키 + 웹 번역

Phase 2a에서 확립된 패턴(`badges.tsx`의 enum 코드값 → 웹 카탈로그 번역)을 재사용한다.

**왜 서버 번역(Phase 2b 방식)이 아닌가**: 예외는 전역 필터라는 단일 관문이 있어 배관이 공짜였지만, 정상 응답에는 그런 관문이 없다. 서버가 번역하려면 서비스 시그니처마다 로케일을 흘려야 해 도메인 로직이 오염된다. 대상 10개는 모두 "코드화된 룰/상태"에 가까워 클라이언트 번역이 자연스럽다.

**api 측**
- **lint(1-7)**: **응답 구조 무변경** — `LintItem.rule`이 이미 안정적인 룰 키(`DROP_DATABASE` 등)로 웹까지 전달된다. `RULES[].message`의 한국어를 **영어로 교체**한다(국제 기본값 + api 단독 소비자용). 웹은 `message`를 표시하지 않고 `rule`로 번역한다.
- **8-10**: 기존 `error`/`note` 필드의 한국어를 **영어로 교체**하고, 각 응답에 **번역 키 필드를 추가**한다:
  - `testConnection` → `errorKey: 'targetDatabase.mysqlOnly'`
  - 백업 note → `noteKey: 'backup.schemaOnly'`
  - 롤백 결과 → `errorKey: 'rollback.schemaOnlyNoData'`
  - 기존 `error`/`note`(영어)는 유지 — api 단독 소비자용 + 웹의 폴백.

**웹 측**
- `messages/{en,ko}.json`에 **`serverMessages` 네임스페이스**를 신설한다. api가 반환하는 키 값이 이 네임스페이스 하위 경로와 정확히 일치하도록 중첩 구조로 둔다:
  ```
  serverMessages.lintRule.DROP_DATABASE …(7개)
  serverMessages.targetDatabase.mysqlOnly
  serverMessages.backup.schemaOnly
  serverMessages.rollback.schemaOnlyNoData
  ```
  `ko` 값은 기존 한국어 원문 그대로, `en`은 동등 영어.
- 렌더 규약: `const ts = useTranslations('serverMessages')`
  - lint 항목: `ts('lintRule.' + item.rule)` — 카탈로그에 없는 룰이면 `item.message` 폴백(향후 룰 추가 시 안전).
  - 8-10: 키 필드가 있으면 `ts(key)`, 없으면 기존 `error`/`note` 원문 폴백.
- `lib/api.ts` 타입에 `errorKey?`/`noteKey?` 옵셔널 필드 추가.

## 구현 순서

**Task A — api**: `lint.engine.ts` 7개 message 영어화 · `target-database.service.ts`·`backup.service.ts`·`rollback.service.ts`의 문자열 영어화 + 키 필드 추가(반환 타입도 함께). 게이트: `pnpm --filter @dbflow/api test` 통과 + 대상 4파일 한국어 0.

**Task B — web**: `lib/api.ts` 타입에 키 필드 추가 · `messages/{en,ko}.json`에 `serverMessages` 신설(10키) · 상세 페이지 lint 목록·백업 note·실행 오류, 대상DB 테스트 오류 렌더를 `ts(...)` 기반으로 전환. 게이트: 웹 빌드+tsc 통과 + en/ko 전체 파리티 + 보간 플레이스홀더 일치.

## 검증

- Task A: api 테스트 전체 통과, 4파일 `grep '[가-힣]'` 0(주석 제외).
- Task B: `pnpm --filter @dbflow/web build` + `tsc --noEmit`, 전체 카탈로그 en/ko 키 파리티 `true`.
- 통합(컨트롤러 수행): lint 결과를 렌더하는 경로가 en/ko 양쪽에서 올바른 언어로 표시되는지 확인. 최소한 카탈로그 키가 실제 룰 키 집합(`RULE_CATALOG`의 7개 `ruleKey`)과 정확히 일치하는지 대조 — 불일치 시 런타임에 폴백(원문 영어)으로 조용히 새므로 이 대조가 핵심 게이트.

## 리스크

- **룰 키 집합 불일치**: 웹 카탈로그 `lintRule.*` 키가 api `RULE_CATALOG`의 `ruleKey`와 어긋나면 조용히 영어 폴백. 검증 단계에서 두 집합을 기계적으로 대조한다.
- **폴백 경로 유지**: 향후 api에 룰이 추가되어도 웹이 깨지지 않도록 `has`-체크 후 `item.message` 폴백을 유지한다(기존 `badges.tsx`와 동일 패턴).
