import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  checkTransition,
  TRANSITIONS,
  INITIAL_STATUSES,
  TERMINAL_STATUSES,
} from './state-machine.mjs'

const config = {
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

const ALL_STATUSES = ['proposed', 'accepted', 'rejected', 'deprecated', 'superseded']

test('exported table mirrors the spec transition map', () => {
  assert.deepEqual(TRANSITIONS, {
    proposed: ['accepted', 'rejected'],
    accepted: ['deprecated', 'superseded'],
    rejected: [],
    deprecated: [],
    superseded: [],
  })
  assert.deepEqual(INITIAL_STATUSES, ['proposed', 'accepted'])
  assert.deepEqual(TERMINAL_STATUSES, ['rejected', 'deprecated', 'superseded'])
})

test('every legal transition cell is accepted', () => {
  for (const from of ALL_STATUSES) {
    for (const to of config.state_machine.transitions[from]) {
      const result = checkTransition(from, to, config)
      assert.equal(result.ok, true, `${from} -> ${to} should be legal`)
      assert.equal(result.code, 'legal_transition')
      assert.equal(typeof result.message, 'string')
    }
  }
})

test('every illegal transition cell is rejected', () => {
  for (const from of ALL_STATUSES) {
    const legal = new Set(config.state_machine.transitions[from])
    for (const to of ALL_STATUSES) {
      if (to === from) continue
      if (legal.has(to)) continue
      const result = checkTransition(from, to, config)
      assert.equal(result.ok, false, `${from} -> ${to} should be illegal`)
      assert.equal(result.code, 'illegal_transition')
      assert.equal(typeof result.message, 'string')
    }
  }
})

test('an unchanged status is accepted for every state', () => {
  for (const status of ALL_STATUSES) {
    const result = checkTransition(status, status, config)
    assert.equal(result.ok, true, `${status} -> ${status} should be accepted`)
    assert.equal(result.code, 'unchanged')
  }
})

test('terminal statuses never leave to any other state', () => {
  for (const from of TERMINAL_STATUSES) {
    assert.deepEqual(config.state_machine.transitions[from], [])
    for (const to of ALL_STATUSES) {
      if (to === from) continue
      const result = checkTransition(from, to, config)
      assert.equal(result.ok, false, `terminal ${from} must not reach ${to}`)
      assert.equal(result.code, 'illegal_transition')
    }
  }
})

test('an unknown source status yields a structured rejection', () => {
  const result = checkTransition('archived', 'accepted', config)
  assert.equal(result.ok, false)
  assert.equal(result.code, 'unknown_status')
  assert.equal(typeof result.message, 'string')
})

test('checkTransition reads the transition table from the passed config, not a hardcoded import', () => {
  const restrictedConfig = {
    state_machine: {
      transitions: {
        proposed: ['accepted'],
        accepted: [],
      },
    },
  }
  const blocked = checkTransition('proposed', 'rejected', restrictedConfig)
  assert.equal(blocked.ok, false)
  assert.equal(blocked.code, 'illegal_transition')

  const allowed = checkTransition('proposed', 'accepted', restrictedConfig)
  assert.equal(allowed.ok, true)
  assert.equal(allowed.code, 'legal_transition')
})
