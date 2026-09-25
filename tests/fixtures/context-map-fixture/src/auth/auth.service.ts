import { JWT_SECRET } from '../config/env.js';
import { validateNonEmptyString } from '../utils/validation.js';

export interface UserSession {
  userId: string;
  token: string;
}

export class AuthService {
  validateToken(token: string): boolean {
    validateNonEmptyString(token, 'token');
    return token.startsWith('bearer_') && token.length > 10;
  }

  createSession(userId: string): UserSession {
    validateNonEmptyString(userId, 'userId');
    return {
      userId,
      token: `bearer_${userId}_${JWT_SECRET.slice(0, 4)}`,
    };
  }
}
