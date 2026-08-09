-- 修复 FTS5 虚拟表损坏
-- 1. 删除旧触发器
DROP TRIGGER IF EXISTS posts_ai;
DROP TRIGGER IF EXISTS posts_au;
DROP TRIGGER IF EXISTS posts_ad;

-- 2. 删除损坏的 FTS5 表
DROP TABLE IF EXISTS posts_fts;

-- 3. 重建 FTS5 表
CREATE VIRTUAL TABLE posts_fts USING fts5(
  title,
  content,
  content=posts,
  content_rowid=id,
  tokenize='unicode61'
);

-- 4. 重建触发器
CREATE TRIGGER posts_ai AFTER INSERT ON posts BEGIN
  INSERT INTO posts_fts(rowid, title, content)
  VALUES (new.id, new.title, new.content);
END;

CREATE TRIGGER posts_au AFTER UPDATE ON posts BEGIN
  UPDATE posts_fts SET title = new.title, content = new.content
  WHERE rowid = new.id;
END;

CREATE TRIGGER posts_ad AFTER DELETE ON posts BEGIN
  DELETE FROM posts_fts WHERE rowid = old.id;
END;

-- 5. 将已有文章同步到 FTS
INSERT INTO posts_fts(rowid, title, content)
SELECT id, title, content FROM posts WHERE status != 'deleted';
