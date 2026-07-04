import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const HOOKS_DIR = dirname(fileURLToPath(import.meta.url))
const SCRIPTS_DIR = join(HOOKS_DIR, '..', 'scripts')
const HOOK_NAME = 'pretooluse-validate.mjs'
const SCRIPT_DEPS = ['validate.mjs', 'frontmatter.mjs', 'state-machine.mjs']

const ACCEPTED_ADR = [
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
  'O backend cresceu sem fronteiras explícitas.',
  '',
  '## Decision',
  '',
  'Adotar arquitetura hexagonal.',
  '',
  '## Consequences',
  '',
  'Dependências apontam para dentro.',
  '',
].join('\n')

const PROPOSED_ADR = ACCEPTED_ADR.replace('status: accepted', 'status: proposed')

function baseConfig(rootDir, overrides = {}) {
  return {
    version: 1,
    root_dir: rootDir,
    fail_mode: 'closed',
    hooks: { pre_commit: true, pre_tool_use: true, post_tool_use: true, ...overrides },
    state_machine: {
      initial: ['proposed', 'accepted'],
      unlocked_statuses: ['proposed'],
      transitions: {
        proposed: ['accepted', 'rejected'],
        accepted: ['deprecated', 'superseded'],
        rejected: [],
        deprecated: [],
        superseded: [],
      },
      mutable_fields: ['status', 'status_date', 'supersedes', 'superseded_by'],
    },
  }
}

function buildSandbox(configHooks = {}) {
  const root = mkdtempSync(join(tmpdir(), 'adr-pretooluse-'))
  const harnessDir = join(root, '.harn', 'adrs')
  const sandboxHooks = join(harnessDir, 'hooks')
  const sandboxScripts = join(harnessDir, 'scripts')
  const adrDir = join(root, 'docs', 'adrs')
  mkdirSync(sandboxHooks, { recursive: true })
  mkdirSync(sandboxScripts, { recursive: true })
  mkdirSync(adrDir, { recursive: true })
  copyFileSync(join(HOOKS_DIR, HOOK_NAME), join(sandboxHooks, HOOK_NAME))
  for (const dep of SCRIPT_DEPS) {
    copyFileSync(join(SCRIPTS_DIR, dep), join(sandboxScripts, dep))
  }
  writeFileSync(
    join(harnessDir, 'config.json'),
    JSON.stringify(baseConfig(adrDir, configHooks), null, 2),
    'utf8',
  )
  return { root, hookPath: join(sandboxHooks, HOOK_NAME), adrDir }
}

function runHook(hookPath, payload) {
  try {
    const stdout = execFileSync('node', [hookPath], {
      input: JSON.stringify(payload),
      encoding: 'utf8',
    })
    return { code: 0, stdout, stderr: '' }
  } catch (error) {
    return { code: error.status, stdout: error.stdout ?? '', stderr: error.stderr ?? '' }
  }
}

test('legal mutable-field edit on accepted ADR passes (exit 0)', () => {
  const { root, hookPath, adrDir } = buildSandbox()
  try {
    const file = join(adrDir, '0007-hexagonal.md')
    writeFileSync(file, ACCEPTED_ADR, 'utf8')
    const result = runHook(hookPath, {
      tool_name: 'Edit',
      tool_input: {
        file_path: file,
        old_string: 'status: accepted',
        new_string: 'status: deprecated',
      },
    })
    assert.equal(result.code, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('illegal body edit on accepted ADR is blocked (exit 2, actionable stderr)', () => {
  const { root, hookPath, adrDir } = buildSandbox()
  try {
    const file = join(adrDir, '0007-hexagonal.md')
    writeFileSync(file, ACCEPTED_ADR, 'utf8')
    const result = runHook(hookPath, {
      tool_name: 'Edit',
      tool_input: {
        file_path: file,
        old_string: 'Adotar arquitetura hexagonal.',
        new_string: 'Mudar a decisão depois de aceita.',
      },
    })
    assert.equal(result.code, 2)
    assert.match(result.stderr, /BLOQUEADO \(adr_management\)/)
    assert.match(result.stderr, /\/adrs:setup --disable pre_tool_use/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('illegal status transition on accepted ADR is blocked (exit 2)', () => {
  const { root, hookPath, adrDir } = buildSandbox()
  try {
    const file = join(adrDir, '0007-hexagonal.md')
    writeFileSync(file, ACCEPTED_ADR, 'utf8')
    const result = runHook(hookPath, {
      tool_name: 'Edit',
      tool_input: {
        file_path: file,
        old_string: 'status: accepted',
        new_string: 'status: rejected',
      },
    })
    assert.equal(result.code, 2)
    assert.match(result.stderr, /Transição ilegal/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('free edit on proposed ADR passes (unlocked status)', () => {
  const { root, hookPath, adrDir } = buildSandbox()
  try {
    const file = join(adrDir, '0008-banking.md')
    writeFileSync(file, PROPOSED_ADR, 'utf8')
    const result = runHook(hookPath, {
      tool_name: 'Edit',
      tool_input: {
        file_path: file,
        old_string: 'Adotar arquitetura hexagonal.',
        new_string: 'Reescrita livre permitida enquanto proposto.',
      },
    })
    assert.equal(result.code, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('Write of a new ADR with legal initial status passes', () => {
  const { root, hookPath, adrDir } = buildSandbox()
  try {
    const file = join(adrDir, '0009-novo.md')
    const result = runHook(hookPath, {
      tool_name: 'Write',
      tool_input: { file_path: file, content: PROPOSED_ADR },
    })
    assert.equal(result.code, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('MultiEdit chaining illegal body change on accepted ADR is blocked (exit 2)', () => {
  const { root, hookPath, adrDir } = buildSandbox()
  try {
    const file = join(adrDir, '0007-hexagonal.md')
    writeFileSync(file, ACCEPTED_ADR, 'utf8')
    const result = runHook(hookPath, {
      tool_name: 'MultiEdit',
      tool_input: {
        file_path: file,
        edits: [
          { old_string: 'status: accepted', new_string: 'status: deprecated' },
          { old_string: 'Dependências apontam para dentro.', new_string: 'Corpo mudou ilegalmente.' },
        ],
      },
    })
    assert.equal(result.code, 2)
    assert.match(result.stderr, /Corpo de ADR travado/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('path outside root_dir is a no-op (exit 0)', () => {
  const { root, hookPath } = buildSandbox()
  try {
    const file = join(root, 'src', '0007-hexagonal.md')
    const result = runHook(hookPath, {
      tool_name: 'Edit',
      tool_input: { file_path: file, old_string: 'a', new_string: 'b' },
    })
    assert.equal(result.code, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('excluded basenames (README/CLAUDE/template) are no-ops (exit 0)', () => {
  const { root, hookPath, adrDir } = buildSandbox()
  try {
    for (const name of ['README.md', 'CLAUDE.md', 'template.md']) {
      const file = join(adrDir, name)
      writeFileSync(file, 'conteúdo qualquer', 'utf8')
      const result = runHook(hookPath, {
        tool_name: 'Edit',
        tool_input: { file_path: file, old_string: 'conteúdo', new_string: 'outro' },
      })
      assert.equal(result.code, 0)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('non-ADR filename in root_dir is a no-op (exit 0)', () => {
  const { root, hookPath, adrDir } = buildSandbox()
  try {
    const file = join(adrDir, 'notes.md')
    writeFileSync(file, 'qualquer', 'utf8')
    const result = runHook(hookPath, {
      tool_name: 'Edit',
      tool_input: { file_path: file, old_string: 'qualquer', new_string: 'outro' },
    })
    assert.equal(result.code, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('non-edit tool is a no-op (exit 0)', () => {
  const { root, hookPath, adrDir } = buildSandbox()
  try {
    const file = join(adrDir, '0007-hexagonal.md')
    writeFileSync(file, ACCEPTED_ADR, 'utf8')
    const result = runHook(hookPath, {
      tool_name: 'Read',
      tool_input: { file_path: file },
    })
    assert.equal(result.code, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('flag off (pre_tool_use false) is a no-op even for illegal edit', () => {
  const { root, hookPath, adrDir } = buildSandbox({ pre_tool_use: false })
  try {
    const file = join(adrDir, '0007-hexagonal.md')
    writeFileSync(file, ACCEPTED_ADR, 'utf8')
    const result = runHook(hookPath, {
      tool_name: 'Edit',
      tool_input: {
        file_path: file,
        old_string: 'Adotar arquitetura hexagonal.',
        new_string: 'Mudança ilegal mas hook desligado.',
      },
    })
    assert.equal(result.code, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('flag absent (no pre_tool_use key) is a no-op', () => {
  const root = mkdtempSync(join(tmpdir(), 'adr-pretooluse-noflag-'))
  try {
    const harnessDir = join(root, '.harn', 'adrs')
    const sandboxHooks = join(harnessDir, 'hooks')
    const sandboxScripts = join(harnessDir, 'scripts')
    const adrDir = join(root, 'docs', 'adrs')
    mkdirSync(sandboxHooks, { recursive: true })
    mkdirSync(sandboxScripts, { recursive: true })
    mkdirSync(adrDir, { recursive: true })
    copyFileSync(join(HOOKS_DIR, HOOK_NAME), join(sandboxHooks, HOOK_NAME))
    for (const dep of SCRIPT_DEPS) {
      copyFileSync(join(SCRIPTS_DIR, dep), join(sandboxScripts, dep))
    }
    const config = baseConfig(adrDir)
    delete config.hooks.pre_tool_use
    writeFileSync(join(harnessDir, 'config.json'), JSON.stringify(config, null, 2), 'utf8')
    const file = join(adrDir, '0007-hexagonal.md')
    writeFileSync(file, ACCEPTED_ADR, 'utf8')
    const result = runHook(join(sandboxHooks, HOOK_NAME), {
      tool_name: 'Edit',
      tool_input: {
        file_path: file,
        old_string: 'Adotar arquitetura hexagonal.',
        new_string: 'Mudança ilegal sem flag.',
      },
    })
    assert.equal(result.code, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('config.local.json shallow-overrides config.json (turns hook off)', () => {
  const { root, hookPath, adrDir } = buildSandbox()
  try {
    const harnessDir = join(root, '.harn', 'adrs')
    writeFileSync(
      join(harnessDir, 'config.local.json'),
      JSON.stringify({ hooks: { pre_tool_use: false } }),
      'utf8',
    )
    const file = join(adrDir, '0007-hexagonal.md')
    writeFileSync(file, ACCEPTED_ADR, 'utf8')
    const result = runHook(hookPath, {
      tool_name: 'Edit',
      tool_input: {
        file_path: file,
        old_string: 'Adotar arquitetura hexagonal.',
        new_string: 'Override local desliga o hook.',
      },
    })
    assert.equal(result.code, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('internal error with hook enabled fails closed (exit 2, disable hint)', () => {
  const { root, hookPath, adrDir } = buildSandbox()
  try {
    const file = join(adrDir, '0007-hexagonal.md')
    writeFileSync(file, ACCEPTED_ADR, 'utf8')
    const result = runHook(hookPath, {
      tool_name: 'Edit',
      tool_input: {
        file_path: file,
        old_string: 'STRING QUE NÃO EXISTE NO ARQUIVO',
        new_string: 'qualquer',
      },
    })
    assert.equal(result.code, 2)
    assert.match(result.stderr, /erro interno/)
    assert.match(result.stderr, /\/adrs:setup --disable pre_tool_use/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('malformed stdin JSON is a no-op (exit 0, never blocks the tool)', () => {
  const { root, hookPath } = buildSandbox()
  try {
    const result = (() => {
      try {
        const stdout = execFileSync('node', [hookPath], { input: 'not json', encoding: 'utf8' })
        return { code: 0, stdout }
      } catch (error) {
        return { code: error.status }
      }
    })()
    assert.equal(result.code, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
