'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { listInbox, type ChangeRequestSummary } from '@/lib/api';
import type { User } from '@/lib/auth';

type InboxCtx = {
  items: ChangeRequestSummary[];
  count: number;
  loading: boolean;
  refresh: () => Promise<void>;
};

/**
 * provider가 없을 때 throw하지 않는다 — useUser()와 의도적으로 다르다.
 * CR 상세 페이지의 기존 테스트들은 컴포넌트를 단독 렌더하므로 provider가 없고,
 * throw하면 그 테스트 전부가 깨진다.
 */
const DEFAULT: InboxCtx = { items: [], count: 0, loading: false, refresh: async () => {} };

const InboxContext = createContext<InboxCtx>(DEFAULT);

/** 결정 권한이 없는 역할은 조회 자체를 하지 않는다(빈 배열이 확정). */
function canDecide(role: User['role']) {
  return role === 'REVIEWER' || role === 'APPROVER';
}

export function InboxProvider({ user, children }: { user: User; children: ReactNode }) {
  const [items, setItems] = useState<ChangeRequestSummary[]>([]);
  const [loading, setLoading] = useState(canDecide(user.role));

  const refresh = useCallback(async () => {
    if (!canDecide(user.role)) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setItems(await listInbox());
    } catch {
      // 사이드바는 모든 페이지에 있다. 여기서 에러를 띄우면 사용자가 하려는 일과
      // 무관한 배너가 전 화면에 붙는다. 잘못된 숫자보다 없는 숫자가 안전하다.
      // 이 컨텍스트는 error 필드를 의도적으로 노출하지 않는다 — 대시보드에는 error 상태가
      // 하나뿐이고 items가 null인 동안 그것이 세면 본문 전체가 빈 화면이 된다.
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [user.role]);

  useEffect(() => {
    // reactStrictMode에서 effect가 두 번 돈다. 대시보드·목록 화면과 같은 active 가드.
    let active = true;
    void (async () => {
      if (!canDecide(user.role)) {
        if (active) setLoading(false);
        return;
      }
      try {
        const next = await listInbox();
        if (active) setItems(next);
      } catch {
        if (active) setItems([]);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [user.role]);

  // 탭 타이틀 미러링: provider는 앱 전체에 걸쳐 단일 인스턴스이므로 여기서만 document.title을
  // 건드린다(배지는 데스크톱 <aside>가 CSS로만 숨겨져도 마운트된 채라 모바일 드로어와
  // 동시에 두 개 살아있을 수 있다). pathname을 deps에 넣는 이유는 Next가 내비게이션마다
  // resolved metadata를 재적용하기 때문 — count만 의존하면 첫 이동에서 타이틀이 되돌아간다.
  const pathname = usePathname();
  useEffect(() => {
    document.title = items.length > 0 ? `(${items.length}) DBFlow` : 'DBFlow';
    return () => {
      document.title = 'DBFlow';
    };
  }, [items.length, pathname]);

  return (
    <InboxContext.Provider value={{ items, count: items.length, loading, refresh }}>
      {children}
    </InboxContext.Provider>
  );
}

export function useInbox(): InboxCtx {
  return useContext(InboxContext);
}
