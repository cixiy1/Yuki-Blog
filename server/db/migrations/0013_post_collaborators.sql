-- 文章共创：把一篇文章的编辑权借给别的账号。
--
-- 为什么按 slug 而不是 posts.id：已发布的文章在仓库里，D1 里未必有对应行；
-- 草稿又一定会有 slug（创建时就分配了）。slug 是两层唯一共有的标识，
-- 所以主键用它——同一张表既能管草稿，也能管已发布文章。
--
-- 只有一档权限（editor）：能读能改正文，不能删文章、不能改可见范围、
-- 不能邀请别人。邀请与移除只留给作者本人与管理员，避免权限链无限外扩。
CREATE TABLE IF NOT EXISTS post_collaborators (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	slug       TEXT NOT NULL,
	uid        INTEGER NOT NULL,
	invited_by INTEGER NOT NULL,
	status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 同一篇文章同一个人只有一条记录：撤销后再邀请是「复活」那一行，不新增
CREATE UNIQUE INDEX IF NOT EXISTS idx_post_collab_slug_uid
	ON post_collaborators (slug, uid);

-- 「共享给我的文章」按人查
CREATE INDEX IF NOT EXISTS idx_post_collab_uid
	ON post_collaborators (uid, status);
