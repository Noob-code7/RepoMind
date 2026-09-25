export function createToken(userId: string): string {
  return `token_for_${userId}`;
}