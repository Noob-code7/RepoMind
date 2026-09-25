# Braid Independent Plan Review Engine & Revision Loop

## Overview

The **Review Engine** is architecturally independent of the Planning Engine. It acts as an adversarial Senior Software Architect whose mission is to challenge the proposed build plan, detect edge cases, uncover missing regression tests, and enforce risk governance.

```text
PlanningResult + PRD + Repository Context
                     │
                     ▼
       [Independent Reviewer Model]
                     │
                     ▼
            [Zod Schema Validation]
                     │
                     ▼
                ReviewResult
          (Findings & Risk Level)
                     │
          ┌──────────┴──────────┐
          ↓                     ↓
     "approved"          "needs_revision"
          │                     │
          ▼                     ▼
    Ready for Gate       [Revision Loop]
                                │
                                ▼
                             Plan v2
                                │
                                ▼
                         [Re-Review Plan]
```

---

## Systematic Review Checks

The Reviewer performs 11 structured checks:
1. **Requirement Coverage**: Are all PRD requirements mapped to concrete tasks and files?
2. **Missing Files**: Did the planner miss any existing files that need modification?
3. **Unnecessary Files**: Did the planner invent tutorial or superfluous files?
4. **Dependency Errors**: Are there flawed dependencies or ordering errors in the task graph?
5. **Architecture Conflicts**: Does the plan contradict existing design patterns?
6. **Duplication**: Does the plan re-implement existing utilities or services?
7. **Test Gaps**: Are there missing regression tests or untestable assertions?
8. **Logic Preservation**: Could existing working features break?
9. **Complexity**: Is the plan over-engineered?
10. **Ambiguity**: Are unresolved PRD questions left dangling?
11. **Security & Risk**: Are credentials, permissions, or inputs unhandled?

---

## Revision Loop (`review/revision_loop.ts`)

When findings are present:
1. The reviewer produces actionable `revisionInstructions` and structured `ReviewFinding[]`.
2. The revision loop generates `Plan v2` while adhering to the **Stability Rule**:
   - Preserves all unchanged, valid tasks, manifest entries, and tests.
   - Specifically patches the areas flagged by the reviewer.
3. Automatically re-reviews `Plan v2` up to `maxRevisions` (default 2).
4. Produces a `PlanningReviewPackage` ready for human sign-off.
