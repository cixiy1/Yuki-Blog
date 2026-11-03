-- 供 email_codes 的过期清理使用。
-- 限流计数走 0001 里的 (email, purpose, created_at) 与 (ip_hash, created_at)，不需要新增。
CREATE INDEX IF NOT EXISTS idx_email_codes_created ON email_codes (created_at);
