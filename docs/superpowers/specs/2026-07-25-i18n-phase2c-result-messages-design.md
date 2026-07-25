# i18n Phase 2c — 반환형(성공 응답) 메시지 국제화 설계

> 2026-07-25. M3(i18n) 마무리 단계. Phase 2b(예외 메시지) 리뷰가 남긴 후속 항목.
> 규모가 작아(4파일·10문자열) 스펙에 구현 순서를 포함하고 별도 계획 문서는 두지 않는다.
> **v2 정정**: 구현 중 코드 확인 결과, 대상 중 2개가 Prisma **저장 필드**임이 드러나 경계를 다시 그었다(§경계 원칙).

## 배경

Phase 2b는 **throw되는 예외**를 국제화했다(전역 필터가 `{key,args}`를 요청 로케일로 번역). 그러나 **정상 응답 payload에 실려 나가는 메시지**는 필터를 거치지 않아 한국어로 남아 있다. 한국어 모드에서는 문제가 없지만, 기본 로케일인 영어 모드에서 이 문장들만 한국어로 보여 Phase 2b가 해결한 혼합 UX 문제가 이 경로에서 재발한다.

## 경계 원칙 (v2 — 이 스펙의 핵심 판단)

반환형 메시지는 두 종류로 갈리고, 취급이 다르다.

| 종류 | 성격 | 취급 | 이유 |
|---|---|---|---|
| **즉석 계산 응답** — lint 결과, 연결 테스트 결과 | 매 요청 계산, DB에 저장 안 됨 | **완전 국제화** (키 제공 → 웹 번역) | 키를 payload에 실으면 끝. 스키마 변경 불필요 |
| **DB 저장 레코드 텍스트** — `Backup.note`, `ExecutionStep.error` | Prisma 필드로 **영구 저장**, 나중에 조회되어 표시 | **영어화만** (번역 안 함) | ① 기존 레코드엔 이미 한국어가 저장돼 있어 **소급 번역이 원리적으로 불가** ② 키를 함께 저장하려면 마이그레이션 필요(과설계) ③ 같은 필드에 MySQL 드라이버 원문(영어)이 섞여 저장됨 |

두 번째 원칙은 Phase 2b가 감사 로그 `summary`를 "저장 시점 언어 유지"로 제외한 것과 **동일한 논리의 연장**이다. 저장된 과거 기록은 국제화 대상이 아니라 감사 증적이다.

## 목표와 종료 기준

**목표**: 즉석 계산 응답의 사용자 노출 메시지(8개)가 활성 로케일로 표시되고, 저장 레코드 텍스트(2개)는 국제 기본값인 영어로 통일된다.

**종료 기준**:
1. 영어 모드에서 SQL 검토(lint) 목록과 연결 테스트 오류가 영어로, 한국어 모드에서 한국어로 표시된다.
2. 저장 레코드 텍스트(백업 note, 롤백 실패 사유)가 영어로 기록된다.
3. 대상 4개 api 파일의 `message`/`error`/`note` 값에 한국어가 남지 않는다(주석·감사 summary는 허용).
4. api 테스트 전체 통과, 웹 빌드+tsc 통과, 웹 카탈로그 en/ko 파리티 유지.

## 대상

### A. 완전 국제화 (8개 — 웹이 번역)

| # | 문자열 | api 위치 | 웹 표시 | 키 |
|---|---|---|---|---|
| 1-7 | lint 룰 설명 7개 | `apply/lint.engine.ts` `RULES[].message` | 변경요청 상세 "SQL 검토" 목록 | **기존 `LintItem.rule`** 재사용(추가 없음) |
| 8 | `MVP는 MYSQL 대상만 연결을 지원합니다.` | `target-database.service.ts` `testConnection` | 대상DB `t('testFailure',{error})` | `errorKey: 'targetDatabase.mysqlOnly'` 신설 |

### B. 영어화만 (2개 — 저장 레코드)

| # | 문자열 | api 위치 | 저장 위치 |
|---|---|---|---|
| 9 | `일부 테이블이 BACKUP_MAX_ROWS 초과로…` | `apply/backup.service.ts` | `Backup.note` (Prisma `String?`) |
| 10 | `schema-only 백업 — 데이터 복구 불가…` | `apply/rollback.service.ts` | `ExecutionStep.error` (Prisma `String?`) |

번역 키를 붙이지 않는다 — 저장 레코드는 조회 시점에 키가 없어 무용하고(생성 응답에만 실어도 조회 경로에서 사라짐), 컬럼 추가는 이 규모에 과設계다.

## 스코프 제외 (Phase 2b 경계의 연장)

- 감사 로그에 저장되는 summary/comment (`rollback`, `apply`, `auth`, `target-database`, `sql-review`) — 저장 시점 언어 유지.
- 서버 콘솔·부팅 거부 메시지 (`main.ts`, `validate-env.ts`, `bootstrap.service.ts` 로거) — 운영자용, 브라우저 노출 아님.
- `crypto/encryption.util.ts` 내부 Error, 데모 시드 사용자 이름/부서.
- MySQL 드라이버 실행 오류 원문 — 진단상 원문 유지.
- class-validator 검증 메시지 — 이미 영어. 한국어 현지화는 별도 트랙.

## 접근 — 코드화된 키 + 웹 번역

Phase 2a에서 확립된 패턴(`badges.tsx`의 enum 코드값 → 웹 카탈로그 번역)을 재사용한다.

**왜 서버 번역(Phase 2b 방식)이 아닌가**: 예외는 전역 필터라는 단일 관문이 있어 배관이 공짜였지만, 정상 응답에는 그런 관문이 없다. 서버가 번역하려면 서비스 시그니처마다 로케일을 흘려야 해 도메인 로직이 오염된다. 대상은 모두 "코드화된 룰/상태"에 가까워 클라이언트 번역이 자연스럽다.

**api 측**
- **lint(1-7)**: **응답 구조 무변경** — `LintItem.rule`이 이미 안정적인 룰 키(`DROP_DATABASE` 등)로 웹까지 전달된다. `RULES[].message`의 한국어를 영어로 교체(국제 기본값 + api 단독 소비자용). 웹은 `message`를 폴백으로만 쓴다.
- **testConnection(8)**: `error`를 영어로 교체하고 `errorKey: 'targetDatabase.mysqlOnly'`를 응답에 추가(반환 타입에 옵셔널 필드).
- **저장 레코드(9-10)**: 문자열만 영어로 교체. 키 필드 추가하지 않음.

**웹 측**
- `messages/{en,ko}.json`에 **`serverMessages` 네임스페이스**를 신설한다. api가 반환하는 키 값이 이 네임스페이스 하위 경로와 정확히 일치하도록 중첩 구조로 둔다:
  ```
  serverMessages.lintRule.DROP_DATABASE …(7개, RULE_CATALOG의 ruleKey와 동일)
  serverMessages.targetDatabase.mysqlOnly
  ```
  `ko` 값은 기존 한국어 원문 그대로, `en`은 동등 영어.
- 렌더 규약: `const ts = useTranslations('serverMessages')`
  - lint 항목: 카탈로그에 있으면 `ts('lintRule.' + item.rule)`, 없으면 `item.message` 폴백(향후 api에 룰이 추가돼도 안전 — `badges.tsx`와 동일 패턴).
  - 연결 테스트: `errorKey`가 있으면 `ts(errorKey)`, 없으면 기존 `error` 원문 폴백.
- `lib/api.ts`의 `TestConnectionResult`에 `errorKey?: string` 추가. 백업 note·실행 단계 오류 렌더는 **변경하지 않는다**(영어 원문 그대로 표시).

## 구현 순서

**Task A — api**: `lint.engine.ts` 7개 message 영어화 · `target-database.service.ts` error 영어화 + `errorKey` 추가(반환 타입 포함) · `backup.service.ts`·`rollback.service.ts` 문자열 영어화(키 없음). 게이트: `pnpm --filter @dbflow/api test` 통과 + 대상 4파일의 message/error/note 값에 한국어 0.

**Task B — web**: `lib/api.ts`에 `errorKey?` 추가 · `messages/{en,ko}.json`에 `serverMessages` 신설(8키) · 상세 페이지 lint 목록과 대상DB 테스트 오류 렌더를 `ts(...)` 기반으로 전환(백업 note·실행 오류는 무변경). 게이트: 웹 빌드+tsc + en/ko 전체 파리티 + 보간 플레이스홀더 일치.

## 검증

- Task A: api 테스트 전체 통과, 4파일의 값 문자열 한국어 0.
- Task B: `pnpm --filter @dbflow/web build` + `tsc --noEmit`, 전체 카탈로그 en/ko 키 파리티 `true`.
- **핵심 대조(컨트롤러 수행)**: 웹 카탈로그의 `serverMessages.lintRule.*` 키 집합이 api `RULE_CATALOG`의 `ruleKey` 7개와 **정확히 일치**하는지 기계적으로 대조. 불일치는 런타임에 조용히 영어 폴백으로 새므로 이 대조가 진짜 게이트다.

## 리스크

- **룰 키 집합 불일치**: 위 대조로 차단.
- **폴백 경로 유지**: 향후 룰 추가 시에도 웹이 깨지지 않도록 `has`-체크 후 `item.message` 폴백 유지.
- **기존 저장 레코드**: 프로덕션에 이미 저장된 한국어 note/error는 그대로 남는다(소급 변경하지 않음 — 감사 증적 보존).
