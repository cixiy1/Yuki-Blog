-- 账号体系重建（参考 FatFish-Study-Platform 的模型）：
-- users 增加 account / password_enc / email_verified_at / session_epoch，
-- status 语义改为 pending / active / disabled / deleted；
-- 邮箱验证码链路整体下线，sessions 表随无状态签名 cookie 一起删除。
--
-- ⚠️ 本文件包含「重建表」的破坏性语句，**不可重复执行**。
-- 幂等性由 d1_migrations 保证：每个迁移文件只会被 apply 一次。
-- 本地要从零重来：rm -rf .wrangler/state && pnpm db:migrate:local
--
-- 顺序有讲究：oauth_accounts 是唯一引用 users 的表，
-- 先干掉它（连同 sessions / email_codes），再重建 users，
-- 这样不依赖 PRAGMA foreign_keys / defer_foreign_keys（D1 对 pragma 支持有限）。
--
-- 执行前自查这两条，都必须返回 0 行：
--   SELECT lower(trim(email)) AS e, COUNT(*) FROM users GROUP BY e HAVING COUNT(*) > 1;
--   SELECT uid, COUNT(*) FROM users GROUP BY uid HAVING COUNT(*) > 1;

DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS email_codes;

-- 第三方绑定：去掉 user_id 的内联外键。
-- 本项目从不硬删用户（status='deleted' 是软删），完整性由应用层保证；
-- 去掉外键后重建 users 才不会撞 FOREIGN KEY constraint failed。
CREATE TABLE oauth_accounts_v2 (
	id               INTEGER PRIMARY KEY AUTOINCREMENT,
	provider         TEXT NOT NULL CHECK (provider IN ('github')),
	provider_uid     TEXT NOT NULL,
	user_id          INTEGER NOT NULL,
	access_token_enc TEXT,
	created_at       TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO oauth_accounts_v2
	(id, provider, provider_uid, user_id, access_token_enc, created_at, updated_at)
SELECT id, provider, provider_uid, user_id, access_token_enc, created_at, updated_at
  FROM oauth_accounts;

DROP TABLE oauth_accounts;
ALTER TABLE oauth_accounts_v2 RENAME TO oauth_accounts;

CREATE UNIQUE INDEX IF NOT EXISTS idx_oauth_provider_uid ON oauth_accounts (provider, provider_uid);
CREATE INDEX IF NOT EXISTS idx_oauth_user ON oauth_accounts (user_id);

-- 账号主表
CREATE TABLE users_v2 (
	id                  INTEGER PRIMARY KEY AUTOINCREMENT,
	uid                 INTEGER NOT NULL,
	account             TEXT NOT NULL,
	email               TEXT NOT NULL,
	email_verified_at   TEXT,
	-- 参考实现的 role 默认值是 admin，那是提权隐患；这里显式 user
	role                TEXT NOT NULL DEFAULT 'user'
	                    CHECK (role IN ('user', 'reviewer', 'admin')),
	status              TEXT NOT NULL DEFAULT 'pending'
	                    CHECK (status IN ('pending', 'active', 'disabled', 'deleted')),
	display_name        TEXT NOT NULL,
	avatar_url          TEXT,
	bio                 TEXT,
	-- NULL 表示该账号没有本地密码（纯 OAuth 账号），不存空串
	password_enc        TEXT,
	password_updated_at TEXT,
	-- 加一即让该用户所有已签发的 cookie 失效（改密、封禁、退出所有设备）
	session_epoch       INTEGER NOT NULL DEFAULT 0,
	last_login_at       TEXT,
	created_at          TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO users_v2 (
	id, uid, account, email, email_verified_at, role, status, display_name,
	avatar_url, bio, password_enc, password_updated_at, session_epoch,
	last_login_at, created_at, updated_at
)
SELECT
	id,
	uid,
	'u' || uid,                                  -- 老用户没有登录名，先给个能改的兜底
	lower(trim(email)),                          -- 统一小写，唯一索引才管得住
	CASE WHEN email_verified = 1 THEN created_at ELSE NULL END,
	CASE WHEN role IN ('user', 'reviewer', 'admin') THEN role ELSE 'user' END,
	CASE
		WHEN status = 'suspended' THEN 'disabled'
		WHEN status = 'deleted'   THEN 'deleted'
		WHEN status = 'active' AND email_verified = 1 THEN 'active'
		ELSE 'pending'                           -- 从没验证过的一律 pending
	END,
	CASE WHEN trim(display_name) = '' THEN 'u' || uid ELSE display_name END,
	avatar_url,
	bio,
	NULL,                                        -- 老库没密码，强制走一次找回密码
	NULL,
	0,
	last_login_at,
	created_at,
	updated_at
FROM users;

DROP TABLE users;
ALTER TABLE users_v2 RENAME TO users;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_uid     ON users (uid);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email   ON users (email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_account ON users (account);
CREATE INDEX        IF NOT EXISTS idx_users_role    ON users (role, status);
CREATE INDEX        IF NOT EXISTS idx_users_status  ON users (status, created_at);
