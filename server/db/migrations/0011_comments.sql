-- 站内评论。
--
-- 0001_init.sql 里有一张同名的占位表（post_slug + content_html + visible/hidden），
-- 从建库到现在没写入过任何数据，字段也和新设计对不上（游客评论要 uid 可空、
-- 正文存 Markdown、状态要区分 pending/approved/rejected）。与其 ALTER 一堆列，
-- 不如直接重建——这张表是空的，丢不了东西。
DROP TABLE IF EXISTS comments;
--
-- 为什么存 D1 而不是构建期静态化：评论是运行时产生的，静态构建期不可能有它。
-- 前端每次进文章页现拉，「先审后发 / 先发后审」也只是这一层的 status 分支，
-- 改开关不需要重新部署（只有改评论组件代码才需要）。
--
-- target 是「评论挂在哪」的稳定标识：
--   · 文章   → frontmatter 的 slug（改 slug 会丢失旧评论，已知取舍）
--   · 留言板 → 固定字符串 guestbook
--   · 说说   → dynamic:<id>
CREATE TABLE IF NOT EXISTS comments (
	id               INTEGER PRIMARY KEY AUTOINCREMENT,
	target           TEXT NOT NULL,
	-- 只有一层嵌套：回复的回复仍然挂在顶层评论下，靠 reply_to_name 显示「回复 @某人」
	parent_id        INTEGER,
	-- 登录用户填 uid；游客为 NULL
	uid              INTEGER,
	guest_name       TEXT,
	-- 游客邮箱只存 sha256，用于同一个人认领自己的评论与发通知，原文不落库
	guest_email_hash TEXT,
	-- 正文存 Markdown 原文，渲染在客户端做（marked + sanitize-html）
	body_md          TEXT NOT NULL,
	status           TEXT NOT NULL DEFAULT 'pending'
	                 CHECK (status IN ('pending', 'approved', 'rejected')),
	-- 站长/审核员发言标记，前端给个徽标
	is_admin         INTEGER NOT NULL DEFAULT 0,
	ip_hash          TEXT,
	created_at       TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
	reviewed_by      INTEGER,
	reviewed_at      TEXT
);

-- 前台按 target 拉已通过的评论（最常用的一条）
CREATE INDEX IF NOT EXISTS idx_comments_target
	ON comments (target, status, id);

-- 管理端按状态分页
CREATE INDEX IF NOT EXISTS idx_comments_status
	ON comments (status, id DESC);

-- 回复查找与级联删除
CREATE INDEX IF NOT EXISTS idx_comments_parent
	ON comments (parent_id);

-- 「我发过的评论」
CREATE INDEX IF NOT EXISTS idx_comments_uid
	ON comments (uid, id DESC);
