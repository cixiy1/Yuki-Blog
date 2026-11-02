-- 认证用的两张一次性 token 表 + 限流表 + 审计索引。
-- 本文件只做「新增对象」，全部 IF NOT EXISTS，可重复执行。
--
-- token 一律只存 sha256：库泄露也拿不到可用的激活/重置链接。

-- 邮箱验证：24 小时
CREATE TABLE IF NOT EXISTS email_verification_tokens (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id    INTEGER NOT NULL,
	email      TEXT NOT NULL,          -- 发信时快照，改邮箱后旧链接自然失效
	token_hash TEXT NOT NULL,
	expires_at TEXT NOT NULL,
	used_at    TEXT,
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_evt_token ON email_verification_tokens (token_hash);
CREATE INDEX IF NOT EXISTS idx_evt_user ON email_verification_tokens (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_evt_expires ON email_verification_tokens (expires_at);

-- 找回密码：1 小时。单独一张表，避免两种用途的 token 串台
CREATE TABLE IF NOT EXISTS password_reset_tokens (
	id              INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id         INTEGER NOT NULL,
	email           TEXT NOT NULL,
	token_hash      TEXT NOT NULL,
	expires_at      TEXT NOT NULL,
	used_at         TEXT,
	request_ip_hash TEXT,
	created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_prt_token ON password_reset_tokens (token_hash);
CREATE INDEX IF NOT EXISTS idx_prt_user ON password_reset_tokens (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_prt_expires ON password_reset_tokens (expires_at);

-- 限流：固定窗口计数。
-- Worker 没有常驻进程，进程内 Map 跨 isolate / 跨 colo 不共享，等于没限流；
-- D1 里单条 UPSERT 是原子的，这里就是唯一的共享计数器。
-- subject 一律存哈希（ip_hash 或 sha256(小写标识|pepper)），表里不留邮箱明文。
CREATE TABLE IF NOT EXISTS rate_limits (
	bucket       TEXT NOT NULL,
	subject      TEXT NOT NULL,
	window_start INTEGER NOT NULL,
	count        INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY (bucket, subject, window_start)
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits (window_start);

-- 审计：管理端要按动作筛、按对象查
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log (action, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_target ON audit_log (target, created_at);
