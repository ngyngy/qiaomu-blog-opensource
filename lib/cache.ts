// Cloudflare KV 缓存层

export function getCacheNamespace(env?: Partial<CloudflareEnv> | null): KVNamespace | undefined {
  return env?.CACHE ?? env?.KV
}

function readFlag(value: string | undefined): boolean {
  return typeof value === 'string' && ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

export function shouldUsePublicContentCache(env?: Partial<CloudflareEnv> | null): boolean {
  const cache = getCacheNamespace(env)
  if (!cache) return false

  if (process.env.NODE_ENV === 'production') {
    return true
  }

  return readFlag(process.env.ENABLE_PUBLIC_CACHE_IN_DEV)
}

export function getPublicContentCacheNamespace(
  env?: Partial<CloudflareEnv> | null,
): KVNamespace | undefined {
  return shouldUsePublicContentCache(env) ? getCacheNamespace(env) : undefined
}

import { getSiteUrl } from '@/lib/site-config'
import { clearMemoized } from '@/lib/server/memory-cache'
import { purgeEdgeCacheUrls } from '@/lib/server/edge-cache'

// 清除缓存（通过版本号机制）
// slugs：需要额外失效的文章 slug（会一并清掉对应的伪静态边缘缓存）
export async function invalidatePublicContentCache(
  env?: Partial<CloudflareEnv> | null,
  slugs?: string[],
): Promise<boolean> {
  await invalidatePublicEdgeCache(slugs)

  const cache = getPublicContentCacheNamespace(env)
  if (!cache) return false

  await invalidateCache(cache)
  return true
}

// 后台写完数据后，把对应的边缘缓存（伪静态层）也清掉。
// 注意 caches.default 是按机房分布的，这里只影响当前 isolate 所在机房；
// 其他机房最多再撑 EDGE_CACHE_TTL（默认 300 秒）。
async function invalidatePublicEdgeCache(slugs?: string[]): Promise<void> {
  try {
    // 同一 isolate 内的记忆化缓存也要失效，否则后台改完自己看到的还是旧的
    clearMemoized()

    const base = getSiteUrl()
    const urls = new Set<string>([
      `${base}/`,
      `${base}/feed.xml`,
      `${base}/sitemap.xml`,
    ])

    for (const slug of slugs ?? []) {
      if (!slug) continue
      const clean = slug.replace(/^\/+|\/+$/g, '')
      if (clean) urls.add(`${base}/${clean}`)
    }

    await purgeEdgeCacheUrls(Array.from(urls))
  } catch {
    // 清缓存失败不应该影响写入结果
  }
}

export async function getCached<T>(
  kv: KVNamespace,
  key: string,
  fetcher: () => Promise<T>,
  ttl: number = 3600
): Promise<T> {
  // 尝试从 KV 读取
  const cached = await kv.get(key, 'json')
  if (cached) return cached as T

  // 缓存未命中，执行查询
  const data = await fetcher()

  // 写入 KV（真正异步，不阻塞响应；写入失败不影响页面）
  kv.put(key, JSON.stringify(data), { expirationTtl: ttl }).catch(() => {})

  return data
}

// 清除缓存（通过版本号机制）
export async function invalidateCache(kv: KVNamespace): Promise<void> {
  const version = await kv.get('cache:version')
  const newVersion = String(Number(version || 0) + 1)
  await kv.put('cache:version', newVersion)
}

// 获取带版本的缓存 key
export async function getCacheKey(kv: KVNamespace, key: string): Promise<string> {
  const version = await kv.get('cache:version')
  return version ? `${key}:v${version}` : key
}

// 直接删除指定 key
export async function deleteCache(kv: KVNamespace, key: string): Promise<void> {
  await kv.delete(key)
}
