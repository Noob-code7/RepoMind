# Braid AI Planning Engine

## Overview

The **Planning Engine** transforms raw PRD requirements and repository context into a strictly validated, repository-aware execution blueprint.

```text
PRD + Repository Context + Codebase Digest + Relevance Map
                          │
                          ▼
            [Duplication Detection Check]
                          │
                          ▼
            [Deep Reasoning Model Call]
                          │
                          ▼
         [JSON Extraction & Zod Validation]
                          │
                          ▼
       [Semantic Validation (DAG, Manifest, Traceability)]
                          │
                          ▼
                   PlanningResult
```

---

## Core Planning Responsibilities

1. **PRD Parsing (`planning/prd_parser.ts`)**:
   - Parses Markdown and freeform text PRDs.
   - Extracts structured requirements (`REQ-001`, `REQ-002`, etc.) with goals, constraints, acceptance criteria.
   - Identifies and flags vague or ambiguous requirement phrasing explicitly.

2. **Duplication & Reuse Enforcement (`planning/duplication_detector.ts`)**:
   - Scans repository context for existing utilities (validation, auth, database, logging).
   - If an existing utility exists, mandates `REUSE EXISTING MODULE` and `action: "modify"`.
   - Prevents generation of duplicate abstractions.

3. **Task Graph Generation (DAG)**:
   - Breaks requirements into fine-grained tasks (`id`, `title`, `type`, `dependencies`, `relatedFiles`, `acceptanceCriteria`, `risks`).
   - Strictly enforces acyclicity (zero circular dependencies).

4. **File Manifest (`ManifestEntry[]`)**:
   - Explicitly declares all files to be affected.
   - Strictly enforces `action`:
     - `"modify"` for files already in the repository.
     - `"create"` for genuinely new files.
     - `"delete"` or `"unchanged"`.
   - Includes `purpose`, `expectedExports`, `expectedSymbols`, `dependencies`, `tests`, `risk`, and `reasoning`.

5. **Test Specification Generation (`TestSpecification[]`)**:
   - Creates test specifications **before** any code is written.
   - Specifies target file, test type (`unit`, `integration`, `e2e`, `regression`, `smoke`), and concrete assertions.

6. **Requirement Traceability (`RequirementTrace[]`)**:
   - Directly links:
     `Requirement → Task(s) → File(s) → Test(s)`
   - Every requirement must have coverage.

7. **Semantic Validation (`planning/dag_validator.ts`)**:
   - Validates DAG acyclicity via Depth First Search.
   - Enforces unique task IDs and valid dependency references.
   - Validates manifest actions against disk state.
   - Automatically prompts model for self-repair if semantic violations occur.
