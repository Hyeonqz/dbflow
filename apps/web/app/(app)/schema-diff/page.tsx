'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCurrentUser } from '@/lib/auth';
import {
  applySchemaDiffToChangeRequest,
  listTargetDatabases,
  previewSchemaDiff,
  type DiffItem,
  type SchemaDiffPreviewResult,
  type TargetDatabase,
} from '@/lib/api';
import { DiffKindBadge } from '@/components/badges';
import { PageHeader } from '@/components/page-header';
import { AlertIcon } from '@/components/icons';

const inputClass =
  'w-full rounded-2xl bg-card px-4 py-3 outline-none ring-1 ring-border-strong focus:ring-primary';

export default function SchemaDiffPage() {
  const { user, ready } = useCurrentUser();
  const router = useRouter();

  const [dbs, setDbs] = useState<TargetDatabase[] | null>(null);
  const [targetId, setTargetId] = useState('');
  const [desiredSql, setDesiredSql] = useState('');
  const [preview, setPreview] = useState<SchemaDiffPreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState('');

  const loadDbs = useCallback(() => {
    return listTargetDatabases()
      .then(setDbs)
      .catch((err: Error) => {
        setDbs([]);
        setError(err.message);
      });
  }, []);

  useEffect(() => {
    if (!ready || !user) return;
    if (user.role === 'REVIEWER') return; // 검토자는 접근 불가
    loadDbs();
  }, [ready, user, loadDbs]);

  if (!ready || !user) {
    return <p className="text-muted">불러오는 중…</p>;
  }

  if (user.role === 'REVIEWER') {
    return (
      <p className="rounded-2xl bg-card px-6 py-5 text-muted ring-1 ring-border">
        스키마 Diff 생성기는 개발자·결재자만 사용할 수 있습니다.
      </p>
    );
  }

  const canCreateCr = user.role === 'DEVELOPER';

  async function runPreview() {
    if (!targetId) {
      setError('대상 DB를 선택해 주세요.');
      return;
    }
    if (!desiredSql.trim()) {
      setError('기준 스키마 DDL을 입력해 주세요.');
      return;
    }
    setPreviewing(true);
    setError('');
    setPreview(null);
    try {
      const result = await previewSchemaDiff({
        targetDatabaseId: targetId,
        desiredSchemaSql: desiredSql,
      });
      setPreview(result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPreviewing(false);
    }
  }

  return (
    <>
      <PageHeader
        title="스키마 Diff 생성기"
        description="기준 스키마와 대상 DB의 실제 스키마를 비교해 차이를 DDL로 산출합니다."
      />

      {error && (
        <p role="alert" className="mt-6 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-500/15 dark:text-red-300">{error}</p>
      )}

      <section className="mt-6 space-y-5 rounded-2xl bg-card p-5 ring-1 ring-border">
        <div className="space-y-2">
          <label htmlFor="target-db" className="block text-sm font-semibold">
            대상 DB
          </label>
          {dbs === null ? (
            <p className="text-sm text-muted">불러오는 중…</p>
          ) : dbs.length === 0 ? (
            <p className="rounded-2xl bg-subtle px-4 py-3 text-sm text-muted">
              접근 가능한 대상 DB가 없습니다.
              {canCreateCr && ' 개발자는 DEV 환경 대상만 비교할 수 있습니다.'}
            </p>
          ) : (
            <select
              id="target-db"
              className={inputClass}
              value={targetId}
              onChange={(e) => {
                setTargetId(e.target.value);
                setPreview(null);
              }}
            >
              <option value="">선택하세요</option>
              {dbs.map((d) => (
                <option key={d.id} value={d.id}>
                  [{d.env}] {d.name} — {d.host}:{d.port}/{d.database}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="space-y-2">
          <label htmlFor="desired-sql" className="block text-sm font-semibold">
            기준 스키마 DDL
          </label>
          <textarea
            id="desired-sql"
            className={`${inputClass} min-h-[200px] resize-y font-mono text-sm`}
            placeholder={'CREATE TABLE users (\n  id INT NOT NULL AUTO_INCREMENT,\n  email VARCHAR(255) NOT NULL,\n  PRIMARY KEY (id),\n  UNIQUE KEY uq_users_email (email)\n);'}
            spellCheck={false}
            value={desiredSql}
            onChange={(e) => setDesiredSql(e.target.value)}
          />
          <p className="text-xs text-muted">
            CREATE TABLE 문 모음을 입력하세요. 여러 문장은 세미콜론(;)으로 구분합니다.
          </p>
        </div>

        <button onClick={runPreview} disabled={previewing} className="btn-primary w-full px-4 py-3 text-sm">
          {previewing ? '비교 중…' : 'Diff 미리보기'}
        </button>
      </section>

      {preview && (
        <DiffResult
          preview={preview}
          canCreateCr={canCreateCr}
          targetDatabaseId={targetId}
          desiredSchemaSql={desiredSql}
          onError={setError}
          onCreated={(id) => router.push(`/change-requests/${id}`)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Diff 결과 뷰 + 변경요청 생성
// ---------------------------------------------------------------------------
function DiffResult({
  preview,
  canCreateCr,
  targetDatabaseId,
  desiredSchemaSql,
  onError,
  onCreated,
}: {
  preview: SchemaDiffPreviewResult;
  canCreateCr: boolean;
  targetDatabaseId: string;
  desiredSchemaSql: string;
  onError: (msg: string) => void;
  onCreated: (id: string) => void;
}) {
  const { currentSnapshotSummary: snap, diff, hasChanges } = preview;
  const destructiveCount = diff.filter((d) => d.destructive).length;
  const [showForm, setShowForm] = useState(false);

  return (
    <section className="mt-8">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-ink">Diff 결과</h2>
        <span className="text-xs text-muted">
          {snap.database} · 테이블 {snap.tableCount}개
        </span>
      </div>

      {!hasChanges ? (
        <div className="mt-3 rounded-2xl bg-card px-6 py-10 text-center ring-1 ring-border">
          <p className="text-muted">차이가 없습니다. 대상 DB가 이미 기준 스키마와 일치합니다.</p>
        </div>
      ) : (
        <>
          {destructiveCount > 0 && (
            <p className="mt-3 flex items-start gap-2 rounded-2xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600 dark:bg-red-500/15 dark:text-red-300">
              <AlertIcon className="mt-0.5 shrink-0" width={18} height={18} />
              <span>파괴적 변경 {destructiveCount}건이 포함되어 있습니다. 데이터 손실에 주의하세요.</span>
            </p>
          )}

          <ul className="mt-3 space-y-3">
            {diff.map((item, idx) => (
              <DiffCard key={idx} item={item} />
            ))}
          </ul>

          {canCreateCr && !showForm && (
            <button onClick={() => setShowForm(true)} className="btn-primary mt-5 w-full px-4 py-3 text-sm">
              변경요청으로 생성
            </button>
          )}

          {canCreateCr && showForm && (
            <CreateCrForm
              targetDatabaseId={targetDatabaseId}
              desiredSchemaSql={desiredSchemaSql}
              onCancel={() => setShowForm(false)}
              onError={onError}
              onCreated={onCreated}
            />
          )}
        </>
      )}
    </section>
  );
}

function DiffCard({ item }: { item: DiffItem }) {
  return (
    <li
      className={`overflow-hidden rounded-2xl ring-1 ${
        item.destructive ? 'ring-red-200 dark:ring-red-500/30' : 'ring-border'
      }`}
    >
      <div className="flex items-center justify-between gap-3 bg-card px-4 py-3">
        <div className="flex items-center gap-2">
          <DiffKindBadge kind={item.kind} />
          <span className="font-mono text-sm text-ink">{item.table}</span>
        </div>
        {item.destructive && (
          <span className="text-xs font-semibold text-red-600 dark:text-red-300">파괴적</span>
        )}
      </div>
      <pre className="overflow-x-auto bg-code px-4 py-3 text-xs leading-relaxed text-code-fg">
        <code>{item.statement}</code>
      </pre>
    </li>
  );
}

function CreateCrForm({
  targetDatabaseId,
  desiredSchemaSql,
  onCancel,
  onError,
  onCreated,
}: {
  targetDatabaseId: string;
  desiredSchemaSql: string;
  onCancel: () => void;
  onError: (msg: string) => void;
  onCreated: (id: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    onError('');
    const t = title.trim();
    const d = description.trim();
    if (!t) {
      onError('제목을 입력해 주세요.');
      return;
    }
    if (!d) {
      onError('설명을 입력해 주세요.');
      return;
    }
    setBusy(true);
    try {
      const cr = await applySchemaDiffToChangeRequest({
        targetDatabaseId,
        desiredSchemaSql,
        title: t,
        description: d,
      });
      onCreated(cr.id);
    } catch (err) {
      onError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-5 space-y-4 rounded-2xl bg-card p-5 ring-1 ring-border">
      <h3 className="text-sm font-semibold">변경요청으로 생성</h3>
      <div className="space-y-2">
        <label htmlFor="cr-title" className="block text-sm font-medium text-muted">
          제목
        </label>
        <input
          id="cr-title"
          className={inputClass}
          placeholder="예: users 스키마 정합화"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <label htmlFor="cr-desc" className="block text-sm font-medium text-muted">
          설명
        </label>
        <textarea
          id="cr-desc"
          className={`${inputClass} min-h-[88px] resize-y`}
          placeholder="변경 배경과 영향 범위를 적어주세요."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div className="flex gap-3">
        <button type="submit" disabled={busy} className="btn-primary flex-1 px-4 py-2.5 text-sm">
          {busy ? '생성 중…' : '변경요청 생성'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="focusable rounded-2xl bg-card px-4 py-2.5 text-sm font-semibold text-muted ring-1 ring-border-strong transition-colors hover:bg-subtle disabled:opacity-50"
        >
          취소
        </button>
      </div>
    </form>
  );
}
