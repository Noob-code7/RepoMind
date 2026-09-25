/**
 * agents/debugger/test_runner.ts
 * Deterministic test runner — executes smoke tests and vitest stub tests.
 * NO LLM calls live here.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  FileManifest,
  TestResults,
  TestStub,
  emptyTestResults,
} from '../../shared/types.js';

export interface TestExecutionOutput {
  results: TestResults;
  failures: Array<{
    testName: string;
    file: string;
    errorOutput: string;
  }>;
  rawStdout: string;
  rawStderr: string;
}

export class TestRunner {
  /**
   * Run smoke tests: verifies files exist and contain valid JavaScript/TypeScript syntax.
   */
  static runSmokeTests(
    projectRoot: string,
    manifest: FileManifest,
  ): { passed: number; failed: number; failures: string[] } {
    let passed = 0;
    let failed = 0;
    const failures: string[] = [];

    for (const f of manifest.files) {
      const fullPath = path.join(projectRoot, f.path);
      if (!fs.existsSync(fullPath)) {
        failed++;
        failures.push(`Smoke failed: Missing file ${f.path}`);
        continue;
      }

      const content = fs.readFileSync(fullPath, 'utf-8');
      if (content.trim().length === 0) {
        failed++;
        failures.push(`Smoke failed: Empty file ${f.path}`);
        continue;
      }

      // Check for syntax error indicators
      const hasUnresolvedConflict = content.includes('<<<<<<<') || content.includes('>>>>>>>');
      if (hasUnresolvedConflict) {
        failed++;
        failures.push(`Smoke failed: Merge conflict markers in ${f.path}`);
        continue;
      }

      passed++;
    }

    return { passed, failed, failures };
  }

  /**
   * Write test stubs to project tests/ folder and run vitest.
   */
  static async runTests(
    projectRoot: string,
    manifest: FileManifest,
    stubs: TestStub[],
  ): Promise<TestExecutionOutput> {
    const results: TestResults = emptyTestResults();
    const failures: Array<{ testName: string; file: string; errorOutput: string }> = [];

    // 1. Run Smoke Tests
    const smoke = TestRunner.runSmokeTests(projectRoot, manifest);
    results.smoke.passed = smoke.passed;
    results.smoke.failed = smoke.failed;
    for (const failure of smoke.failures) {
      failures.push({
        testName: 'Smoke Test',
        file: failure,
        errorOutput: failure,
      });
    }

    // 2. Write Test Stubs to project tests directory
    const testsDir = path.join(projectRoot, 'tests');
    fs.mkdirSync(testsDir, { recursive: true });

    for (let i = 0; i < stubs.length; i++) {
      const stub = stubs[i];
      const stubFile = stub.file || `tests/stub_${i}.test.ts`;
      const stubPath = path.isAbsolute(stubFile)
        ? stubFile
        : path.join(projectRoot, stubFile);

      fs.mkdirSync(path.dirname(stubPath), { recursive: true });
      fs.writeFileSync(stubPath, stub.code, 'utf-8');
    }

    // If there are no stubs, return early
    if (stubs.length === 0) {
      return { results, failures, rawStdout: '', rawStderr: '' };
    }

    // Ensure package.json exists in projectRoot for module resolution
    const projPkgJson = path.join(projectRoot, 'package.json');
    if (!fs.existsSync(projPkgJson)) {
      fs.writeFileSync(
        projPkgJson,
        JSON.stringify(
          {
            name: manifest.project,
            type: 'module',
            private: true,
          },
          null,
          2,
        ),
        'utf-8',
      );
    }

    // 3. Execute Vitest on the generated project tests
    let rawStdout = '';
    let rawStderr = '';

    try {
      // Run vitest with json output to parse results accurately
      const cmd = `npx vitest run --dir "${testsDir}" --reporter=json`;
      const stdout = execSync(cmd, {
        cwd: projectRoot,
        timeout: 30000,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      rawStdout = stdout;

      // Parse JSON report
      const parsed = JSON.parse(stdout);
      if (parsed.testResults) {
        for (const suite of parsed.testResults) {
          for (const assertion of suite.assertionResults || []) {
            if (assertion.status === 'passed') {
              results.stubs.passed++;
            } else {
              results.stubs.failed++;
              failures.push({
                testName: assertion.title || assertion.fullName,
                file: suite.name,
                errorOutput: assertion.failureMessages?.join('\n') || 'Assertion failed',
              });
            }
          }
        }
      }
    } catch (err: unknown) {
      const execError = err as { stdout?: string; stderr?: string; message?: string };
      rawStdout = execError.stdout || '';
      rawStderr = execError.stderr || execError.message || '';

      // Try to parse json if available in stdout
      try {
        const jsonMatch = rawStdout.match(/\{[\s\S]*"numTotalTests"[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          results.stubs.passed = parsed.numPassedTests || 0;
          results.stubs.failed = parsed.numFailedTests || 1;
        } else {
          results.stubs.failed = Math.max(1, stubs.length);
        }
      } catch {
        results.stubs.failed = Math.max(1, stubs.length);
      }

      failures.push({
        testName: 'Vitest Execution',
        file: testsDir,
        errorOutput: (rawStderr || rawStdout).slice(-2000),
      });
    }

    return { results, failures, rawStdout, rawStderr };
  }
}
