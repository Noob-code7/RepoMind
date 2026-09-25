/**
 * context/test_detector.ts
 * Deterministic test discovery, extracting test suites, test cases, and assertion counts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { TestContext } from './schemas.js';

export class TestDetector {
  /**
   * Scan test files and extract structural test information.
   */
  static analyzeTestFiles(root: string, testFilePaths: string[]): TestContext[] {
    const results: TestContext[] = [];

    for (const relPath of testFilePaths) {
      const fullPath = path.join(root, relPath);
      if (!fs.existsSync(fullPath)) continue;

      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const framework = TestDetector.detectFramework(content);
        const suites = TestDetector.extractSuites(content);
        const testCases = TestDetector.extractTestCases(content);
        const assertionsCount = (content.match(/\b(expect|assert)\s*\(/g) || []).length;

        results.push({
          file: relPath,
          framework,
          suites,
          testCases,
          assertionsCount,
        });
      } catch {
        results.push({
          file: relPath,
          framework: 'unknown',
          suites: [],
          testCases: [],
          assertionsCount: 0,
        });
      }
    }

    return results;
  }

  static detectFramework(content: string): string {
    if (content.includes("from 'vitest'") || content.includes('from "vitest"')) return 'vitest';
    if (content.includes("from '@jest/globals'") || content.includes('jest.')) return 'jest';
    if (content.includes("from 'mocha'")) return 'mocha';
    if (content.includes("from 'node:test'")) return 'node:test';
    return 'vitest';
  }

  static extractSuites(content: string): string[] {
    const suites: string[] = [];
    const regex = /\bdescribe\s*\(\s*['"`](.*?)['"`]/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      suites.push(match[1]);
    }
    return suites;
  }

  static extractTestCases(content: string): string[] {
    const tests: string[] = [];
    const regex = /\b(it|test)\s*\(\s*['"`](.*?)['"`]/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      tests.push(match[2]);
    }
    return tests;
  }
}
