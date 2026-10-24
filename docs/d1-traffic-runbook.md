# D1 每日行读取超限：定位与治理

博客：`https://blog.ngy123.com`（Next.js 16 + OpenNext + Cloudflare Workers + D1）
时间：2026-10-25

---

## 一、为什么会超

D1 免费版每天 **500 万行读取**。关键是：**行读取按"扫描到的行数"计费，不是返回行数**。缺索引时，哪怕只返回 25 条列表数据，也会把整表扫一遍。

当前 sitemap 里有 **760 个 URL**，也就是 posts 表大约 **757 行**。

每一个页面请求大概要执行这些查询：

| 页面 | 主要查询 | 估算行读取 |
| --- | --- | --- |
| 首页 `/` | `getSiteHeaderData`（JOIN + GROUP BY 全表）+ `getPosts` + `getPostsCount`（COUNT(*)） | ≈ 2,270 |
| 文章页 `/{slug}` | 页头 + `getPostBySlug` ×2 + 「继续阅读」的两次全表扫描 | ≈ 1,570 |
| `/sitemap.xml` | `getPosts(1000)` + `getPublicCategories` | ≈ 1,510 |
| `/feed.xml` | 一次带 `ORDER BY` 的全表过滤扫描 | ≈ 750 |
| `/search?q=` | `LIKE` 模糊匹配 `content` 正文（整篇长文） | ≈ 750+ |

也就是说，**每天只要大约 2,000～3,000 次请求就会打满配额**。爬虫轻松做到。

## 二、真正的病根

不是"文章太多"，而是三件事叠加：

1. **边缘完全没有缓存**
   线上实测响应头：
   ```
   Cache-Control: public, must-revalidate, max-age=0
   EO-Cache-Status: MISS
   ```
   所有页面都是 `force-dynamic`，Worker 又返回 `max-age=0`，
   所以 Cloudflare CDN **一次都不缓存**，每个请求都跑完整 SSR + D1。

2. **KV 缓存写了但没接上**
   `lib/cache.ts` 里已经写好了完整的 KV 缓存逻辑，
   但 `getCacheNamespace()` 需要 `env.CACHE` 或 `env.KV`，
   而 `wrangler.toml` 里**没有绑定任何 KV namespace**——整段缓存代码一直是死代码。

3. **查询本身贵**
   - `getPublicCategories`：`categories JOIN posts GROUP BY`，每个页面渲染页头都要扫一次全表
   - `getPostsCount`：`COUNT(*)` 全表
   - 「继续阅读」：`LIKE` 全表扫 `content` + 再捞 48 条候选（`SELECT *` 连 `html` 一起读）
   - 缺少覆盖 `(status, password, is_hidden, deleted_at)` 的复合索引

---

## 三、治理方案（三层）

### 第 1 层：伪静态边缘缓存（核心，本次已实现）

`worker.ts` 入口加了一层 Cloudflare Cache API（`lib/server/edge-cache.ts`）：

- 匿名、公开的 GET 请求，先用 URL 去 `caches.default` 查
- **命中直接返回，一次 D1 都不触碰**
- 未命中才真正渲染，并写回边缘缓存
- 自动跳过：`/admin`、`/editor`、`/api`、`?pwd=`、带管理员 Cookie、RSC 预取、浏览器硬刷新

于是 D1 读取量从 **「与请求数成正比」** 变成 **「与去重后的 URL 数 × TTL 成正比」**。
760 篇文章、TTL 300 秒，理论上限约 `760 × 288 = 21.9 万行/天`，
只有原来的 **4%** 左右。

响应头会带上诊断字段：

```
x-edge-cache: HIT     # 边缘缓存命中，未触碰 D1
x-edge-cache: MISS    # 首次或已过期，走了一次正常渲染
```

可用环境变量调优（`wrangler.toml` 的 `[vars]`）：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `EDGE_CACHE` | `on` | 设为 `off` 可一键关闭整层 |
| `EDGE_CACHE_TTL` | `300` | 普通页面秒数。想让新文章更快生效就调小（如 60） |
| `EDGE_CACHE_TTL_FEED` | `3600` | `sitemap.xml` / `feed.xml` / `robots.txt` |
| `EDGE_CACHE_TTL_ASSET` | `86400` | 静态资源 |

**已知代价：**
- 文章页显示的阅读次数不再实时（只在缓存未命中时才 +1）
- 新发布/修改的文章最多延迟 `EDGE_CACHE_TTL` 秒才是对所有人可见
  （后台保存时会尝试清除当前机房的缓存；`caches.default` 是按机房分布的，
  想全球立刻生效要在 Cloudflare 后台用 Purge Everything）

### 第 2 层：isolate 内记忆化（本次已实现）

Worker isolate 会在多次请求之间复用，所以模块级缓存能挡掉同一 isolate 内的
重复 D1 查询。`lib/server/memory-cache.ts`：

| 内容 | TTL |
| --- | --- |
| 站点页头数据（导航 / 分类 / 主题） | 60 秒 |
| 文章总数 `getPostsCount` | 60 秒 |
| 「继续阅读」结果（按 slug） | 10 分钟 |

后台写数据时会自动清空，所以不会出现自己改完自己看不见的情况。

### 第 3 层：D1 索引（需要在 Cloudflare 执行一次）

见 `db/perf-indexes.sql`。在 D1 Console 粘贴执行即可，**幂等，可重复执行**：

```bash
wrangler d1 execute qiaomu-blog-opensource-db --remote --file=db/perf-indexes.sql
```

索引主要让"缓存未命中的那一次渲染"变便宜——从扫 757 行降到几十行。

配套的代码侧优化（本次已实现）：

- 「继续阅读」从 `SELECT *` 改为只取打分需要的列，不再读取 `content` / `html` 大字段
- `robots.ts` 增加 `Disallow: /search`——每次 LIke 都要扫正文，是纯亏本开支

---

## 四、立刻止血（不用等发布，Cloudflare 后台 5 分钟）

> 适用于：部署还没做，但想先把今天的配额守住。

**Workers & Pages → 你的域名 → Caching → Cache Rules → 新建规则**

- 规则名：`Cache public pages`
- 自定义过滤表达式：
  ```
  (http.request.uri.path ne "/admin" and http.request.uri.path not contains "/api/"
   and not http.request.uri.path contains "/editor"
   and not http.cookie contains "admin_session"
   and http.request.method eq "GET")
  ```
- 设置：**Cache eligibility → Eligible for cache**，Edge TTL → 2 小时
- 勾选 **Ignore origin Cache-Control**（关键：源站是 `max-age=0`，不忽略就永远不缓存）

顺手再做两件事：

- **Caching → Configuration**：Browser Cache TTL 设为 `Respect Existing Headers`，Crawler Hints 打开
- **Speed → Optimization**：开启 Auto Minify 和 Brotli

---

## 五、验证

```bash
# 第一次请求
curl -sI https://blog.ngy123.com/ | grep -i x-edge-cache
# → x-edge-cache: MISS

# 立刻再请求一次
curl -sI https://blog.ngy123.com/ | grep -i x-edge-cache
# → x-edge-cache: HIT
```

第二天到 Cloudflare 后台 → Workers & Pages → D1 → 你的数据库 → Metrics，
看 Row Reads 是否从百万级掉到十万级以下。

---

## 六、兜底选项

如果之后流量继续涨：

1. **Workers Paid $5/月**：含每月 250 亿行读取，基本不可能再超
2. **绑定 KV namespace**：`wrangler.toml` 加 `[[kv_namespaces]] binding = "CACHE"`，
   `lib/cache.ts` 里已经写好的那份 KV 缓存就会自动生效，与边缘缓存形成两级缓存
3. **进一步静态化**：发布时把每篇文章的 HTML 直接写进 R2 / KV，
   文章完全变为「读文件」，彻底脱离 D1
