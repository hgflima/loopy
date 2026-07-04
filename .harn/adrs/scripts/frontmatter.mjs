const DELIMITER = '---'

const FIELD_ORDER = [
  'number',
  'title',
  'status',
  'date',
  'status_date',
  'supersedes',
  'superseded_by',
]

function parseScalar(raw) {
  const value = raw.trim()
  if (value === 'null') return null
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim()
    if (inner === '') return []
    return inner.split(',').map((item) => Number(item.trim()))
  }
  return value
}

function serializeScalar(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return `[${value.join(', ')}]`
  return String(value)
}

function findClosingDelimiter(lines) {
  for (let index = 1; index < lines.length; index++) {
    if (lines[index] === DELIMITER) return index
  }
  return -1
}

export function parse(src) {
  const lines = src.split('\n')
  if (lines[0] !== DELIMITER) {
    return { frontmatter: null, body: src }
  }
  const closingIndex = findClosingDelimiter(lines)
  if (closingIndex === -1) {
    return { frontmatter: null, body: src }
  }

  const frontmatter = {}
  for (let index = 1; index < closingIndex; index++) {
    const line = lines[index]
    const separatorIndex = line.indexOf(':')
    if (separatorIndex === -1) continue
    const key = line.slice(0, separatorIndex).trim()
    const rawValue = line.slice(separatorIndex + 1)
    frontmatter[key] = parseScalar(rawValue)
  }

  const body = lines.slice(closingIndex + 1).join('\n')
  return { frontmatter, body }
}

export function serialize({ frontmatter, body }) {
  if (frontmatter == null) return body

  const keys = [
    ...FIELD_ORDER.filter((key) => key in frontmatter),
    ...Object.keys(frontmatter).filter((key) => !FIELD_ORDER.includes(key)),
  ]

  const fieldLines = keys.map((key) => `${key}: ${serializeScalar(frontmatter[key])}`)
  return [DELIMITER, ...fieldLines, DELIMITER, body].join('\n')
}
