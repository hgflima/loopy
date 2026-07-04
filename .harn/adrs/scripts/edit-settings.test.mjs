import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, copyFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  addAdrHooks,
  removeAdrHooks,
  addAdrHooksToString,
  removeAdrHooksFromString,
  isOwnedCommand,
} from './edit-settings.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const REAL_SETTINGS = join(here, '..', '__fixtures__', 'repo', 'settings.json')

const THIRD_PARTY = ['no-new-comments', 'quality-gate', 'simplify-ignore', 'sdd-cache']

function sandboxCopyOfRealSettings() {
  const dir = mkdtempSync(join(tmpdir(), 'adr-settings-'))
  const copy = join(dir, 'settings.json')
  copyFileSync(REAL_SETTINGS, copy)
  return { dir, copy }
}

function collectCommands(settings) {
  const commands = []
  for (const phase of Object.values(settings.hooks || {})) {
    for (const block of phase) {
      for (const hook of block.hooks || []) {
        commands.push(hook.command)
      }
    }
  }
  return commands
}

test('isOwnedCommand recognizes only ADR hook paths', () => {
  assert.equal(isOwnedCommand('node ${CLAUDE_PROJECT_DIR}/.harn/adrs/hooks/pretooluse-validate.mjs'), true)
  assert.equal(isOwnedCommand('node ${CLAUDE_PROJECT_DIR}/.claude/hooks/no-new-comments.mjs'), false)
  assert.equal(isOwnedCommand(undefined), false)
})

test('add then remove yields a byte-identical copy of the real settings.json', () => {
  const { dir, copy } = sandboxCopyOfRealSettings()
  try {
    const original = readFileSync(copy, 'utf8')
    const added = addAdrHooksToString(original)
    const restored = removeAdrHooksFromString(added)
    assert.equal(restored, original)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('add inserts the ADR PreToolUse and PostToolUse blocks with the correct matcher', () => {
  const { dir, copy } = sandboxCopyOfRealSettings()
  try {
    const original = JSON.parse(readFileSync(copy, 'utf8'))
    const added = addAdrHooks(original)

    assert.equal(added.hooks.PreToolUse.length, original.hooks.PreToolUse.length + 1)
    assert.equal(added.hooks.PostToolUse.length, original.hooks.PostToolUse.length + 1)

    const preBlock = added.hooks.PreToolUse.at(-1)
    const postBlock = added.hooks.PostToolUse.at(-1)
    assert.equal(preBlock.matcher, 'Write|Edit|MultiEdit')
    assert.equal(postBlock.matcher, 'Write|Edit|MultiEdit')
    assert.ok(preBlock.hooks[0].command.includes('/.harn/adrs/hooks/pretooluse-validate.mjs'))
    assert.ok(postBlock.hooks[0].command.includes('/.harn/adrs/hooks/posttooluse-lint.mjs'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('add preserves all four third-party hooks', () => {
  const { dir, copy } = sandboxCopyOfRealSettings()
  try {
    const original = JSON.parse(readFileSync(copy, 'utf8'))
    const added = addAdrHooks(original)
    const commands = collectCommands(added).join('\n')
    for (const name of THIRD_PARTY) {
      assert.ok(commands.includes(name), `third-party hook missing after add: ${name}`)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a second add is a no-op (does not duplicate ADR blocks)', () => {
  const { dir, copy } = sandboxCopyOfRealSettings()
  try {
    const original = readFileSync(copy, 'utf8')
    const onceAdded = addAdrHooksToString(original)
    const twiceAdded = addAdrHooksToString(onceAdded)
    assert.equal(twiceAdded, onceAdded)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('remove deletes only owned blocks, leaving third-party hooks intact', () => {
  const { dir, copy } = sandboxCopyOfRealSettings()
  try {
    const original = JSON.parse(readFileSync(copy, 'utf8'))
    const added = addAdrHooks(original)
    const removed = removeAdrHooks(added)

    const commands = collectCommands(removed)
    assert.equal(commands.some((cmd) => isOwnedCommand(cmd)), false)

    const joined = commands.join('\n')
    for (const name of THIRD_PARTY) {
      assert.ok(joined.includes(name), `third-party hook missing after remove: ${name}`)
    }
    assert.deepEqual(removed, original)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('remove on settings with no owned blocks is a no-op', () => {
  const { dir, copy } = sandboxCopyOfRealSettings()
  try {
    const original = readFileSync(copy, 'utf8')
    const removed = removeAdrHooksFromString(original)
    assert.equal(removed, original)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
