export type Database = D1Database

// 获取数据库实例（从 Cloudflare Workers 环境）
export function getDB(env: CloudflareEnv) {
  return env.DB
}

// Schema 由 wrangler d1 execute 管理，运行时不再执行迁移
// D1 上 ALTER TABLE 重复执行可能触发异常，改为空操作
export async function ensureSchema(_db: Database) {
  return
}
