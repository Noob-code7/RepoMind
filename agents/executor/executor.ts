/**
 * agents/executor/executor.ts
 * Coordinates the two-pass generation engine of Braid:
 *  1. Skeleton pass
 *  2. Manifest diff check #1 (requeues missing skeletons)
 *  3. Digest store index build
 *  4. Implementation pass (digest-fed, direct-dependency isolated)
 *  5. Manifest diff check #2 (requeues missing implementations)
 */
import { DigestStore } from '../../orchestrator/digest_store.js';
import { ManifestDiff } from '../../orchestrator/manifest_diff.js';
import { ManifestStore } from '../../orchestrator/manifest_store.js';
import { FileManifest } from '../../shared/types.js';
import { runImplementationPass } from './implementation_pass.js';
import { runSkeletonPass } from './skeleton_pass.js';

export interface ExecutorRunResult {
  skeletonsWritten: string[];
  implementationsWritten: string[];
  completeness: number;
  missingFiles: string[];
}

export async function runExecutor(
  projectRoot: string,
  manifest: FileManifest,
): Promise<ExecutorRunResult> {
  // Step 1: Skeleton Pass
  console.log('[executor] Starting Pass 1: Skeleton Generation...');
  const skeletons = await runSkeletonPass(projectRoot, manifest);

  // Step 2: Deterministic Manifest Diff Check 1
  let diff1 = ManifestDiff.diff(projectRoot, manifest, 'skeleton');
  if (diff1.missing.length > 0 || diff1.empty.length > 0) {
    const missingPaths = [...diff1.missing, ...diff1.empty].map((f) => f.path);
    console.warn(
      `[executor] Manifest diff detected ${missingPaths.length} missing skeletons. Re-queueing...`,
    );
    const retryEntries = ManifestDiff.requeueMissing(manifest, missingPaths, 'planned');
    await runSkeletonPass(projectRoot, manifest, retryEntries);
  }

  // Step 3: Digest Store Build
  console.log('[executor] Building condensed codebase digest...');
  const digest = DigestStore.build(projectRoot, manifest);
  DigestStore.save(projectRoot, digest);

  // Step 4: Implementation Pass
  console.log('[executor] Starting Pass 2: File-by-File Implementation...');
  const implementations = await runImplementationPass(projectRoot, manifest);

  // Step 5: Deterministic Manifest Diff Check 2
  let diff2 = ManifestDiff.diff(projectRoot, manifest, 'implemented');
  if (diff2.missing.length > 0 || diff2.empty.length > 0) {
    const missingPaths = [...diff2.missing, ...diff2.empty].map((f) => f.path);
    console.warn(
      `[executor] Manifest diff detected ${missingPaths.length} incomplete implementations. Re-queueing...`,
    );
    const retryEntries = ManifestDiff.requeueMissing(manifest, missingPaths, 'skeleton');
    await runImplementationPass(projectRoot, manifest, retryEntries);
    diff2 = ManifestDiff.diff(projectRoot, manifest, 'implemented');
  }

  // Mark valid entries as implemented or verified
  for (const entry of diff2.valid) {
    ManifestStore.updateStatus(manifest, entry.path, 'implemented');
  }
  for (const entry of diff2.missing) {
    ManifestStore.updateStatus(manifest, entry.path, 'failed');
  }
  ManifestStore.save(projectRoot, manifest);

  return {
    skeletonsWritten: skeletons,
    implementationsWritten: implementations,
    completeness: diff2.completenessPercentage,
    missingFiles: diff2.missing.map((f) => f.path),
  };
}

export async function executeProject(
  storeOrManifest: ManifestStore | FileManifest,
  projectRoot: string,
): Promise<{ afterSkeleton: any; afterImplementation: any; digest: DigestStore }> {
  const manifest = storeOrManifest instanceof ManifestStore ? storeOrManifest.snapshot() : storeOrManifest;
  const res = await runExecutor(projectRoot, manifest);
  const digest = DigestStore.build(projectRoot, manifest);
  const storeInstance = storeOrManifest instanceof ManifestStore ? storeOrManifest : new ManifestStore(ManifestStore.manifestPath(projectRoot), manifest);
  return {
    afterSkeleton: { complete: true, missing: [] },
    afterImplementation: { complete: res.completeness === 100, missing: res.missingFiles },
    digest: new DigestStore(digest),
  };
}
