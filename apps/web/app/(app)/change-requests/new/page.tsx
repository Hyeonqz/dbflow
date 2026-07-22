'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCurrentUser } from '@/lib/auth';
import {
  createChangeRequest,
  listApprovalPolicy,
  listUsersByRole,
  type SqlType,
  type TargetEnv,
  type UserSummary,
} from '@/lib/api';
import { SQL_TYPE_LABEL } from '@/components/badges';
import { PageHeader } from '@/components/page-header';

type DraftFile = {
  key: string; // React 리스트 안정 키 (서버로 전송하지 않음)
  filename: string;
  sqlType: SqlType;
  content: string;
};

const ENV_OPTIONS: TargetEnv[] = ['DEV', 'STAGING', 'PROD'];
const SQL_TYPE_OPTIONS: SqlType[] = ['DDL', 'DML'];

const inputClass =
  'w-full rounded-2xl bg-card px-4 py-3 outline-none ring-1 ring-border-strong focus:ring-primary';

function newDraftFile(): DraftFile {
  return {
    key: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    filename: '',
    sqlType: 'DDL',
    content: '',
  };
}

export default function NewChangeRequestPage() {
  const router = useRouter();
  const { user, ready } = useCurrentUser();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [targetEnv, setTargetEnv] = useState<TargetEnv>('DEV');
  const [files, setFiles] = useState<DraftFile[]>([newDraftFile()]);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [reviewers, setReviewers] = useState<UserSummary[]>([]);
  const [approvers, setApprovers] = useState<UserSummary[]>([]);
  const [reviewerId, setReviewerId] = useState('');
  const [requiredApprovals, setRequiredApprovals] = useState(1);
  const [approverIds, setApproverIds] = useState<string[]>(['']);

  useEffect(() => {
    listUsersByRole('REVIEWER').then(setReviewers).catch(() => setReviewers([]));
    listUsersByRole('APPROVER').then(setApprovers).catch(() => setApprovers([]));
  }, []);

  // 대상 환경이 바뀔 때마다 해당 환경의 필수 결재자 수(N)를 조회해 셀렉트 개수를 맞춘다.
  useEffect(() => {
    let active = true;
    listApprovalPolicy()
      .then((rows) => {
        if (!active) return;
        const n = rows.find((r) => r.env === targetEnv)?.requiredApprovals ?? 1;
        setRequiredApprovals(n);
        setApproverIds((prev) => {
          const next = prev.slice(0, n);
          while (next.length < n) next.push('');
          return next;
        });
      })
      .catch(() => setRequiredApprovals(1));
    return () => {
      active = false;
    };
  }, [targetEnv]);

  function updateApproverId(idx: number, value: string) {
    setApproverIds((prev) => prev.map((id, i) => (i === idx ? value : id)));
  }

  if (!ready || !user) {
    return <p className="text-muted">불러오는 중…</p>;
  }

  if (user.role !== 'DEVELOPER') {
    return (
      <p className="rounded-2xl bg-card px-6 py-5 ring-1 ring-border text-muted">
        변경 요청 생성은 개발자만 가능합니다.
      </p>
    );
  }

  function updateFile(key: string, patch: Partial<DraftFile>) {
    setFiles((prev) => prev.map((f) => (f.key === key ? { ...f, ...patch } : f)));
  }

  function addFile() {
    setFiles((prev) => [...prev, newDraftFile()]);
  }

  function removeFile(key: string) {
    setFiles((prev) => (prev.length === 1 ? prev : prev.filter((f) => f.key !== key)));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError('제목을 입력해 주세요.');
      return;
    }

    const preparedFiles = files
      .map((f) => ({
        filename: f.filename.trim(),
        sqlType: f.sqlType,
        content: f.content.trim(),
      }))
      .filter((f) => f.filename || f.content);

    if (preparedFiles.length === 0) {
      setError('최소 한 개의 SQL 파일을 입력해 주세요.');
      return;
    }
    const incomplete = preparedFiles.find((f) => !f.filename || !f.content);
    if (incomplete) {
      setError('각 SQL 파일에는 파일명과 내용이 모두 필요합니다.');
      return;
    }

    if (!reviewerId || approverIds.some((id) => !id)) {
      setError('검토자와 결재자를 모두 선택해 주세요.');
      return;
    }

    setSubmitting(true);
    try {
      const created = await createChangeRequest({
        title: trimmedTitle,
        description: description.trim(),
        targetEnv,
        files: preparedFiles,
        reviewerId,
        approverIds,
      });
      router.push(`/change-requests/${created.id}`);
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  }

  return (
    <>
      <PageHeader
        title="새 변경 요청"
        description="작성 후 상세 화면에서 검토를 요청(제출)할 수 있습니다."
      />

      <form onSubmit={onSubmit} className="mt-8 space-y-6">
        <div className="space-y-2">
          <label htmlFor="title" className="block text-sm font-semibold">
            제목
          </label>
          <input
            id="title"
            className={inputClass}
            placeholder="예: 주문 테이블 인덱스 추가"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="description" className="block text-sm font-semibold">
            설명 <span className="font-normal text-muted">(선택)</span>
          </label>
          <textarea
            id="description"
            className={`${inputClass} min-h-[88px] resize-y`}
            placeholder="변경 배경과 영향 범위를 적어주세요."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="targetEnv" className="block text-sm font-semibold">
            대상 환경
          </label>
          <select
            id="targetEnv"
            className={inputClass}
            value={targetEnv}
            onChange={(e) => setTargetEnv(e.target.value as TargetEnv)}
          >
            {ENV_OPTIONS.map((env) => (
              <option key={env} value={env}>
                {env}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="reviewerId" className="block text-sm font-semibold">
              검토자
            </label>
            <select
              id="reviewerId"
              className={inputClass}
              value={reviewerId}
              onChange={(e) => setReviewerId(e.target.value)}
            >
              <option value="">선택하세요</option>
              {reviewers.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.department})
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <span className="block text-sm font-semibold">
              결재자 {requiredApprovals > 1 && `(${requiredApprovals}명)`}
            </span>
            <div className="space-y-2">
              {approverIds.map((selectedId, idx) => (
                <select
                  key={idx}
                  aria-label={`결재자 ${idx + 1}`}
                  className={inputClass}
                  value={selectedId}
                  onChange={(e) => updateApproverId(idx, e.target.value)}
                >
                  <option value="">선택하세요</option>
                  {approvers
                    .filter((a) => a.id === selectedId || !approverIds.includes(a.id))
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.department})
                      </option>
                    ))}
                </select>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">SQL 파일</span>
            <button
              type="button"
              onClick={addFile}
              className="focusable rounded-full bg-card px-3 py-1.5 text-sm font-medium text-primary ring-1 ring-border-strong transition-colors hover:bg-subtle"
            >
              + 파일 추가
            </button>
          </div>

          {files.map((file, idx) => (
            <fieldset key={file.key} className="rounded-2xl bg-card p-4 ring-1 ring-border">
              <div className="flex items-center justify-between">
                <legend className="text-sm font-medium text-muted">파일 {idx + 1}</legend>
                {files.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeFile(file.key)}
                    className="focusable rounded-lg px-1 text-sm text-muted transition-colors hover:text-red-500 dark:hover:text-red-400"
                  >
                    삭제
                  </button>
                )}
              </div>

              <div className="mt-3 flex flex-col gap-3 sm:flex-row">
                <input
                  aria-label={`파일 ${idx + 1} 파일명`}
                  className={`${inputClass} sm:flex-1`}
                  placeholder="파일명 (예: 0001_add_index.sql)"
                  value={file.filename}
                  onChange={(e) => updateFile(file.key, { filename: e.target.value })}
                />
                <select
                  aria-label={`파일 ${idx + 1} SQL 유형`}
                  className={`${inputClass} sm:w-56`}
                  value={file.sqlType}
                  onChange={(e) => updateFile(file.key, { sqlType: e.target.value as SqlType })}
                >
                  {SQL_TYPE_OPTIONS.map((t) => (
                    <option key={t} value={t}>
                      {SQL_TYPE_LABEL[t]}
                    </option>
                  ))}
                </select>
              </div>

              <textarea
                aria-label={`파일 ${idx + 1} SQL 내용`}
                className={`${inputClass} mt-3 min-h-[140px] resize-y font-mono text-sm`}
                placeholder="SQL을 붙여넣으세요."
                spellCheck={false}
                value={file.content}
                onChange={(e) => updateFile(file.key, { content: e.target.value })}
              />
            </fieldset>
          ))}
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-500 dark:text-red-400">
            {error}
          </p>
        )}

        <button type="submit" disabled={submitting} className="btn-primary w-full px-4 py-3">
          {submitting ? '저장 중…' : '변경 요청 생성'}
        </button>
      </form>
    </>
  );
}
