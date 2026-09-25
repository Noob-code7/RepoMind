export function validateNonEmptyString(input: string, fieldName: string): boolean {
  if (!input || input.trim().length === 0) {
    throw new Error(`${fieldName} cannot be empty`);
  }
  return true;
}

export function validateTaskPriority(priority: string): boolean {
  const allowed = ['low', 'medium', 'high'];
  return allowed.includes(priority.toLowerCase());
}
