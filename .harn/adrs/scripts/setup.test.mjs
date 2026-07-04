import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  install,
  verify,
  setHook,
  queryStatus,
  readConfig,
  addGitignoreEntry,
  applyHookToSettings,
  applyHookToLintstaged,
  buildDefaultConfig,
  setHookFlag,
} from './setup.mjs'

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url))
const HARNESS_DIR = join(SCRIPTS_DIR, '..')

const REPO_FIXTURES = join(HARNESS_DIR, '__fixtures__', 'repo')
const SETTINGS_SRC = join(REPO_FIXTURES, 'settings.json')
const LINTSTAGED_SRC = join(REPO_FIXTURES, 'lintstagedrc.js')
const GITIGNORE_SRC = join(REPO_FIXTURES, 'gitignore')

const HOOK_FILES = ['pretooluse-validate.mjs', 'posttooluse-lint.mjs', 'precommit-validate.mjs']
const SCRIPT_DEPS = ['validate.mjs', 'frontmatter.mjs', 'state-machine.mjs']
const FIXTURES = ['legal-accepted.md', 'illegal-transition.md']
const THIRD_PARTY = ['no-new-comments', 'quality-gate', 'simplify-ignore', 'sdd-cache']
const ADR_GLOB = 'docs/adrs/[0-9][0-9][0-9][0-9]-*.md'
const TS_GLOB = '*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}'
const GITIGNORE_ENTRY = '.harn/adrs/config.local.json'

function buildSandbox() {
  const root = mkdtempSync(join(tmpdir(), 'adr-setup-'))
  const claudeDir = join(root, '.claude')
  const harnessDir = join(root, '.harn', 'adrs')
  const sandboxHooks = join(harnessDir, 'hooks')
  const sandboxScripts = join(harnessDir, 'scripts')
  const sandboxFixtures = join(harnessDir, '__fixtures__')
  mkdirSync(claudeDir, { recursive: true })
  mkdirSync(sandboxHooks, { recursive: true })
  mkdirSync(sandboxScripts, { recursive: true })
  mkdirSync(sandboxFixtures, { recursive: true })

  copyFileSync(SETTINGS_SRC, join(claudeDir, 'settings.json'))
  copyFileSync(LINTSTAGED_SRC, join(root, '.lintstagedrc.js'))
  copyFileSync(GITIGNORE_SRC, join(root, '.gitignore'))

  for (const hook of HOOK_FILES) {
    copyFileSync(join(HARNESS_DIR, 'hooks', hook), join(sandboxHooks, hook))
  }
  for (const dep of SCRIPT_DEPS) {
    copyFileSync(join(HARNESS_DIR, 'scripts', dep), join(sandboxScripts, dep))
  }
  for (const fixture of FIXTURES) {
    copyFileSync(join(HARNESS_DIR, '__fixtures__', fixture), join(sandboxFixtures, fixture))
  }

  return { root, harnessDir, repoRoot: root }
}

function env(sandbox) {
  return { harnessDir: sandbox.harnessDir, repoRoot: sandbox.repoRoot }
}

function settingsString(sandbox) {
  return readFileSync(join(sandbox.repoRoot, '.claude', 'settings.json'), 'utf8')
}

function lintstagedString(sandbox) {
  return readFileSync(join(sandbox.repoRoot, '.lintstagedrc.js'), 'utf8')
}

function gitignoreString(sandbox) {
  return readFileSync(join(sandbox.repoRoot, '.gitignore'), 'utf8')
}

function occurrences(haystack, needle) {
  return haystack.split(needle).length - 1
}

function withSandbox(run) {
  const sandbox = buildSandbox()
  try {
    run(sandbox)
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true })
  }
}

test('addGitignoreEntry adds the local config exactly once and is idempotent', () => {
  const base = 'node_modules\n.fallow/\n'
  const once = addGitignoreEntry(base)
  assert.ok(once.includes(GITIGNORE_ENTRY))
  assert.equal(occurrences(once, GITIGNORE_ENTRY), 1)
  const twice = addGitignoreEntry(once)
  assert.equal(twice, once)
})

test('addGitignoreEntry on empty file seeds a single entry', () => {
  const result = addGitignoreEntry('')
  assert.equal(occurrences(result, GITIGNORE_ENTRY), 1)
})

test('buildDefaultConfig honors a custom root_dir and ships hooks off', () => {
  const config = buildDefaultConfig('docs/decisions')
  assert.equal(config.root_dir, 'docs/decisions')
  assert.deepEqual(config.hooks, { pre_commit: false, pre_tool_use: false, post_tool_use: false })
})

test('setHookFlag rejects unknown hooks and flips known ones', () => {
  const config = buildDefaultConfig()
  assert.throws(() => setHookFlag(config, 'bogus', true), /hook desconhecido/)
  const flipped = setHookFlag(config, 'pre_commit', true)
  assert.equal(flipped.hooks.pre_commit, true)
  assert.equal(config.hooks.pre_commit, false)
})

test('applyHookToSettings adds the PreToolUse block without touching third-party blocks', () => {
  withSandbox((sandbox) => {
    const settings = JSON.parse(settingsString(sandbox))
    const before = settings.hooks.PreToolUse.length
    const updated = applyHookToSettings(settings, 'pre_tool_use', true)
    assert.equal(updated.hooks.PreToolUse.length, before + 1)
    const joined = JSON.stringify(updated)
    for (const name of THIRD_PARTY) assert.ok(joined.includes(name))
  })
})

test('applyHookToLintstaged add/remove only governs pre_commit', () => {
  withSandbox((sandbox) => {
    const source = lintstagedString(sandbox)
    const added = applyHookToLintstaged(source, 'pre_commit', true)
    assert.ok(added.includes(ADR_GLOB))
    assert.ok(added.includes(TS_GLOB))
    const removed = applyHookToLintstaged(added, 'pre_commit', false)
    assert.equal(removed, source)
    assert.equal(applyHookToLintstaged(source, 'pre_tool_use', true), source)
  })
})

test('install enables all three hooks and writes the config flags', () => {
  withSandbox((sandbox) => {
    install(env(sandbox), 'docs/adrs')
    assert.deepEqual(queryStatus(env(sandbox)), {
      pre_commit: true,
      pre_tool_use: true,
      post_tool_use: true,
    })
    const config = readConfig(sandbox.harnessDir)
    assert.equal(config.root_dir, 'docs/adrs')
  })
})

test('install wires settings.json and .lintstagedrc.js, preserving third-party entries', () => {
  withSandbox((sandbox) => {
    install(env(sandbox), 'docs/adrs')
    const settings = settingsString(sandbox)
    assert.ok(settings.includes('/.harn/adrs/hooks/pretooluse-validate.mjs'))
    assert.ok(settings.includes('/.harn/adrs/hooks/posttooluse-lint.mjs'))
    for (const name of THIRD_PARTY) assert.ok(settings.includes(name))
    const lintstaged = lintstagedString(sandbox)
    assert.ok(lintstaged.includes(ADR_GLOB))
    assert.ok(lintstaged.includes(TS_GLOB))
  })
})

test('install adds the gitignore entry exactly once even across repeated runs', () => {
  withSandbox((sandbox) => {
    install(env(sandbox), 'docs/adrs')
    const after = gitignoreString(sandbox)
    assert.equal(occurrences(after, GITIGNORE_ENTRY), 1)
    install(env(sandbox), 'docs/adrs')
    assert.equal(occurrences(gitignoreString(sandbox), GITIGNORE_ENTRY), 1)
  })
})

test('install is idempotent: a second run leaves settings and lintstaged byte-identical', () => {
  withSandbox((sandbox) => {
    install(env(sandbox), 'docs/adrs')
    const settingsAfterFirst = settingsString(sandbox)
    const lintstagedAfterFirst = lintstagedString(sandbox)
    install(env(sandbox), 'docs/adrs')
    assert.equal(settingsString(sandbox), settingsAfterFirst)
    assert.equal(lintstagedString(sandbox), lintstagedAfterFirst)
  })
})

test('verify passes after install (legal edit allowed, illegal edit blocked)', () => {
  withSandbox((sandbox) => {
    install(env(sandbox), 'docs/adrs')
    const result = verify(env(sandbox))
    assert.equal(result.ok, true)
    assert.equal(result.legal, true)
    assert.equal(result.illegal, true)
  })
})

test('verify reports not-ok when pre_tool_use is disabled', () => {
  withSandbox((sandbox) => {
    install(env(sandbox), 'docs/adrs')
    setHook(env(sandbox), 'pre_tool_use', false)
    const result = verify(env(sandbox))
    assert.equal(result.ok, false)
    assert.match(result.message, /pre_tool_use/)
  })
})

test('install -> verify -> disable -> verify lifecycle', () => {
  withSandbox((sandbox) => {
    install(env(sandbox), 'docs/adrs')
    assert.equal(verify(env(sandbox)).ok, true)

    setHook(env(sandbox), 'pre_tool_use', false)
    assert.equal(queryStatus(env(sandbox)).pre_tool_use, false)
    assert.equal(verify(env(sandbox)).ok, false)
  })
})

test('disable pre_tool_use removes only the PreToolUse owned block, leaving PostToolUse and third-party intact', () => {
  withSandbox((sandbox) => {
    install(env(sandbox), 'docs/adrs')
    setHook(env(sandbox), 'pre_tool_use', false)
    const settings = settingsString(sandbox)
    assert.ok(!settings.includes('/.harn/adrs/hooks/pretooluse-validate.mjs'))
    assert.ok(settings.includes('/.harn/adrs/hooks/posttooluse-lint.mjs'))
    for (const name of THIRD_PARTY) assert.ok(settings.includes(name))
  })
})

test('disable pre_commit removes only the ADR glob-key, leaving ts/js entry', () => {
  withSandbox((sandbox) => {
    install(env(sandbox), 'docs/adrs')
    setHook(env(sandbox), 'pre_commit', false)
    const lintstaged = lintstagedString(sandbox)
    assert.ok(!lintstaged.includes(ADR_GLOB))
    assert.ok(lintstaged.includes(TS_GLOB))
  })
})

test('full install then disable-all returns settings and lintstaged byte-identical to originals', () => {
  withSandbox((sandbox) => {
    const originalSettings = settingsString(sandbox)
    const originalLintstaged = lintstagedString(sandbox)
    install(env(sandbox), 'docs/adrs')
    setHook(env(sandbox), 'pre_tool_use', false)
    setHook(env(sandbox), 'post_tool_use', false)
    setHook(env(sandbox), 'pre_commit', false)
    assert.equal(settingsString(sandbox), originalSettings)
    assert.equal(lintstagedString(sandbox), originalLintstaged)
  })
})

test('ensureConfig creates config only when absent (install does not touch real harness)', () => {
  withSandbox((sandbox) => {
    assert.equal(existsSync(join(sandbox.harnessDir, 'config.json')), false)
    install(env(sandbox), 'docs/adrs')
    assert.equal(existsSync(join(sandbox.harnessDir, 'config.json')), true)
  })
})

test('install wires the root CLAUDE.md awareness section and is idempotent', () => {
  withSandbox((sandbox) => {
    const claudeFile = join(sandbox.repoRoot, 'CLAUDE.md')
    install(env(sandbox), 'docs/adrs')
    const first = readFileSync(claudeFile, 'utf8')
    assert.ok(first.includes('## Architecture Decision Records (ADRs)'))
    assert.ok(first.includes('docs/adrs'))
    assert.ok(first.includes('/adrs:create'))
    install(env(sandbox), 'docs/adrs')
    assert.equal(readFileSync(claudeFile, 'utf8'), first)
  })
})

test('install appends the ADR section to an existing CLAUDE.md without clobbering its content', () => {
  withSandbox((sandbox) => {
    const claudeFile = join(sandbox.repoRoot, 'CLAUDE.md')
    writeFileSync(claudeFile, '# Projeto\n\nConteúdo existente preservado.\n', 'utf8')
    install(env(sandbox), 'docs/adrs')
    const out = readFileSync(claudeFile, 'utf8')
    assert.ok(out.includes('Conteúdo existente preservado.'))
    assert.ok(out.includes('## Architecture Decision Records (ADRs)'))
  })
})
