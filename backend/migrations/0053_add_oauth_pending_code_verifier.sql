-- Store the CP OAuth PKCE code_verifier alongside the pending state.
-- 跨域社交登录时 code_verifier 若只存 cookie,可能在上游回跳(如从 B 经 A 到
-- cpoauth 再回 A)中丢失,导致兑换时提示 "code_verifier required for PKCE"。
-- 改为持久化到 DB,回调时随 state 一并取回。
ALTER TABLE oauth_pending ADD COLUMN code_verifier TEXT;