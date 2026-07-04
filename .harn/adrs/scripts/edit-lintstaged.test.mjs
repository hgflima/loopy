import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { add, remove, hasAdrEntry } from './edit-lintstaged.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const realLintstaged = join(here, '..', '__fixtures__', 'repo', 'lintstagedrc.js')

function sandbox() {
  return mkdtempSync(join(tmpdir(), 'adr-lintstaged-'))
}

const ADR_GLOB = 'docs/adrs/[0-9][0-9][0-9][0-9]-*.md'
const TS_GLOB = '*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}'

test('add then remove is byte-identical over a copy of the real .lintstagedrc.js', () => {
  const dir = sandbox()
  const copy = join(dir, '.lintstagedrc.js')
  copyFileSync(realLintstaged, copy)
  const original = readFileSync(copy, 'utf8')

  const added = add(original)
  writeFileSync(copy, added)
  const removed = remove(readFileSync(copy, 'utf8'))
  writeFileSync(copy, removed)

  assert.equal(readFileSync(copy, 'utf8'), original)
})

test('add inserts the ADR glob-key and preserves the existing ts/js entry', () => {
  const original = readFileSync(realLintstaged, 'utf8')
  const added = add(original)
  assert.ok(added.includes(ADR_GLOB))
  assert.ok(added.includes('node .harn/adrs/hooks/precommit-validate.mjs'))
  assert.ok(added.includes(TS_GLOB))
  assert.ok(added.includes('bash .claude/hooks/quality-gate-staged.sh'))
})

test('add is idempotent (second call is a no-op)', () => {
  const original = readFileSync(realLintstaged, 'utf8')
  const once = add(original)
  const twice = add(once)
  assert.equal(twice, once)
})

test('remove drops only the ADR key and leaves the ts/js entry', () => {
  const original = readFileSync(realLintstaged, 'utf8')
  const added = add(original)
  const removed = remove(added)
  assert.ok(!removed.includes(ADR_GLOB))
  assert.ok(removed.includes(TS_GLOB))
  assert.equal(removed, original)
})

test('remove on a source without the ADR key is a no-op', () => {
  const original = readFileSync(realLintstaged, 'utf8')
  assert.equal(remove(original), original)
})

test('hasAdrEntry reflects presence', () => {
  const original = readFileSync(realLintstaged, 'utf8')
  assert.equal(hasAdrEntry(original), false)
  assert.equal(hasAdrEntry(add(original)), true)
})

test('preserves double-quote style when the file uses double quotes', () => {
  const dquote = 'export default {\n  "*.{ts,tsx}": "bash run.sh",\n}\n'
  const added = add(dquote)
  assert.ok(added.includes(`"${ADR_GLOB}"`))
  assert.ok(!added.includes(`'${ADR_GLOB}'`))
  assert.equal(remove(added), dquote)
})

test('preserves CRLF line endings', () => {
  const crlf = "export default {\r\n  '*.{ts}': 'x',\r\n}\r\n"
  const added = add(crlf)
  assert.ok(added.includes('\r\n'))
  assert.ok(!/(?<!\r)\n/.test(added))
  assert.equal(remove(added), crlf)
})

test('round-trips when the existing last entry has no trailing comma', () => {
  const noComma = "export default {\n  '*.{ts}': 'x'\n}\n"
  const added = add(noComma)
  assert.ok(added.includes(ADR_GLOB))
  assert.equal(remove(added), noComma)
})
