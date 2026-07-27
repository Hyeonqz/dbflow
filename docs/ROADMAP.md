# DBFlow 로드맵 / TODO

DB 변경요청을 ERP식 다단계 승인으로 관리하고 실제 대상 DB에 안전하게 적용하는 솔루션.

## ✅ 완료 (master)

| Plan | 내용 | PR |
|------|------|-----|
| 1 | Foundation + Auth — JWT 로그인, RBAC(개발자/검토자=DBA/결재자), 역할별 대시보드 | #1 |
| 2 | 변경요청 승인 워크플로우 — DRAFT→SUBMITTED→REVIEW→FINAL 상태머신, 역할별 가시성, 파일 기반 DDL/DML | #2 |
| — | shadow DB GRANT 자동화 (로컬 `prisma migrate dev`) | #3 |
| 3 | 적용 엔진 + 대상 DB 레지스트리 — 환경별 정책(DEV 자동/STAGING·PROD 승인), 실행 추적, AES-256-GCM 암호화 | #4 |
| 4 | 스키마 Diff 생성기 — 기준 스키마 vs 현재 대상 DB 비교 → DDL 자동 생성 → DRAFT CR 투입 | #5 |
| 5 | 적용 안전장치 — 위험 SQL 린트(BLOCK/WARN), dry-run, 자동 백업, 롤백 | #6 |
| — | 지정 검토/결재자 · 부서 프로필 · ADMIN 계정 생성 · 텔레그램 알림 | — |
| T1-1 | 감사 로그 UI — 필터/검색/CSV·JSON 내보내기, append-only 트리거 | — |
| T1-2 | SQL 리뷰 정책 — 환경×규칙 심각도(DISABLED/INFO/WARN/BLOCK) 설정 | #11 |
| T1-3 | 커스텀 승인 플로우 — 환경별 결재 인원(N명 만장일치), 결재 정책 관리 | #12 |
| OSS | 오픈소스 전환 — 단일 이미지 셀프호스팅 · 다국어(영어 기본/한국어) · 배포 타임존 `DBFLOW_TZ` · Docker Hub 공개 | — |

기반 스택: Next.js(App Router) + NestJS + Prisma + MySQL 8 / 토스 스타일 UI / 테스트 173개.

---

## 🔭 다음 (Tier-2 후보)

경쟁·유사 툴(Bytebase / ITIL·ServiceNow / Liquibase / Redgate / Yearning·Archery) 리서치로 도출한
다음 기능 후보와 추천 3선은 **[roadmap-tier2-candidates.md](./roadmap-tier2-candidates.md)** 참고.
B1(변경 작업창·동결) ✅ PR #13, A1 부재 위임 ✅ PR #14. 다음 추천: ① A1 잔여(에스컬레이션·SLA + 알림 발송 인프라) → ② 긴급 변경 fast-path + 사후 검토(PIR) → ③ 롤백 계획 필수화.

**UX 중심 후보**(실제 제품·사용자 경험 리서치, 2026-07-27)는 **[roadmap-ux-candidates.md](./roadmap-ux-candidates.md)** 참고.
추천: ⓪ CR 상세 에러 표시 버그픽스 → ① 결재 인박스 슬라이스(대기 큐·배지·재검토 요청·위임 표시) → ② 리비전 diff+승인 무효화 → ③ 에디터·목록 에르고노믹스 팩.

---

## 📋 TODO (구 목록 — Tier-2 후보 문서로 재정리 중)

### P1 — 실사용 채택 블로커
- [x] **감사 로그 UI** — 완료 (T1-1)
- [~] **알림 (Notifications)** — 텔레그램 완료, 이메일/Slack/웹훅·인터랙티브 결재는 Tier-2 D1

### P2 — 상용화 준비
- [ ] **staging 환경 추가** — dev→staging→prod 3단계 승격 파이프라인
- [ ] **암호화 키 운영 관리** — `APP_ENCRYPTION_KEY` → KMS/secret manager 연동, 키 로테이션
- [ ] **멀티 DB 엔진 확장** — PostgreSQL / MariaDB / Oracle (현재 MySQL 전용; introspector·파서·적용 드라이버 추상화 필요)
- [ ] **조직/멀티테넌시** — 팀·프로젝트 단위 격리, 대상 DB·권한 스코프

### P3 — 스키마 Diff 고도화 (Plan 4 후속)
- [ ] DEFAULT-only 변경 비교
- [ ] FK / PK 변경 지원
- [ ] 전체 동기화 모드의 DROP_TABLE (대상-only 테이블 제거)
- [ ] 타입 비교 정밀화 (display width/콜레이션 오탐 제거)
- [ ] 기준 스키마 소스 다양화 (Prisma schema / 파일 업로드 / 다른 DB introspect)

### P4 — 운영·품질
- [ ] **적용 동시성/큐** — 대상 DB별 적용 큐, 예약 적용(maintenance window)
- [ ] **e2e 테스트** — 로그인→생성→승인→적용 전 구간 자동화
- [ ] **관측성** — 구조화 로깅, correlation id, 메트릭/대시보드
- [ ] **대상 DB 연결 풀/타임아웃·재시도** 정책
- [x] **CI 파이프라인** — PR·main push마다 api 테스트 + web 타입검사/빌드 자동 실행 (`.github/workflows/ci.yml`)
- [ ] **FE 인증 토큰** localStorage → httpOnly 쿠키(Server Component 전환)

### P5 — 제품화
- [x] **온보딩/설치 가이드 + 셀프호스팅 패키징** — 단일 이미지(web+api) `docker compose` 배포본, README 복붙 quickstart, 프로덕션 배포 가이드(TLS·감사 IP·하드닝)
- [x] **오픈소스 공개** — AGPL-3.0, Docker Hub `calixjin/dbflow` (v0.1.0 · v0.1.1, amd64/arm64), 태그 push 시 자동 배포
- [ ] 요금/라이선스, 사용량 측정
- [ ] 변경요청 템플릿·재사용, 코멘트/멘션 협업
- [ ] 슬랙/팀즈 통합, 웹훅
