# Braid Schema Reference

All data structures in Braid are strictly defined and validated using **Zod**. Model outputs are never parsed loosely.

---

## 1. Context Schemas (`context/schemas.ts`)

- `RepositoryContext`:
  - `repository`: Name, root, languages, frameworks, package manager, test framework.
  - `files`: Array of `FileContext` (path, type, size, exports, imports, symbols, importance, relatedFiles).
  - `symbols`: Array of `SymbolContext` (name, kind, file, exported, signature, docstring).
  - `dependencies`: Array of `DependencyEdge` (source, target, specifier, isExternal).
  - `tests`: Array of `TestContext` (file, framework, suites, testCases, assertionsCount).
  - `entryPoints`: Identified application entry points.
  - `architecture`: Pattern, layers, data flow summary.
  - `conventions`: Coding and naming conventions.
  - `git`: Branch, isClean, modifiedFiles, untrackedFiles, recentCommits.

- `RelevantContext`:
  - `assessment`: Confidence (`high` | `medium` | `low`), relevantFiles, ignoredFiles, gaps (`ContextGap[]`), reasoning.
  - `relevantFiles`: Filtered `FileContext[]`.
  - `digest`: Condensed codebase string.

---

## 2. Planning Schemas (`planning/schemas.ts`)

- `PlanningResult`:
  - `schemaVersion`: Schema version (e.g. `'1.0.0'`).
  - `runId`: Unique execution identifier.
  - `project`: ProjectSummary.
  - `requirements`: `Requirement[]` (`id`, `title`, `description`, `type`, `acceptanceCriteria`, `ambiguities`).
  - `context`: `ContextAssessment`.
  - `architecture`: `ArchitecturePlan`.
  - `tasks`: `Task[]` (`id`, `title`, `type`, `dependencies`, `priority`, `relatedFiles`, `acceptanceCriteria`, `risks`).
  - `manifest`: `ManifestEntry[]` (`path`, `action: 'create'|'modify'|'delete'|'unchanged'`, `purpose`, `relatedTasks`, `expectedExports`, `expectedSymbols`, `dependencies`, `tests`, `risk`, `reasoning`).
  - `tests`: `TestSpecification[]` (`id`, `target`, `type`, `description`, `assertions`, `relatedRequirements`, `relatedFiles`).
  - `traceability`: `RequirementTrace[]` (`requirementId`, `tasks`, `files`, `tests`).
  - `risks`: `PlanRisk[]`.
  - `assumptions`: Array of strings.
  - `unresolvedQuestions`: Array of strings.

---

## 3. Review Schemas (`review/schemas.ts`)

- `ReviewResult`:
  - `runId`: Execution ID.
  - `status`: `'approved'` | `'needs_revision'` | `'blocked'`.
  - `summary`: High-level summary of review.
  - `findings`: `ReviewFinding[]` (`id`, `severity`, `category`, `title`, `explanation`, `affectedTasks`, `affectedFiles`, `recommendation`).
  - `missingRequirements`: Array of unmapped requirements.
  - `missingFiles`: Array of omitted files.
  - `unnecessaryFiles`: Array of superfluous files.
  - `riskLevel`: `'low'` | `'medium'` | `'high'` | `'critical'`.
  - `revisionInstructions`: Actionable instructions for re-planning.

- `PlanningReviewPackage`:
  - `plan`: Validated `PlanningResult`.
  - `review`: Validated `ReviewResult`.
  - `status`: `'ready_for_approval'` | `'needs_revision'` | `'blocked'`.
