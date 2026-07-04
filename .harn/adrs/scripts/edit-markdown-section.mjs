function detectEol(source) {
  return source.includes('\r\n') ? '\r\n' : '\n'
}

function headingLevel(line) {
  const match = line.match(/^(#{1,6})\s+\S/)
  return match ? match[1].length : 0
}

function normalizeHeading(text) {
  return text.replace(/^#+\s+/, '').trim()
}

function findHeadingIndex(lines, headingText) {
  const target = normalizeHeading(headingText)
  for (let i = 0; i < lines.length; i++) {
    if (headingLevel(lines[i]) > 0 && normalizeHeading(lines[i]) === target) {
      return i
    }
  }
  return -1
}

function findSectionEnd(lines, startIndex, level) {
  for (let i = startIndex + 1; i < lines.length; i++) {
    const lvl = headingLevel(lines[i])
    if (lvl > 0 && lvl <= level) return i
  }
  return lines.length
}

export function hasSection(source, heading) {
  const eol = detectEol(source)
  return findHeadingIndex(source.split(eol), heading) >= 0
}

export function replaceSection(source, heading, body) {
  const eol = detectEol(source)
  const headingLine = `## ${normalizeHeading(heading)}`
  const block = body === '' ? [headingLine] : [headingLine, '', ...body.split(eol)]

  if (source === '') {
    return block.join(eol) + eol
  }

  const lines = source.split(eol)
  const headingIndex = findHeadingIndex(lines, heading)

  if (headingIndex < 0) {
    const trimmedEnd = source.replace(/(\r\n|\n)+$/, '')
    return trimmedEnd + eol + eol + block.join(eol) + eol
  }

  const level = headingLevel(lines[headingIndex])
  const sectionEnd = findSectionEnd(lines, headingIndex, level)
  const before = lines.slice(0, headingIndex)
  const after = lines.slice(sectionEnd)
  const rebuilt = [...before, ...block, ...after].join(eol)
  return rebuilt.replace(/(\r\n|\n)*$/, '') + eol
}
