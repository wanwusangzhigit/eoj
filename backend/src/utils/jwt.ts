import { Jwt } from 'hono/utils/jwt';

import { UserPayload } from '../types';

export async function signJWT(payload: object, secret: string): Promise<string> {
  if (!secret) {
    throw new Error('JWT_SECRET is not configured');
  }
  return await Jwt.sign(
    { ...payload, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7 },
    secret,
    'HS256'
  );
}

export async function verifyJWT(
  token: string,
  secret: string
): Promise<UserPayload | null> {
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
