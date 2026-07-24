const path = require('path');
const withNextIntl = require('next-intl/plugin')('./i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  // 모노레포: 트레이싱 루트를 리포 루트로 고정해야 standalone이 workspace 의존성을 포함한다
  experimental: { outputFileTracingRoot: path.join(__dirname, '../../') },
};

module.exports = withNextIntl(nextConfig);
