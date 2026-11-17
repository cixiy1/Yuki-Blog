-- 组织：邀请制成员关系 + 站内同意
--
-- `orgs` / `org_members` 从 0001 就有了，但一直没有接口，两张表都是空的。
-- 这里补两样：
--
--   1. `orgs.cover` —— 组织卡片封面（站内路径或 http(s)），站点 /orgs/ 用
--   2. `org_invites` —— 邀请票。邀请不直接进组织，要对方在站内点「同意」，
--      所以票要能过期、能撤回、能留痕（谁在什么时候被谁邀请的）
--
-- 为什么邀请要过一道确认：组织决定「谁能看我的文章」（visibleTo 里的 org:<slug>）
-- 和「谁能一起改我的文章」（共创按组织邀请）。直接把陌生人塞进组，等于把
-- 一串文章的读权限发了出去，撤销之前对方什么都看得到。

ALTER TABLE orgs ADD COLUMN cover TEXT;

CREATE TABLE IF NOT EXISTS org_invites (
	id           INTEGER PRIMARY KEY AUTOINCREMENT,
	org_id       INTEGER NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
	uid          INTEGER NOT NULL,
	invited_by   INTEGER NOT NULL,
	token        TEXT NOT NULL,
	status       TEXT NOT NULL DEFAULT 'pending'
	             CHECK (status IN ('pending', 'accepted', 'declined', 'revoked')),
	note         TEXT,
	created_at   TEXT NOT NULL DEFAULT (datetime('now')),
	expires_at   TEXT NOT NULL,
	responded_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_org_invites_token ON org_invites (token);
CREATE INDEX IF NOT EXISTS idx_org_invites_uid ON org_invites (uid, status);

-- 同一个人对同一个组织最多一张待处理邀请：重复邀请只会让列表里堆出两行同名，
-- 谁也说不清点哪个才作数。接受/拒绝/撤回后状态变了，不受这个索引限制。
CREATE UNIQUE INDEX IF NOT EXISTS idx_org_invites_pending
	ON org_invites (org_id, uid) WHERE status = 'pending';
