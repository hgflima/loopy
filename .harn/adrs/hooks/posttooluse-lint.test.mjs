import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

import { isAdrRecord, lintFile } from './posttooluse-lint.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const scriptsDir = join(here, '..', 'scripts')

const LEGAL_ADR = [
  '---',
  'number: 0007',
  'title: Adotar boundary hexagonal',
  'status: accepted',
  'date: 2026-06-20',
  'status_date: 2026-06-20',
  'supersedes: []',
  'superseded_by: null',
  '---',
  '',
  '## Context',
  '',
  'Algum contexto.',
  '',
  '## Decision',
  '',
  'Alguma decisao.',
  '',
  '## Consequences',
  '',
  'Alguma consequencia.',
  '',
].join('\n')

const ILLEGAL_ADR = [
  '---',
  'number: 0010',
  'title: ADR sem consequencias',
  'status: proposed',
  'date: 2026-06-20',
  'status_date: 2026-06-20',
  'supersedes: []',
  'superseded_by: null',
  '---',
  '',
  '## Context',
  '',
  'Contexto.',
  '',
  '## Decision',
  '',
  'Decisao sem consequencias.',
  '',
].join('\n')

function makeSandbox({ enabled = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'adr-posttooluse-'))
  const harnessDir = join(root, '.harn', 'adrs')
  const sandboxHooks = join(harnessDir, 'hooks')
  const sandboxScripts = join(harnessDir, 'scripts')
  const recordsDir = join(root, 'docs', 'adrs')
  mkdirSync(sandboxHooks, { recursive: true })
  mkdirSync(sandboxScripts, { recursive: true })
  mkdirSync(recordsDir, { recursive: true })

  for (const name of ['frontmatter.mjs', 'state-machine.mjs', 'validate.mjs']) {
    copyFileSync(join(scriptsDir, name), join(sandboxScripts, name))
  }
  copyFileSync(join(here, 'posttooluse-lint.mjs'), join(sandboxHooks, 'posttooluse-lint.mjs'))

  writeFileSync(
    join(harnessDir, 'config.json'),
    JSON.stringify({
      version: 1,
      root_dir: 'docs/adrs',
      hooks: { pre_commit: true, pre_tool_use: true, post_tool_use: enabled },
    }),
    'utf8',
  )

  return {
    root,
    recordsDir,
    hookPath: join(sandboxHooks, 'posttooluse-lint.mjs'),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  }
}

function runHook(hookPath, payload) {
  try {
    const stdout = execFileSync('node', [hookPath], {
      input: JSON.stringify(payload),
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return { code: 0, stdout, stderr: '' }
  } catch (error) {
    return { code: error.status, stdout: error.stdout ?? '', stderr: error.stderr ?? '' }
  }
}

function writePayload(filePath) {
  return { tool_name: 'Write', tool_input: { file_path: filePath, content: '' } }
}

test('isAdrRecord matches NNNN-*.md inside root_dir and excludes README/CLAUDE/template', () => {
  const root = '/repo'
  const rootDir = 'docs/adrs'
  assert.equal(isAdrRecord('docs/adrs/0001-backend.md', root, rootDir), true)
  assert.equal(isAdrRecord('docs/adrs/README.md', root, rootDir), false)
  assert.equal(isAdrRecord('docs/adrs/CLAUDE.md', root, rootDir), false)
  assert.equal(isAdrRecord('docs/adrs/template.md', root, rootDir), false)
  assert.equal(isAdrRecord('docs/adrs/notes.md', root, rootDir), false)
  assert.equal(isAdrRecord('docs/other/0001-backend.md', root, rootDir), false)
  assert.equal(isAdrRecord('', root, rootDir), false)
})

test('lintFile returns ok for a legal ADR body and fail listing the missing heading', () => {
  const { recordsDir, cleanup } = makeSandbox()
  try {
    const legal = join(recordsDir, '0007-legal.md')
    const illegal = join(recordsDir, '0010-illegal.md')
    writeFileSync(legal, LEGAL_ADR, 'utf8')
    writeFileSync(illegal, ILLEGAL_ADR, 'utf8')

    const okResult = lintFile(legal)
    assert.equal(okResult.ok, true)

    const failResult = lintFile(illegal)
    assert.equal(failResult.ok, false)
    assert.ok(failResult.message.includes('## Consequences'))
  } finally {
    cleanup()
  }
})

test('hook is silent and exits 0 for an ADR that satisfies the template', () => {
  const { recordsDir, hookPath, cleanup } = makeSandbox()
  try {
    const file = join(recordsDir, '0007-legal.md')
    writeFileSync(file, LEGAL_ADR, 'utf8')
    const result = runHook(hookPath, writePayload('docs/adrs/0007-legal.md'))
    assert.equal(result.code, 0)
    assert.equal(result.stderr, '')
  } finally {
    cleanup()
  }
})

test('hook emits feedback for an ADR missing a required heading', () => {
  const { recordsDir, hookPath, cleanup } = makeSandbox()
  try {
    const file = join(recordsDir, '0010-illegal.md')
    writeFileSync(file, ILLEGAL_ADR, 'utf8')
    const result = runHook(hookPath, writePayload('docs/adrs/0010-illegal.md'))
    assert.equal(result.code, 2)
    assert.ok(result.stderr.includes('## Consequences'))
    assert.ok(result.stderr.includes('docs/adrs/0010-illegal.md'))
  } finally {
    cleanup()
  }
})

test('hook does not modify the offending file', () => {
  const { recordsDir, hookPath, cleanup } = makeSandbox()
  try {
    const file = join(recordsDir, '0010-illegal.md')
    writeFileSync(file, ILLEGAL_ADR, 'utf8')
    runHook(hookPath, writePayload('docs/adrs/0010-illegal.md'))
    const after = lintFile(file)
    assert.equal(after.ok, false)
    assert.ok(after.message.includes('## Consequences'))
  } finally {
    cleanup()
  }
})

test('hook is a no-op for non-ADR file paths', () => {
  const { hookPath, cleanup } = makeSandbox()
  try {
    const result = runHook(hookPath, writePayload('docs/adrs/README.md'))
    assert.equal(result.code, 0)
    assert.equal(result.stderr, '')
  } finally {
    cleanup()
  }
})

test('hook is a no-op for non-write tools', () => {
  const { hookPath, cleanup } = makeSandbox()
  try {
    const result = runHook(hookPath, { tool_name: 'Read', tool_input: { file_path: 'docs/adrs/0010-illegal.md' } })
    assert.equal(result.code, 0)
    assert.equal(result.stderr, '')
  } finally {
    cleanup()
  }
})

test('hook is a no-op when post_tool_use is disabled in config', () => {
  const { recordsDir, hookPath, cleanup } = makeSandbox({ enabled: false })
  try {
    const file = join(recordsDir, '0010-illegal.md')
    writeFileSync(file, ILLEGAL_ADR, 'utf8')
    const result = runHook(hookPath, writePayload('docs/adrs/0010-illegal.md'))
    assert.equal(result.code, 0)
    assert.equal(result.stderr, '')
  } finally {
    cleanup()
  }
})
