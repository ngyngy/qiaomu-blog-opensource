// 边缘缓存（伪静态层）
//
// 背景：站点全部页面都是 force-dynamic，且 Worker 返回的 Cache-Control 是
// `max-age=0`，所以 Cloudflare 边缘**完全不缓存**。每一次访问（含爬虫）都会
// 触发完整的 SSR + 多次 D1 全表扫描，很快撞上 D1 免费版每日 500 万行读取限制。
//
// 这里在 Worker 入口加一层 Cloudflare Cache API：
//   - 匿名公开的 GET 请求先用 URL 去 `caches.default` 里查
//   - 命中直接返回，**一次 D1 都不碰**
//   - 未命中才真正渲染，并把响应写回边缘缓存
//
// 这样 D1 读取量从「与请求数成正比」变成「与去重后的 URL 数 × TTL 成正比」。

type EdgeCache = {
  match(request: Request): Promise<Response | undefined>
  put(request: Request, response: Response): Promise<void>
  delete(request: Request): Promise<boolean>
}

interface WaitUntilContext {
  waitUntil(promise: Promise<unknown>): void
}

export type EdgeFetchHandler = (
  request: Request,
  env: Partial<CloudflareEnv>,
  ctx: WaitUntilContext,
) => Promise<Response>

interface EdgeCacheEnv {
  EDGE_CACHE?: string
  EDGE_CACHE_TTL?: string
  EDGE_CACHE_TTL_FEED?: string
  EDGE_CACHE_TTL_ASSET?: string
}

const PRIVATE_PATH_PREFIXES = ['/admin', '/editor', '/api']
const FEED_PATHS = ['/sitemap.xml', '/feed.xml', '/robots.txt']
const STATIC_EXTENSIONS = /\.(?:js|css|mjs|woff2?|ttf|otf|png|jpe?g|gif|webp|avif|svg|ico|json|txt|xml)$/i

const DEFAULT_HTML_TTL = 300
const DEFAULT_FEED_TTL = 3600
const DEFAULT_ASSET_TTL = 86400
const MAX_CACHEABLE_BYTES = 5 * 1024 * 1024

function readDisabledFlag(value: string | undefined): boolean {
  return typeof value === 'string' && ['0', 'false', 'off', 'no'].includes(value.trim().toLowerCase())
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  if (typeof value !== 'string') return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function getEdgeCache(): EdgeCache | undefined {
  const storage = (globalThis as unknown as { caches?: { default: EdgeCache } }).caches
  const cache = storage?.default
  return cache && typeof cache.match === 'function' ? cache : undefined
}

function isEnabled(env?: Partial<CloudflareEnv> | null): boolean {
  const flag = (env as EdgeCacheEnv | undefined)?.EDGE_CACHE
  return !readDisabledFlag(flag)
}

// 只对「结果对所有人都一样」的请求做缓存，避免把管理员视图或加密文章泄露给访客
export function isCacheablePublicRequest(request: Request): boolean {
  if (request.method !== 'GET') return false

  const url = new URL(request.url)
  const path = url.pathname

  if (PRIVATE_PATH_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
    return false
  }

  // 加密文章的正文依赖 pwd 参数，结果不唯一
  if (url.searchParams.has('pwd')) return false

  // Next.js 的客户端软导航（RSC / prefetch）响应体格式不同，单独处理更安全
  if (request.headers.get('rsc') || request.headers.get('next-router-prefetch')) return false

  // 管理员登录态不能缓存，否则后台改动会被 CDN 盖住
  const cookie = request.headers.get('cookie')
  if (cookie && /admin_session|admin_token/i.test(cookie)) return false

  // 浏览器硬刷新
  const cacheControl = request.headers.get('cache-control')
  if (cacheControl && /(?:no-cache|no-store|max-age=0)/i.test(cacheControl)) return false

  return true
}

export function resolveEdgeTtl(env: Partial<CloudflareEnv> | undefined, pathname: string): number {
  const config = env as EdgeCacheEnv | undefined

  if (FEED_PATHS.includes(pathname)) {
    return readPositiveInt(config?.EDGE_CACHE_TTL_FEED, DEFAULT_FEED_TTL)
  }

  if (pathname.startsWith('/_next/') || STATIC_EXTENSIONS.test(pathname)) {
    return readPositiveInt(config?.EDGE_CACHE_TTL_ASSET, DEFAULT_ASSET_TTL)
  }

  return readPositiveInt(config?.EDGE_CACHE_TTL, DEFAULT_HTML_TTL)
}

function cloneForCache(response: Response, body: ArrayBuffer | null, ttl: number): Response {
  const headers = new Headers(response.headers)
  // 去掉源站的 max-age=0，否则边缘缓存会立刻过期
  headers.set('cache-control', `public, max-age=${ttl}`)
  headers.delete('set-cookie')
  headers.delete('server-timing')
  return new Response(body, { status: response.status, statusText: response.statusText, headers })
}

export async function serveWithEdgeCache(
  request: Request,
  env: Partial<CloudflareEnv>,
  ctx: WaitUntilContext,
  next: EdgeFetchHandler,
): Promise<Response> {
  const cache = isEnabled(env) ? getEdgeCache() : undefined
  if (!cache || !isCacheablePublicRequest(request)) {
    return next(request, env, ctx)
  }

  const url = new URL(request.url)
  const cacheKey = new Request(url.toString(), { method: 'GET' })

  try {
    const hit = await cache.match(cacheKey)
    if (hit) {
      const headers = new Headers(hit.headers)
      headers.set('x-edge-cache', 'HIT')
      return new Response(hit.body, { status: hit.status, statusText: hit.statusText, headers })
    }
  } catch {
    // 缓存读取异常按未命中处理
  }

  const response = await next(request, env, ctx)

  if (!response.ok) return response
  if (response.headers.has('set-cookie')) return response

  try {
    const declared = response.headers.get('content-length')
    if (declared && Number.parseInt(declared, 10) > MAX_CACHEABLE_BYTES) {
      return response
    }

    const clone = response.clone()
    const body = await clone.arrayBuffer()
    if (body.byteLength > MAX_CACHEABLE_BYTES) return response

    const ttl = resolveEdgeTtl(env, url.pathname)
    ctx.waitUntil(cache.put(cacheKey, cloneForCache(response, body, ttl)).catch(() => undefined))

    const headers = new Headers(response.headers)
    headers.set('x-edge-cache', 'MISS')
    return new Response(body, { status: response.status, statusText: response.statusText, headers })
  } catch {
    return response
  }
}

// 清除指定 URL 的边缘缓存。
// 注意：caches.default 是按 Cloudflare 机房分布的，这里只会清当前访问的
// 那一个机房。想全球立刻生效需要在 Cloudflare 后台用 Purge Everything，
// 或者直接等 TTL（默认 300 秒）自然过期。
export async function purgeEdgeCacheUrls(urls: Array<string | null | undefined>): Promise<number> {
  const cache = getEdgeCache()
  if (!cache) return 0

  const targets = Array.from(new Set(urls.filter((item): item is string => Boolean(item)).map((item) => item.trim())))
  if (targets.length === 0) return 0

  const results = await Promise.allSettled(
    targets.map(async (target) => {
      const key = new Request(new URL(target).toString(), { method: 'GET' })
      await cache.delete(key)
    }),
  )

  return results.filter((result) => result.status === 'fulfilled').length
}
