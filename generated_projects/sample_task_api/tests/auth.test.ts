import { describe, it, expect } from 'vitest';
import { createToken } from '../src/auth.js';
describe('auth', () => { it('creates token', () => { expect(createToken('user-1')).toBeDefined(); }); });