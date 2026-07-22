# DBFlow 기능 TODO 리스트

> 작성일: 2026-06-17
> 설계 문서: `2026-06-17-dbflow-design.md`
> 범례: `[ ]` 미착수 · `[~]` 진행중 · `[x]` 완료

마일스톤 순서대로 진행한다. **M0~M5가 MVP**이며, M6 이후는 확장 백로그다.

---

## M0. 프로젝트 기반 (Foundation)

- [ ] 모노레포/디렉토리 구조 결정 (`apps/web` Next.js, `apps/api` NestJS)
- [ ] NestJS 프로젝트 셋업 + 기본 설정(config, validation pipe)
- [ ] Next.js 프로젝트 셋업 + 기본 레이아웃
- [ ] 메타DB(PostgreSQL) + Prisma 셋업, 초기 마이그레이션
- [ ] 로컬 개발 환경 docker-compose (PostgreSQL + 테스트용 MySQL dev/prod)
- [ ] Atlas CLI 설치·동작 확인 (백엔드에서 child_process 호출 PoC)

---

## M1. 인증 / 권한 (Auth & RBAC)

- [ ] User 모델 + Prisma 스키마
- [ ] 회원/계정 생성(관리자 발급) + 비밀번호 해시(bcrypt/argon2)
- [ ] 로그인 / JWT 발급·검증
- [ ] 역할(DEVELOPER / REVIEWER(DBA) / APPROVER) 정의
- [ ] RBAC 가드 (역할별 API 접근 제어)
- [ ] 프론트: 로그인 화면 + 역할별 메뉴 노출

---

## M2. 환경 연결 관리 (Connections)

- [ ] Environment 모델 (host/port/db/stage/dbType)
- [ ] 자격증명 AES-256-GCM 암호화 저장/복호화 모듈
- [ ] 대상 MySQL 커넥션 풀 관리 (mysql2)
- [ ] 연결 테스트 기능 (등록 시 ping)
- [ ] 환경 CRUD API + 화면 (비밀번호 응답 비노출)
- [ ] dev / prod 2개 환경 등록 플로우

---

## M3. 스키마 비교 & 변경 생성 (Diff & Authoring)

- [ ] Diff 모듈: Atlas로 source/target introspect → DDL diff 생성
- [ ] Diff 결과 파싱 → ChangeItem(DDL_AUTO) 목록 변환
- [ ] ChangeRequest / ChangeItem 모델
- [ ] DML 수동 SQL 항목 추가 기능
- [ ] 변경 항목 적용 **순서(order)** 지정 UI
- [ ] FileStore: 변경 항목을 타임스탬프 버전 SQL 파일로 저장 (로컬 FS 어댑터)
- [ ] 변경 요청 생성/수정/제출 API + 화면
- [ ] diff 결과 시각화(추가/변경/삭제 구분)

---

## M4. 결재 워크플로우 (Approval Chain)

- [ ] 상태머신 구현 (DRAFT→SUBMITTED→REVIEWED→APPROVED→APPLIED, REJECTED)
- [ ] Approval 모델 + 단계별 권한 검증
- [ ] DBA 검토 화면 (승인/반려 + 코멘트)
- [ ] 결재자 결재 화면 (승인/반려 + 코멘트)
- [ ] 반려 시 작성자 재제출 흐름
- [ ] 결재 진행 상태 표시(타임라인 UI)

---

## M5. 적용 & 추적성 (Execution & Audit)

- [ ] Execution 모듈: 승인된 요청을 order대로 실행
- [ ] dry-run (적용 전 검증)
- [ ] 롤백 SQL 자동 생성
- [ ] 실행 결과 기록(SUCCESS/FAILED/PARTIAL) + 로그
- [ ] 부분 실패 처리 + 수동 복구 가이드
- [ ] AuditLog: 모든 액션 누가/언제/무엇 기록
- [ ] 이력/감사 조회 화면
- [ ] 적용 확정 UI (운영 반영 확인 모달)

> **여기까지 MVP 완료** — 직접 사내에서 dev→prod 변경을 도구로 수행 가능

---

## M6+. 확장 백로그 (Post-MVP)

### 멀티 DB
- [ ] PostgreSQL 지원
- [ ] MariaDB 지원
- [ ] Oracle 지원

### 멀티 환경
- [ ] N환경(dev→staging→prod) 지원
- [ ] 환경 간 누락분 비교/승격 (flyway_schema_history 비교 개념)
- [ ] 환경별 스키마 일치 대시보드

### 엔진/저장
- [ ] 자체 diff 엔진 구현 (Atlas 대체/보완)
- [ ] 파일 저장소 S3 어댑터
- [ ] 파일 저장소 Git 어댑터
- [ ] Flyway식 버전 마이그레이션 모드 1급 지원

### 안전성
- [ ] 적용 전 자동 백업 스냅샷
- [ ] 드리프트 감지 (도구 밖 변경 탐지)
- [ ] 적용 트랜잭션 강화

### 운영 편의
- [ ] 알림 (Slack / 이메일) — 결재 단계별
- [ ] 정기 적용 스케줄링
- [ ] 변경 요청 검색/필터/태그

### 상용화 (SaaS)
- [ ] 멀티테넌시
- [ ] SSO (OAuth/SAML)
- [ ] 과금/플랜
- [ ] 조직·팀 관리
