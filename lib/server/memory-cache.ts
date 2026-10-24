// Worker isolate 内的短生命记忆化缓存。
//
// Cloudflare Worker 的 isolate 会在多次请求之间复用，所以模块级 Map 能挡掉
// 同一 isolate 内高频重复的 D1 查询（比如每个页面都要读一次的站点导航、
// 分类列表、文章总数、相关文章）。
//
// 这只是「兜住边缘缓存未命中时成本」的第二道防线，不是数据正确性的来源：
// TTL 都压得很短（秒级~分钟级），并且是每 isolate 独立的。

type CacheEntry<T> = { value: T; expiresAt: number }

const MAX_ENTRIES = 512

const store = new Map<string, CacheEntry<unknown>>()
const inflight = new Map<string, Promise<unknown>>()

function evictIfNeeded(now: number): void {
  if (store.size < MAX_ENTRIES) return

  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) store.delete(key)
  }

  while (store.size >= MAX_ENTRIES) {
    const oldest = store.keys().next()
    if (oldest.done) break
    store.delete(oldest.value)
  }
}

export async function memoize<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const now = Date.now()
  const hit = store.get(key)
  if (hit && hit.expiresAt > now) {
    return hit.value as T
  }

  // 并发去重：同一 key 的多个同时到达的请求只打一次数据库
  const pending = inflight.get(key)
  if (pending) {
    return (await pending) as T
  }

  const task = loader()
    .then((value) => {
      evictIfNeeded(Date.now())
      store.set(key, { value, expiresAt: Date.now() + ttlMs })
      return value
    })
    .finally(() => {
      inflight.delete(key)
    })

  inflight.set(key, task)
  return (await task) as T
}

export function clearMemoized(prefix?: string): void {
  if (!prefix) {
    store.clear()
    return
  }
  for (const key of Array.from(store.keys())) {
    if (key.startsWith(prefix)) store.delete(key)
  }
}
