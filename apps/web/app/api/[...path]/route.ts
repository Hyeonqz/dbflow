import type { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * same-origin API 프록시: /api/* → ${DBFLOW_API_URL}/*
 * 요청 시점에 env를 읽으므로 사전 빌드된 이미지에서도 런타임 설정 가능
 * (rewrites는 빌드 시 routes-manifest에 구워져 불가 — 스펙 §2).
 */
const FORWARD_REQUEST_HEADERS = ['authorization', 'content-type', 'accept', 'accept-language'];
// undici가 자동 압축 해제하므로 인코딩/길이 헤더는 그대로 넘기면 불일치 발생
const DROP_RESPONSE_HEADERS = ['content-encoding', 'content-length', 'transfer-encoding'];

async function proxy(req: NextRequest, { params }: { params: { path: string[] } }) {
  const apiUrl = process.env.DBFLOW_API_URL ?? 'http://localhost:3001';
  const search = new URL(req.url).search;
  const target = `${apiUrl}/${params.path.join('/')}${search}`;

  const headers = new Headers();
  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = req.headers.get(name);
    if (value) headers.set(name, value);
  }

  const upstream = await fetch(target, {
    method: req.method,
    headers,
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : req.body,
    // @ts-expect-error -- undici는 스트리밍 body에 duplex 지정을 요구
    duplex: 'half',
    cache: 'no-store',
  });

  const responseHeaders = new Headers(upstream.headers);
  for (const name of DROP_RESPONSE_HEADERS) responseHeaders.delete(name);
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}

export { proxy as GET, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE };
