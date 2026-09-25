import { describe, expect, it } from 'vitest';
import { AuthService } from '../src/auth/auth.service.js';

describe('AuthService', () => {
  it('validates tokens', () => {
    const auth = new AuthService();
    expect(auth.validateToken('bearer_valid_token_123')).toBe(true);
  });
});
