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
 *   4. Every `node-version` in every job matches `.nvmrc`, so the Node version
 *      is enforced from one place without relying on an action input.
 *   5. `release.yml` in particular is a *tag-only* workflow. This is the check
 *      that would have caught the original symptom most directly: a release
 *      workflow that fires on branch pushes is misconfigured by definition.
 *   6. `.github/dependabot.yml` parses and covers both ecosystems. It fails the
 *      same way a workflow does, only quieter: a malformed entry makes
 *      Dependabot stop opening PRs, and silence there is indistinguishable
 *      from having nothing to update.
 *
 * USAGE
 *   npm run check:workflows
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
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

/**
 * Dependabot config lives outside the workflows directory but fails the same way:
 * a malformed entry makes Dependabot stop opening PRs, and the only symptom is
 * the absence of updates -- which looks identical to "nothing needed updating".
 * It is checked here for the same reason the workflows are.
 */
const DEPENDABOT_PATH = join(REPO_ROOT, '.github', 'dependabot.yml');

/**
 * Single source of truth for the Node version.
 *
 * The workflows use a literal `node-version` rather than `node-version-file`.
 * That is deliberate: `node-version-file` was tried and took the workflow from
 * green to a run with zero jobs and an unreadable name. The cause was never
 * conclusively identified -- the YAML parsed cleanly, was valid UTF-8, had no
 * BOM and no control characters -- so the safer spelling was restored and the
 * single-source guarantee moved here, where it is enforced on every gate run
 * instead of being a property of an action input.
 */
const NVMRC_PATH = join(REPO_ROOT, '.nvmrc');

function declaredNodeVersion(): string | null {
  if (!existsSync(NVMRC_PATH)) return null;
  const value = readFileSync(NVMRC_PATH, 'utf8').trim();
  return value.length > 0 ? value : null;
}

/** Ecosystems this repo actually has a lockfile for. */
const EXPECTED_ECOSYSTEMS = ['npm', 'github-actions'];

function checkDependabot(): Failure[] {
  const failures: Failure[] = [];
  const name = '.github/dependabot.yml';

  if (!existsSync(DEPENDABOT_PATH)) {
    return [{ file: name, message: 'missing; dependency updates would never be proposed' }];
  }

  const doc = parseDocument(readFileSync(DEPENDABOT_PATH, 'utf8'));
  if (doc.errors.length > 0) {
    for (const err of doc.errors) {
      failures.push({ file: name, message: `YAML syntax: ${err.message.split('\n')[0]}` });
    }
    return failures;
  }

  const config = doc.toJS() as {
    version?: unknown;
    updates?: { 'package-ecosystem'?: string; directory?: string; schedule?: { interval?: string } }[];
  };

  if (config.version !== 2) {
    failures.push({ file: name, message: `expected \`version: 2\`, got ${JSON.stringify(config.version)}` });
  }

  const updates = Array.isArray(config.updates) ? config.updates : [];
  if (updates.length === 0) {
    failures.push({ file: name, message: 'no `updates` entries; Dependabot would do nothing' });
    return failures;
  }

  for (const ecosystem of EXPECTED_ECOSYSTEMS) {
    if (!updates.some((u) => u['package-ecosystem'] === ecosystem)) {
      failures.push({ file: name, message: `no \`updates\` entry for the ${ecosystem} ecosystem` });
    }
  }

  for (const update of updates) {
    const label = update['package-ecosystem'] ?? '(unnamed)';
    if (!update.schedule?.interval) {
      failures.push({ file: name, message: `${label}: missing \`schedule.interval\`` });
    }
    if (!update.directory) {
      failures.push({ file: name, message: `${label}: missing \`directory\`` });
    }
  }

  return failures;
}

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

  // Node must be pinned to the one version the repo declares.
  const declared = declaredNodeVersion();
  if (declared !== null) {
    for (const [jobName, job] of Object.entries(shape.jobs ?? {})) {
      for (const step of (job?.steps ?? []) as { with?: { 'node-version'?: unknown } }[]) {
        const pinned = step.with?.['node-version'];
        if (pinned === undefined) continue;
        if (String(pinned) !== declared) {
          failures.push({
            file,
            message: `job "${jobName}" pins node-version ${String(pinned)} but .nvmrc says ${declared}`,
          });
        }
      }
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

  const depFailures = checkDependabot();
  if (depFailures.length === 0) {
    console.log('  ok  .github/dependabot.yml');
  } else {
    failures.push(...depFailures);
    console.log('FAIL  .github/dependabot.yml');
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} workflow problem(s):`);
    for (const f of failures) {
      console.error(`  ${f.file}: ${f.message}`);
    }
    console.error('\nAn unparseable workflow is worse than a failing one: it runs zero');
    console.error('steps and can silently fall back to triggering on every push.');
    console.error('A malformed dependabot.yml is the same class of problem: it just');
    console.error('stops proposing updates, which reads as "nothing needed updating".');
    process.exitCode = 1;
    return;
  }

  console.log(`\n${files.length} workflow(s) and dependabot.yml parse and declare the expected shape.`);
}

main();