-- 站点配置的发布历史：每次发布留一份快照，用于回滚与审计对账
CREATE TABLE IF NOT EXISTS site_config_versions (
	id           INTEGER PRIMARY KEY AUTOINCREMENT,
	-- 发布那一刻的全量配置（JSON），回滚就是用这份灌回草稿
	snapshot     TEXT NOT NULL,
	-- 提交信息，默认由变更摘要生成，允许人工改写
	note         TEXT,
	-- 写仓库成功后的 commit sha；失败为 NULL，便于分辨「记了版本但没落盘」
	commit_sha   TEXT,
	published_by INTEGER,
	published_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_config_versions_time
	ON site_config_versions (published_at DESC);
