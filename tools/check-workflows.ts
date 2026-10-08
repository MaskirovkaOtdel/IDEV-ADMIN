/**
 * Workflow checker — parses every GitHub Actions YAML in the repo and asserts
 * that the parts we depend on are actually there.
 *
 * WHY THIS EXISTS
 * ---------------
 * `release.yml` shipped with a stray `'` on the final line, which made it an
 * unterminated quoted scalar. The file was therefore invalid YAML, and GitHub
 * could not read a single field in it. The consequences were subtle and bad:
 *
 *   • The workflow ran with zero jobs, so nothing ever executed.
 *   • Its name fell back to the file path, hiding it in the Actions list.
 *   • The `tags: v*` trigger was never read, so it fired on *every* push to
 *     main instead of on tags. A working tag workflow shows `head_branch=v0.1.0`
 *     and appears once per tag; firing on main meant the file had not parsed.
 *
 * The bug was invisible for the entire life of the file: the game, the tests,
 * the build, and the other workflow were all green, and the only symptom was a
 * red `failure` nobody opened. Nothing in the gate looked at `.github/` at all.
 *
 * So this exists to close that hole rather than to re-report the one bug:
 * a workflow that cannot be parsed is now a build failure, not a mystery.
 *
 * WHAT IT CHECKS
 *   1. Every file parses as YAML (syntax).
 *   2. Every file declares `name` and at least one `on` trigger (GitHub silently
 *      substitutes the file path when these are missing).
 *   3. Workflows declare explicit `permissions`, so a new workflow cannot
 *      inherit more access than it intends.
 *   4. `release.yml` in particular is a *tag-only* workflow. This is the check
 *      that would have caught the original symptom most directly: a release
 *      workflow that fires on branch pushes is misconfigured by definition.
 *
 * USAGE
 *   npm run check:workflows
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { parseDocument } from 'yaml';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const WORKFLOW_DIR = join(REPO_ROOT, '.github', 'workflows');

/** Shape of the bits of a workflow we assert on. Anything else is left alone. */
interface WorkflowShape {
  name?: unknown;
  on?: unknown;
  permissions?: unknown;
  jobs?: Record<string, { steps?: unknown[] }>;
}

interface Failure {
  file: string;
  message: string;
}

/** Workflows whose triggers are pinned to specific events, not every push. */
const TRIGGER_EXPECTATIONS: Record<string, { tagOnly: boolean }> = {
  'release.yml': { tagOnly: true },
};

/** Workflows that are allowed to omit `permissions` because they write nothing. */
const PERMISSIONS_OPTIONAL = new Set<string>();

function listWorkflowFiles(): string[] {
  let entries: string[];
  try {
    entries = readdirSync(WORKFLOW_DIR);
  } catch {
    return [];
  }
  return entries.filter((name) => name.endsWith('.yml') || name.endsWith('.yaml')).sort();
}

function checkFile(file: string, expectations: { tagOnly: boolean } | undefined): Failure[] {
  const failures: Failure[] = [];
  const full = join(WORKFLOW_DIR, file);
  const text = readFileSync(full, 'utf8');

  const doc = parseDocument(text);
  if (doc.errors.length > 0) {
    for (const err of doc.errors) {
      failures.push({ file, message: `YAML syntax: ${err.message.split('\n')[0]}` });
    }
    // A syntax error makes every assertion below meaningless, so stop here.
    return failures;
  }

  let shape: WorkflowShape;
  try {
    shape = doc.toJS() as WorkflowShape;
  } catch (err) {
    failures.push({ file, message: `not convertible to JSON: ${(err as Error).message}` });
    return failures;
  }

  if (typeof shape.name !== 'string' || shape.name.length === 0) {
    failures.push({
      file,
      message: 'missing `name`; GitHub falls back to the file path and the workflow is hard to find',
    });
  }

  if (shape.on === undefined || shape.on === null) {
    failures.push({ file, message: 'missing `on`; the workflow has no trigger at all' });
  }

  const hasJobs = shape.jobs !== undefined && Object.keys(shape.jobs).length > 0;
  if (!hasJobs) {
    failures.push({ file, message: 'missing or empty `jobs`; the workflow would run zero steps' });
  }

  if (shape.permissions === undefined && !PERMISSIONS_OPTIONAL.has(file)) {
    failures.push({
      file,
      message: 'missing `permissions`; state the access this workflow needs instead of inheriting the default',
    });
  }

  if (expectations?.tagOnly) {
    const trigger = JSON.stringify(shape.on) ?? '';
    const triggersOnBranches = trigger.includes('"branches"');
    const isTagOnly = trigger.includes('"tags"') && !triggersOnBranches;

    if (!isTagOnly) {
      failures.push({
        file,
        message: `expected a tag-only trigger (push on tags, no branches), got on=${trigger}`,
      });
    }
    if (trigger.includes('workflow_dispatch')) {
      failures.push({
        file,
        message: 'release is meant to be cut from a pushed tag; workflow_dispatch makes it cuttable by hand',
      });
    }
  }

  // Every job must be able to run somewhere and actually do something.
  for (const [jobName, job] of Object.entries(shape.jobs ?? {})) {
    if (!Array.isArray(job?.steps) || job.steps.length === 0) {
      failures.push({ file, message: `job "${jobName}" has no steps` });
    }
  }

  return failures;
}

function main(): void {
  const files = listWorkflowFiles();

  if (files.length === 0) {
    console.log('No workflows found — nothing to check.');
    return;
  }

  const failures: Failure[] = [];
  for (const file of files) {
    const fileFailures = checkFile(file, TRIGGER_EXPECTATIONS[file]);
    const rel = relative(REPO_ROOT, join(WORKFLOW_DIR, file)).split(sep).join('/');
    if (fileFailures.length === 0) {
      console.log(`  ok  ${rel}`);
    } else {
      failures.push(...fileFailures);
      console.log(`FAIL  ${rel}`);
    }
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} workflow problem(s):`);
    for (const f of failures) {
      console.error(`  ${f.file}: ${f.message}`);
    }
    console.error('\nAn unparseable workflow is worse than a failing one: it runs zero');
    console.error('steps and can silently fall back to triggering on every push.');
    process.exitCode = 1;
    return;
  }

  console.log(`\n${files.length} workflow(s) parse and declare the expected shape.`);
}

main();