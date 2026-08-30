import { Jwt } from 'hono/utils/jwt';

import { UserPayload } from '../types';

export async function signJWT(payload: object, secret: string, expiresInSeconds: number = 60 * 60 * 24 * 7): Promise<string> {
  if (!secret) {
    throw new Error('JWT_SECRET is not configured');
  }
  return await Jwt.sign(
    { ...payload, exp: Math.floor(Date.now() / 1000) + expiresInSeconds },
    secret,
    'HS256'
  );
}

async function tryVerify(token: string, secret: string): Promise<UserPayload | null> {
  try {
    const payload = (await Jwt.verify(token, secret, 'HS256')) as any;
    if (payload && payload.userId) {
      return { id: payload.userId, userId: payload.userId, username: payload.username, role: payload.role, permissions: payload.permissions || [] };
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
