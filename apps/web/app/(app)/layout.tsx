import type { ReactNode } from 'react';
import { AppShell } from '@/components/app-shell';
import { UserProvider } from '@/components/user-context';

// (app) 그룹 layout — 인증 페이지 공용 앱셸.
// Phase 2에서 dashboard/change-requests/schema-diff/target-databases 페이지를 이 그룹 하위로 이동.
export default function AppGroupLayout({ children }: { children: ReactNode }) {
  return (
    <UserProvider>
      <AppShell>{children}</AppShell>
    </UserProvider>
  );
}
