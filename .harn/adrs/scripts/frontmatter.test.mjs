import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse, serialize } from './frontmatter.mjs'

function withSandbox(name, contents, run) {
  const dir = mkdtempSync(join(tmpdir(), 'adr-frontmatter-'))
  try {
    const path = join(dir, name)
    writeFileSync(path, contents, 'utf8')
    run(path)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const CANONICAL = `---
number: 0007
title: Adotar boundary hexagonal
status: accepted
date: 2026-06-20
status_date: 2026-06-20
supersedes: [1, 2]
superseded_by: null
---

## Context

Texto do contexto.

## Decision

Decisão tomada.

## Consequences

Consequências.
`

test('parse extracts frontmatter fields with correct types', () => {
  const { frontmatter, body } = parse(CANONICAL)
  assert.equal(frontmatter.number, '0007')
  assert.equal(frontmatter.title, 'Adotar boundary hexagonal')
  assert.equal(frontmatter.status, 'accepted')
  assert.equal(frontmatter.date, '2026-06-20')
  assert.equal(frontmatter.status_date, '2026-06-20')
  assert.deepEqual(frontmatter.supersedes, [1, 2])
  assert.equal(frontmatter.superseded_by, null)
  assert.match(body, /## Context/)
})

test('round-trip serialize(parse(x)) === x from a sandbox file', () => {
  withSandbox('adr.md', CANONICAL, (path) => {
    const src = readFileSync(path, 'utf8')
    assert.equal(serialize(parse(src)), src)
  })
})

test('--- in the body is not parsed as frontmatter when line 1 is not ---', () => {
  const src = `# ADR-0003

## Context

Antes da regra.

---

Depois da regra horizontal.
`
  const { frontmatter, body } = parse(src)
  assert.equal(frontmatter, null)
  assert.equal(body, src)
})

test('--- as a horizontal rule in the body of a frontmatter doc stays in the body', () => {
  const src = `---
number: 0003
title: Com regua no corpo
status: accepted
date: 2026-06-20
status_date: 2026-06-20
supersedes: []
superseded_by: null
---

## Context

Antes.

---

Depois.
`
  const { frontmatter, body } = parse(src)
  assert.equal(frontmatter.number, '0003')
  assert.match(body, /\n---\n/)
  assert.equal(serialize({ frontmatter, body }), src)
})

test('empty list and null round-trip', () => {
  const src = `---
number: 0001
title: Lista vazia e null
status: proposed
date: 2026-06-20
status_date: 2026-06-20
supersedes: []
superseded_by: null
---

## Context

Corpo.
`
  const { frontmatter, body } = parse(src)
  assert.deepEqual(frontmatter.supersedes, [])
  assert.equal(frontmatter.superseded_by, null)
  assert.equal(serialize({ frontmatter, body }), src)
})

test('canonical field order is enforced on serialize regardless of input order', () => {
  const out = serialize({
    frontmatter: {
      superseded_by: null,
      supersedes: [],
      status_date: '2026-06-20',
      date: '2026-06-20',
      status: 'accepted',
      title: 'Fora de ordem',
      number: '0009',
    },
    body: '\n## Context\n',
  })
  const order = out
    .split('\n')
    .slice(1, 8)
    .map((line) => line.slice(0, line.indexOf(':')))
  assert.deepEqual(order, [
    'number',
    'title',
    'status',
    'date',
    'status_date',
    'supersedes',
    'superseded_by',
  ])
})

test('a file without --- on line 1 parses to frontmatter:null and whole src as body', () => {
  const src = `- **Status:** Accepted
- **Data:** 2026-06-20

# ADR-0001
`
  const { frontmatter, body } = parse(src)
  assert.equal(frontmatter, null)
  assert.equal(body, src)
})

test('a docs whose closing --- is missing parses to frontmatter:null', () => {
  const src = `---
number: 0001
title: Sem fechamento

## Context
`
  const { frontmatter, body } = parse(src)
  assert.equal(frontmatter, null)
  assert.equal(body, src)
})
