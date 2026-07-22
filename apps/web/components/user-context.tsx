'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { readUser, type User } from '@/lib/auth';

type Ctx = { user: User | null; ready: boolean; setUser: (u: User) => void };
const UserContext = createContext<Ctx | null>(null);

export function UserProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUserState] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const u = readUser();
    if (!u) { router.replace('/login'); return; }
    setUserState(u);
    setReady(true);
  }, [router]);

  function setUser(u: User) {
    setUserState(u);
    localStorage.setItem('user', JSON.stringify(u));
  }

  return <UserContext.Provider value={{ user, ready, setUser }}>{children}</UserContext.Provider>;
}

export function useUser() {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error('useUser must be used within UserProvider');
  return ctx;
}
