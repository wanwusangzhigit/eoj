import { Hono } from 'hono';
import { AppType } from '../types';
import { createCaptcha, verifyCaptcha } from '../utils/captcha';

const captcha = new Hono<AppType>();

// GET /captcha/generate — Generate a new CAPTCHA image
captcha.get('/generate', async (c) => {
  try {
    const { uuid, svg, type, answer_length } = await createCaptcha(c.env.DB);
    return c.json({
      success: true,
      data: { uuid, svg, type, answer_length },
    });
  } catch (e: any) {
    console.error('Captcha generation error:', e);
    return c.json({ success: false, error: { message: 'Failed to generate captcha', code: 'INTERNAL_ERROR' } }, 500);
  }
});

export default captcha;
export { verifyCaptcha };