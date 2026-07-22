# DBFlow 오픈소스 전환 전략

> 2026-07-22 v2. **판매형 솔루션 → 오픈소스 셀프호스팅**(Keycloak 모델).
> v2 변경: 코드베이스 실태조사 반영, 다국어(i18n) 트랙 추가, 배포 방식(§4-B) 확정.
> ✅ 2026-07-22: 결정 A·B·C·D 전부 확정(§4). 수익 모델 = 오픈코어+수익 여지 → 라이선스 AGPL-3.0.

## 1. 무엇이 바뀌나

- **제품은 그대로**: 통제된 절차 기반 DB 변경 형상관리(작성→제출→검토→결재→백업 후 적용), 규제 조직(금융·공공·대기업) 대상.
- **바뀌는 것은 go-to-market**: 라이선스 판매 → **오픈소스로 공개하고 각자 자기 인프라에 셀프호스팅**. Keycloak이 인증(IAM) 니치에서 하듯, DBFlow는 "규제 조직의 DB 변경 통제" 니치의 셀프호스팅 OSS를 지향.
- 사용자 진입 경로는 **두 가지 모두 지원**(§4-B 확정):
  1. `git clone` → `docker compose up` (소스에서 빌드)
  2. Docker Hub 이미지 `pull` → compose로 기동 (빌드 불필요)
- 국제 오픈소스 사용자를 위해 **UI/메시지 다국어(영어·한국어, 이후 확장)** 를 코어 기능으로 제공한다(§6).

## 2. Keycloak 운영 모델에서 참고할 점

- 커뮤니티 오픈소스 코어 + 문서 + 컨테이너 이미지 → 누구나 셀프호스팅.
- **첫 실행 관리자 부트스트랩**(`KEYCLOAK_ADMIN`/`KEYCLOAK_ADMIN_PASSWORD` env). 데모 계정 없음.
- 모든 설정을 **env로 외부화**(DB, 시크릿, 포트, base URL).
- 선택적 상용(Red Hat build of Keycloak) — 개발자 커뮤니티 성장 + 엔터프라이즈 지원 유료화.

## 3. 현재 격차 — 패키징/공개 (2026-07-22 코드 조사 기준)

| 항목 | 현재 | 필요 |
|---|---|---|
| api/web 컨테이너화 | ❌ Dockerfile·`.dockerignore` 없음. `docker/docker-compose.yml`은 개발용 MySQL만 기동 | 프로덕션 멀티스테이지 Dockerfile 2개 + 전체 스택 compose(mysql+api+web) |
| 마이그레이션 실행 | ⚠️ `start.sh`가 호스트에서 `prisma migrate deploy` 수동 실행 | api 컨테이너 entrypoint에서 `migrate deploy` 후 기동 |
| web→api 주소 | ❌ `apps/web/lib/api.ts`의 `NEXT_PUBLIC_API_BASE`가 **빌드타임** 변수(기본 `localhost:3001`) → Hub에 올린 이미지에 주소가 박힘 | Next.js rewrites로 same-origin 프록시(`/api/*` → api) 전환. **Docker Hub 배포의 선결 조건** |
| 시크릿 기본값 | ❌ `JWT_SECRET` 기본 `change-me-in-prod`로 **조용히 부팅**(auth.module.ts), `.env.example`의 `APP_ENCRYPTION_KEY`는 전부 0 | 기본/약한 시크릿이면 부팅 거부(fail-fast) |
| 최초 관리자 | ❌ seed가 데모 계정 4개(`password1234`) 무조건 생성 | env 부트스트랩(§4-C), 데모 시드는 opt-in 플래그로 분리 |
| env 문서화 | ⚠️ 루트 `.env.example`만 존재(api용), web용 없음 | api/web `.env.example` 정비 + 설정 레퍼런스 문서 |
| CORS/헬스체크 | ⚠️ `origin: true`(모든 오리진 반사), 헬스체크 엔드포인트 없음 | 프로덕션 CORS 설정, `/health` 추가(compose healthcheck 연동) |
| 라이선스/문서 | ❌ LICENSE·README·CONTRIBUTING·SECURITY 전무. 문서 전부 한국어 | 전부 필요, 공개 문서는 영문 기준(라이선스 AGPL-3.0, §4-A) |
| 이미지 배포/CI | ❌ `.github/workflows` 없음 | CI(빌드/테스트) + 태그 시 Docker Hub push, 버전 릴리스·체인지로그 |

## 4. 결정 사항

- **A. 라이선스** — ✅ **확정(2026-07-22): AGPL-3.0**(수익 모델=오픈코어+수익 여지 결정에 따름). 저작권자(본인)는 CLA 기반 **듀얼 라이선스**로 상용판 판매 가능. 코어=AGPL, 향후 엔터프라이즈 애드온/호스팅/지원은 별도. 수용한 트레이드오프: 네트워크 카피레프트가 일부 엔터프라이즈 도입을 저해할 수 있음. 부수 의무: 공개 전 의존성 라이선스 AGPL 호환성 감사(§5-5 체크리스트).
  - **오픈코어 경계(초안)**: 무료 AGPL 코어 = 통제 절차 전체(작성→검토→다중결재→위임→SoD→작업창→적용→롤백→감사). 향후 유료 후보 = SSO/SCIM(엔터프라이즈 인증), 고급 감사 리포트/컴플라이언스 증빙 번들, 멀티테넌시/조직관리, 우선 지원·SLA. (경계는 M2 이후 별도 확정 — 지금은 전부 코어.)
- **B. 배포 방식** — ✅ **확정(2026-07-22): 둘 다 지원.** git clone + compose(소스 빌드)와 Docker Hub 이미지 pull 모두 1급 경로. 구현 순서는 clone+compose 먼저(패키징 산출물이 Hub 이미지의 재료), 이어서 CI로 Hub push.
- **C. 최초 관리자** — ✅ **확정: fail-fast + env**. `DBFLOW_ADMIN_EMAIL`/`DBFLOW_ADMIN_PASSWORD` 미설정이면 **부팅 거부**(Keycloak식). 최초 기동 시 해당 관리자 1회 생성. 데모 시드 4계정은 `DBFLOW_DEMO=true`일 때만.
- **D. 로케일 전략** — ✅ **확정: 쿠키+미들웨어**(URL 불변). next-intl, 언어 전환 UI는 프로필/헤더. URL prefix는 미채택.

## 5. 트랙 1 — 패키징·공개 (필요 작업)

§3 격차의 해소 작업. 각 항목은 기존 개발 사이클(brainstorm→spec→plan→구현→리뷰)로 진행.

1. **컨테이너화**: api/web 프로덕션 Dockerfile(멀티스테이지, pnpm workspace 대응) + `.dockerignore` + 전체 스택 compose(mysql `mysqldata` 볼륨 유지, api는 `depends_on: mysql: condition: service_healthy`로 기동 순서 보장). api entrypoint에서 `prisma migrate deploy` 후 기동.
   - 함정 체크리스트(리뷰 반영): ⓐ Prisma `binaryTargets`를 대상 플랫폼(amd64/arm64·베이스 이미지 libc)에 맞게 지정 ⓑ `prisma` CLI와 seed 실행기(`ts-node`)는 devDependency — migrate/seed를 실행하는 레이어에 CLI가 살아남도록 구성 ⓒ web `next.config.js`에 `output: 'standalone'` 추가(이미지 슬림화) ⓓ `argon2` 네이티브 애드온이 선택한 베이스 이미지(특히 alpine/musl)에서 동작하는지 선검증.
2. **web API 프록시 전환**: `NEXT_PUBLIC_API_BASE` 의존 제거, Next.js rewrites same-origin 프록시(`/api/*` → api, 내부 주소는 `next start` 기동 시 런타임 env로 해석). 사전 빌드 이미지가 어떤 호스트에서도 동작하는 조건. 부수 효과: 브라우저 CORS 문제 소멸 — §5-3의 CORS 하드닝은 api를 직접 노출하는 배포에만 해당. 의도된 트레이드오프: 감사 export 다운로드 포함 전 api 트래픽이 Next 서버를 경유(사내 도구 규모에서 허용).
3. **보안 하드닝**: 부팅 env 검증을 `main.ts` 부트스트랩 **단일 지점**에서 수행 — 기본 `JWT_SECRET`(기본값이 auth.module.ts와 jwt.strategy.ts **두 곳**에 존재), 전부 0인 `APP_ENCRYPTION_KEY`, §4-C 관리자 env 미설정 시 부팅 거부. CORS 프로덕션 설정(직접 노출 배포용) + `/health` 엔드포인트(compose healthcheck 연동).
4. **관리자 부트스트랩 + 데모 시드 분리**(§4-C): `DBFLOW_ADMIN_EMAIL`/`DBFLOW_ADMIN_PASSWORD` 필수(미설정 시 부팅 거부), 최초 기동 시 1회 생성. 데모 4계정은 `DBFLOW_DEMO=true`일 때만. **M1 범위** — 클린 `compose up` 후 로그인 가능해야 M1 완료(사용자를 만드는 경로가 seed뿐이므로, 이것 없이는 부팅돼도 로그인 불가).
5. **문서·라이선스**: LICENSE(AGPL-3.0) · 영문 README 퀵스타트(두 진입 경로 + **평가 모드**(`DBFLOW_DEMO=true` 원커맨드 체험) vs **프로덕션 모드** 구분) · 설정 레퍼런스 · CONTRIBUTING · SECURITY · issue/PR 템플릿 · CODE_OF_CONDUCT · semver 버저닝 규칙. **공개 전 체크리스트**: git 히스토리 시크릿 스캔, 의존성 라이선스 AGPL 호환성 감사.
6. **운영 배포 가이드**: TLS 종단(리버스 프록시 예시) + `X-Forwarded-*`/trust proxy 처리 — 감사 로그의 클라이언트 IP가 프록시 뒤에서 프록시 IP로 찍히지 않게. DB 볼륨 백업/복구 가이드(적용 전 백업이 DB에 저장되므로 DB 볼륨 유실 = 백업 유실).
7. **배포 자동화**: GitHub Actions CI(빌드/테스트/lint) + 태그 시 Docker Hub 이미지 push(멀티아치 amd64/arm64) + 릴리스·체인지로그.

## 6. 트랙 2 — 다국어 i18n (필요 작업)

현황(2026-07-22 조사): i18n 라이브러리 없음. web 21개 파일에 한국어 UI 문자열 약 300~450개(페이지 대부분 `"use client"`), api 서비스 예외 메시지 약 100~120개(최대 `change-request.service.ts` 32개, 보간 포함). DB는 enum 전부 영어 코드라 스키마 작업 불필요. `components/badges.tsx`의 enum→라벨 맵은 이미 key→label 구조.

1. **web i18n 기반**: `next-intl` 도입 + 쿠키+미들웨어 로케일(§4-D) + 언어 전환 UI(프로필/헤더).
2. **web 문자열 추출**: 21개 파일의 문자열을 `ko.json`/`en.json` 카탈로그로. `badges.tsx` 라벨 맵부터(구조 그대로 이전), 최대 파일은 `change-requests/[id]/page.tsx`.
3. **날짜/숫자 포맷 파라미터화**: `lib/format.ts`의 `'ko-KR'` 하드코딩 + 인라인 중복 3곳을 로케일 기반으로 통일.
4. **배포 타임존 설정화(리뷰 반영 — 언어와 별개의 1급 설정)**: 현재 `+09:00` 오프셋이 delegation·apply-schedule의 벽시계→시각 변환에 하드코딩돼 있고 `main.ts`도 서버 `TZ=Asia/Seoul`을 가정. 해외 셀프호스터가 작업창 09:00–18:00을 설정하면 **조용히 KST로 해석되는 정합성 버그** — 작업창/동결기간이 핵심 가치인 제품에서 치명적. env(`DBFLOW_TZ` 등)로 파라미터화. i18n의 필수 동반 작업(별도 스펙 가능).
5. **api 예외 메시지 국제화**: 예외를 메시지 키+파라미터로 throw, 기존 `audit-exception.filter.ts`에서 해석. 로케일은 브라우저 `Accept-Language`가 아니라 **앱에서 선택한 로케일(쿠키)을 클라이언트가 헤더로 전달**(§4-D와 정합 — 안 그러면 UI는 한국어인데 에러는 영어인 혼합 UX 발생). 전달 지점은 `lib/api.ts`의 `apiFetch` 단일 관문 + 직접 fetch 2곳(login, audit export). `nestjs-i18n` 전면 도입은 validation 메시지 현지화가 필요해질 때.
6. **언어 추가 확장성**: 카탈로그 구조가 잡히면 신규 언어 = json 파일 추가. 별도 코드 작업 없음.

참고: class-validator 기본 메시지는 현재 영어 — 한국어 로케일 현지화는 후순위(§6-5의 확장으로 처리 가능).

## 7. 마일스톤과 순서

1. **M1 패키징+부트스트랩**(트랙1 §5-1~4) — 종료 기준: **클린 `compose up` 후 §4-C 관리자로 로그인까지 동작**. 최우선.
2. **M2 문서·라이선스·공개**(트랙1 §5-5~6) — 공개 전 체크리스트(히스토리 스캔·의존성 라이선스 감사) 통과 후 리포지토리 공개.
3. **M3 i18n**(트랙2) — M1과 병행 가능한 것은 **문자열 추출(§6-2)뿐**(카탈로그 구조만 합의되면 결정 비의존). next-intl 배선(§6-1)·타임존 설정화(§6-4)는 각각 독립 스펙으로 진행. 영문 README 등 공개 문서는 M2에서 처음부터 영문 작성해 이중작업 방지.
4. **M4 배포 자동화**(트랙1 §5-7) — M1 산출물을 CI로 Hub push. 이 시점부터 "pull → up → 동작" 경로 개통.
5. **(선택) 오픈코어** — §4-A의 경계 초안대로 커뮤니티 코어 + 추후 유료 엔터프라이즈/지원. 경계 확정은 M2 이후.

## 8. 진행 중 작업과의 관계

- 기능 개발(다중결재·위임·SoD·작업창·관리 UX 등)은 그대로 유효 — 오픈소스 코어의 기능이 된다.
- 이 전환 트랙은 기능과 **병행 또는 후행** 가능. 단 M1(패키징)이 "셀프호스팅 가능"의 최소 조건이라 우선순위 최상.
- 운영 하드닝 로드맵 항목(httpOnly 쿠키 인증 P4, 암호화키 KMS P2)은 M2 이후 순차 편입.
