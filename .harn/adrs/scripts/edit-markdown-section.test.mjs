import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { replaceSection, hasSection } from './edit-markdown-section.mjs'

const HEADING = '## Architecture Decision Records (ADRs)'
const BODY = 'Read before changing architecture.\n\nUse the adr_management skill.'

function sandbox() {
  return mkdtempSync(join(tmpdir(), 'adr-markdown-'))
}

test('appends the section at EOF when the heading is absent', () => {
  const source = '# Title\n\nIntro paragraph.\n'
  const result = replaceSection(source, HEADING, BODY)
  assert.ok(result.startsWith('# Title\n\nIntro paragraph.'))
  assert.ok(result.includes(HEADING))
  assert.ok(result.includes('Use the adr_management skill.'))
  assert.ok(hasSection(result, HEADING))
})

test('replace is idempotent when appending', () => {
  const source = '# Title\n\nIntro paragraph.\n'
  const once = replaceSection(source, HEADING, BODY)
  const twice = replaceSection(once, HEADING, BODY)
  assert.equal(twice, once)
})

test('replaces the section in place up to the next heading of equal level', () => {
  const source = [
    '# Title',
    '',
    '## Architecture Decision Records (ADRs)',
    '',
    'old pointer text',
    '',
    '## Other Section',
    '',
    'keep me',
    '',
  ].join('\n')
  const result = replaceSection(source, HEADING, BODY)
  assert.ok(result.includes('Use the adr_management skill.'))
  assert.ok(!result.includes('old pointer text'))
  assert.ok(result.includes('## Other Section'))
  assert.ok(result.includes('keep me'))
})

test('replace in place is idempotent', () => {
  const source = [
    '# Title',
    '',
    '## Architecture Decision Records (ADRs)',
    '',
    'old pointer text',
    '',
    '## Other Section',
    '',
    'keep me',
    '',
  ].join('\n')
  const once = replaceSection(source, HEADING, BODY)
  const twice = replaceSection(once, HEADING, BODY)
  assert.equal(twice, once)
})

test('does not consume a deeper subheading that follows the section', () => {
  const source = [
    '## Architecture Decision Records (ADRs)',
    '',
    'pointer',
    '',
    '### Sub note',
    '',
    'detail',
    '',
    '## Next',
    '',
    'tail',
    '',
  ].join('\n')
  const result = replaceSection(source, HEADING, BODY)
  assert.ok(!result.includes('### Sub note'))
  assert.ok(!result.includes('detail'))
  assert.ok(result.includes('## Next'))
  assert.ok(result.includes('tail'))
})

test('stops at a higher-level heading that follows the section', () => {
  const source = [
    '## Architecture Decision Records (ADRs)',
    '',
    'pointer',
    '',
    '# Top Level After',
    '',
    'tail',
    '',
  ].join('\n')
  const result = replaceSection(source, HEADING, BODY)
  assert.ok(!result.includes('pointer'))
  assert.ok(result.includes('# Top Level After'))
  assert.ok(result.includes('tail'))
})

test('creates the section when the source is empty', () => {
  const result = replaceSection('', HEADING, BODY)
  assert.ok(result.startsWith(HEADING))
  assert.ok(result.endsWith('\n'))
  assert.ok(hasSection(result, HEADING))
})

test('hasSection is false before and true after replace', () => {
  const source = '# Title\n\nIntro.\n'
  assert.equal(hasSection(source, HEADING), false)
  assert.equal(hasSection(replaceSection(source, HEADING, BODY), HEADING), true)
})

test('round-trips a copy written to a sandbox file', () => {
  const dir = sandbox()
  const file = join(dir, 'CLAUDE.md')
  writeFileSync(file, '# Title\n\nIntro.\n')
  const original = readFileSync(file, 'utf8')
  writeFileSync(file, replaceSection(original, HEADING, BODY))
  const first = readFileSync(file, 'utf8')
  writeFileSync(file, replaceSection(first, HEADING, BODY))
  assert.equal(readFileSync(file, 'utf8'), first)
})

test('preserves CRLF when appending', () => {
  const source = '# Title\r\n\r\nIntro.\r\n'
  const result = replaceSection(source, HEADING, 'line one\r\nline two')
  assert.ok(result.includes('\r\n'))
  assert.ok(!/(?<!\r)\n/.test(result))
})
