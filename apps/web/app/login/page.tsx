'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { login } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // 이미 로그인된 상태로 진입하면 바로 대시보드로.
  useEffect(() => {
    if (localStorage.getItem('accessToken')) router.replace('/dashboard');
  }, [router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const { accessToken, user } = await login(email, password);
      localStorage.setItem('accessToken', accessToken);
      localStorage.setItem('user', JSON.stringify(user));
      router.push('/dashboard');
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  }

  const inputClass =
    'w-full rounded-2xl bg-card px-4 py-3 text-ink outline-none ring-1 ring-border-strong ' +
    'transition-shadow placeholder:text-muted focus:ring-2 focus:ring-primary';

  return (
    <main className="grid min-h-screen place-items-center px-6">
      <div className="w-full max-w-sm">
        <div className="text-xl font-bold text-primary">DBFlow</div>
        <h1 className="mt-6 text-2xl font-bold text-ink">로그인</h1>
        <p className="mt-2 text-muted">안전한 DB 변경 형상 관리</p>

        <form onSubmit={onSubmit} className="mt-8 space-y-4" noValidate>
          <div className="space-y-1.5">
            <label htmlFor="email" className="block text-sm font-medium text-ink">
              이메일
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              className={inputClass}
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="password" className="block text-sm font-medium text-ink">
              비밀번호
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              className={inputClass}
              placeholder="비밀번호를 입력하세요"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {error && (
            <p role="alert" className="text-sm text-red-500 dark:text-red-400">
              {error}
            </p>
          )}

          <button type="submit" disabled={submitting} className="btn-primary w-full px-4 py-3">
            {submitting ? '로그인 중…' : '로그인'}
          </button>
        </form>
      </div>
    </main>
  );
}
