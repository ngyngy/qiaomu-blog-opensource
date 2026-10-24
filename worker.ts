// open-next generates this module during the Cloudflare build step.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- generated artifact may be absent during clean Next type-checks
import { default as handler } from './.open-next/worker.js'
import { consumeBackgroundJobBatch, type BackgroundJob, type BackgroundJobEnv } from './lib/background-jobs'
import { serveWithEdgeCache } from './lib/server/edge-cache'

interface QueueMessage<T> {
  body: T
  ack?: () => void
  retry?: () => void
}

interface QueueBatch<T> {
  messages: Array<QueueMessage<T>>
}

interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void
}

type WorkerEnv = BackgroundJobEnv & Partial<CloudflareEnv>

const originFetch = (request: Request, env: WorkerEnv, ctx: WorkerExecutionContext) =>
  (handler.fetch as (request: Request, env: unknown, ctx: unknown) => Promise<Response>)(request, env, ctx)

const customWorker = {
  async fetch(request: Request, env: WorkerEnv, ctx: WorkerExecutionContext) {
    // 伪静态层：公开页面的匿名 GET 请求先查 Cloudflare 边缘缓存，
    // 命中就直接返回，一次 D1 都不触碰。详见 lib/server/edge-cache.ts
    try {
      return await serveWithEdgeCache(request, env, ctx, originFetch)
    } catch (error) {
      console.error('[edge-cache] serve failed, falling back to origin', error)
      return originFetch(request, env, ctx)
    }
  },

  async queue(batch: QueueBatch<BackgroundJob>, env: BackgroundJobEnv) {
    await consumeBackgroundJobBatch(batch, env)
  },
}

export default customWorker

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- generated artifact may be absent during clean Next type-checks
export { DOQueueHandler, DOShardedTagCache } from './.open-next/worker.js'
