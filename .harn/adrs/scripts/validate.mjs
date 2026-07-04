import { parse } from './frontmatter.mjs'
import { checkTransition } from './state-machine.mjs'

const REQUIRED_HEADINGS = ['## Context', '## Decision', '## Consequences']

function initialStatuses(config) {
  return config?.state_machine?.initial ?? []
}

function unlockedStatuses(config) {
  return config?.state_machine?.unlocked_statuses ?? []
}

function mutableFields(config) {
  return config?.state_machine?.mutable_fields ?? []
}

function frontmatterValuesEqual(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, index) => value === b[index])
  }
  return a === b
}

function collectFieldKeys(...frontmatters) {
  const keys = new Set()
  for (const frontmatter of frontmatters) {
    for (const key of Object.keys(frontmatter ?? {})) keys.add(key)
  }
  return keys
}

export function lintTemplate(body) {
  const missing = REQUIRED_HEADINGS.filter((heading) => !body.includes(heading))
  if (missing.length === 0) {
    return {
      ok: true,
      code: 'template_ok',
      message: 'Template em conformidade: Context, Decision e Consequences presentes.',
    }
  }
  return {
    ok: false,
    code: 'template_missing_heading',
    message: `Template incompleto: faltam os headings obrigatórios ${missing.join(', ')}.`,
  }
}

export function validateCreate(proposedContent, config) {
  const parsed = parse(proposedContent)
  if (parsed.frontmatter == null) {
    return {
      ok: false,
      code: 'missing_frontmatter',
      message: 'ADR sem frontmatter: a linha 1 precisa ser "---" com o schema canônico.',
    }
  }
  const status = parsed.frontmatter.status
  const allowed = initialStatuses(config)
  if (!allowed.includes(status)) {
    return {
      ok: false,
      code: 'create_invalid_status',
      message: `Status inicial inválido na criação: "${status}". Permitidos: ${allowed.join(', ')}.`,
    }
  }
  return {
    ok: true,
    code: 'create_ok',
    message: `Criação permitida com status inicial "${status}".`,
  }
}

function checkLocked(current, next, config) {
  if (next.frontmatter == null) {
    return {
      ok: false,
      code: 'missing_frontmatter',
      message: 'ADR travado sem frontmatter válido: a linha 1 precisa ser "---".',
    }
  }

  const mutable = new Set(mutableFields(config))
  const keys = collectFieldKeys(current.frontmatter, next.frontmatter)
  for (const key of keys) {
    if (mutable.has(key)) continue
    const before = current.frontmatter?.[key]
    const after = next.frontmatter?.[key]
    if (!frontmatterValuesEqual(before, after)) {
      return {
        ok: false,
        code: 'immutable_field_changed',
        message: `Campo imutável alterado em ADR travado: "${key}". Apenas ${mutableFields(config).join(', ')} podem mudar.`,
      }
    }
  }

  if (current.body !== next.body) {
    return {
      ok: false,
      code: 'immutable_body_changed',
      message: 'Corpo de ADR travado foi alterado. Em status travado o corpo é imutável.',
    }
  }

  const fromStatus = current.frontmatter.status
  const toStatus = next.frontmatter.status
  if (fromStatus !== toStatus) {
    const transition = checkTransition(fromStatus, toStatus, config)
    if (!transition.ok) return transition
  }

  return {
    ok: true,
    code: 'locked_edit_ok',
    message: 'Edição permitida: apenas campos mutáveis e/ou transição de status legal.',
  }
}

export function validateEdit(path, currentContent, proposedContent, config) {
  if (currentContent == null) {
    return validateCreate(proposedContent, config)
  }

  const current = parse(currentContent)
  const next = parse(proposedContent)

  if (current.frontmatter == null) {
    return {
      ok: false,
      code: 'missing_frontmatter',
      message: `ADR atual sem frontmatter válido (${path}): migre para o schema canônico antes de editar.`,
    }
  }
  if (next.frontmatter == null) {
    return {
      ok: false,
      code: 'missing_frontmatter',
      message: 'Edição removeria o frontmatter do ADR: a linha 1 precisa permanecer "---".',
    }
  }

  if (unlockedStatuses(config).includes(current.frontmatter.status)) {
    return checkTransition(current.frontmatter.status, next.frontmatter.status, config)
  }

  return checkLocked(current, next, config)
}
