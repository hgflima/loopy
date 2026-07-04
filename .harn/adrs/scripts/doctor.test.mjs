import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generate } from './reindex.mjs'
import { runDoctor, formatReport } from './doctor.mjs'

const CONFIG = {
  version: 1,
  root_dir: 'docs/adrs',
  numbering: 'sequential',
  template: 'template.md',
  lint: 'strict',
  fail_mode: 'closed',
  hooks: { pre_commit: true, pre_tool_use: true, post_tool_use: true },
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

const SETTINGS = {
  hooks: {
    PreToolUse: [
      { matcher: 'Write|Edit|MultiEdit', hooks: [{ type: 'command', command: 'node ${CLAUDE_PROJECT_DIR}/.claude/hooks/no-new-comments.mjs' }] },
      { matcher: 'Write|Edit|MultiEdit', hooks: [{ type: 'command', command: 'node ${CLAUDE_PROJECT_DIR}/.harn/adrs/hooks/pretooluse-validate.mjs' }] },
    ],
    PostToolUse: [
      { matcher: 'Write|Edit|MultiEdit', hooks: [{ type: 'command', command: 'node ${CLAUDE_PROJECT_DIR}/.harn/adrs/hooks/posttooluse-lint.mjs' }] },
    ],
  },
}

const LINTSTAGED =
  "export default {\n  '*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}': 'bash .claude/hooks/quality-gate-staged.sh',\n  'docs/adrs/[0-9][0-9][0-9][0-9]-*.md': 'node .harn/adrs/hooks/precommit-validate.mjs',\n}\n"

function adr({ number, title, status, date = '2026-01-01', statusDate, supersedes = [], supersededBy = null }) {
  return [
    '---',
    `number: ${number}`,
    `title: ${title}`,
    `status: ${status}`,
    `date: ${date}`,
    `status_date: ${statusDate ?? date}`,
    `supersedes: [${supersedes.join(', ')}]`,
    `superseded_by: ${supersededBy == null ? 'null' : supersededBy}`,
    '---',
    '',
    '## Context',
    '',
    'Contexto.',
    '',
    '## Decision',
    '',
    'Decisao.',
    '',
    '## Consequences',
    '',
    'Consequencias.',
    '',
  ].join('\n')
}

function buildSandbox({ adrs, config = CONFIG, settings = SETTINGS, lintstaged = LINTSTAGED, writeReadme = true, readmeOverride }) {
  const root = mkdtempSync(join(tmpdir(), 'adr-doctor-'))
  const rootDir = join(root, 'docs', 'adrs')
  mkdirSync(rootDir, { recursive: true })
  for (const [name, contents] of Object.entries(adrs)) {
    writeFileSync(join(rootDir, name), contents, 'utf8')
  }
  const configPath = join(root, 'config.json')
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8')
  const settingsPath = join(root, 'settings.json')
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8')
  const lintstagedPath = join(root, '.lintstagedrc.js')
  writeFileSync(lintstagedPath, lintstaged, 'utf8')
  if (writeReadme) {
    writeFileSync(join(rootDir, 'README.md'), readmeOverride ?? generate(rootDir), 'utf8')
  }
  return { root, rootDir, configPath, settingsPath, lintstagedPath }
}

function run(sandbox) {
  return runDoctor({
    rootDir: sandbox.rootDir,
    configPath: sandbox.configPath,
    settingsPath: sandbox.settingsPath,
    lintstagedPath: sandbox.lintstagedPath,
  })
}

function checkByName(result, name) {
  return result.checks.find((check) => check.name === name)
}

const CLEAN_ADRS = {
  '0001-backend.md': adr({ number: '0001', title: 'Backend', status: 'accepted' }),
  '0002-old.md': adr({ number: '0002', title: 'Old', status: 'superseded', date: '2026-02-01', supersededBy: 3 }),
  '0003-new.md': adr({ number: '0003', title: 'New', status: 'accepted', date: '2026-03-01', supersedes: [2] }),
  '0004-proposed.md': adr({ number: '0004', title: 'Proposed', status: 'proposed', date: '2026-04-01' }),
}

test('clean fixture set passes all six checks with exit code 0', () => {
  const sandbox = buildSandbox({ adrs: CLEAN_ADRS })
  try {
    const result = run(sandbox)
    assert.equal(result.ok, true)
    assert.equal(result.checks.length, 6)
    assert.ok(result.checks.every((check) => check.ok))
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true })
  }
})

test('flags a duplicate ADR number', () => {
  const sandbox = buildSandbox({
    adrs: {
      ...CLEAN_ADRS,
      '0005-dup.md': adr({ number: '0001', title: 'Dup', status: 'accepted', date: '2026-05-01' }),
    },
  })
  try {
    const result = run(sandbox)
    assert.equal(result.ok, false)
    const numbers = checkByName(result, 'no duplicate numbers; number matches filename')
    assert.equal(numbers.ok, false)
    assert.ok(numbers.problems.some((p) => p.includes('numero duplicado 0001')))
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true })
  }
})

test('flags a one-sided supersede link', () => {
  const sandbox = buildSandbox({
    adrs: {
      '0001-a.md': adr({ number: '0001', title: 'A', status: 'accepted' }),
      '0002-b.md': adr({ number: '0002', title: 'B', status: 'accepted', date: '2026-02-01', supersedes: [1] }),
    },
  })
  try {
    const result = run(sandbox)
    assert.equal(result.ok, false)
    const supersede = checkByName(result, 'supersede links bidirectional')
    assert.equal(supersede.ok, false)
    assert.ok(supersede.problems.some((p) => p.includes('supersede unilateral')))
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true })
  }
})

test('flags an invalid status', () => {
  const sandbox = buildSandbox({
    adrs: {
      '0001-a.md': adr({ number: '0001', title: 'A', status: 'Accepted' }),
    },
  })
  try {
    const result = run(sandbox)
    assert.equal(result.ok, false)
    const template = checkByName(result, 'every record follows template + valid status')
    assert.equal(template.ok, false)
    assert.ok(template.problems.some((p) => p.includes('status invalido "Accepted"')))
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true })
  }
})

test('flags a hook declared in config but absent from settings.json', () => {
  const sandbox = buildSandbox({
    adrs: CLEAN_ADRS,
    settings: {
      hooks: {
        PreToolUse: [
          { matcher: 'Write|Edit|MultiEdit', hooks: [{ type: 'command', command: 'node ${CLAUDE_PROJECT_DIR}/.claude/hooks/no-new-comments.mjs' }] },
        ],
        PostToolUse: [
          { matcher: 'Write|Edit|MultiEdit', hooks: [{ type: 'command', command: 'node ${CLAUDE_PROJECT_DIR}/.harn/adrs/hooks/posttooluse-lint.mjs' }] },
        ],
      },
    },
  })
  try {
    const result = run(sandbox)
    assert.equal(result.ok, false)
    const hooks = checkByName(result, 'hooks declared == installed')
    assert.equal(hooks.ok, false)
    assert.ok(hooks.problems.some((p) => p.includes('pre_tool_use') && p.includes('ausente')))
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true })
  }
})

test('flags a stale README', () => {
  const sandbox = buildSandbox({
    adrs: CLEAN_ADRS,
    readmeOverride: '## Index\n\nstale and wrong\n',
  })
  try {
    const result = run(sandbox)
    assert.equal(result.ok, false)
    const readme = checkByName(result, 'README up to date (regenerate == no diff)')
    assert.equal(readme.ok, false)
    assert.ok(readme.problems.some((p) => p.includes('desatualizado')))
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true })
  }
})

test('flags number that does not match the filename NNNN', () => {
  const sandbox = buildSandbox({
    adrs: {
      '0001-a.md': adr({ number: '0009', title: 'A', status: 'accepted' }),
    },
  })
  try {
    const result = run(sandbox)
    assert.equal(result.ok, false)
    const numbers = checkByName(result, 'no duplicate numbers; number matches filename')
    assert.equal(numbers.ok, false)
    assert.ok(numbers.problems.some((p) => p.includes('diverge do NNNN do filename')))
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true })
  }
})

test('flags a missing root_dir', () => {
  const sandbox = buildSandbox({ adrs: CLEAN_ADRS })
  try {
    const result = runDoctor({
      rootDir: join(sandbox.root, 'docs', 'nonexistent'),
      configPath: sandbox.configPath,
      settingsPath: sandbox.settingsPath,
      lintstagedPath: sandbox.lintstagedPath,
    })
    assert.equal(result.ok, false)
    const config = checkByName(result, 'config valid + root_dir exists')
    assert.equal(config.ok, false)
    assert.ok(config.problems.some((p) => p.includes('root_dir nao existe')))
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true })
  }
})

test('flags an invalid config.json', () => {
  const sandbox = buildSandbox({ adrs: CLEAN_ADRS })
  try {
    writeFileSync(sandbox.configPath, '{ not valid json', 'utf8')
    const result = run(sandbox)
    assert.equal(result.ok, false)
    const config = checkByName(result, 'config valid + root_dir exists')
    assert.equal(config.ok, false)
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true })
  }
})

test('formatReport renders PASS/FAIL lines and a terminal verdict', () => {
  const sandbox = buildSandbox({ adrs: CLEAN_ADRS })
  try {
    const report = formatReport(run(sandbox))
    assert.match(report, /PASS {2}config valid \+ root_dir exists/)
    assert.match(report, /doctor: OK/)
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true })
  }
})

test('does not mutate the source ADR or README files', () => {
  const sandbox = buildSandbox({ adrs: CLEAN_ADRS })
  try {
    const before = generate(sandbox.rootDir)
    run(sandbox)
    const after = generate(sandbox.rootDir)
    assert.equal(after, before)
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true })
  }
})
