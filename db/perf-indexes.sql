-- D1 行读取优化索引
--
-- 背景：D1 免费版每天只有 500 万行读取。**行数是按扫描行数算的**，
-- 缺少合适索引时，一次 "已发布文章列表" 或 COUNT(*) 就会扫完整张 posts 表。
-- 这份 SQL 专门覆盖公开站 4 个高频查询形态：首页列表、文章总数、
-- 分类聚合（页头每个页面都要跑一次）、分类页列表。
--
-- 执行方式（幂等，重复执行不会报错）：
--   Cloudflare 后台 → D1 → 选中数据库 → Console → 粘贴全部 → Execute
-- 或命令行：
--   wrangler d1 execute qiaomu-blog-opensource-db --remote --file=db/perf-indexes.sql
--
-- 提示：如果几千行数据，建索引只需几秒；期间不会阻塞读取。

-- 1) 首页文章列表
--    对应 getPosts()：
--      WHERE status='published' AND deleted_at IS NULL AND password IS NULL AND is_hidden=0
--      ORDER BY is_pinned DESC, published_at DESC LIMIT 25
--    索引把 4 个过滤条件全部覆盖，SQLite 无需回表逐行判断，
--    符合条件的文章按序读到 25 条即可停下，不再全表扫描。
CREATE INDEX IF NOT EXISTS idx_posts_public_list
  ON posts (status, password, is_hidden, deleted_at, is_pinned DESC, published_at DESC);

-- 2) 文章总数
--    对应 getPostsCount()：同样的四个过滤条件上的 COUNT(*)。
--    D1 的 COUNT 仍需要遍历索引条目，但走索引比走全表（带 content/html 大字段）便宜得多。
--    注意：首页真正省流量的做法是少调用它（已在代码里做了 60 秒记忆化）。
CREATE INDEX IF NOT EXISTS idx_posts_public_count
  ON posts (is_pinned, deleted_at, status, password, is_hidden);

-- 3) 分类聚合（getPublicCategories）
--    原本是 categories JOIN posts + GROUP BY，每个页面渲染页头都要扫一次全表。
--    按 category 建索引后，聚合可以直接在索引上做。
CREATE INDEX IF NOT EXISTS idx_posts_public_category
  ON posts (category, status, password, is_hidden, deleted_at);

-- 4) 单个分类下的文章列表（getPostsByCategory）
CREATE INDEX IF NOT EXISTS idx_posts_public_by_category
  ON posts (category, is_pinned DESC, published_at DESC)
  WHERE status = 'published' AND deleted_at IS NULL AND password IS NULL AND is_hidden = 0;

-- 5) 让 SQLite 的查询计划器拿到最新统计信息
--    （建完索引后跑一次，能显著改善执行计划的选择）
ANALYZE;
