-- 彻底移除 FTS5 虚拟表（D1 不稳定，改用 LIKE 回退搜索）
DROP TRIGGER IF EXISTS posts_ai;
DROP TRIGGER IF EXISTS posts_au;
DROP TRIGGER IF EXISTS posts_ad;
DROP TABLE IF EXISTS posts_fts;

-- 清理所有测试数据和已删除的文章
DELETE FROM posts;
DELETE FROM categories WHERE name NOT IN ('未分类', 'AI工具', 'AI');
UPDATE categories SET post_count = 0;

-- 重置自增计数器
DELETE FROM sqlite_sequence WHERE name = 'posts';
