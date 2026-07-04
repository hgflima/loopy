import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from './frontmatter.mjs'
import { generate } from './reindex.mjs'

const ADR_FILENAME = /^([0-9]{4})-.*\.md$/
const README = 'README.md'

const HOOK_DECLARATIONS = [
  { flag: 'pre_tool_use', surface: 'settings.json (PreToolUse)', marker: 'pretooluse-validate.mjs', kind: 'settings', section: 'PreToolUse' },
  { flag: 'post_tool_use', surface: 'settings.json (PostToolUse)', marker: 'posttooluse-lint.mjs', kind: 'settings', section: 'PostToolUse' },
  { flag: 'pre_commit', surface: '.lintstagedrc.js', marker: 'precommit-validate.mjs', kind: 'lintstaged', section: null },
]

const REQUIRED_HEADINGS = ['## Context', '## Decision', '## Consequences']

function pad4(value) {
  return String(value).padStart(4, '0')
}

function pass(name) {
  return { name, ok: true, problems: [] }
}

function fail(name, problems) {
  return { name, ok: false, problems }
}

function readJsonSafe(path) {
  try {
    return { value: JSON.parse(readFileSync(path, 'utf8')), error: null }
  } catch (error) {
    return { value: null, error }
  }
}

function readTextSafe(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

function dirExists(path) {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function adrFiles(rootDir) {
  if (!dirExists(rootDir)) return []
  return readdirSync(rootDir)
    .filter((name) => ADR_FILENAME.test(name))
    .sort()
}

function loadRecords(rootDir) {
  const records = []
  for (const file of adrFiles(rootDir)) {
    const match = file.match(ADR_FILENAME)
    const filenameNumber = match ? match[1] : null
    const src = readFileSync(join(rootDir, file), 'utf8')
    const { frontmatter, body } = parse(src)
    records.push({ file, filenameNumber, frontmatter, body })
  }
  return records
}

function checkConfig(config, configError, rootDir) {
  const name = 'config valid + root_dir exists'
  const problems = []
  if (configError != null || config == null) {
    problems.push(`config.json invalido ou ilegivel: ${configError ? configError.message : 'conteudo nulo'}.`)
    return fail(name, problems)
  }
  if (typeof config.version !== 'number') {
    problems.push('config.json sem campo "version" numerico.')
  }
  if (typeof config.root_dir !== 'string' || config.root_dir.length === 0) {
    problems.push('config.json sem "root_dir" valido.')
  } else if (!dirExists(rootDir)) {
    problems.push(`root_dir nao existe no disco: ${config.root_dir}.`)
  }
  return problems.length ? fail(name, problems) : pass(name)
}

function isHookDeclared(config, flag) {
  return Boolean(config && config.hooks && config.hooks[flag])
}

function isHookInstalled(declaration, settings, lintstaged) {
  if (declaration.kind === 'lintstaged') {
    return typeof lintstaged === 'string' && lintstaged.includes(declaration.marker)
  }
  const section = settings && settings.hooks ? settings.hooks[declaration.section] : null
  if (!Array.isArray(section)) return false
  return section.some(
    (block) =>
      block &&
      Array.isArray(block.hooks) &&
      block.hooks.some((hook) => hook && typeof hook.command === 'string' && hook.command.includes(declaration.marker)),
  )
}

function checkHooks(config, settings, lintstaged) {
  const name = 'hooks declared == installed'
  const problems = []
  for (const declaration of HOOK_DECLARATIONS) {
    const declared = isHookDeclared(config, declaration.flag)
    if (!declared) continue
    if (!isHookInstalled(declaration, settings, lintstaged)) {
      problems.push(`hook "${declaration.flag}" declarado em config.hooks mas ausente em ${declaration.surface}.`)
    }
  }
  return problems.length ? fail(name, problems) : pass(name)
}

function validStatuses(config) {
  const transitions = config && config.state_machine && config.state_machine.transitions
  return transitions ? Object.keys(transitions) : []
}

function checkTemplateAndStatus(records, config) {
  const name = 'every record follows template + valid status'
  const problems = []
  const allowed = validStatuses(config)
  for (const record of records) {
    if (record.frontmatter == null) {
      problems.push(`${record.file}: sem frontmatter (linha 1 precisa ser "---").`)
      continue
    }
    const missing = REQUIRED_HEADINGS.filter((heading) => !record.body.includes(heading))
    if (missing.length) {
      problems.push(`${record.file}: headings obrigatorios ausentes: ${missing.join(', ')}.`)
    }
    const status = record.frontmatter.status
    if (!allowed.includes(status)) {
      problems.push(`${record.file}: status invalido "${status}". Validos: ${allowed.join(', ')}.`)
    }
  }
  return problems.length ? fail(name, problems) : pass(name)
}

function recordNumber(record) {
  if (record.frontmatter != null && record.frontmatter.number != null) {
    return pad4(record.frontmatter.number)
  }
  return record.filenameNumber != null ? pad4(record.filenameNumber) : null
}

function checkNumbers(records) {
  const name = 'no duplicate numbers; number matches filename'
  const problems = []
  const seen = new Map()
  for (const record of records) {
    const number = recordNumber(record)
    if (record.filenameNumber != null && record.frontmatter != null && record.frontmatter.number != null) {
      if (pad4(record.frontmatter.number) !== pad4(record.filenameNumber)) {
        problems.push(
          `${record.file}: frontmatter.number (${pad4(record.frontmatter.number)}) diverge do NNNN do filename (${pad4(record.filenameNumber)}).`,
        )
      }
    }
    if (number == null) continue
    if (seen.has(number)) {
      problems.push(`numero duplicado ${number}: ${seen.get(number)} e ${record.file}.`)
    } else {
      seen.set(number, record.file)
    }
  }
  return problems.length ? fail(name, problems) : pass(name)
}

function checkSupersede(records) {
  const name = 'supersede links bidirectional'
  const problems = []
  const byNumber = new Map()
  for (const record of records) {
    const number = recordNumber(record)
    if (number != null) byNumber.set(number, record)
  }
  for (const record of records) {
    if (record.frontmatter == null) continue
    const number = recordNumber(record)
    const supersedes = Array.isArray(record.frontmatter.supersedes) ? record.frontmatter.supersedes : []
    for (const target of supersedes) {
      const key = pad4(target)
      const targetRecord = byNumber.get(key)
      if (!targetRecord || targetRecord.frontmatter == null) {
        problems.push(`${record.file}: supersedes ${key} mas ADR-${key} nao existe.`)
        continue
      }
      if (pad4(targetRecord.frontmatter.superseded_by) !== number) {
        problems.push(`supersede unilateral: ${record.file} supersedes ${key}, mas ADR-${key}.superseded_by nao aponta de volta para ${number}.`)
      }
    }
    const supersededBy = record.frontmatter.superseded_by
    if (supersededBy != null) {
      const key = pad4(supersededBy)
      const targetRecord = byNumber.get(key)
      if (!targetRecord || targetRecord.frontmatter == null) {
        problems.push(`${record.file}: superseded_by ${key} mas ADR-${key} nao existe.`)
        continue
      }
      const targetSupersedes = Array.isArray(targetRecord.frontmatter.supersedes) ? targetRecord.frontmatter.supersedes : []
      if (!targetSupersedes.map(pad4).includes(number)) {
        problems.push(`supersede unilateral: ${record.file} superseded_by ${key}, mas ADR-${key}.supersedes nao inclui ${number}.`)
      }
    }
  }
  return problems.length ? fail(name, problems) : pass(name)
}

function checkReadme(rootDir) {
  const name = 'README up to date (regenerate == no diff)'
  const expected = generate(rootDir)
  const onDisk = readTextSafe(join(rootDir, README))
  if (onDisk == null) {
    return fail(name, [`README.md ausente em ${rootDir}; rode /adrs:reindex.`])
  }
  if (onDisk !== expected) {
    return fail(name, ['README.md desatualizado em relacao aos ADRs; rode /adrs:reindex para regenerar.'])
  }
  return pass(name)
}

export function runDoctor({ rootDir, configPath, settingsPath, lintstagedPath }) {
  const config = readJsonSafe(configPath)
  const settings = settingsPath ? readJsonSafe(settingsPath).value : null
  const lintstaged = lintstagedPath ? readTextSafe(lintstagedPath) : null
  const records = config.value != null && dirExists(rootDir) ? loadRecords(rootDir) : []

  const checks = [
    checkConfig(config.value, config.error, rootDir),
    checkHooks(config.value, settings, lintstaged),
    checkTemplateAndStatus(records, config.value),
    checkNumbers(records),
    checkSupersede(records),
    checkReadme(rootDir),
  ]

  return { ok: checks.every((check) => check.ok), checks }
}

export function formatReport(result) {
  const lines = []
  for (const check of result.checks) {
    lines.push(`${check.ok ? 'PASS' : 'FAIL'}  ${check.name}`)
    for (const problem of check.problems) {
      lines.push(`        - ${problem}`)
    }
  }
  lines.push('')
  lines.push(result.ok ? 'doctor: OK' : 'doctor: FAIL')
  return lines.join('\n')
}

function repoRoot() {
  const here = dirname(fileURLToPath(import.meta.url))
  return resolve(here, '..', '..', '..')
}

function resolveOptions() {
  const root = repoRoot()
  const configPath = join(root, '.harn', 'adrs', 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8'))
  return {
    rootDir: join(root, config.root_dir),
    configPath,
    settingsPath: join(root, '.claude', 'settings.json'),
    lintstagedPath: join(root, '.lintstagedrc.js'),
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const result = runDoctor(resolveOptions())
  process.stdout.write(formatReport(result) + '\n')
  process.exit(result.ok ? 0 : 1)
}
