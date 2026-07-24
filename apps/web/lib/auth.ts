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

/** Read the current user from localStorage (SSR-safe). */
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
 * Auth guard hook.
 * - After mount, checks the user in localStorage
 * - If absent, replaces the route with /login
 * - While ready=false, callers should render loading UI (avoids hydration mismatch)
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
