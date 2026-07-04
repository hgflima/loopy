import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, cpSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateCreate, validateEdit, lintTemplate } from './validate.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(HERE, '..', '__fixtures__')

const CONFIG = {
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

function withFixtures(run) {
  const dir = mkdtempSync(join(tmpdir(), 'adr-validate-'))
  try {
    const sandbox = join(dir, '__fixtures__')
    mkdirSync(sandbox)
    cpSync(FIXTURES, sandbox, { recursive: true })
    const read = (name) => readFileSync(join(sandbox, name), 'utf8')
    run(read)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('locked accepted: changing an immutable field is rejected', () => {
  withFixtures((read) => {
    const result = validateEdit(
      'docs/adrs/0007-x.md',
      read('legal-accepted.md'),
      read('illegal-immutable-field-changed.md'),
      CONFIG,
    )
    assert.equal(result.ok, false)
    assert.equal(result.code, 'immutable_field_changed')
    assert.match(result.message, /imut/i)
  })
})

test('locked accepted: changing the body is rejected', () => {
  withFixtures((read) => {
    const result = validateEdit(
      'docs/adrs/0007-x.md',
      read('legal-accepted.md'),
      read('illegal-body-changed.md'),
      CONFIG,
    )
    assert.equal(result.ok, false)
    assert.equal(result.code, 'immutable_body_changed')
  })
})

test('locked accepted: an illegal status transition is rejected', () => {
  withFixtures((read) => {
    const result = validateEdit(
      'docs/adrs/0007-x.md',
      read('legal-accepted.md'),
      read('illegal-transition.md'),
      CONFIG,
    )
    assert.equal(result.ok, false)
    assert.equal(result.code, 'illegal_transition')
  })
})

test('locked accepted: editing only mutable fields and a legal transition passes', () => {
  withFixtures((read) => {
    const result = validateEdit(
      'docs/adrs/0007-x.md',
      read('legal-accepted.md'),
      read('legal-accepted-mutable-edit.md'),
      CONFIG,
    )
    assert.equal(result.ok, true)
    assert.equal(result.code, 'locked_edit_ok')
  })
})

test('locked accepted: no-op edit passes', () => {
  withFixtures((read) => {
    const content = read('legal-accepted.md')
    const result = validateEdit('docs/adrs/0007-x.md', content, content, CONFIG)
    assert.equal(result.ok, true)
    assert.equal(result.code, 'locked_edit_ok')
  })
})

test('unlocked proposed: free edit of body and immutable fields passes', () => {
  withFixtures((read) => {
    const result = validateEdit(
      'docs/adrs/0008-x.md',
      read('legal-proposed.md'),
      read('legal-proposed-free-edit.md'),
      CONFIG,
    )
    assert.equal(result.ok, true)
    assert.equal(result.code, 'legal_transition')
  })
})

test('unlocked proposed: an illegal status transition is still rejected', () => {
  withFixtures((read) => {
    const result = validateEdit(
      'docs/adrs/0008-x.md',
      read('legal-proposed.md'),
      read('illegal-proposed-illegal-transition.md'),
      CONFIG,
    )
    assert.equal(result.ok, false)
    assert.equal(result.code, 'illegal_transition')
  })
})

test('create: status outside initial is rejected', () => {
  withFixtures((read) => {
    const result = validateEdit(
      'docs/adrs/0009-x.md',
      null,
      read('illegal-create-invalid-status.md'),
      CONFIG,
    )
    assert.equal(result.ok, false)
    assert.equal(result.code, 'create_invalid_status')
  })
})

test('create: a legal initial status passes', () => {
  withFixtures((read) => {
    const result = validateEdit('docs/adrs/0008-x.md', null, read('legal-proposed.md'), CONFIG)
    assert.equal(result.ok, true)
    assert.equal(result.code, 'create_ok')
  })
})

test('create: an accepted initial status passes', () => {
  withFixtures((read) => {
    const result = validateCreate(read('legal-accepted.md'), CONFIG)
    assert.equal(result.ok, true)
    assert.equal(result.code, 'create_ok')
  })
})

test('create: content without frontmatter is rejected', () => {
  const result = validateCreate('# ADR sem frontmatter\n\n## Context\n', CONFIG)
  assert.equal(result.ok, false)
  assert.equal(result.code, 'missing_frontmatter')
})

test('lintTemplate: a body missing a required heading fails', () => {
  withFixtures((read) => {
    const { body } = splitBody(read('illegal-template-missing-heading.md'))
    const result = lintTemplate(body)
    assert.equal(result.ok, false)
    assert.equal(result.code, 'template_missing_heading')
    assert.match(result.message, /Consequences/)
  })
})

test('lintTemplate: a body with the three headings passes', () => {
  withFixtures((read) => {
    const { body } = splitBody(read('legal-accepted.md'))
    const result = lintTemplate(body)
    assert.equal(result.ok, true)
    assert.equal(result.code, 'template_ok')
  })
})

test('lintTemplate: extra headings beyond the minimum still pass', () => {
  withFixtures((read) => {
    const { body } = splitBody(read('legal-proposed-free-edit.md'))
    const result = lintTemplate(body)
    assert.equal(result.ok, true)
    assert.equal(result.code, 'template_ok')
  })
})

function splitBody(content) {
  const lines = content.split('\n')
  const closing = lines.indexOf('---', 1)
  return { body: lines.slice(closing + 1).join('\n') }
}
