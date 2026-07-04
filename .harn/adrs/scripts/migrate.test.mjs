import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, readdirSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

import {
  isConforming,
  numberFromFilename,
  titleFromBody,
  parseProseMeta,
  proposeFrontmatter,
  migrateContent,
  planMigration,
  migrateDir,
} from './setup.mjs'
import { parse } from './frontmatter.mjs'
import { validateCreate, validateEdit, lintTemplate } from './validate.mjs'

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url))
const HARNESS_DIR = join(SCRIPTS_DIR, '..')
const PROSE_ADR_DIR = join(HARNESS_DIR, '__fixtures__', 'prose-adrs')

const REAL_ADRS = [
  '0001-backend-stack.md',
  '0002-fronteira-hexagonal-direcao-dependencia.md',
  '0003-smells-de-qualidade-aceitos.md',
  '0004-calibracao-instrumento-dead-code.md',
  '0005-nao-adotar-contrato-tipado-be-fe.md',
]

const SCRIPT_DEPS = ['validate.mjs', 'frontmatter.mjs', 'state-machine.mjs']

const CONFIG = JSON.parse(readFileSync(join(HARNESS_DIR, 'config.json'), 'utf8'))

function seedAdrCopies() {
  const adrDir = mkdtempSync(join(tmpdir(), 'adr-migrate-'))
  for (const name of REAL_ADRS) {
    copyFileSync(join(PROSE_ADR_DIR, name), join(adrDir, name))
  }
  return adrDir
}

function readFiles(adrDir) {
  const map = {}
  for (const name of readdirSync(adrDir)) {
    map[name] = readFileSync(join(adrDir, name), 'utf8')
  }
  return map
}

function withAdrDir(run) {
  const adrDir = seedAdrCopies()
  try {
    run(adrDir)
  } finally {
    rmSync(adrDir, { recursive: true, force: true })
  }
}

test('numberFromFilename derives the zero-padded number from NNNN-slug.md', () => {
  assert.equal(numberFromFilename('0001-backend-stack.md'), '0001')
  assert.equal(numberFromFilename('docs/adrs/0042-foo-bar.md'), '0042')
  assert.equal(numberFromFilename('README.md'), null)
})

test('titleFromBody strips the # ADR-NNNN — prefix', () => {
  assert.equal(
    titleFromBody('# ADR-0001 — Stack do backend serverless do onboarding PF\n\n- **Status:** Proposed\n'),
    'Stack do backend serverless do onboarding PF',
  )
  assert.equal(titleFromBody('# Plain title\n\nbody'), 'Plain title')
})

test('parseProseMeta extracts the status and date prose lines', () => {
  const src = '# ADR-0002 — x\n\n- **Status:** Accepted\n- **Data:** 2026-06-07\n- **Decisores:** time\n'
  assert.deepEqual(parseProseMeta(src), { status: 'Accepted', date: '2026-06-07' })
})

test('proposeFrontmatter lowercases status and corrects 0001 to accepted', () => {
  const src = readFileSync(join(PROSE_ADR_DIR, '0001-backend-stack.md'), 'utf8')
  const fm = proposeFrontmatter(src, '0001-backend-stack.md')
  assert.equal(fm.number, '0001')
  assert.equal(fm.status, 'accepted')
  assert.equal(fm.date, '2026-05-08')
  assert.equal(fm.status_date, '2026-05-08')
  assert.deepEqual(fm.supersedes, [])
  assert.equal(fm.superseded_by, null)
})

test('proposeFrontmatter keeps a real accepted status lowercased', () => {
  const src = readFileSync(join(PROSE_ADR_DIR, '0002-fronteira-hexagonal-direcao-dependencia.md'), 'utf8')
  const fm = proposeFrontmatter(src, '0002-fronteira-hexagonal-direcao-dependencia.md')
  assert.equal(fm.status, 'accepted')
  assert.equal(fm.date, '2026-06-07')
})

test('migrateContent yields conforming frontmatter and preserves the H1 and body', () => {
  const src = readFileSync(join(PROSE_ADR_DIR, '0003-smells-de-qualidade-aceitos.md'), 'utf8')
  const out = migrateContent(src, '0003-smells-de-qualidade-aceitos.md')
  assert.ok(out.startsWith('---\n'))
  assert.ok(isConforming(out))
  const parsed = parse(out)
  assert.equal(parsed.frontmatter.number, '0003')
  assert.ok(parsed.body.includes('# ADR-0003 — Smells de qualidade aceitos'))
  assert.ok(parsed.body.includes('## Context'))
  assert.ok(parsed.body.includes('## Decision'))
  assert.ok(parsed.body.includes('## Consequences'))
})

test('migrateContent preserves non-schema prose (Decisores, Escopo, Specs) in the body', () => {
  const src = readFileSync(join(PROSE_ADR_DIR, '0004-calibracao-instrumento-dead-code.md'), 'utf8')
  const out = migrateContent(src, '0004-calibracao-instrumento-dead-code.md')
  const parsed = parse(out)
  assert.ok(parsed.body.includes('**Decisores:**'))
  assert.ok(parsed.body.includes('**Escopo:**'))
  assert.ok(parsed.body.includes('**Precedente:**'))
})

test('migrateContent strips only the Status and Data prose lines', () => {
  const src = readFileSync(join(PROSE_ADR_DIR, '0002-fronteira-hexagonal-direcao-dependencia.md'), 'utf8')
  const out = migrateContent(src, '0002-fronteira-hexagonal-direcao-dependencia.md')
  const parsed = parse(out)
  assert.ok(!parsed.body.includes('- **Status:**'))
  assert.ok(!parsed.body.includes('- **Data:**'))
})

test('migrateContent does not mistake the body --- of ADR-0003 for frontmatter', () => {
  const src = readFileSync(join(PROSE_ADR_DIR, '0003-smells-de-qualidade-aceitos.md'), 'utf8')
  assert.equal(isConforming(src), false)
  const out = migrateContent(src, '0003-smells-de-qualidade-aceitos.md')
  const parsed = parse(out)
  assert.equal(parsed.frontmatter.title.includes('---'), false)
  assert.ok(parsed.body.includes('---'))
})

test('migrateDir migrates all five copies and every result passes validate and lint', () => {
  withAdrDir((adrDir) => {
    const result = migrateDir(adrDir, { apply: true })
    assert.equal(result.total, 5)
    assert.equal(result.migrated.length, 5)
    assert.equal(result.alreadyConforming, 0)

    for (const name of REAL_ADRS) {
      const content = readFileSync(join(adrDir, name), 'utf8')
      assert.ok(isConforming(content), `${name} should be conforming`)
      assert.equal(validateCreate(content, CONFIG).ok, true, `${name} should pass validateCreate`)
      assert.equal(lintTemplate(parse(content).body).ok, true, `${name} should pass lintTemplate`)
    }
  })
})

test('migrateDir is idempotent: a second run is a no-op with zero diff', () => {
  withAdrDir((adrDir) => {
    migrateDir(adrDir, { apply: true })
    const afterFirst = readFiles(adrDir)
    const second = migrateDir(adrDir, { apply: true })
    assert.equal(second.migrated.length, 0)
    assert.equal(second.alreadyConforming, 5)
    assert.deepEqual(readFiles(adrDir), afterFirst)
  })
})

test('planMigration reports the raw copies as non-conforming before migration', () => {
  withAdrDir((adrDir) => {
    const plan = planMigration(adrDir)
    assert.equal(plan.length, 5)
    for (const entry of plan) assert.equal(entry.conforming, false, `${entry.name} starts non-conforming`)
  })
})

test('a migrated accepted ADR is then locked: an illegal body edit is rejected by validateEdit', () => {
  withAdrDir((adrDir) => {
    migrateDir(adrDir, { apply: true })
    const file = join(adrDir, '0002-fronteira-hexagonal-direcao-dependencia.md')
    const current = readFileSync(file, 'utf8')
    const tampered = current.replace('## Context', '## Contexto adulterado')
    const result = validateEdit(file, current, tampered, CONFIG)
    assert.equal(result.ok, false)
    assert.equal(result.code, 'immutable_body_changed')
  })
})

function buildHookSandbox(enablePreToolUse) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'adr-migrate-hook-')))
  const sandboxHooks = join(root, '.harn', 'adrs', 'hooks')
  const sandboxScripts = join(root, '.harn', 'adrs', 'scripts')
  const adrDir = join(root, 'docs', 'adrs')
  mkdirSync(sandboxHooks, { recursive: true })
  mkdirSync(sandboxScripts, { recursive: true })
  mkdirSync(adrDir, { recursive: true })
  copyFileSync(
    join(HARNESS_DIR, 'hooks', 'pretooluse-validate.mjs'),
    join(sandboxHooks, 'pretooluse-validate.mjs'),
  )
  for (const dep of SCRIPT_DEPS) {
    copyFileSync(join(HARNESS_DIR, 'scripts', dep), join(sandboxScripts, dep))
  }
  const config = {
    ...CONFIG,
    root_dir: 'docs/adrs',
    hooks: { ...CONFIG.hooks, pre_tool_use: enablePreToolUse },
  }
  writeFileSync(join(root, '.harn', 'adrs', 'config.json'), JSON.stringify(config, null, 2) + '\n', 'utf8')
  return { root, hookPath: join(sandboxHooks, 'pretooluse-validate.mjs'), adrDir }
}

function runHook(hookPath, payload) {
  try {
    execFileSync('node', [hookPath], { input: JSON.stringify(payload), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
    return 0
  } catch (error) {
    return error.status ?? 1
  }
}

test('enabling the PreToolUse hook BEFORE migrating blocks the rewrite (proves the migrate-then-enable invariant)', () => {
  const sandbox = buildHookSandbox(true)
  try {
    const name = '0002-fronteira-hexagonal-direcao-dependencia.md'
    const prose = readFileSync(join(PROSE_ADR_DIR, name), 'utf8')
    const file = join(sandbox.adrDir, name)
    writeFileSync(file, prose, 'utf8')
    const migrated = migrateContent(prose, name)
    const code = runHook(sandbox.hookPath, {
      tool_name: 'Write',
      tool_input: { file_path: file, content: migrated },
    })
    assert.equal(code, 2)
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true })
  }
})

test('with the PreToolUse hook DISABLED the same rewrite is allowed (migrate runs with hooks off)', () => {
  const sandbox = buildHookSandbox(false)
  try {
    const name = '0002-fronteira-hexagonal-direcao-dependencia.md'
    const prose = readFileSync(join(PROSE_ADR_DIR, name), 'utf8')
    const file = join(sandbox.adrDir, name)
    writeFileSync(file, prose, 'utf8')
    const migrated = migrateContent(prose, name)
    const code = runHook(sandbox.hookPath, {
      tool_name: 'Write',
      tool_input: { file_path: file, content: migrated },
    })
    assert.equal(code, 0)
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true })
  }
})
