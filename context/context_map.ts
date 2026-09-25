/**
 * context/context_map.ts
 * Braid Context Map — 3-Layer Semantic Context Graph Generator & Persistence.
 * Connects:
 *   PRD → Requirements (Layer 1) → Code Context / Files / Symbols (Layer 2) →
 *   Dependencies / Tests / Change Impact (Layer 3).
 *
 * Implements the hybrid relevance engine, context gap detector, change impact analysis,
 * and repository change detection via SHA-256 hashing.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PrdParser } from '../planning/prd_parser.js';
import { LLMProvider } from '../providers/llm_provider.js';
import { ImpactAnalyzer } from './impact_analyzer.js';
import { buildRepositoryContext } from './mapper.js';
import {
  ContextEdge,
  ContextGap,
  ContextImpactAnalysis,
  ContextMap,
  ContextMapSchema,
  ContextNode,
  RepositoryContext,
  RequirementContext,
} from './schemas.js';

export interface GenerateContextMapOptions {
  root: string;
  prdContent?: string;
  prdPath?: string;
  focus?: string;
  impactTarget?: string;
  context?: RepositoryContext;
  planner?: LLMProvider;
}

export class ContextMapBuilder {
  /**
   * Build a complete 3-layer ContextMap for a repository and optional PRD.
   */
  public static async generate(
    options: GenerateContextMapOptions,
  ): Promise<ContextMap> {
    const root = path.resolve(options.root);

    // 1. Deterministic Repository Discovery
    const context =
      options.context || (await buildRepositoryContext({ root }));

    // 2. Ingest PRD (Layer 1: PRD Context)
    let prdText = options.prdContent || '';
    if (!prdText && options.prdPath) {
      const fullPrdPath = path.resolve(root, options.prdPath);
      if (fs.existsSync(fullPrdPath)) {
        prdText = fs.readFileSync(fullPrdPath, 'utf-8');
      }
    }

    const hasPrd = Boolean(prdText.trim());
    const requirements: RequirementContext[] = [];

    if (hasPrd) {
      const parsed = PrdParser.parse(prdText);
      for (const req of parsed.requirements) {
        requirements.push({
          id: req.id,
          title: req.title,
          description: req.description,
          type: req.type,
          acceptanceCriteria: req.acceptanceCriteria,
          technicalConstraints: parsed.constraints,
          userFlows: [],
          ambiguities: req.ambiguities,
        });
      }
    }

    const nodes: ContextNode[] = [];
    const edges: ContextEdge[] = [];
    const nodeMap = new Map<string, ContextNode>();
    const edgeSet = new Set<string>();

    const addNode = (node: ContextNode) => {
      if (!nodeMap.has(node.id)) {
        nodeMap.set(node.id, node);
        nodes.push(node);
      } else {
        // Merge relevance & confidence if higher
        const existing = nodeMap.get(node.id)!;
        existing.relevance = Math.max(existing.relevance, node.relevance);
        existing.confidence = Math.max(existing.confidence, node.confidence);
        if (node.reason && !existing.reason?.includes(node.reason)) {
          existing.reason = existing.reason
            ? `${existing.reason}; ${node.reason}`
            : node.reason;
        }
      }
    };

    const addEdge = (edge: ContextEdge) => {
      const key = `${edge.source}->${edge.target}:${edge.type}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        edges.push(edge);
      }
    };

    // 3. Register Layer 1 Requirement Nodes
    for (const req of requirements) {
      addNode({
        id: req.id,
        type: 'requirement',
        name: `${req.id}: ${req.title}`,
        relevance: 1.0,
        confidence: req.ambiguities.length > 0 ? 0.72 : 0.98,
        reason: `PRD requirement: ${req.description.slice(0, 140)}`,
      });
    }

    // 4. Layer 2: Code Context (Lexical + AST matching)
    const fileScoreMap = new Map<
      string,
      { file: string; score: number; matchedReqs: string[]; reasons: string[] }
    >();

    for (const f of context.files) {
      fileScoreMap.set(f.path, {
        file: f.path,
        score: 0,
        matchedReqs: [],
        reasons: [],
      });
    }

    // Match requirements against files and symbols
    if (requirements.length > 0) {
      for (const req of requirements) {
        const titleKeywords = extractKeywords(req.title);
        const descKeywords = extractKeywords(req.description);
        let matchFoundForReq = false;
        const matchingFilesForReq: string[] = [];

        for (const file of context.files) {
          if (file.type !== 'source') continue;

          let score = 0;
          const reasons: string[] = [];
          const lowerPath = file.path.toLowerCase();

          // Enforce domain title keyword match for requirement implementation
          const hasTitleDomainMatch =
            titleKeywords.size === 0 ||
            Array.from(titleKeywords).some(
              (kw) =>
                lowerPath.split(/[\/\\._-]/).some((part) => isKeywordMatch(part, kw)) ||
                file.exports.some((exp) => isKeywordMatch(exp, kw)) ||
                file.symbols.some((sym) => isKeywordMatch(sym, kw)),
            );

          if (!hasTitleDomainMatch) {
            continue;
          }

          // High-weight domain title keyword matches
          for (const kw of titleKeywords) {
            const pathParts = lowerPath.split(/[\/\\._-]/);
            if (pathParts.some((part) => isKeywordMatch(part, kw))) {
              score += 5;
              reasons.push(`Path matches requirement domain "${kw}"`);
            }
            for (const exp of file.exports) {
              if (isKeywordMatch(exp, kw)) {
                score += 6;
                reasons.push(`Export "${exp}" matches domain "${kw}"`);
              }
            }
            for (const sym of file.symbols) {
              if (isKeywordMatch(sym, kw)) {
                score += 4;
                reasons.push(`Symbol "${sym}" matches domain "${kw}"`);
              }
            }
          }

          // Lower-weight secondary description keyword matches
          for (const kw of descKeywords) {
            if (titleKeywords.has(kw)) continue;
            if (lowerPath.includes(kw)) {
              score += 1;
            }
            for (const exp of file.exports) {
              if (exp.toLowerCase().includes(kw)) {
                score += 2;
                reasons.push(`Export "${exp}" matches "${kw}"`);
              }
            }
            for (const sym of file.symbols) {
              if (sym.toLowerCase().includes(kw)) {
                score += 1;
              }
            }
          }

          if (score >= 4) {
            matchFoundForReq = true;
            matchingFilesForReq.push(file.path);

            const entry = fileScoreMap.get(file.path)!;
            entry.score += score;
            entry.matchedReqs.push(req.id);
            entry.reasons.push(...reasons);

            const confidence = Math.min(0.98, Math.max(0.4, score / 10));
            const relevance = Math.min(1.0, score / 8);

            const fileNodeId = `file:${file.path}`;
            addNode({
              id: fileNodeId,
              type: 'file',
              name: path.basename(file.path),
              path: file.path,
              relevance,
              confidence,
              reason: `Exports ${file.exports.slice(0, 3).join(', ') || 'symbols'} relevant to ${req.id} (${reasons.slice(0, 2).join('; ')})`,
            });

            addEdge({
              source: req.id,
              target: fileNodeId,
              type: 'implements',
              confidence,
            });

            // Map top matching symbols inside this file
            const fileSymbols = context.symbols.filter(
              (s) => s.file === file.path,
            );
            for (const sym of fileSymbols) {
              let symMatches = false;
              for (const kw of [...titleKeywords, ...descKeywords]) {
                if (isKeywordMatch(sym.name, kw)) {
                  symMatches = true;
                  break;
                }
              }

              if (symMatches || (file.exports.includes(sym.name) && score >= 4)) {
                const symNodeId = `symbol:${file.path}#${sym.name}`;
                addNode({
                  id: symNodeId,
                  type: 'symbol',
                  name: sym.name,
                  path: file.path,
                  symbol: sym.name,
                  relevance: Math.min(1.0, relevance + 0.1),
                  confidence: 0.95,
                  reason: `${sym.kind} "${sym.name}" implementing ${req.id}`,
                });

                addEdge({
                  source: fileNodeId,
                  target: symNodeId,
                  type: 'exports',
                  confidence: 1.0,
                });

                addEdge({
                  source: req.id,
                  target: symNodeId,
                  type: 'implements',
                  confidence: 0.92,
                });
              }
            }
          }
        }
      }
    } else {
      // Repository-wide context map (no PRD supplied)
      for (const file of context.files) {
        if (file.type === 'test') continue;
        const relevance =
          file.importance === 'critical'
            ? 1.0
            : file.importance === 'high'
            ? 0.8
            : 0.5;

        const fileNodeId = `file:${file.path}`;
        addNode({
          id: fileNodeId,
          type: 'file',
          name: path.basename(file.path),
          path: file.path,
          relevance,
          confidence: 0.9,
          reason: `Repository file (${file.importance} importance)`,
        });

        // Add top symbols
        for (const exp of file.exports.slice(0, 4)) {
          const symNodeId = `symbol:${file.path}#${exp}`;
          addNode({
            id: symNodeId,
            type: 'symbol',
            name: exp,
            path: file.path,
            symbol: exp,
            relevance: relevance * 0.9,
            confidence: 0.9,
            reason: `Exported symbol in ${file.path}`,
          });

          addEdge({
            source: fileNodeId,
            target: symNodeId,
            type: 'exports',
            confidence: 1.0,
          });
        }
      }
    }

    // 5. Layer 3: Dependency Context & Expansion
    const relevantFilePaths = new Set(
      nodes.filter((n) => n.type === 'file' && n.path).map((n) => n.path!),
    );

    // Expand to direct dependencies & dependents
    for (const dep of context.dependencies) {
      if (relevantFilePaths.has(dep.source)) {
        // Target is imported by a relevant file
        const targetFile = context.files.find(
          (f) => f.path === dep.target || f.path.endsWith(dep.target),
        );
        if (targetFile) {
          const depNodeId = `file:${targetFile.path}`;
          addNode({
            id: depNodeId,
            type: 'dependency',
            name: path.basename(targetFile.path),
            path: targetFile.path,
            relevance: 0.65,
            confidence: 0.95,
            reason: `Shared dependency required by ${dep.source}`,
          });

          addEdge({
            source: `file:${dep.source}`,
            target: depNodeId,
            type: 'depends_on',
            confidence: 1.0,
          });
        }
      }
    }

    // 6. Test Discovery & Mapping
    const affectedTestsList = new Set<string>();

    for (const test of context.tests) {
      const testStem = path
        .basename(test.file)
        .replace(/\.(test|spec)\.(ts|js|tsx|jsx)$/, '')
        .toLowerCase();

      for (const relPath of relevantFilePaths) {
        const fileStem = path
          .basename(relPath)
          .replace(/\.(ts|js|tsx|jsx)$/, '')
          .toLowerCase();

        const isMatch =
          testStem === fileStem ||
          fileStem.startsWith(testStem) ||
          testStem.startsWith(fileStem) ||
          test.file.toLowerCase().includes(fileStem) ||
          context.dependencies.some(
            (d) => d.source === test.file && d.target === relPath,
          );

        if (isMatch) {
          affectedTestsList.add(test.file);
          const testNodeId = `test:${test.file}`;
          addNode({
            id: testNodeId,
            type: 'test',
            name: path.basename(test.file),
            path: test.file,
            relevance: 0.85,
            confidence: 0.95,
            reason: `Unit/regression test suite verifying ${relPath}`,
          });

          addEdge({
            source: `file:${relPath}`,
            target: testNodeId,
            type: 'tested_by',
            confidence: 0.95,
          });
        }
      }
    }

    // 7. Context Gaps Detection
    const gaps: ContextGap[] = [];

    if (requirements.length > 0) {
      for (const req of requirements) {
        // Gap: Requirement has no matching implementation file
        const matchingFileEdges = edges.filter(
          (e) =>
            e.source === req.id &&
            e.type === 'implements' &&
            e.target.startsWith('file:'),
        );
        if (matchingFileEdges.length === 0) {
          gaps.push({
            type: 'missing_implementation',
            description: `Requirement ${req.id} ("${req.title}") has no obvious implementation file in repository.`,
            affectedArea: req.title,
            severity: 'high',
            confidence: 0.31,
          });
        } else if (matchingFileEdges.length > 4) {
          // Gap: Multiple disparate files appear responsible for same requirement
          gaps.push({
            type: 'conflicting_responsibilities',
            description: `Requirement ${req.id} maps to ${matchingFileEdges.length} different files without clear primary ownership.`,
            affectedArea: req.id,
            severity: 'medium',
            confidence: 0.58,
          });
        }
      }
    }

    // Gap: Relevant functionality exists but has no tests
    for (const relPath of relevantFilePaths) {
      const hasTest = Array.from(affectedTestsList).some((t) => {
        const fStem = path.basename(relPath).replace(/\.(ts|js|tsx|jsx)$/, '');
        return t.includes(fStem);
      });

      if (!hasTest) {
        gaps.push({
          type: 'untested_functionality',
          description: `Relevant module "${relPath}" lacks dedicated unit or integration tests.`,
          affectedArea: relPath,
          severity: 'medium',
          confidence: 0.82,
        });
      }
    }

    // Gap: Unresolved external dependencies
    const unresolvable = context.dependencies.filter(
      (d) =>
        !d.isExternal &&
        d.target.startsWith('.') &&
        !context.files.some((f) => f.path === d.target),
    );
    if (unresolvable.length > 2) {
      gaps.push({
        type: 'unknown_dependency',
        description: `Found ${unresolvable.length} unresolved relative dependencies in repository.`,
        affectedArea: 'dependencies',
        severity: 'low',
        confidence: 0.65,
      });
    }

    // 8. Change Impact Analysis (if target specified via --impact)
    let impact: ContextImpactAnalysis | undefined;
    if (options.impactTarget) {
      impact = ImpactAnalyzer.analyze({
        target: options.impactTarget,
        context,
        nodes,
        edges,
      });
    }

    // 9. Focus Filtering (if --focus requested)
    let finalNodes = nodes;
    let finalEdges = edges;

    if (options.focus) {
      const focusTerm = options.focus.toLowerCase();
      const matchedNodeIds = new Set<string>();

      for (const node of nodes) {
        if (
          node.name.toLowerCase().includes(focusTerm) ||
          node.path?.toLowerCase().includes(focusTerm) ||
          node.symbol?.toLowerCase().includes(focusTerm) ||
          node.reason?.toLowerCase().includes(focusTerm)
        ) {
          matchedNodeIds.add(node.id);
        }
      }

      // Include 1-hop connected neighbors
      for (const edge of edges) {
        if (matchedNodeIds.has(edge.source)) matchedNodeIds.add(edge.target);
        if (matchedNodeIds.has(edge.target)) matchedNodeIds.add(edge.source);
      }

      finalNodes = nodes.filter((n) => matchedNodeIds.has(n.id));
      finalEdges = edges.filter(
        (e) => matchedNodeIds.has(e.source) && matchedNodeIds.has(e.target),
      );
    }

    // 10. Compute Overall Context Confidence Score
    let confidence = 0.94;
    if (requirements.length === 0) {
      confidence = 0.92;
    } else {
      const criticalGaps = gaps.filter((g) => g.severity === 'critical');
      const highGaps = gaps.filter((g) => g.severity === 'high');
      const medGaps = gaps.filter((g) => g.severity === 'medium');

      confidence -= criticalGaps.length * 0.25;
      confidence -= highGaps.length * 0.12;
      confidence -= medGaps.length * 0.04;
      confidence = Math.max(0.2, Math.min(0.99, Number(confidence.toFixed(2))));
    }

    // 11. Deterministic Hashes
    const repositoryHash = computeRepositoryHash(context);
    const contextHash = computeContextHash(finalNodes, finalEdges, requirements);

    const relevantFiles = Array.from(
      new Set(
        finalNodes
          .filter((n) => (n.type === 'file' || n.type === 'dependency') && n.path)
          .map((n) => n.path!),
      ),
    );

    const affectedTests = Array.from(affectedTestsList);

    const contextMap: ContextMap = {
      repository: context,
      requirements,
      nodes: finalNodes,
      edges: finalEdges,
      relevantFiles,
      affectedTests,
      contextGaps: gaps,
      impact,
      confidence,
      repositoryHash,
      contextHash,
      generatedAt: new Date().toISOString(),
    };

    return ContextMapSchema.parse(contextMap);
  }

  /**
   * Save ContextMap to `.braid/context.json`.
   */
  public static save(projectRoot: string, contextMap: ContextMap): string {
    const braidDir = path.join(projectRoot, '.braid');
    if (!fs.existsSync(braidDir)) {
      fs.mkdirSync(braidDir, { recursive: true });
    }
    const filePath = path.join(braidDir, 'context.json');
    fs.writeFileSync(filePath, JSON.stringify(contextMap, null, 2), 'utf-8');
    return filePath;
  }

  /**
   * Load ContextMap from `.braid/context.json` and detect repository changes.
   */
  public static load(
    projectRoot: string,
    currentContext?: RepositoryContext,
  ): {
    map: ContextMap;
    repositoryChanged: boolean;
    warning?: string;
  } | null {
    const filePath = path.join(projectRoot, '.braid', 'context.json');
    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      const parsed = ContextMapSchema.safeParse(raw);
      if (!parsed.success) {
        return null;
      }

      const map = parsed.data;
      let repositoryChanged = false;
      let warning: string | undefined;

      if (currentContext) {
        const currentHash = computeRepositoryHash(currentContext);
        if (map.repositoryHash && currentHash !== map.repositoryHash) {
          repositoryChanged = true;
          warning = 'Repository changed since Context Map was generated.';
        }
      }

      return { map, repositoryChanged, warning };
    } catch {
      return null;
    }
  }
}

/**
 * Deterministic hash of repository files.
 */
export function computeRepositoryHash(context: RepositoryContext): string {
  const sortedFiles = [...context.files]
    .map((f) => `${f.path}:${f.size || 0}:${f.exports.join(',')}`)
    .sort()
    .join('|');
  return crypto.createHash('sha256').update(sortedFiles).digest('hex');
}

/**
 * Deterministic hash of context map nodes and edges.
 */
export function computeContextHash(
  nodes: ContextNode[],
  edges: ContextEdge[],
  requirements: RequirementContext[],
): string {
  const nodeStr = [...nodes]
    .map((n) => `${n.id}:${n.type}:${n.relevance}`)
    .sort()
    .join('|');
  const edgeStr = [...edges]
    .map((e) => `${e.source}->${e.target}:${e.type}`)
    .sort()
    .join('|');
  const reqStr = [...requirements]
    .map((r) => `${r.id}:${r.title}`)
    .sort()
    .join('|');

  return crypto
    .createHash('sha256')
    .update(`${nodeStr}||${edgeStr}||${reqStr}`)
    .digest('hex');
}

function extractKeywords(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);

  const stopWords = new Set([
    'this',
    'that',
    'with',
    'from',
    'have',
    'must',
    'should',
    'will',
    'when',
    'what',
    'which',
    'where',
    'there',
    'their',
    'create',
    'update',
    'user',
    'users',
    'code',
    'file',
    'build',
    'make',
    'into',
    'each',
    'every',
    'also',
    'only',
    'able',
    'req',
    'requirement',
    'requirements',
    'system',
    'platform',
    'step',
    'spec',
    'rule',
  ]);

  const result = new Set<string>();
  for (const w of words) {
    if (!stopWords.has(w) && !/^req-?\d*$/i.test(w) && !/^\d+$/.test(w)) {
      result.add(w);
    }
  }
  return result;
}

function isKeywordMatch(target: string, query: string): boolean {
  const t = target.toLowerCase();
  const q = query.toLowerCase();
  if (t === q) return true;
  // If target contains full query keyword (e.g. target="taskservice", query="task")
  if (q.length >= 3 && t.includes(q)) return true;
  // If query starts with target stem (e.g. target="auth", query="authentication")
  if (t.length >= 4 && q.length >= 4 && q.startsWith(t)) return true;
  return false;
}

