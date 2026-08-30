import { Context, Next } from 'hono';
import { AppType } from '../types';
import { verifyCaptcha, isCaptchaRequired } from '../utils/captcha';

/**
 * Middleware factory: verify CAPTCHA for a specific feature.
 * Expects `captcha_uuid` and `captcha_answer` in the JSON body.
 * If the feature's captcha setting is disabled, passes through.
 */
export function captchaMiddleware(feature: string) {
  return async (c: Context<AppType>, next: Next) => {
    try {
      // Check if captcha is required for this feature
      const required = await isCaptchaRequired(c.env.DB, feature);
      if (!required) {
        await next();
        return;
      }

      const body = await c.req.json().catch(() => ({}));
      const uuid = body?.captcha_uuid;
      const answer = body?.captcha_answer;

      if (!uuid || !answer) {
        return c.json({
          success: false,
          error: { message: 'CAPTCHA verification required', code: 'CAPTCHA_REQUIRED' }
        }, 400);
      }

      const valid = await verifyCaptcha(c.env.DB, uuid, answer);
      if (!valid) {
        return c.json({
          success: false,
          error: { message: 'CAPTCHA verification failed', code: 'CAPTCHA_FAILED' }
        }, 400);
      }

      await next();
    } catch {
      return c.json({
        success: false,
        error: { message: 'CAPTCHA verification failed', code: 'CAPTCHA_FAILED' }
      }, 400);
    }
  };
}