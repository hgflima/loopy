const ADR_GLOB = 'docs/adrs/[0-9][0-9][0-9][0-9]-*.md'
const ADR_COMMAND = 'node .harn/adrs/hooks/precommit-validate.mjs'

function detectEol(source) {
  return source.includes('\r\n') ? '\r\n' : '\n'
}

function detectQuote(source) {
  const single = (source.match(/'/g) || []).length
  const double = (source.match(/"/g) || []).length
  return double > single ? '"' : "'"
}

function detectIndent(source) {
  const match = source.match(/\n([ \t]+)\S/)
  return match ? match[1] : '  '
}

function openingBraceIndex(lines) {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('{')) return i
  }
  return -1
}

export function hasAdrEntry(source) {
  return source.includes(ADR_GLOB)
}

export function add(source) {
  if (hasAdrEntry(source)) return source
  const eol = detectEol(source)
  const quote = detectQuote(source)
  const indent = detectIndent(source)
  const lines = source.split(eol)
  const openIndex = openingBraceIndex(lines)
  if (openIndex < 0) return source
  const entry = `${indent}${quote}${ADR_GLOB}${quote}: ${quote}${ADR_COMMAND}${quote},`
  lines.splice(openIndex + 1, 0, entry)
  return lines.join(eol)
}

export function remove(source) {
  if (!hasAdrEntry(source)) return source
  const eol = detectEol(source)
  const lines = source.split(eol)
  const kept = lines.filter((line) => !line.includes(ADR_GLOB))
  return kept.join(eol)
}
