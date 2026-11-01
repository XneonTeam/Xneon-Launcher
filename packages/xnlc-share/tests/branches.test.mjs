import { test } from 'node:test'
import assert from 'node:assert/strict'
import { branchHistory, emptyRepository } from '../lib/index.js'

test('история наследуется до корня, включает обе стороны слияния и исключает посторонние ветки', () => {
  const repo = emptyRepository('repo', 'owner')
  repo.commits = Object.fromEntries([
    ['root', []], ['main-1', ['root']], ['base', ['main-1']],
    ['main-2', ['base']], ['feature-1', ['base']], ['feature-2', ['feature-1']],
    ['sibling', ['base']], ['merge', ['main-2', 'feature-2']],
  ].map(([id, parents]) => [id, { id, parents }]))
  repo.branches = {
    main: { head: 'merge', owner: 'owner', protected: true },
    feature: { head: 'feature-2', owner: 'owner', protected: false, base: 'base' },
    fresh: { head: 'base', owner: 'owner', protected: false, base: 'base' },
  }
  assert.deepEqual(branchHistory(repo, 'feature').map(commit => commit.id), ['feature-2', 'feature-1', 'base', 'main-1', 'root'])
  assert.deepEqual(branchHistory(repo, 'main').map(commit => commit.id), ['merge', 'main-2', 'feature-2', 'feature-1', 'base', 'main-1', 'root'])
  assert.deepEqual(branchHistory(repo, 'fresh').map(commit => commit.id), ['base', 'main-1', 'root'])
  assert.deepEqual(branchHistory(repo, 'missing'), [])
  repo.branches.broken = { head: 'missing-commit', owner: 'owner', protected: false }
  assert.deepEqual(branchHistory(repo, 'broken'), [])
})
