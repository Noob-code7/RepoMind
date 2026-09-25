# Braid Context Mapping Engine

## Overview

The **Context Mapping Engine** is Braid's repository intelligence layer. It analyzes the existing codebase deterministically before planning starts, ensuring Braid never blindly generates generic code or duplicates existing utilities.

```text
Repository
    ↓
File discovery (Scanner)
    ↓
Language & framework detection
    ↓
AST Symbol Extraction (TypeScript Compiler API)
    ↓
Import & dependency graph resolution
    ↓
Test suite & assertion detection
    ↓
Read-only Git state analysis
    ↓
Repository Context Object
    ↓
Relevance Ranking & Context Gap Analysis
    ↓
Relevant Context Map + Codebase Digest
```

---

## Key Modules

### 1. Repository Scanner (`context/scanner.ts`)
- Discovers files while respecting standard ignore lists (`node_modules`, `.git`, `dist`, `.cache`).
- Categorizes files: `source`, `test`, `config`, `documentation`, `asset`, `unknown`.
- Detects languages (`TypeScript`, `JavaScript`, etc.) and frameworks (`React`, `Express`, `Vite`, etc.).
- Evaluates architectural importance: `critical`, `high`, `medium`, `low`.

### 2. AST Static Analyzer (`context/ast_analyzer.ts`)
- Uses the native TypeScript Compiler API (`ts.createSourceFile`) for 100% accurate, compiler-grade AST traversal.
- Extracts exported and internal:
  - Functions & Arrow Functions (with signatures and leading docstrings)
  - Classes & Services (with methods and constructors)
  - Interfaces & Type Aliases
  - Express & API Routes (e.g. `app.get('/login')`, `router.post('/register')`)
  - Direct and named imports/exports

### 3. Dependency Graph Builder (`context/dependency_graph.ts`)
- Resolves relative module specifiers (`./service.js`, `../utils/validation`) to real repository file paths.
- Distinguishes internal inter-file dependencies from external npm packages.
- Produces explicit `DependencyEdge[]` records (`source`, `target`, `specifier`, `isExternal`).

### 4. Test Detector (`context/test_detector.ts`)
- Scans `*.test.ts`, `*.spec.ts`, and test directories.
- Detects frameworks (`vitest`, `jest`, `mocha`, `node:test`).
- Extracts test suites (`describe`), test cases (`it`, `test`), and counts assertions (`expect`, `assert`).

### 5. Git Analyzer (`context/git_analyzer.ts`)
- Read-only Git state analysis.
- Inspects current branch, modified files, untracked files, and recent commit messages.
- Never commits or modifies git state.

### 6. Relevance Engine & Gap Detection (`context/relevance.ts`)
- Evaluates PRD requirements against repository symbols and paths.
- Classifies files into:
  - `HIGH RELEVANCE`: Direct matches to PRD domain models and endpoints.
  - `MEDIUM RELEVANCE`: Direct dependencies and shared utilities.
  - `TEST RELEVANCE`: Existing tests covering relevant modules.
  - `LOW / UNRELATED`: Orthogonal files left out of model context.
- **Context Gap Detection**: Detects missing test context, absent configurations, or unknown dependencies.
- Assigns categorical confidence: `'high'`, `'medium'`, or `'low'`.

### 7. Codebase Digest (`context/digest.ts`)
- Formats a compact, highly dense summary of the codebase (stack, architecture, important file signatures) for LLM context injection without context bloat.
