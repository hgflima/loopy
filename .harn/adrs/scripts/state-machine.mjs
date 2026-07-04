export const TRANSITIONS = {
  proposed: ['accepted', 'rejected'],
  accepted: ['deprecated', 'superseded'],
  rejected: [],
  deprecated: [],
  superseded: [],
}

export const INITIAL_STATUSES = ['proposed', 'accepted']

export const TERMINAL_STATUSES = ['rejected', 'deprecated', 'superseded']

function transitionsFor(config, from) {
  const table = config?.state_machine?.transitions ?? TRANSITIONS
  return table[from] ?? null
}

export function checkTransition(from, to, config) {
  const allowed = transitionsFor(config, from)
  if (allowed == null) {
    return {
      ok: false,
      code: 'unknown_status',
      message: `Status desconhecido na máquina de estados: "${from}".`,
    }
  }
  if (from === to) {
    return {
      ok: true,
      code: 'unchanged',
      message: `Status inalterado: "${from}".`,
    }
  }
  if (allowed.includes(to)) {
    return {
      ok: true,
      code: 'legal_transition',
      message: `Transição permitida: "${from}" → "${to}".`,
    }
  }
  return {
    ok: false,
    code: 'illegal_transition',
    message: `Transição ilegal: "${from}" → "${to}". Permitidas a partir de "${from}": ${
      allowed.length ? allowed.join(', ') : '(nenhuma — estado terminal)'
    }.`,
  }
}
