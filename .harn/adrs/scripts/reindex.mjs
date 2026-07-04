import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { parse } from './frontmatter.mjs'

const ADR_FILENAME = /^([0-9]{4})-.*\.md$/
const README = 'README.md'
const INDEX_HEADING = '## Index'
const CHANGELOG_HEADING = '## Changelog'

function adrFiles(rootDir) {
  if (!existsSync(rootDir)) return []
  return readdirSync(rootDir)
    .filter((name) => ADR_FILENAME.test(name))
    .sort()
}

function numberFromFilename(name) {
  const match = name.match(ADR_FILENAME)
  return match ? match[1] : null
}

export function collectAdrs(rootDir) {
  const adrs = []
  for (const name of adrFiles(rootDir)) {
    const src = readFileSync(join(rootDir, name), 'utf8')
    const { frontmatter } = parse(src)
    if (frontmatter == null) continue
    adrs.push({ file: name, frontmatter })
  }
  return adrs.sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
}

function sortKey(adr) {
  return String(adr.frontmatter.number ?? numberFromFilename(adr.file) ?? '')
}

function supersedeLinks(adr, byNumber) {
  const links = []
  const supersedes = adr.frontmatter.supersedes
  if (Array.isArray(supersedes)) {
    for (const target of supersedes) {
      links.push(`supersedes ${linkTo(target, byNumber)}`)
    }
  }
  const supersededBy = adr.frontmatter.superseded_by
  if (supersededBy != null) {
    links.push(`superseded by ${linkTo(supersededBy, byNumber)}`)
  }
  return links.join('; ')
}

function pad4(value) {
  return String(value).padStart(4, '0')
}

function linkTo(number, byNumber) {
  const key = pad4(number)
  const target = byNumber.get(key)
  if (target) return `[ADR-${key}](./${target.file})`
  return `ADR-${key}`
}

function cell(value) {
  return value == null ? '' : String(value)
}

export function renderIndex(adrs) {
  const byNumber = new Map()
  for (const adr of adrs) {
    byNumber.set(pad4(adr.frontmatter.number ?? numberFromFilename(adr.file)), adr)
  }
  const rows = adrs.map((adr) => {
    const number = pad4(adr.frontmatter.number ?? numberFromFilename(adr.file))
    const title = `[${cell(adr.frontmatter.title)}](./${adr.file})`
    return `| ${number} | ${title} | ${cell(adr.frontmatter.status)} | ${cell(adr.frontmatter.date)} | ${supersedeLinks(adr, byNumber)} |`
  })
  return [
    INDEX_HEADING,
    '',
    '| Number | Title | Status | Date | Supersede |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n')
}

function gitAuthorFor(rootDir, file, kind) {
  try {
    const args =
      kind === 'created'
        ? ['log', '--diff-filter=A', '--follow', '--format=%an', '--', file]
        : ['log', '-1', '--format=%an', '--', file]
    const out = execFileSync('git', args, { cwd: rootDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    const lines = out.split('\n').filter((line) => line.trim() !== '')
    return lines.length ? lines[lines.length - 1] : ''
  } catch {
    return ''
  }
}

export function deriveEvents(adrs, authorLookup) {
  const events = []
  for (const adr of adrs) {
    const number = pad4(adr.frontmatter.number ?? numberFromFilename(adr.file))
    const date = cell(adr.frontmatter.date)
    const statusDate = cell(adr.frontmatter.status_date)
    const status = cell(adr.frontmatter.status)
    events.push({
      date,
      number,
      kind: 'created',
      detail: `ADR-${number} created`,
      author: authorLookup(adr.file, 'created'),
    })
    if (statusDate && statusDate !== date && status) {
      events.push({
        date: statusDate,
        number,
        kind: 'transition',
        detail: `ADR-${number} status → ${status}`,
        author: authorLookup(adr.file, 'latest'),
      })
    }
  }
  return events.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date)
    if (a.number !== b.number) return a.number.localeCompare(b.number)
    return a.kind.localeCompare(b.kind)
  })
}

export function renderChangelog(events) {
  const rows = events.map((event) => {
    const author = event.author ? ` — ${event.author}` : ''
    return `- ${event.date} — ${event.detail}${author}`
  })
  return [CHANGELOG_HEADING, '', ...(rows.length ? rows : ['- (no events)']), ''].join('\n')
}

export function renderReadme(adrs, events) {
  return [renderIndex(adrs), renderChangelog(events), ''].join('\n')
}

export function generate(rootDir) {
  const adrs = collectAdrs(rootDir)
  const events = deriveEvents(adrs, (file, kind) => gitAuthorFor(rootDir, file, kind))
  return renderReadme(adrs, events)
}

export function reindex(rootDir) {
  const content = generate(rootDir)
  writeFileSync(join(rootDir, README), content, 'utf8')
  return content
}

function repoRoot() {
  const here = dirname(fileURLToPath(import.meta.url))
  return resolve(here, '..', '..', '..')
}

function resolveRootDir() {
  const configPath = join(repoRoot(), '.harn', 'adrs', 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8'))
  return join(repoRoot(), config.root_dir)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  reindex(resolveRootDir())
}
