import { describe, it, expect } from 'vitest';
import {
  classifyCommit,
  calculateNextVersion,
  formatReleaseNotes,
  type CommitInfo,
} from '../../tools/semver-engine.ts';

describe('semver engine commit classification', () => {
  it('classifies breaking changes as major', () => {
    expect(classifyCommit('feat!: breaking overhaul of prestige', '').bump).toBe('major');
    expect(classifyCommit('fix!: breaking change in save format', '').bump).toBe('major');
    expect(classifyCommit('feat: rework economy', 'BREAKING CHANGE: changes prestige reset formula').bump).toBe(
      'major'
    );
  });

  it('classifies feat as minor', () => {
    expect(classifyCommit('feat: add quantum server generator', '').bump).toBe('minor');
    expect(classifyCommit('feat(ui): add new dark mode theme', '').bump).toBe('minor');
  });

  it('classifies fix, perf, and refactor as patch', () => {
    expect(classifyCommit('fix: prevent overflow in production tick', '').bump).toBe('patch');
    expect(classifyCommit('fix(engine): round offline earnings correctly', '').bump).toBe('patch');
    expect(classifyCommit('perf: memoize expensive card calculations', '').bump).toBe('patch');
    expect(classifyCommit('refactor: decouple prestige logic from ui', '').bump).toBe('patch');
  });

  it('classifies chores, docs, and ci as none', () => {
    expect(classifyCommit('chore: bump dependencies', '').bump).toBe('none');
    expect(classifyCommit('docs: update README with install instructions', '').bump).toBe('none');
    expect(classifyCommit('ci: streamline github action cache', '').bump).toBe('none');
  });
});

describe('semver version calculation', () => {
  it('increments patch correctly (X.X.1 -> X.X.2)', () => {
    expect(calculateNextVersion('0.6.1', 'patch')).toBe('0.6.2');
    expect(calculateNextVersion('1.2.9', 'patch')).toBe('1.2.10');
  });

  it('increments minor correctly (X.1.X -> X.2.0)', () => {
    expect(calculateNextVersion('0.6.1', 'minor')).toBe('0.7.0');
    expect(calculateNextVersion('1.3.5', 'minor')).toBe('1.4.0');
  });

  it('increments major correctly (1.X.X -> 2.0.0)', () => {
    expect(calculateNextVersion('0.6.1', 'major')).toBe('1.0.0');
    expect(calculateNextVersion('1.4.2', 'major')).toBe('2.0.0');
  });

  it('preserves version when bump is none', () => {
    expect(calculateNextVersion('0.6.1', 'none')).toBe('0.6.1');
  });
});

describe('semver release notes formatting', () => {
  it('groups commits into markdown categories with links', () => {
    const commits: CommitInfo[] = [
      {
        hash: 'abcdef1234567890abcdef1234567890abcdef12',
        shortHash: 'abcdef1',
        subject: 'feat: add achievements modal',
        body: '',
        authorName: 'MaskirovkaOtdel',
        authorEmail: 'thod.efstathiadis@gmail.com',
        bump: 'minor',
        category: 'features',
      },
      {
        hash: '1234567890abcdef1234567890abcdef12345678',
        shortHash: '1234567',
        subject: 'fix: correct offline timestamp clamp',
        body: '',
        authorName: 'Contributor',
        authorEmail: 'contrib@example.com',
        bump: 'patch',
        category: 'fixes',
      },
    ];

    const notes = formatReleaseNotes(commits, 'v0.6.1', 'v0.7.0');
    expect(notes).toContain('## Release v0.7.0');
    expect(notes).toContain('### ✨ Features & Enhancements');
    expect(notes).toContain('feat: add achievements modal');
    expect(notes).toContain('### 🐛 Bug Fixes');
    expect(notes).toContain('fix: correct offline timestamp clamp');
    expect(notes).toContain('**Full Changelog**: [v0.6.1...v0.7.0]');
  });
});
