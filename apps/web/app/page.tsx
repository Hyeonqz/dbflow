import { redirect } from 'next/navigation';

// 랜딩("시작하기") 없이 바로 로그인으로. (로그인 페이지가 토큰 보유 시 대시보드로 재이동)
export default function Home() {
  redirect('/login');
}
