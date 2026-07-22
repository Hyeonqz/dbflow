'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export type Role = 'DEVELOPER' | 'REVIEWER' | 'APPROVER' | 'ADMIN';

export type User = {
  id: string;
  email: string;
  name: string;
  department: string;
  role: Role;
};

export const ROLE_LABEL: Record<Role, string> = {
  DEVELOPER: '개발자',
  REVIEWER: '검토자(DBA)',
  APPROVER: '결재자',
  ADMIN: '관리자',
};

/** localStorage에서 현재 사용자 읽기 (SSR-safe). */
export function readUser(): User | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem('user');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    localStorage.removeItem('user');
    return null;
  }
}

export function logout() {
  localStorage.removeItem('accessToken');
  localStorage.removeItem('user');
}

/**
 * 인증 가드 훅.
 * - 마운트 후 localStorage에서 사용자 확인
 * - 없으면 /login으로 교체 이동
 * - ready=false 동안 호출부는 로딩 UI를 렌더 (하이드레이션 불일치 방지)
 */
export function useCurrentUser() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const u = readUser();
    if (!u) {
      router.replace('/login');
      return;
    }
    setUser(u);
    setReady(true);
  }, [router]);

  return { user, ready };
}
