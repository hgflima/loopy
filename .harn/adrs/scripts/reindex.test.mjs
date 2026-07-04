import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import {
  collectAdrs,
  renderIndex,
  deriveEvents,
  renderReadme,
  generate,
  reindex,
} from './reindex.mjs'

function adr({ number, title, status, date, statusDate, supersedes = [], supersededBy = null }) {
  const fm = [
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
    'Decisão.',
    '',
    '## Consequences',
    '',
    'Consequências.',
    '',
  ]
  return fm.join('\n')
}

function seedSandbox(files) {
  const dir = mkdtempSync(join(tmpdir(), 'adr-reindex-'))
  for (const [name, contents] of Object.entries(files)) {
    writeFileSync(join(dir, name), contents, 'utf8')
  }
  return dir
}

function seedGitSandbox(files) {
  const dir = seedSandbox(files)
  const run = (args) => execFileSync('git', args, { cwd: dir, stdio: ['ignore', 'ignore', 'ignore'] })
  run(['init'])
  run(['config', 'user.email', 'tester@example.com'])
  run(['config', 'user.name', 'Reindex Tester'])
  run(['add', '.'])
  run(['commit', '-m', 'seed adrs'])
  return dir
}

const THREE_ADRS = {
  '0001-alpha.md': adr({ number: '0001', title: 'Alpha', status: 'accepted', date: '2026-01-01' }),
  '0002-beta.md': adr({ number: '0002', title: 'Beta', status: 'proposed', date: '2026-02-01' }),
  '0003-gamma.md': adr({ number: '0003', title: 'Gamma', status: 'accepted', date: '2026-03-01' }),
}

test('collectAdrs returns ADRs sorted by number, skipping non-frontmatter files', () => {
  const dir = seedSandbox({
    ...THREE_ADRS,
    'README.md': '# old readme',
    'CLAUDE.md': 'conventions',
    'notes.txt': 'ignored',
  })
  try {
    const adrs = collectAdrs(dir)
    assert.deepEqual(
      adrs.map((a) => a.frontmatter.number),
      ['0001', '0002', '0003'],
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('renderIndex orders rows deterministically by number regardless of file read order', () => {
  const dir = seedSandbox({
    '0003-gamma.md': THREE_ADRS['0003-gamma.md'],
    '0001-alpha.md': THREE_ADRS['0001-alpha.md'],
    '0002-beta.md': THREE_ADRS['0002-beta.md'],
  })
  try {
    const index = renderIndex(collectAdrs(dir))
    const numbers = index
      .split('\n')
      .filter((line) => /^\| 000\d /.test(line))
      .map((line) => line.split('|')[1].trim())
    assert.deepEqual(numbers, ['0001', '0002', '0003'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('renderIndex renders bidirectional supersede links', () => {
  const dir = seedSandbox({
    '0001-old.md': adr({ number: '0001', title: 'Old', status: 'superseded', date: '2026-01-01', supersededBy: 2 }),
    '0002-new.md': adr({ number: '0002', title: 'New', status: 'accepted', date: '2026-02-01', supersedes: [1] }),
  })
  try {
    const index = renderIndex(collectAdrs(dir))
    assert.match(index, /superseded by \[ADR-0002\]\(\.\/0002-new\.md\)/)
    assert.match(index, /supersedes \[ADR-0001\]\(\.\/0001-old\.md\)/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('reindex is idempotent: generate, regenerate, compare equal (no git)', () => {
  const dir = seedSandbox(THREE_ADRS)
  try {
    const first = reindex(dir)
    const onDisk = readFileSync(join(dir, 'README.md'), 'utf8')
    assert.equal(onDisk, first)
    const second = reindex(dir)
    assert.equal(second, first)
    assert.equal(readFileSync(join(dir, 'README.md'), 'utf8'), first)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('generate degrades gracefully when git history is absent', () => {
  const dir = seedSandbox(THREE_ADRS)
  try {
    const content = generate(dir)
    assert.match(content, /## Index/)
    assert.match(content, /## Changelog/)
    assert.match(content, /2026-01-01 — ADR-0001 created/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('reindex is idempotent inside a real git repo and includes git-derived author', () => {
  const dir = seedGitSandbox(THREE_ADRS)
  try {
    const first = reindex(dir)
    const second = reindex(dir)
    assert.equal(second, first)
    assert.match(first, /ADR-0001 created — Reindex Tester/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('changelog events are ordered by date then number', () => {
  const adrs = [
    { file: '0002-b.md', frontmatter: { number: '0002', title: 'B', status: 'accepted', date: '2026-02-01', status_date: '2026-02-01' } },
    { file: '0001-a.md', frontmatter: { number: '0001', title: 'A', status: 'deprecated', date: '2026-01-01', status_date: '2026-03-01' } },
  ]
  const events = deriveEvents(adrs, () => '')
  assert.deepEqual(
    events.map((e) => `${e.date}:${e.number}:${e.kind}`),
    ['2026-01-01:0001:created', '2026-02-01:0002:created', '2026-03-01:0001:transition'],
  )
})

test('renderReadme combines index and changelog sections', () => {
  const dir = seedSandbox(THREE_ADRS)
  try {
    const adrs = collectAdrs(dir)
    const events = deriveEvents(adrs, () => '')
    const out = renderReadme(adrs, events)
    assert.ok(out.indexOf('## Index') < out.indexOf('## Changelog'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('reindex creates README without a __fixtures__ dependency and never mutates source ADRs', () => {
  const dir = seedSandbox(THREE_ADRS)
  try {
    const before = readFileSync(join(dir, '0001-alpha.md'), 'utf8')
    reindex(dir)
    const after = readFileSync(join(dir, '0001-alpha.md'), 'utf8')
    assert.equal(after, before)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('collectAdrs on a missing root_dir returns empty without throwing', () => {
  const dir = seedSandbox({})
  const missing = join(dir, 'does-not-exist')
  try {
    assert.deepEqual(collectAdrs(missing), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('seedSandbox supports a directory created via mkdirSync helper for nested fixtures', () => {
  const dir = mkdtempSync(join(tmpdir(), 'adr-reindex-nested-'))
  try {
    const nested = join(dir, 'docs', 'adrs')
    mkdirSync(nested, { recursive: true })
    writeFileSync(join(nested, '0001-x.md'), THREE_ADRS['0001-alpha.md'], 'utf8')
    const adrs = collectAdrs(nested)
    assert.equal(adrs.length, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
