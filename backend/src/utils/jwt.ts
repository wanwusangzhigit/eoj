import { Jwt } from 'hono/utils/jwt';

import { UserPayload } from '../types';

// 审计 #H-17: 在 payload 中显式写入 iat，作为 JWT 服务端吊销基准。
// Hono 的 Jwt.sign 不会自动注入 iat；verify 也仅在 iat 存在时校验，
// 所以我们需要在签名时显式写入，verifyJWT 之后由中间件比对
// users.token_invalid_before 来实现吊销语义。
export async function signJWT(payload: object, secret: string, expiresInSeconds: number = 60 * 60 * 24 * 7): Promise<string> {
  if (!secret) {
    throw new Error('JWT_SECRET is not configured');
  }
  const now = Math.floor(Date.now() / 1000);
  return await Jwt.sign(
    { ...payload, iat: now, exp: now + expiresInSeconds },
    secret,
    'HS256'
  );
}

async function tryVerify(token: string, secret: string): Promise<UserPayload | null> {
  try {
    const payload = (await Jwt.verify(token, secret, 'HS256')) as any;
    if (payload && payload.userId) {
      return {
        id: payload.userId,
        userId: payload.userId,
        username: payload.username,
        role: payload.role,
        permissions: payload.permissions || [],
        iat: typeof payload.iat === 'number' ? payload.iat : undefined,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 验证 JWT。支持密钥轮换:传入 previousSecret(环境变量 JWT_SECRET_PREVIOUS)时,
 * 先尝试当前密钥,失败后再用旧密钥验证,使旧 token 在轮换窗口期内仍然有效。
 */
export async function verifyJWT(
  token: string,
  secret: string,
  previousSecret?: string
): Promise<UserPayload | null> {
  const payload = await tryVerify(token, secret);
  if (payload) return payload;
  if (previousSecret && previousSecret !== secret) {
    return await tryVerify(token, previousSecret);
  }
  return null;
}
