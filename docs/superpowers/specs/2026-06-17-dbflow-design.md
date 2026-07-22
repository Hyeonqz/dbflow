# DBFlow 설계 문서 (DB 변경 형상 관리 도구)

> 작성일: 2026-06-17
> 상태: 설계 승인 대기 → 구현 계획 작성 예정
> 가칭: **DBFlow** (이름은 추후 변경 가능)

---

## 1. 목적 / 배경

현재 개발 DB의 변경(스키마·데이터)을 운영 DB로 반영할 때 **Workbench / ERD 도구를 통해 수동으로** 진행하고 있다. 이로 인해 다음 문제가 발생한다.

- **운영 사고 위험**: 수동 반영 중 누락·실수 가능
- **추적성 부재**: 누가, 언제, 무엇을 반영했는지 기록이 없음
- **검토·승인 절차 부재**: 변경이 통제 없이 운영에 반영됨
- **환경 간 불일치**: dev와 prod 스키마가 어긋남

이를 해결하기 위해, dev/prod 스키마를 자동 비교해 DDL을 생성하고, DML은 직접 작성해 하나의 "변경 요청"으로 묶은 뒤 **개발자 → DBA → 결재자 3단계 결재**를 거쳐 운영에 안전하게 적용하는 웹 도구를 구축한다.

**목표 단계**
1. MVP를 작게 만들어 직접 사용
2. 사내 도입
3. 검증되면 상용화(SaaS)

---

## 2. 한 줄 정의

> dev/prod 스키마를 자동 비교(Atlas)해 DDL을 생성하고, DML은 직접 작성해 하나의 "변경 요청"으로 묶은 뒤, 개발자→DBA→결재자 3단계 결재를 거쳐 운영에 안전하게 적용하는 웹 도구. 모든 변경은 버전 SQL 파일로 보관.

---

## 3. 핵심 설계 결정 (확정 사항)

| 항목 | 결정 | 비고 |
|------|------|------|
| 변경 관리 방식 | **상태 비교(diff) + 마이그레이션 스크립트 하이브리드** | MVP는 상태 비교(DDL) 우선 |
| MVP 우선순위 | **상태 비교 먼저** (dev↔prod diff → DDL 생성 → 적용) | 현재 수동 작업을 즉시 자동화 |
| 대상 DB | MySQL (MVP) | PostgreSQL / MariaDB / Oracle은 확장 |
| 환경 | dev → prod 2단계 (MVP) | staging 포함 N단계는 확장 |
| 적용 방식 | **검토 후 수동 확정** + 롤백 SQL 생성 | 자동 적용 안 함 |
| 결재 | **3단계 풀 체인** 개발자 → 검토자(DBA) → 결재자 | 반려·코멘트 포함 |
| 결재 단위 | **단건·릴리스 묶음 모두** (변경 요청 = 1~N개 항목) | 운영 핫픽스 + 정기 배포 모두 커버 |
| diff 엔진 | **Atlas(atlasgo.io) CLI 활용** | 멀티 DB 지원, 자체 구현은 추후 |
| 변경 타입 | **DDL(자동 diff) + DML(수동 작성)** 한 요청에 혼재 | 순서 지정 가능 |
| 저장 방식 | **파일 기반** (버전 SQL 파일, 로컬 FS) | S3/Git는 확장 |
| 스택 | **Next.js(프론트) + NestJS(백엔드) + Prisma(메타DB)** | 메타DB는 PostgreSQL |

---

## 4. 아키텍처

```
┌─────────────────┐      REST/JSON       ┌──────────────────────────────┐
│  Next.js 프론트  │  ─────────────────>  │        NestJS 백엔드          │
│  (역할별 화면)    │                      │                              │
└─────────────────┘                      │  ┌────────────────────────┐  │
                                         │  │ 메타DB (PostgreSQL)     │  │  유저·결재·이력
                                         │  │ Prisma ORM             │  │
                                         │  └────────────────────────┘  │
                                         │                              │
                                         │  ── mysql2 ──> 대상 DB        │  introspection·
                                         │     (dev / prod MySQL)        │  DDL/DML 실행
                                         │                              │
                                         │  ── Atlas CLI(child_process)  │  스키마 diff·DDL 생성
                                         │                              │
                                         │  ── FileStore(로컬 FS)        │  버전 SQL 파일 저장
                                         └──────────────────────────────┘
```

데이터 흐름(상태 비교 → 적용):
1. 개발자가 source(dev) / target(prod) 환경 선택
2. 백엔드가 두 환경을 introspect → Atlas로 diff → DDL 생성
3. 개발자가 필요한 DML 항목을 추가하고 적용 순서 지정
4. 변경 요청 제출 → SQL 파일로 저장
5. DBA 검토·승인 → 결재자 결재
6. 결재 완료 후 적용: dry-run → 롤백 SQL 생성 → 순서대로 실행 → 실행 로그 기록

---

## 5. 백엔드 모듈 (NestJS)

각 모듈은 단일 책임을 가지며 명확한 인터페이스로 통신한다.

| 모듈 | 책임 | 주요 의존성 |
|------|------|------------|
| **Auth/Users** | 로그인(JWT), 역할 `DEVELOPER / REVIEWER(DBA) / APPROVER` 부여·검증 | Prisma |
| **Connections** | 환경(dev·prod) 등록, 접속정보 암호화 저장/복호화, 대상 DB 커넥션 풀 관리 | mysql2, 암호화 모듈 |
| **Diff** | Atlas CLI 호출 → source·target introspect → DDL diff 생성·파싱 | Atlas CLI, Connections |
| **ChangeRequest** | 변경 요청 도메인. 항목 묶음·순서·상태머신 관리 | Prisma, FileStore |
| **FileStore** | 변경 항목을 타임스탬프 버전 SQL 파일로 저장/조회. 어댑터 인터페이스(로컬 FS → S3/Git 교체 가능) | fs |
| **Approval** | 3단계 결재 체인 진행, 승인·반려·코멘트 기록 | ChangeRequest |
| **Execution** | 승인된 요청을 순서대로 적용, dry-run, 롤백 SQL 생성, 실행 로그·담당자 기록 | Connections, FileStore |
| **Audit** | 전체 이력·감사 로그 조회 | Prisma |

---

## 6. 데이터 모델 (메타DB, Prisma)

```
User
  id, email, name, passwordHash, role(DEVELOPER|REVIEWER|APPROVER), createdAt

Environment
  id, name, dbType(MYSQL|...), host, port, dbName,
  encryptedCredentials, stage(DEV|STAGING|PROD), createdAt

ChangeRequest
  id, title, description, status, authorId,
  sourceEnvId, targetEnvId, createdAt, updatedAt

ChangeItem
  id, changeRequestId, order(int),
  type(DDL_AUTO|DML_MANUAL), sql(text), filePath, version, createdAt

Approval
  id, changeRequestId, step(REVIEW|APPROVE), approverId,
  decision(APPROVED|REJECTED), comment, decidedAt

Execution
  id, changeRequestId, executedById, status(SUCCESS|FAILED|PARTIAL),
  log(text), rollbackSql(text), executedAt

AuditLog
  id, actorId, action, targetType, targetId, detail(json), createdAt
```

---

## 7. 결재 상태머신

```
DRAFT ──submit──> SUBMITTED ──DBA 승인──> REVIEWED ──결재자 승인──> APPROVED ──apply──> APPLIED
                      │                       │                       │
                      └──── REJECTED (코멘트와 함께 작성자에게 반려) ────┘
```

- 어느 단계에서든 반려 시 `REJECTED` → 작성자가 수정 후 재제출(DRAFT로 복귀)
- 단건(핫픽스)이든 릴리스 묶음이든 **동일한 흐름**을 탄다 (변경 항목 개수만 다름)
- 상태 전이는 역할 권한으로 통제: DBA만 `SUBMITTED→REVIEWED`, 결재자만 `REVIEWED→APPROVED`, 적용 권한자만 `APPROVED→APPLIED`

---

## 8. 적용(Apply) 안전장치 / 에러 처리

- **dry-run**: 실제 적용 전 검증 단계
- **롤백 SQL 자동 생성**: Atlas의 역방향 diff 또는 기록된 이전 상태 기반
- **순서 보장 실행**: 변경 항목을 지정된 `order`대로 실행 (예: 컬럼 추가 → 데이터 백필)
- **에러 처리**:
  - 항목 실행 중 실패 시 즉시 **중단**하고 실패 지점·에러를 로그에 기록
  - DDL은 트랜잭션이 제한적이므로(MySQL DDL 암묵 커밋), 부분 실패 가능 → 상태를 `PARTIAL`로 기록하고 롤백 SQL·수동 복구 가이드 제공
  - DML은 가능하면 트랜잭션으로 묶어 실행
- **추적성**: 모든 적용에 누가/언제/무엇을 실행했는지 `Execution` + `AuditLog`에 기록 (블로그 DMM의 핵심 요구 충족)

---

## 9. 보안 / 자격증명

- 대상 DB 접속정보(특히 운영 비밀번호)는 **대칭키 암호화(AES-256-GCM)** 후 메타DB에 저장, 복호화 키는 환경변수/시크릿 매니저로 관리
- 비밀번호는 응답 페이로드에 절대 노출하지 않음
- 역할 기반 접근 제어(RBAC): 운영 환경 접속·적용은 권한 있는 역할만
- (확장) 감사 로그 불변성, SSO

---

## 9-1. UI/UX 방향

- **토스(Toss) 스타일** 지향: 깔끔한 여백, 큰 타이포, 단계별로 하나에 집중하는 플로우, 부드러운 마이크로 인터랙션, 명확한 1차 액션 버튼
- 복잡한 DB 작업을 **단계형(스텝) 흐름**으로 분해해 비전문가도 따라갈 수 있게 (환경 선택 → diff 확인 → 항목 구성 → 제출)
- 위험한 액션(운영 적용)은 색/문구로 명확히 경고하고 확인 모달로 보호
- 상태(결재 진행)는 타임라인으로 직관적으로 표현
- 구현: Tailwind CSS 기반, 일관된 디자인 토큰(색·간격·라운드), 접근성 고려

## 10. 테스트 전략

- **단위 테스트**: Diff 파싱, 상태머신 전이, 권한 검증, 암호화/복호화
- **통합 테스트**: 로컬 Docker MySQL 2개(dev/prod)로 diff→생성→적용→롤백 시나리오
- **E2E**: 변경 요청 생성 → 3단계 결재 → 적용까지의 흐름
- 운영 DB를 절대 테스트 대상으로 쓰지 않음 (격리된 테스트 컨테이너만 사용)

---

## 11. MVP 범위

가장 먼저 직접 써볼 버전. (MySQL + dev→prod + 풀 3단계 결재)

- [x] 로그인 + 3역할(DEVELOPER/REVIEWER/APPROVER)
- [x] MySQL 환경 2개(dev·prod) 등록 + 자격증명 암호화 저장
- [x] Atlas로 DDL 자동 diff
- [x] DML 수동 SQL 항목 + 적용 순서 지정
- [x] 변경 요청 묶음(1~N건 → 단건·릴리스 모두 커버)
- [x] SQL 파일 기반 저장(로컬 FS)
- [x] 3단계 결재 체인(반려·코멘트)
- [x] 운영 적용(수동 확정 + dry-run + 롤백 SQL + 실행 로그)
- [x] 이력/감사 화면

---

## 12. 향후 확장 (TODO 백로그)

상세 기능 목록은 `2026-06-17-dbflow-features-todo.md` 참고.

- 멀티 DB: PostgreSQL / MariaDB / Oracle
- N환경(dev→staging→prod) + 환경 간 누락분 비교/승격
- 자체 diff 엔진 구현(Atlas 대체/보완)
- 파일 저장소 S3/Git 연동
- 적용 전 자동 백업 스냅샷
- Flyway식 버전 마이그레이션 모드(순수 스크립트 철학) 1급 지원
- 드리프트 감지(도구 밖에서 운영 DB가 바뀐 경우)
- 알림(Slack/이메일), 정기 적용 스케줄
- 상용화: 멀티테넌시 · SSO · 과금
