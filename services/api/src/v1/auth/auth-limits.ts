import { createHash, createHmac } from 'crypto';

export type AuthLimitWindow = '1m' | '5m' | '10m' | '15m';

export interface AuthLimit {
  window: AuthLimitWindow;
  perAddress: number;
  perEmail: number;
  message: string;
}

export const AUTH_LIMITS = {
  register: { window: '5m', perAddress: 60, perEmail: 3, message: 'Too many registration attempts. Please try again later.' },
  login: { window: '1m', perAddress: 120, perEmail: 10, message: 'Too many login attempts. Please try again later.' },
  verifyEmail: { window: '10m', perAddress: 120, perEmail: 10, message: 'Too many verification attempts. Please try again later.' },
  forgotPassword: { window: '15m', perAddress: 30, perEmail: 3, message: 'Too many password reset requests. Please try again later.' },
  resendToken: { window: '5m', perAddress: 60, perEmail: 5, message: 'Too many resend attempts. Please try again later.' },
  resetPassword: { window: '15m', perAddress: 30, perEmail: 5, message: 'Too many password reset attempts. Please try again later.' },
} as const satisfies Record<string, AuthLimit>;

export type AuthLimitName = keyof typeof AUTH_LIMITS;

export const deriveLimitSecret = (base: string | undefined): string => {
  if (!base) throw new Error('A secret to hash rate limit keys with is not configured');
  return createHash('sha256').update(`auth-limit-v1:${base}`).digest('hex');
};

export const emailKey = (secret: string, email: string): string => createHmac('sha256', secret).update(email).digest('hex');

export const limitProps = (name: AuthLimitName, secret: string, email: string): { scope: string; emailKey: string } => ({
  scope: name,
  emailKey: emailKey(secret, email),
});
