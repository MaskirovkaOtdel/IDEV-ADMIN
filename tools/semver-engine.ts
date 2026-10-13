/**
 * Semantic Versioning Engine & Release Notes Generator
 *
 * Automatically inspects commits since the latest git tag, determines the
 * appropriate Semantic Version bump according to Conventional Commits:
 *
 *   • Major (X.0.0): Any commit with BREAKING CHANGE: or type!:
 *   • Minor (0.X.0): Any feat / feature commit
 *   • Patch (0.0.X): Any fix, perf, refactor, or patch commit
 *
 * Keeps package.json and package-lock.json in strict lockstep to satisfy
 * src/__tests__/version.test.ts, and formats categorized GitHub release notes.
 *
 * Usage:
 *   npx tsx tools/semver-engine.ts           # Inspect status & proposed bump
 *   npx tsx tools/semver-engine.ts --apply   # Apply version bump to package.json & package-lock.json
 *   npx tsx tools/semver-engine.ts --notes   # Print generated release notes
 */

import { execSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const PKG_PATH = resolve(REPO_ROOT, 'package.json');
const LOCK_PATH = resolve(REPO_ROOT, 'package-lock.json');

export type BumpType = 'major' | 'minor' | 'patch' | 'none';

export interface CommitInfo {
  hash: string;
  shortHash: string;
  subject: string;
  body: string;
  authorName: string;
  authorEmail: string;
  bump: BumpType;
  category: 'breaking' | 'features' | 'fixes' | 'performance' | 'chores';
}

interface PackageJson {
  version: string;
  [key: string]: unknown;
}

interface PackageLockJson {
  version: string;
  packages: {
    '': {
      version: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

function runGit(cmd: string): string {
  try {
    return execSync(`git ${cmd}`, { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    return '';
  }
}

export function getLatestTag(): string {
  const tag = runGit('describe --tags --abbrev=0 --match "v*"');
  if (tag.length > 0) return tag;
  const allTags = runGit('tag -l "v*" --sort=-v:refname');
  const firstTag = allTags.split('\n')[0]?.trim();
  return firstTag || '';
}

export function classifyCommit(subject: string, body: string): {
  bump: BumpType;
  category: CommitInfo['category'];
} {
  const fullText = `${subject}\n\n${body}`;

  // Breaking changes: BREAKING CHANGE: trailer or type!: convention
  const isBreaking =
    /BREAKING[\s-]CHANGE:/i.test(fullText) ||
    /^[a-zA-Z]+(\([^)]+\))?!:/i.test(subject);

  if (isBreaking) {
    return { bump: 'major', category: 'breaking' };
  }

  // Features: feat: or feat(...):
  if (/^feat(\([^)]+\))?:/i.test(subject)) {
    return { bump: 'minor', category: 'features' };
  }

  // Bug fixes: fix: or fix(...):
  if (/^fix(\([^)]+\))?:/i.test(subject)) {
    return { bump: 'patch', category: 'fixes' };
  }

  // Performance / Refactoring
  if (/^(perf|refactor)(\([^)]+\))?:/i.test(subject)) {
    return { bump: 'patch', category: 'performance' };
  }

  // Chores, docs, CI, tests, maintenance
  return { bump: 'none', category: 'chores' };
}

export function getCommitsSince(tag: string): CommitInfo[] {
  const range = tag.length > 0 ? `${tag}..HEAD` : 'HEAD';
  // Use unit separator (%x1f) and record separator (%x1e) to reliably parse multiline git log
  const logFormat = '%H%x1f%h%x1f%s%x1f%b%x1f%an%x1f%ae%x1e';
  const raw = runGit(`log ${range} --pretty=format:"${logFormat}"`);

  if (!raw || raw.trim().length === 0) return [];

  const records = raw.split('\x1e');
  const commits: CommitInfo[] = [];

  for (const record of records) {
    const trimmed = record.trim();
    if (!trimmed) continue;
    const parts = trimmed.split('\x1f');
    if (parts.length < 6) continue;

    const [hash, shortHash, subject, body, authorName, authorEmail] = parts;
    const { bump, category } = classifyCommit(subject, body);

    commits.push({
      hash,
      shortHash,
      subject,
      body,
      authorName,
      authorEmail,
      bump,
      category,
    });
  }

  return commits;
}

export function calculateNextVersion(currentVersion: string, bump: BumpType): string {
  const parts = currentVersion.split('.').map((p) => parseInt(p, 10));
  if (parts.length !== 3 || parts.some(isNaN)) {
    throw new Error(`Invalid semver version in package.json: ${currentVersion}`);
  }

  const [major, minor, patch] = parts;

  switch (bump) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
    case 'none':
    default:
      return currentVersion;
  }
}

export function formatReleaseNotes(
  commits: CommitInfo[],
  oldTag: string,
  newTag: string,
  repoUrl = 'https://github.com/MaskirovkaOtdel/IDEV-ADMIN'
): string {
  const lines: string[] = [];
  lines.push(`## Release ${newTag}`);
  lines.push('');

  const breaking = commits.filter((c) => c.category === 'breaking');
  const features = commits.filter((c) => c.category === 'features');
  const fixes = commits.filter((c) => c.category === 'fixes');
  const perf = commits.filter((c) => c.category === 'performance');
  const chores = commits.filter((c) => c.category === 'chores');

  if (breaking.length > 0) {
    lines.push('### 🚨 Breaking Changes');
    for (const c of breaking) {
      lines.push(`- ${c.subject} ([${c.shortHash}](${repoUrl}/commit/${c.hash})) — @${c.authorName}`);
    }
    lines.push('');
  }

  if (features.length > 0) {
    lines.push('### ✨ Features & Enhancements');
    for (const c of features) {
      lines.push(`- ${c.subject} ([${c.shortHash}](${repoUrl}/commit/${c.hash})) — @${c.authorName}`);
    }
    lines.push('');
  }

  if (fixes.length > 0) {
    lines.push('### 🐛 Bug Fixes');
    for (const c of fixes) {
      lines.push(`- ${c.subject} ([${c.shortHash}](${repoUrl}/commit/${c.hash})) — @${c.authorName}`);
    }
    lines.push('');
  }

  if (perf.length > 0) {
    lines.push('### ⚡ Performance & Polish');
    for (const c of perf) {
      lines.push(`- ${c.subject} ([${c.shortHash}](${repoUrl}/commit/${c.hash})) — @${c.authorName}`);
    }
    lines.push('');
  }

  if (chores.length > 0) {
    lines.push('### 🔧 Maintenance & Chores');
    for (const c of chores) {
      lines.push(`- ${c.subject} ([${c.shortHash}](${repoUrl}/commit/${c.hash})) — @${c.authorName}`);
    }
    lines.push('');
  }

  if (oldTag.length > 0) {
    lines.push(`**Full Changelog**: [${oldTag}...${newTag}](${repoUrl}/compare/${oldTag}...${newTag})`);
  }

  return lines.join('\n');
}

export function applyVersionBump(newVersion: string): void {
  const pkgContent = readFileSync(PKG_PATH, 'utf8');
  const pkg = JSON.parse(pkgContent) as PackageJson;
  pkg.version = newVersion;
  writeFileSync(PKG_PATH, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');

  const lockContent = readFileSync(LOCK_PATH, 'utf8');
  const lock = JSON.parse(lockContent) as PackageLockJson;
  lock.version = newVersion;
  if (lock.packages && lock.packages['']) {
    lock.packages[''].version = newVersion;
  }
  writeFileSync(LOCK_PATH, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');

  console.log(`[semver-engine] Applied version bump to ${newVersion} in package.json and package-lock.json`);
}

function writeGithubOutput(key: string, value: string): void {
  const ghOutputFile = process.env.GITHUB_OUTPUT;
  if (!ghOutputFile) return;

  if (value.includes('\n')) {
    const delimiter = `EOF_${Math.random().toString(36).substring(2, 9)}`;
    const block = `${key}<<${delimiter}\n${value}\n${delimiter}\n`;
    appendFileSync(ghOutputFile, block, 'utf8');
  } else {
    appendFileSync(ghOutputFile, `${key}=${value}\n`, 'utf8');
  }
}

export function main(): void {
  const args = process.argv.slice(2);
  const shouldApply = args.includes('--apply');
  const printNotesOnly = args.includes('--notes');
  const allowChoreBump = args.includes('--bump-chores');

  const pkg = JSON.parse(readFileSync(PKG_PATH, 'utf8')) as PackageJson;
  const currentVersion = pkg.version;
  const latestTag = getLatestTag();
  const commits = getCommitsSince(latestTag);

  let highestBump: BumpType = 'none';

  for (const c of commits) {
    if (c.bump === 'major') {
      highestBump = 'major';
      break; // Maximum possible
    }
    if (c.bump === 'minor') {
      highestBump = 'minor';
    } else if (c.bump === 'patch' && highestBump === 'none') {
      highestBump = 'patch';
    }
  }

  // If there are commits but all are chores/docs, optionally bump patch if configured
  if (highestBump === 'none' && allowChoreBump && commits.length > 0) {
    highestBump = 'patch';
  }

  const shouldRelease = highestBump !== 'none';
  const nextVersion = calculateNextVersion(currentVersion, highestBump);
  const nextTag = `v${nextVersion}`;
  const notes = formatReleaseNotes(commits, latestTag, nextTag);

  if (printNotesOnly) {
    console.log(notes);
    return;
  }

  console.log('--- SemVer Engine Evaluation ---');
  console.log(`Current version:    ${currentVersion}`);
  console.log(`Latest git tag:     ${latestTag || '(none)'}`);
  console.log(`Commits evaluated:  ${commits.length}`);
  console.log(`Highest bump type:  ${highestBump}`);
  console.log(`Proposed next:      ${nextVersion} (${nextTag})`);
  console.log(`Release needed:     ${shouldRelease}`);

  if (shouldApply && shouldRelease) {
    applyVersionBump(nextVersion);
  }

  // Write outputs for GitHub Actions
  writeGithubOutput('should_release', shouldRelease ? 'true' : 'false');
  writeGithubOutput('bump_type', highestBump);
  writeGithubOutput('current_version', currentVersion);
  writeGithubOutput('new_version', nextVersion);
  writeGithubOutput('tag', nextTag);
  writeGithubOutput('release_notes', notes);
}

if (process.argv[1]?.endsWith('semver-engine.ts')) {
  main();
}
