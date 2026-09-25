/**
 * context/renderer.ts
 * Terminal visualization for Braid Context Map.
 * Adheres strictly to the Braid design aesthetic:
 * Charcoal, ivory, subtle warm peach, sage, rust.
 * Renders hierarchical PRD → Requirements → Files → Symbols → Dependencies → Tests → Impact.
 */
import path from 'node:path';
import {
  ANSI_BOLD,
  ANSI_FAINT,
  ANSI_IVORY,
  ANSI_MUTED,
  ANSI_PEACH,
  ANSI_RESET,
  ANSI_RUST,
  ANSI_SAGE,
} from '../brand/cli_mark.js';
import { ContextMap } from './schemas.js';

export function renderContextMap(contextMap: ContextMap): string {
  const lines: string[] = [];

  const totalFiles = contextMap.repository.files.length;
  const relevantCount = contextMap.relevantFiles.length;
  const symbolsCount = contextMap.nodes.filter((n) => n.type === 'symbol').length;
  const depsCount = contextMap.edges.filter((e) => e.type === 'depends_on' || e.type === 'imports').length;
  const testsCount = contextMap.affectedTests.length;
  const confidencePct = Math.round(contextMap.confidence * 100);

  // Confidence color
  const confColor =
    confidencePct >= 85 ? ANSI_SAGE : confidencePct >= 65 ? ANSI_PEACH : ANSI_RUST;

  // Header stats
  lines.push('');
  lines.push(`  ${ANSI_SAGE}✓${ANSI_RESET} ${ANSI_IVORY}${totalFiles} files scanned${ANSI_RESET}`);
  lines.push(`  ${ANSI_SAGE}✓${ANSI_RESET} ${ANSI_IVORY}${relevantCount} files relevant${ANSI_RESET}`);
  lines.push(`  ${ANSI_SAGE}✓${ANSI_RESET} ${ANSI_IVORY}${symbolsCount} symbols mapped${ANSI_RESET}`);
  lines.push(`  ${ANSI_SAGE}✓${ANSI_RESET} ${ANSI_IVORY}${depsCount} dependencies resolved${ANSI_RESET}`);
  lines.push(`  ${ANSI_SAGE}✓${ANSI_RESET} ${ANSI_IVORY}${testsCount} tests discovered${ANSI_RESET}`);
  lines.push('');
  lines.push(`  ${ANSI_MUTED}Context confidence:${ANSI_RESET} ${confColor}${confidencePct}%${ANSI_RESET}`);
  lines.push('');

  // Group by Feature / Requirement
  lines.push(`  ${ANSI_BOLD}${ANSI_IVORY}PRD → Context${ANSI_RESET}`);
  lines.push('');

  const reqNodes = contextMap.nodes.filter((n) => n.type === 'requirement');

  if (reqNodes.length > 0) {
    for (const req of reqNodes) {
      lines.push(`  ${ANSI_PEACH}${req.name}${ANSI_RESET}`);

      // Find files implementing this requirement
      const fileEdges = contextMap.edges.filter(
        (e) => e.source === req.id && (e.type === 'implements' || e.type === 'related_to'),
      );
      const targetFileNodeIds = Array.from(new Set(fileEdges.map((e) => e.target)));
      const fileNodes = targetFileNodeIds
        .map((id) => contextMap.nodes.find((n) => n.id === id))
        .filter((n): n is NonNullable<typeof n> => Boolean(n && (n.type === 'file' || n.type === 'test')));

      // Find tests covering these files
      const testNodes = contextMap.nodes.filter(
        (n) =>
          n.type === 'test' &&
          fileNodes.some((fn) =>
            contextMap.edges.some(
              (e) => e.source === fn.id && e.target === n.id && e.type === 'tested_by',
            ),
          ),
      );
      const allDisplayNodes = [...fileNodes, ...testNodes];

      if (allDisplayNodes.length === 0) {
        lines.push(`    ${ANSI_FAINT}└── (no direct implementation file found)${ANSI_RESET}`);
      } else {
        allDisplayNodes.forEach((fn, fIdx) => {
          const isLastFile = fIdx === allDisplayNodes.length - 1;
          const branch = isLastFile ? '└──' : '├──';
          const pipe = isLastFile ? '   ' : '│  ';

          // Find symbols exported by this file that are linked to this req
          const symNodes = fn.type === 'test'
            ? []
            : contextMap.nodes.filter((n) => n.type === 'symbol' && n.path === fn.path);

          lines.push(`    ${ANSI_FAINT}${branch}${ANSI_RESET} ${ANSI_IVORY}${fn.path || fn.name}${ANSI_RESET}`);

          if (symNodes.length > 0) {
            symNodes.slice(0, 3).forEach((sn, sIdx) => {
              const isLastSym = sIdx === Math.min(symNodes.length, 3) - 1;
              const symBranch = isLastSym ? '└──' : '├──';
              const isFunc = /^[a-z]/.test(sn.name);
              const symLabel = isFunc ? `${sn.name}()` : sn.name;
              lines.push(`    ${ANSI_FAINT}${pipe} ${symBranch}${ANSI_RESET} ${ANSI_MUTED}${symLabel}${ANSI_RESET}`);
            });
          }
        });
      }
      lines.push('');
    }
  } else {
    // Repository-wide view: Group by top-level module directories
    const moduleMap = new Map<string, Array<{ path: string; name: string }>>();
    for (const f of contextMap.relevantFiles) {
      const dir = path.dirname(f);
      const mod = dir === '.' ? 'Root' : dir.replace(/\\/g, '/');
      const list = moduleMap.get(mod) || [];
      list.push({ path: f, name: path.basename(f) });
      moduleMap.set(mod, list);
    }

    for (const [mod, files] of moduleMap.entries()) {
      lines.push(`  ${ANSI_PEACH}${mod}${ANSI_RESET}`);
      files.forEach((f, idx) => {
        const isLast = idx === files.length - 1;
        const branch = isLast ? '└──' : '├──';
        lines.push(`    ${ANSI_FAINT}${branch}${ANSI_RESET} ${ANSI_IVORY}${f.path}${ANSI_RESET}`);
      });
      lines.push('');
    }
  }

  // Shared Dependencies Section
  const sharedDepNodes = contextMap.nodes.filter((n) => n.type === 'dependency');
  if (sharedDepNodes.length > 0) {
    lines.push(`  ${ANSI_BOLD}${ANSI_IVORY}Shared Dependencies${ANSI_RESET}`);
    sharedDepNodes.slice(0, 5).forEach((dep, idx) => {
      const isLast = idx === Math.min(sharedDepNodes.length, 5) - 1;
      const branch = isLast ? '└──' : '├──';
      lines.push(`    ${ANSI_FAINT}${branch}${ANSI_RESET} ${ANSI_MUTED}${dep.path || dep.name}${ANSI_RESET}`);
    });
    lines.push('');
  }

  // Context Gaps Section (if any detected)
  if (contextMap.contextGaps.length > 0) {
    lines.push(`  ${ANSI_BOLD}${ANSI_RUST}Context Gaps Detected${ANSI_RESET}`);
    for (const gap of contextMap.contextGaps) {
      const badge =
        gap.severity === 'high' || gap.severity === 'critical'
          ? `${ANSI_RUST}! [${gap.type}]${ANSI_RESET}`
          : `${ANSI_PEACH}▲ [${gap.type}]${ANSI_RESET}`;
      lines.push(`    ${badge} ${ANSI_IVORY}${gap.description}${ANSI_RESET}`);
      if (gap.confidence !== undefined) {
        lines.push(`      ${ANSI_FAINT}Confidence: ${Math.round(gap.confidence * 100)}%${ANSI_RESET}`);
      }
    }
    lines.push('');
  }

  // Impact Section (if present)
  if (contextMap.impact) {
    const impact = contextMap.impact;
    const riskColor =
      impact.riskLevel === 'high' ? ANSI_RUST : impact.riskLevel === 'medium' ? ANSI_PEACH : ANSI_SAGE;

    lines.push(`  ${ANSI_BOLD}${ANSI_IVORY}Change Impact Analysis${ANSI_RESET} ${ANSI_MUTED}(Target: ${impact.target})${ANSI_RESET}`);
    lines.push(`  ${ANSI_MUTED}Potential impact:${ANSI_RESET} ${riskColor}${impact.riskLevel.toUpperCase()}${ANSI_RESET}`);
    lines.push('');

    const allAffected = [
      ...impact.directlyAffectedFiles.map((f) => ({ path: f, type: 'directly affected' })),
      ...impact.indirectlyAffectedFiles.map((f) => ({ path: f, type: 'indirectly affected' })),
      ...impact.affectedTests.map((t) => ({ path: t, type: 'test verification' })),
    ];

    lines.push(`  ${ANSI_IVORY}Affected (${allAffected.length} files):${ANSI_RESET}`);
    for (const item of allAffected.slice(0, 8)) {
      lines.push(`    ${ANSI_PEACH}→${ANSI_RESET} ${ANSI_IVORY}${item.path}${ANSI_RESET} ${ANSI_FAINT}(${item.type})${ANSI_RESET}`);
    }

    if (impact.explanations.length > 0) {
      lines.push('');
      lines.push(`  ${ANSI_MUTED}Impact Rationale:${ANSI_RESET}`);
      for (const exp of impact.explanations.slice(0, 4)) {
        lines.push(`    ${ANSI_FAINT}•${ANSI_RESET} ${ANSI_IVORY}${path.basename(exp.item)}:${ANSI_RESET} ${ANSI_MUTED}${exp.reason}${ANSI_RESET}`);
      }
    }
    lines.push('');
  } else {
    // Show summary of potentially affected files
    const affectedCount = contextMap.relevantFiles.length + contextMap.affectedTests.length;
    lines.push(`  ${ANSI_MUTED}Potentially affected:${ANSI_RESET}`);
    lines.push(`    ${ANSI_IVORY}${affectedCount} files${ANSI_RESET}`);
    lines.push('');
  }

  return lines.join('\n');
}
