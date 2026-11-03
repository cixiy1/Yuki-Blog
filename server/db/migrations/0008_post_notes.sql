-- 审核批注：审核员在正文上划词写的建议。
-- 退回只说「改一下」作者不知道该改哪；批注挂到具体那段文字上，作者逐条对照。
CREATE TABLE IF NOT EXISTS post_notes (
	id           INTEGER PRIMARY KEY AUTOINCREMENT,
	post_id      INTEGER NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
	reviewer_uid INTEGER NOT NULL,
	-- 被选中的原文（渲染后的可见文字），用来在正文里定位高亮
	quote        TEXT NOT NULL,
	-- 审核员写的建议
	note         TEXT NOT NULL,
	created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_post_notes_post
	ON post_notes (post_id, id);
