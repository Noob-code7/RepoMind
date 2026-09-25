import { AuthService } from './auth.service.js';

export function authenticate(authHeader: string | undefined): boolean {
  if (!authHeader) return false;
  const service = new AuthService();
  return service.validateToken(authHeader);
}
