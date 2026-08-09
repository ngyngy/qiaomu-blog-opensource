import { resolve } from "node:path";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import type { NextConfig } from "next";

void initOpenNextCloudflareForDev();

const nextConfig: NextConfig = {
  // 图片优化（Cloudflare 有自己的优化）
  images: {
    unoptimized: true,
  },

  turbopack: {
    root: resolve(process.cwd()),
  },

  // 移除客户端环境变量暴露（安全风险）
  // 敏感信息应该只在服务端使用

  // 减少构建时的 worker 数量，避免 MaxListenersExceededWarning
  experimental: {
    workerThreads: false,
    cpus: 1,
  },

  // 排除 @vercel/og（OG 图片生成）以减小 Worker 体积
  // 本项目不使用 opengraph-image 路由，无需此模块
  // 可节省约 2.2 MiB 未压缩体积（~1.5 MiB gzip）
  outputFileTracingExcludes: {
    "/**": ["./node_modules/next/dist/compiled/@vercel/og/**/*"],
  },
};

export default nextConfig;
