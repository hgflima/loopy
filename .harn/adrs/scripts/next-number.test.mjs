import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nextNumber } from './next-number.mjs'

function sandbox(files) {
  const dir = mkdtempSync(join(tmpdir(), 'adr-next-number-'))
  for (const name of files) {
    writeFileSync(join(dir, name), '', 'utf8')
  }
  return dir
}

test('returns 0001 for an empty directory', () => {
  const dir = sandbox([])
  try {
    assert.equal(nextNumber(dir), '0001')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('returns max+1 when ADRs are contiguous', () => {
  const dir = sandbox([
    '0001-first.md',
    '0002-second.md',
    '0003-third.md',
  ])
  try {
    assert.equal(nextNumber(dir), '0004')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('returns max+1 with a gap in numbering (0001, 0003 -> 0004)', () => {
  const dir = sandbox([
    '0001-backend-stack.md',
    '0003-smells.md',
  ])
  try {
    assert.equal(nextNumber(dir), '0004')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('ignores non-ADR files (README.md, CLAUDE.md, template.md)', () => {
  const dir = sandbox([
    '0001-first.md',
    '0002-second.md',
    'README.md',
    'CLAUDE.md',
    'template.md',
  ])
  try {
    assert.equal(nextNumber(dir), '0003')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('pads to 4 digits', () => {
  const dir = sandbox(['0009-adr.md'])
  try {
    assert.equal(nextNumber(dir), '0010')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('reflects reality when 5 existing ADRs are present (0001..0005 -> 0006)', () => {
  const dir = sandbox([
    '0001-backend-stack.md',
    '0002-fronteira-hexagonal.md',
    '0003-smells-de-qualidade.md',
    '0004-calibracao.md',
    '0005-nao-adotar-contrato.md',
  ])
  try {
    assert.equal(nextNumber(dir), '0006')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
