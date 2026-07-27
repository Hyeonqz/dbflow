# 배포 타임존 설정화 (`DBFLOW_TZ`) 설계

> 2026-07-26. v0.1.0의 알려진 제약 해소. 지금은 백엔드가 `Asia/Seoul`을 가정해, 비-KST 배포에서 적용 작업창·동결 판정이 어긋난다.

## 문제

작업창과 동결기간은 이 제품의 핵심 통제 장치인데, 벽시계 입력이 **KST로 고정 해석**된다.

- `delegation.service.ts:8`, `apply-schedule.service.ts:19` — `new Date(\`${value}:00+09:00\`)`: 사용자가 입력한 `09:00`을 항상 KST로 파싱한다. 프랑크푸르트 운영자가 "09:00–18:00 작업창"을 만들면 실제로는 **현지 00:00–09:00**이 된다.
- `apply-schedule.service.ts:14` — 메시지용 포맷이 `timeZone: 'Asia/Seoul'` 고정.
- `main.ts:10` — 서버 TZ가 `Asia/Seoul`이 아니면 경고만 출력(방치).
- 웹 `apply-schedule/page.tsx:65` — 서버가 알려준 `schedule.timezone`이 `Asia/Seoul`이 아니면 "불일치" 경고. 즉 KST가 정상값이라는 전제.
- 웹 `lib/format.ts` `formatKstDateTime` — 비즈니스 시각 표시가 `Asia/Seoul` 고정.

DB에는 타임존 컬럼이 없다(`schedule.timezone`은 런타임 `Intl...resolvedOptions().timeZone`을 응답에 실어 보내는 어서션 값일 뿐). 그래서 **스키마 변경 없이** 해결된다.

## 접근 — 프로세스 타임존을 설정으로 만들고, 오프셋 하드코딩을 없앤다

핵심 통찰: 오프셋을 직접 계산할 필요가 없다. `new Date('2026-07-26T09:00:00')`처럼 **오프셋 없는 date-time은 로컬 타임존으로 해석**되므로(ES 사양), 프로세스 TZ를 배포 타임존으로 맞추면 파싱·판정·포맷이 자동으로 따라온다. DST가 있는 타임존도 `Date`가 알아서 처리한다.

**env**: `DBFLOW_TZ` (IANA 존 이름, 기본 `Asia/Seoul` — 기존 배포 무회귀).

**api**
1. `main.ts` 부팅 초기에 `process.env.TZ`를 `DBFLOW_TZ`로 설정한다(Node는 이후 `Date` 연산에 반영). 컨테이너 `TZ`와 이중 관리하지 않도록 `DBFLOW_TZ`를 단일 소스로 둔다.
2. `validate-env.ts`에서 `DBFLOW_TZ` **유효성 검증**: `Intl.DateTimeFormat(undefined, { timeZone: v })`가 던지면 오타이므로 부팅 거부(fail-fast). 기존 fail-fast 원칙과 동일.
3. `+09:00` 하드코딩 2곳 제거 → 오프셋 없는 로컬 파싱.
4. `apply-schedule.service.ts:14`의 `timeZone: 'Asia/Seoul'` 제거(로컬 = `DBFLOW_TZ`).
5. `main.ts`의 "TZ가 Asia/Seoul이 아님" 경고는 제거한다 — 프로세스 TZ를 강제하므로 불일치가 성립하지 않는다.

**web** (단일 이미지라 웹 서버도 같은 env를 본다)
6. `i18n/request.ts`(next-intl `getRequestConfig`)에서 `timeZone: process.env.DBFLOW_TZ ?? 'Asia/Seoul'`를 반환한다. next-intl이 이미 타임존을 1급으로 다루므로 **새 provider가 필요 없다** — 클라이언트는 `useTimeZone()`으로 읽는다.
7. `lib/format.ts`: `formatKstDateTime(iso, locale)` → `formatBusinessDateTime(iso, locale, timeZone)`. 호출부(작업창·동결·위임 기간, 상세의 동결 배너)가 `useTimeZone()` 값을 넘긴다. 이름도 KST 전제를 버린다.
8. `apply-schedule/page.tsx`의 경고: "서버가 KST가 아님"(무의미해짐) → **"표시 시각은 `<타임존>` 기준"** 안내로 전환. 서버가 준 `schedule.timezone`과 브라우저 타임존이 다를 때만 노출해, 운영자가 시차를 오해하지 않게 한다. 메시지 키는 en/ko 양쪽 갱신.

**배포 파일**: compose 2개의 `TZ: Asia/Seoul` → `TZ: ${DBFLOW_TZ:-Asia/Seoul}`(tzdata가 컨테이너 로컬시간도 맞추도록) + `DBFLOW_TZ` 전달. `.env.example`에 `DBFLOW_TZ` 항목과 설명 추가.

## 종료 기준

1. `DBFLOW_TZ=Europe/Berlin`으로 기동하면, 작업창 `09:00–18:00`이 **베를린 09–18시**로 판정된다(KST 아님).
2. `DBFLOW_TZ` 미설정 시 기존과 동일(`Asia/Seoul`) — 무회귀.
3. 잘못된 값(`DBFLOW_TZ=Seoul/Asia` 등)은 부팅 거부.
4. 웹의 비즈니스 시각 표시가 `DBFLOW_TZ` 기준이고, 브라우저 타임존과 다르면 기준 타임존을 안내한다.
5. api 테스트 전체 통과, 웹 빌드+tsc 통과, en/ko 카탈로그 파리티 유지.

## 검증

- 단위: 작업창 판정 로직을 `TZ`를 바꿔 실행해 같은 벽시계 입력이 다른 UTC 인스턴트로 파싱되는지 확인(가능하면 기존 apply-schedule 스펙에 케이스 추가).
- 통합(컨트롤러): 단일 이미지를 `DBFLOW_TZ=Europe/Berlin`으로 띄워, 작업창을 만들고 `/apply-schedule` 응답의 `timezone`이 `Europe/Berlin`인지 + 판정 경계가 베를린 기준인지 확인. 기본값(미설정)으로도 한 번 확인.
- 오타 값으로 기동 시 부팅 거부 확인.

## 스코프 제외

- **DB 컬럼화(스케줄별 타임존)** — 조직 하나가 여러 타임존의 작업창을 동시에 운영하는 요구는 아직 없다. 배포 단위 설정으로 충분하며, 필요해지면 그때 컬럼을 추가한다(그때도 이 env가 기본값이 된다).
- **과거 저장 데이터의 소급 재해석** — 이미 저장된 인스턴트는 UTC로 정확하다. 표시 타임존만 바뀐다.
