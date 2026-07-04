import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const HARNESS_DIR = join(HERE, '..')
const SCRIPTS_DIR = join(HARNESS_DIR, 'scripts')

const ACCEPTED_ADR = [
  '---',
  'number: 0001',
  'title: Backend stack',
  'status: accepted',
  'date: 2026-06-20',
  'status_date: 2026-06-20',
  'supersedes: []',
  'superseded_by: null',
  '---',
  '',
  '## Context',
  '',
  'Contexto do backend.',
  '',
  '## Decision',
  '',
  'Decisão tomada.',
  '',
  '## Consequences',
  '',
  'Consequências aceitas.',
  '',
].join('\n')

function withStatus(content, from, to) {
  return content.replace(`status: ${from}`, `status: ${to}`)
}

function makeSandbox() {
  const root = mkdtempSync(join(tmpdir(), 'adr-precommit-'))
  const harness = join(root, '.harn', 'adrs')
  const scripts = join(harness, 'scripts')
  const hooks = join(harness, 'hooks')
  const docs = join(root, 'docs', 'adrs')
  mkdirSync(scripts, { recursive: true })
  mkdirSync(hooks, { recursive: true })
  mkdirSync(docs, { recursive: true })

  copyFileSync(join(HARNESS_DIR, 'config.json'), join(harness, 'config.json'))
  for (const name of ['validate.mjs', 'frontmatter.mjs', 'state-machine.mjs']) {
    copyFileSync(join(SCRIPTS_DIR, name), join(scripts, name))
  }
  copyFileSync(join(HOOK_SOURCE), join(hooks, 'precommit-validate.mjs'))

  return { root, docs, hookPath: join(hooks, 'precommit-validate.mjs'), harness }
}

const HOOK_SOURCE = join(HERE, 'precommit-validate.mjs')

function git(root, args) {
  execFileSync('git', args, { cwd: root, stdio: ['ignore', 'ignore', 'ignore'] })
}

function initRepo(root) {
  git(root, ['init'])
  git(root, ['config', 'user.email', 'tester@example.com'])
  git(root, ['config', 'user.name', 'Precommit Tester'])
}

function commitAll(root, message) {
  git(root, ['add', '.'])
  git(root, ['commit', '-m', message])
}

function runHook(sandbox, stagedPaths) {
  try {
    const stdout = execFileSync('node', [sandbox.hookPath, ...stagedPaths], {
      cwd: sandbox.root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { code: 0, stdout, stderr: '' }
  } catch (error) {
    return { code: error.status ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' }
  }
}

function disablePreCommit(sandbox) {
  writeFileSync(
    join(sandbox.harness, 'config.local.json'),
    JSON.stringify({ hooks: { pre_commit: false } }),
    'utf8',
  )
}

function cleanup(sandbox) {
  rmSync(sandbox.root, { recursive: true, force: true })
}

test('legal staged edit (mutable field change on accepted ADR) exits 0', () => {
  const sandbox = makeSandbox()
  try {
    initRepo(sandbox.root)
    const path = join(sandbox.docs, '0001-backend-stack.md')
    writeFileSync(path, ACCEPTED_ADR, 'utf8')
    commitAll(sandbox.root, 'seed accepted adr')

    const transitioned = withStatus(ACCEPTED_ADR, 'accepted', 'deprecated').replace(
      'status_date: 2026-06-20',
      'status_date: 2026-07-01',
    )
    writeFileSync(path, transitioned, 'utf8')
    git(sandbox.root, ['add', 'docs/adrs/0001-backend-stack.md'])

    const result = runHook(sandbox, ['docs/adrs/0001-backend-stack.md'])
    assert.equal(result.code, 0, result.stderr)
  } finally {
    cleanup(sandbox)
  }
})

test('illegal staged edit (body changed on locked accepted ADR) exits non-zero with actionable stderr', () => {
  const sandbox = makeSandbox()
  try {
    initRepo(sandbox.root)
    const path = join(sandbox.docs, '0001-backend-stack.md')
    writeFileSync(path, ACCEPTED_ADR, 'utf8')
    commitAll(sandbox.root, 'seed accepted adr')

    const bodyChanged = ACCEPTED_ADR.replace('Decisão tomada.', 'Decisão completamente reescrita.')
    writeFileSync(path, bodyChanged, 'utf8')
    git(sandbox.root, ['add', 'docs/adrs/0001-backend-stack.md'])

    const result = runHook(sandbox, ['docs/adrs/0001-backend-stack.md'])
    assert.notEqual(result.code, 0)
    assert.match(result.stderr, /BLOQUEADO/)
    assert.match(result.stderr, /immutable_body_changed/)
    assert.match(result.stderr, /--disable pre_commit/)
  } finally {
    cleanup(sandbox)
  }
})

test('illegal staged edit (immutable field changed) exits non-zero', () => {
  const sandbox = makeSandbox()
  try {
    initRepo(sandbox.root)
    const path = join(sandbox.docs, '0001-backend-stack.md')
    writeFileSync(path, ACCEPTED_ADR, 'utf8')
    commitAll(sandbox.root, 'seed accepted adr')

    const titleChanged = ACCEPTED_ADR.replace('title: Backend stack', 'title: Outro titulo')
    writeFileSync(path, titleChanged, 'utf8')
    git(sandbox.root, ['add', 'docs/adrs/0001-backend-stack.md'])

    const result = runHook(sandbox, ['docs/adrs/0001-backend-stack.md'])
    assert.notEqual(result.code, 0)
    assert.match(result.stderr, /immutable_field_changed/)
  } finally {
    cleanup(sandbox)
  }
})

test('illegal staged transition (accepted -> proposed) exits non-zero', () => {
  const sandbox = makeSandbox()
  try {
    initRepo(sandbox.root)
    const path = join(sandbox.docs, '0001-backend-stack.md')
    writeFileSync(path, ACCEPTED_ADR, 'utf8')
    commitAll(sandbox.root, 'seed accepted adr')

    const badTransition = withStatus(ACCEPTED_ADR, 'accepted', 'proposed')
    writeFileSync(path, badTransition, 'utf8')
    git(sandbox.root, ['add', 'docs/adrs/0001-backend-stack.md'])

    const result = runHook(sandbox, ['docs/adrs/0001-backend-stack.md'])
    assert.notEqual(result.code, 0)
  } finally {
    cleanup(sandbox)
  }
})

test('newly added ADR with legal initial status is treated as CREATE and exits 0', () => {
  const sandbox = makeSandbox()
  try {
    initRepo(sandbox.root)
    writeFileSync(join(sandbox.docs, '.keep'), '', 'utf8')
    commitAll(sandbox.root, 'seed empty docs')

    const path = join(sandbox.docs, '0002-new-decision.md')
    const created = ACCEPTED_ADR.replace('number: 0001', 'number: 0002').replace(
      'title: Backend stack',
      'title: New decision',
    )
    writeFileSync(path, created, 'utf8')
    git(sandbox.root, ['add', 'docs/adrs/0002-new-decision.md'])

    const result = runHook(sandbox, ['docs/adrs/0002-new-decision.md'])
    assert.equal(result.code, 0, result.stderr)
  } finally {
    cleanup(sandbox)
  }
})

test('newly added ADR with invalid initial status (deprecated) exits non-zero', () => {
  const sandbox = makeSandbox()
  try {
    initRepo(sandbox.root)
    writeFileSync(join(sandbox.docs, '.keep'), '', 'utf8')
    commitAll(sandbox.root, 'seed empty docs')

    const path = join(sandbox.docs, '0002-new-decision.md')
    const created = withStatus(
      ACCEPTED_ADR.replace('number: 0001', 'number: 0002'),
      'accepted',
      'deprecated',
    )
    writeFileSync(path, created, 'utf8')
    git(sandbox.root, ['add', 'docs/adrs/0002-new-decision.md'])

    const result = runHook(sandbox, ['docs/adrs/0002-new-decision.md'])
    assert.notEqual(result.code, 0)
    assert.match(result.stderr, /create_invalid_status/)
  } finally {
    cleanup(sandbox)
  }
})

test('non-ADR-record staged paths are ignored and exit 0', () => {
  const sandbox = makeSandbox()
  try {
    initRepo(sandbox.root)
    const readme = join(sandbox.docs, 'README.md')
    writeFileSync(readme, '# index', 'utf8')
    commitAll(sandbox.root, 'seed readme')

    writeFileSync(readme, '# index changed by hand', 'utf8')
    git(sandbox.root, ['add', 'docs/adrs/README.md'])

    const result = runHook(sandbox, ['docs/adrs/README.md', 'src/whatever.ts'])
    assert.equal(result.code, 0, result.stderr)
  } finally {
    cleanup(sandbox)
  }
})

test('auto-gate: pre_commit disabled in config.local.json makes the hook a no-op even on illegal edits', () => {
  const sandbox = makeSandbox()
  try {
    initRepo(sandbox.root)
    const path = join(sandbox.docs, '0001-backend-stack.md')
    writeFileSync(path, ACCEPTED_ADR, 'utf8')
    commitAll(sandbox.root, 'seed accepted adr')

    disablePreCommit(sandbox)
    const bodyChanged = ACCEPTED_ADR.replace('Decisão tomada.', 'Reescrita ilegal.')
    writeFileSync(path, bodyChanged, 'utf8')
    git(sandbox.root, ['add', 'docs/adrs/0001-backend-stack.md'])

    const result = runHook(sandbox, ['docs/adrs/0001-backend-stack.md'])
    assert.equal(result.code, 0, result.stderr)
  } finally {
    cleanup(sandbox)
  }
})

test('no staged ADR paths in argv exits 0', () => {
  const sandbox = makeSandbox()
  try {
    initRepo(sandbox.root)
    writeFileSync(join(sandbox.docs, '.keep'), '', 'utf8')
    commitAll(sandbox.root, 'seed')
    const result = runHook(sandbox, [])
    assert.equal(result.code, 0, result.stderr)
  } finally {
    cleanup(sandbox)
  }
})
