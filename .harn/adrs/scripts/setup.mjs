#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, copyFileSync, rmSync, realpathSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { addAdrHooks, removeAdrHooks } from './edit-settings.mjs'
import { add as addLintstagedKey, remove as removeLintstagedKey } from './edit-lintstaged.mjs'
import { replaceSection } from './edit-markdown-section.mjs'
import { parse, serialize } from './frontmatter.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const HARNESS_DIR = join(HERE, '..')
const REPO_ROOT = join(HARNESS_DIR, '..', '..')

const HOOK_NAMES = ['pre_commit', 'pre_tool_use', 'post_tool_use']
const GITIGNORE_ENTRY = '.harn/adrs/config.local.json'
const CLAUDE_HEADING = 'Architecture Decision Records (ADRs)'

const DEFAULT_CONFIG = {
  version: 1,
  root_dir: 'docs/adrs',
  numbering: 'sequential',
  template: 'template.md',
  lint: 'strict',
  fail_mode: 'closed',
  hooks: { pre_commit: false, pre_tool_use: false, post_tool_use: false },
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

export function buildDefaultConfig(rootDir) {
  return {
    ...DEFAULT_CONFIG,
    root_dir: rootDir || DEFAULT_CONFIG.root_dir,
    hooks: { ...DEFAULT_CONFIG.hooks },
  }
}

export function setHookFlag(config, hook, enabled) {
  if (!HOOK_NAMES.includes(hook)) {
    throw new Error(`hook desconhecido: "${hook}". Conhecidos: ${HOOK_NAMES.join(', ')}.`)
  }
  return {
    ...config,
    hooks: { ...config.hooks, [hook]: enabled },
  }
}

export function withSettingsBlock(settings, blockKey, present) {
  const reference = present ? addAdrHooks(settings) : removeAdrHooks(settings)
  const targetBlocks = reference.hooks?.[blockKey] ?? []
  const baseHooks = settings && typeof settings === 'object' ? settings.hooks || {} : {}
  return {
    ...settings,
    hooks: { ...baseHooks, [blockKey]: targetBlocks },
  }
}

export function applyHookToSettings(settings, hook, enabled) {
  if (hook === 'pre_tool_use') return withSettingsBlock(settings, 'PreToolUse', enabled)
  if (hook === 'post_tool_use') return withSettingsBlock(settings, 'PostToolUse', enabled)
  return settings
}

export function applyHookToLintstaged(source, hook, enabled) {
  if (hook !== 'pre_commit') return source
  return enabled ? addLintstagedKey(source) : removeLintstagedKey(source)
}

export function addGitignoreEntry(source) {
  const eol = source.includes('\r\n') ? '\r\n' : '\n'
  const lines = source.split(eol)
  if (lines.some((line) => line.trim() === GITIGNORE_ENTRY)) return source
  const trimmed = source.replace(/(\r\n|\n)+$/, '')
  const prefix = trimmed === '' ? '' : trimmed + eol + eol
  return `${prefix}# adr_management local override${eol}${GITIGNORE_ENTRY}${eol}`
}

function readJsonIfExists(file) {
  if (!existsSync(file)) return null
  return JSON.parse(readFileSync(file, 'utf8'))
}

function writeJson(file, value) {
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8')
}

export function readConfig(harnessDir) {
  return readJsonIfExists(join(harnessDir, 'config.json'))
}

export function ensureConfig(harnessDir, rootDir) {
  const file = join(harnessDir, 'config.json')
  const existing = readJsonIfExists(file)
  if (existing) return existing
  mkdirSync(harnessDir, { recursive: true })
  const created = buildDefaultConfig(rootDir)
  writeJson(file, created)
  return created
}

function writeConfig(harnessDir, config) {
  writeJson(join(harnessDir, 'config.json'), config)
}

function settingsPath(repoRoot) {
  return join(repoRoot, '.claude', 'settings.json')
}

function lintstagedPath(repoRoot) {
  return join(repoRoot, '.lintstagedrc.js')
}

function gitignorePath(repoRoot) {
  return join(repoRoot, '.gitignore')
}

function applySettingsEdit(repoRoot, hook, enabled) {
  if (hook !== 'pre_tool_use' && hook !== 'post_tool_use') return
  const file = settingsPath(repoRoot)
  const settings = readJsonIfExists(file)
  if (!settings) return
  const updated = applyHookToSettings(settings, hook, enabled)
  writeFileSync(file, JSON.stringify(updated, null, 2) + '\n', 'utf8')
}

function applyLintstagedEdit(repoRoot, hook, enabled) {
  if (hook !== 'pre_commit') return
  const file = lintstagedPath(repoRoot)
  if (!existsSync(file)) return
  const source = readFileSync(file, 'utf8')
  writeFileSync(file, applyHookToLintstaged(source, hook, enabled), 'utf8')
}

function applyGitignore(repoRoot) {
  const file = gitignorePath(repoRoot)
  const source = existsSync(file) ? readFileSync(file, 'utf8') : ''
  const updated = addGitignoreEntry(source)
  if (updated !== source) writeFileSync(file, updated, 'utf8')
}

function claudeMdPath(repoRoot) {
  return join(repoRoot, 'CLAUDE.md')
}

export function adrAwarenessBody(rootDir) {
  return [
    `Decisões de arquitetura deste repositório são registradas como ADRs versionados em \`${rootDir}/\`.`,
    '',
    `- **Antes** de mudar arquitetura, leia os ADRs relevantes em \`${rootDir}/\`.`,
    '- **Depois** de decidir, registre a escolha com `/adrs:create` (ou `/adrs:supersede NNNN`).',
    '- ADRs `accepted` são imutáveis fora de `status`/supersede — imposto por hooks determinísticos.',
    '- Operações: skill `adr_management` e comandos `/adrs:*` (rode `/adrs:help`).',
  ].join('\n')
}

function applyClaudeMd(repoRoot, rootDir) {
  const file = claudeMdPath(repoRoot)
  const source = existsSync(file) ? readFileSync(file, 'utf8') : ''
  const updated = replaceSection(source, CLAUDE_HEADING, adrAwarenessBody(rootDir))
  if (updated !== source) writeFileSync(file, updated, 'utf8')
}

export function setHook(env, hook, enabled) {
  const { harnessDir, repoRoot } = env
  const config = readConfig(harnessDir) ?? ensureConfig(harnessDir, DEFAULT_CONFIG.root_dir)
  writeConfig(harnessDir, setHookFlag(config, hook, enabled))
  applySettingsEdit(repoRoot, hook, enabled)
  applyLintstagedEdit(repoRoot, hook, enabled)
}

export function install(env, rootDir) {
  const { harnessDir, repoRoot } = env
  const config = ensureConfig(harnessDir, rootDir)
  applyGitignore(repoRoot)
  applyClaudeMd(repoRoot, config.root_dir)
  for (const hook of HOOK_NAMES) setHook(env, hook, true)
  return readConfig(harnessDir)
}

export function queryStatus(env) {
  const config = readConfig(env.harnessDir)
  const hooks = config?.hooks ?? {}
  return HOOK_NAMES.reduce((acc, hook) => {
    acc[hook] = hooks[hook] === true
    return acc
  }, {})
}

const VERIFY_SCRIPT_DEPS = ['validate.mjs', 'frontmatter.mjs', 'state-machine.mjs']
const VERIFY_FIXTURE = 'legal-accepted.md'

function fixtureContent(harnessDir, name) {
  return readFileSync(join(harnessDir, '__fixtures__', name), 'utf8')
}

function buildVerifySandbox(harnessDir, config) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'adr-verify-')))
  const sandboxHarness = join(root, '.harn', 'adrs')
  const sandboxHooks = join(sandboxHarness, 'hooks')
  const sandboxScripts = join(sandboxHarness, 'scripts')
  const adrDir = join(root, 'docs', 'adrs')
  mkdirSync(sandboxHooks, { recursive: true })
  mkdirSync(sandboxScripts, { recursive: true })
  mkdirSync(adrDir, { recursive: true })
  copyFileSync(
    join(harnessDir, 'hooks', 'pretooluse-validate.mjs'),
    join(sandboxHooks, 'pretooluse-validate.mjs'),
  )
  for (const dep of VERIFY_SCRIPT_DEPS) {
    copyFileSync(join(harnessDir, 'scripts', dep), join(sandboxScripts, dep))
  }
  const sandboxConfig = {
    ...config,
    root_dir: 'docs/adrs',
    hooks: { ...config.hooks, pre_tool_use: true },
  }
  writeFileSync(join(sandboxHarness, 'config.json'), JSON.stringify(sandboxConfig, null, 2) + '\n', 'utf8')
  return { root, hookPath: join(sandboxHooks, 'pretooluse-validate.mjs'), adrDir }
}

function runHook(hookPath, payload) {
  try {
    execFileSync('node', [hookPath], { input: JSON.stringify(payload), encoding: 'utf8' })
    return 0
  } catch (error) {
    return error.status ?? 1
  }
}

function verifyCase(sandbox, name, content, oldString, newString) {
  const adrFile = join(sandbox.adrDir, name)
  writeFileSync(adrFile, content, 'utf8')
  const code = runHook(sandbox.hookPath, {
    tool_name: 'Edit',
    tool_input: { file_path: adrFile, old_string: oldString, new_string: newString },
  })
  return { name, code, blocked: code === 2 }
}

export function verify(env) {
  const config = readConfig(env.harnessDir)
  if (config?.hooks?.pre_tool_use !== true) {
    return { ok: false, message: 'pre_tool_use não está habilitado; rode install antes de --verify.' }
  }
  const content = fixtureContent(env.harnessDir, VERIFY_FIXTURE)
  const sandbox = buildVerifySandbox(env.harnessDir, config)
  try {
    const legal = verifyCase(
      sandbox,
      '0098-verify-legal.md',
      content,
      'status: accepted',
      'status: deprecated',
    )
    const illegal = verifyCase(
      sandbox,
      '0099-verify-illegal.md',
      content,
      'Adotar arquitetura hexagonal com ports e adapters.',
      'Reescrever o corpo de um ADR aceito.',
    )
    const ok = legal.blocked === false && illegal.blocked === true
    return { ok, legal: legal.blocked === false, illegal: illegal.blocked === true, results: [legal, illegal] }
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true })
  }
}

const ADR_FILENAME_PATTERN = /^(\d{4})-.*\.md$/
const PROSE_STATUS_PATTERN = /^\s*-\s*\*\*Status:\*\*\s*(.+?)\s*$/
const PROSE_DATE_PATTERN = /^\s*-\s*\*\*Data:\*\*\s*(.+?)\s*$/
const H1_PATTERN = /^#\s+(.*\S)\s*$/
const H1_ADR_PREFIX_PATTERN = /^ADR[-\s]?\d{4}\s*[—–-]\s*/

export function isConforming(src) {
  return parse(src).frontmatter != null
}

export function numberFromFilename(name) {
  const match = ADR_FILENAME_PATTERN.exec(basename(name))
  return match ? match[1] : null
}

export function titleFromBody(src) {
  for (const line of src.split('\n')) {
    const match = H1_PATTERN.exec(line)
    if (match) return match[1].replace(H1_ADR_PREFIX_PATTERN, '').trim()
  }
  return null
}

export function parseProseMeta(src) {
  let status = null
  let date = null
  for (const line of src.split('\n')) {
    if (status == null) {
      const statusMatch = PROSE_STATUS_PATTERN.exec(line)
      if (statusMatch) status = statusMatch[1]
    }
    if (date == null) {
      const dateMatch = PROSE_DATE_PATTERN.exec(line)
      if (dateMatch) date = dateMatch[1]
    }
  }
  return { status, date }
}

function normalizeStatus(number, rawStatus) {
  if (number === '0001') return 'accepted'
  return String(rawStatus ?? '').trim().toLowerCase()
}

export function proposeFrontmatter(src, filename) {
  const number = numberFromFilename(filename)
  if (number == null) {
    throw new Error(`nome de arquivo não casa NNNN-slug.md: "${basename(filename)}".`)
  }
  const title = titleFromBody(src)
  if (title == null) {
    throw new Error(`ADR sem H1 para derivar o título: "${basename(filename)}".`)
  }
  const { status, date } = parseProseMeta(src)
  if (date == null) {
    throw new Error(`ADR sem linha "- **Data:**" para derivar a data: "${basename(filename)}".`)
  }
  return {
    number,
    title,
    status: normalizeStatus(number, status),
    date,
    status_date: date,
    supersedes: [],
    superseded_by: null,
  }
}

function stripProseMeta(src) {
  return src
    .split('\n')
    .filter((line) => !PROSE_STATUS_PATTERN.test(line) && !PROSE_DATE_PATTERN.test(line))
    .join('\n')
}

export function migrateContent(src, filename) {
  const frontmatter = proposeFrontmatter(src, filename)
  const body = '\n' + stripProseMeta(src)
  return serialize({ frontmatter, body })
}

function adrFiles(adrDir) {
  if (!existsSync(adrDir)) return []
  return readdirSync(adrDir)
    .filter((name) => ADR_FILENAME_PATTERN.test(name))
    .sort()
}

export function planMigration(adrDir) {
  return adrFiles(adrDir).map((name) => {
    const file = join(adrDir, name)
    const src = readFileSync(file, 'utf8')
    return { name, file, conforming: isConforming(src) }
  })
}

export function migrateDir(adrDir, options = {}) {
  const plan = planMigration(adrDir)
  const pending = plan.filter((entry) => !entry.conforming)
  const migrated = []
  for (const entry of pending) {
    const src = readFileSync(entry.file, 'utf8')
    const next = migrateContent(src, entry.name)
    if (options.apply) writeFileSync(entry.file, next, 'utf8')
    migrated.push({ name: entry.name, frontmatter: proposeFrontmatter(src, entry.name), content: next })
  }
  return { total: plan.length, migrated, alreadyConforming: plan.length - pending.length }
}

function resolveAdrDir(env, config) {
  const rootDir = config?.root_dir ?? DEFAULT_CONFIG.root_dir
  return resolve(env.repoRoot, rootDir)
}

export function setupWithMigration(env, rootDir) {
  ensureConfig(env.harnessDir, rootDir)
  const config = readConfig(env.harnessDir)
  const adrDir = resolveAdrDir(env, config)
  const result = migrateDir(adrDir, { apply: true })
  install(env, config.root_dir)
  return result
}

export function defaultEnv() {
  return { harnessDir: HARNESS_DIR, repoRoot: REPO_ROOT }
}

function parseArgs(argv) {
  const flags = {
    verify: false,
    install: false,
    migrate: false,
    dryRun: false,
    yes: false,
    action: null,
    hook: null,
    rootDir: null,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--verify') flags.verify = true
    else if (arg === '--install') flags.install = true
    else if (arg === '--migrate') flags.migrate = true
    else if (arg === '--dry-run') flags.dryRun = true
    else if (arg === '--yes') flags.yes = true
    else if (arg === '--status') flags.action = 'status'
    else if (arg === '--enable') {
      flags.action = 'enable'
      flags.hook = argv[++i]
    } else if (arg === '--disable') {
      flags.action = 'disable'
      flags.hook = argv[++i]
    } else if (arg === '--root-dir') {
      flags.rootDir = argv[++i]
    }
  }
  return flags
}

function reportMigration(result, applied) {
  const verb = applied ? 'migrados' : 'pendentes'
  process.stdout.write(
    `migração: ${result.migrated.length} ${verb}, ${result.alreadyConforming} já conformes ` +
      `(de ${result.total} ADRs).\n`,
  )
  for (const entry of result.migrated) {
    process.stdout.write(`  - ${entry.name} → status=${entry.frontmatter.status}, date=${entry.frontmatter.date}\n`)
  }
}

function reportVerify(result) {
  if (result.ok) {
    process.stdout.write('--verify OK: caso legal passou e caso ilegal foi bloqueado.\n')
    process.exit(0)
  }
  process.stderr.write(`--verify FALHOU: ${JSON.stringify(result)}\n`)
  process.exit(1)
}

function main() {
  const flags = parseArgs(process.argv.slice(2))
  const env = defaultEnv()

  if (flags.action === 'status') {
    process.stdout.write(JSON.stringify(queryStatus(env), null, 2) + '\n')
    return
  }

  if (flags.action === 'enable' || flags.action === 'disable') {
    setHook(env, flags.hook, flags.action === 'enable')
    process.stdout.write(`${flags.action} ${flags.hook}: ok\n`)
    return
  }

  if (flags.migrate) {
    ensureConfig(env.harnessDir, flags.rootDir ?? DEFAULT_CONFIG.root_dir)
    const config = readConfig(env.harnessDir)
    const adrDir = resolveAdrDir(env, config)
    const applied = !flags.dryRun
    const result = migrateDir(adrDir, { apply: applied })
    reportMigration(result, applied)
    if (applied && flags.yes) {
      install(env, config.root_dir)
      process.stdout.write('hooks habilitados após migração.\n')
    }
    return
  }

  if (flags.install || (!flags.verify && !flags.action)) {
    install(env, flags.rootDir ?? DEFAULT_CONFIG.root_dir)
    process.stdout.write('install: ok\n')
  }

  if (flags.verify) {
    reportVerify(verify(env))
  }
}

const ENTRY = resolve(fileURLToPath(import.meta.url))
if (process.argv[1] && resolve(process.argv[1]) === ENTRY) {
  main()
}
