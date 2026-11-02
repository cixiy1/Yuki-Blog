-- 用户系统初始化：账号、会话、组织、文章元数据、评论、媒体、设置、审计。
-- 表结构对应 docs/user-system/design.md 第七节。
-- 全部 IF NOT EXISTS：重复 apply 不会报错。

-- 账号
CREATE TABLE IF NOT EXISTS users (
	id             INTEGER PRIMARY KEY AUTOINCREMENT,
	uid            INTEGER NOT NULL,
	email          TEXT NOT NULL,
	email_verified INTEGER NOT NULL DEFAULT 0,
	role           TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'reviewer', 'admin')),
	status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted')),
	display_name   TEXT NOT NULL,
	avatar_url     TEXT,
	bio            TEXT,
	last_login_at  TEXT,
	created_at     TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_uid ON users (uid);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users (role, status);

-- 第三方绑定
CREATE TABLE IF NOT EXISTS oauth_accounts (
	id               INTEGER PRIMARY KEY AUTOINCREMENT,
	provider         TEXT NOT NULL CHECK (provider IN ('github')),
	provider_uid     TEXT NOT NULL,
	user_id          INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
	access_token_enc TEXT,
	created_at       TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_oauth_provider_uid ON oauth_accounts (provider, provider_uid);
CREATE INDEX IF NOT EXISTS idx_oauth_user ON oauth_accounts (user_id);

-- 会话（只存 token 的 sha256）
CREATE TABLE IF NOT EXISTS sessions (
	id           INTEGER PRIMARY KEY AUTOINCREMENT,
	token_hash   TEXT NOT NULL,
	user_id      INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
	expires_at   TEXT NOT NULL,
	ip_hash      TEXT,
	user_agent   TEXT,
	last_seen_at TEXT,
	created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_token ON sessions (token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);

-- 邮箱验证码（只存 code 的 hash）
CREATE TABLE IF NOT EXISTS email_codes (
	id          INTEGER PRIMARY KEY AUTOINCREMENT,
	email       TEXT NOT NULL,
	code_hash   TEXT NOT NULL,
	purpose     TEXT NOT NULL CHECK (purpose IN ('login', 'bind', 'delete')),
	expires_at  TEXT NOT NULL,
	consumed_at TEXT,
	attempts    INTEGER NOT NULL DEFAULT 0,
	ip_hash     TEXT,
	created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_email_codes_lookup ON email_codes (email, purpose, created_at);
CREATE INDEX IF NOT EXISTS idx_email_codes_ip ON email_codes (ip_hash, created_at);

-- 组织
-- can_review = 该组织已获准审核自己成员的投稿，由管理员批准后置 1。
CREATE TABLE IF NOT EXISTS orgs (
	id          INTEGER PRIMARY KEY AUTOINCREMENT,
	slug        TEXT NOT NULL,
	name        TEXT NOT NULL,
	owner_uid   INTEGER NOT NULL,
	description TEXT,
	status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'rejected', 'disabled')),
	can_review  INTEGER NOT NULL DEFAULT 0,
	created_at  TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_orgs_slug ON orgs (slug);
CREATE INDEX IF NOT EXISTS idx_orgs_owner ON orgs (owner_uid);

CREATE TABLE IF NOT EXISTS org_members (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	org_id     INTEGER NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
	uid        INTEGER NOT NULL,
	role       TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_org_members_unique ON org_members (org_id, uid);
CREATE INDEX IF NOT EXISTS idx_org_members_uid ON org_members (uid);

-- 文章元数据（正文在 git，这里只记状态与指针）
CREATE TABLE IF NOT EXISTS posts (
	id           INTEGER PRIMARY KEY AUTOINCREMENT,
	uid          INTEGER NOT NULL,
	org_id       INTEGER REFERENCES orgs (id) ON DELETE SET NULL,
	repo_path    TEXT NOT NULL,
	slug         TEXT NOT NULL,
	title        TEXT NOT NULL,
	summary      TEXT,
	cover        TEXT,
	tags         TEXT,
	status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'published', 'rejected', 'archived')),
	commit_sha   TEXT,
	published_at TEXT,
	submitted_at TEXT,
	reviewer_uid INTEGER,
	review_note  TEXT,
	reviewed_at  TEXT,
	created_at   TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_slug ON posts (slug);
CREATE INDEX IF NOT EXISTS idx_posts_status ON posts (status, updated_at);
CREATE INDEX IF NOT EXISTS idx_posts_uid ON posts (uid, updated_at);
CREATE INDEX IF NOT EXISTS idx_posts_org ON posts (org_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_posts_repo_path ON posts (repo_path);

-- 版本记录
CREATE TABLE IF NOT EXISTS post_revisions (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	post_id    INTEGER NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
	commit_sha TEXT,
	message    TEXT,
	actor_uid  INTEGER,
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_post_revisions_post ON post_revisions (post_id, created_at);

-- 评论：post_slug 也用于留言板、说说，目标标识由调用方约定
CREATE TABLE IF NOT EXISTS comments (
	id           INTEGER PRIMARY KEY AUTOINCREMENT,
	post_slug    TEXT NOT NULL,
	uid          INTEGER NOT NULL,
	parent_id    INTEGER REFERENCES comments (id) ON DELETE CASCADE,
	content_html TEXT NOT NULL,
	status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'visible', 'hidden', 'deleted')),
	ip_hash      TEXT,
	user_agent   TEXT,
	created_at   TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_comments_post ON comments (post_slug, status, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_uid ON comments (uid, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments (parent_id);

-- 媒体
CREATE TABLE IF NOT EXISTS media (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	uid        INTEGER NOT NULL,
	kind       TEXT NOT NULL CHECK (kind IN ('image', 'audio', 'video', 'file')),
	storage    TEXT NOT NULL CHECK (storage IN ('r2', 'git', 'external')),
	url        TEXT NOT NULL,
	path       TEXT,
	mime       TEXT,
	bytes      INTEGER NOT NULL DEFAULT 0,
	sha256     TEXT,
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_media_uid ON media (uid, created_at);
CREATE INDEX IF NOT EXISTS idx_media_sha ON media (sha256);

-- 站点设置
CREATE TABLE IF NOT EXISTS settings (
	key        TEXT PRIMARY KEY,
	value_json TEXT NOT NULL,
	updated_by INTEGER,
	updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 操作审计
CREATE TABLE IF NOT EXISTS audit_log (
	id          INTEGER PRIMARY KEY AUTOINCREMENT,
	actor_uid   INTEGER,
	action      TEXT NOT NULL,
	target      TEXT,
	detail_json TEXT,
	ip_hash     TEXT,
	created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log (created_at);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log (actor_uid, created_at);
