import { AUTH_LIMITS, deriveLimitSecret, emailKey, limitProps } from '../auth-limits';

describe('AUTH_LIMITS', () => {
  const entries = Object.entries(AUTH_LIMITS);

  it('covers the six routes that take an email address and leaves refresh to nginx', () => {
    expect(Object.keys(AUTH_LIMITS).sort()).toEqual(['forgotPassword', 'login', 'register', 'resendToken', 'resetPassword', 'verifyEmail']);
    expect(AUTH_LIMITS).not.toHaveProperty('refresh');
  });

  it.each(entries)('%s: the limit per email is stricter than the limit per address', (_name, policy) => {
    expect(policy.perEmail).toBeGreaterThan(0);
    expect(policy.perEmail).toBeLessThan(policy.perAddress);
  });

  it.each(entries)('%s: a whole class behind one address can still register and sign in', (name, policy) => {
    if (name === 'login') expect(policy.perAddress).toBeGreaterThanOrEqual(100);
    if (name === 'register') expect(policy.perAddress).toBeGreaterThanOrEqual(40);
  });

  it.each(entries)('%s: has a window Arcjet accepts and a message', (_name, policy) => {
    expect(['1m', '5m', '10m', '15m']).toContain(policy.window);
    expect(policy.message).toMatch(/Please try again later\.$/);
  });

  it('keeps a password guess budget per account small', () => {
    expect(AUTH_LIMITS.login.perEmail).toBeLessThanOrEqual(10);
    expect(AUTH_LIMITS.resetPassword.perEmail).toBeLessThanOrEqual(5);
    expect(AUTH_LIMITS.forgotPassword.perEmail).toBeLessThanOrEqual(3);
  });
});

describe('emailKey', () => {
  const secret = deriveLimitSecret('base-secret');

  it('is stable for the same address', () => {
    expect(emailKey(secret, 'ada@example.test')).toBe(emailKey(secret, 'ada@example.test'));
  });

  it('differs between addresses', () => {
    expect(emailKey(secret, 'ada@example.test')).not.toBe(emailKey(secret, 'bob@example.test'));
  });

  it('does not contain the address, so Arcjet never receives it', () => {
    const key = emailKey(secret, 'ada@example.test');

    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toContain('ada');
  });

  it('cannot be reproduced without the secret', () => {
    expect(emailKey(deriveLimitSecret('other-secret'), 'ada@example.test')).not.toBe(emailKey(secret, 'ada@example.test'));
  });

  it('is not the secret of the one time codes', () => {
    expect(deriveLimitSecret('base-secret')).not.toBe('base-secret');
  });

  it('refuses a missing base secret instead of hashing with a constant', () => {
    expect(() => deriveLimitSecret(undefined)).toThrow();
    expect(() => deriveLimitSecret('')).toThrow();
  });
});

describe('limitProps', () => {
  const secret = deriveLimitSecret('base-secret');

  it('names the route and carries the hashed address', () => {
    const props = limitProps('login', secret, 'ada@example.test');

    expect(props.scope).toBe('login');
    expect(props.emailKey).toBe(emailKey(secret, 'ada@example.test'));
    expect(JSON.stringify(props)).not.toContain('ada@example.test');
  });
});
