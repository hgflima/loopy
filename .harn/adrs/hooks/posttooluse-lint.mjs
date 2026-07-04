#!/usr/bin/env node
import { readFileSync, existsSync, realpathSync } from 'node:fs'
import { join, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '../scripts/frontmatter.mjs'
import { lintTemplate } from '../scripts/validate.mjs'

const WRITE_TOOLS = ['Write', 'Edit', 'MultiEdit']
const ADR_RECORD = /^[0-9]{4}-.*\.md$/
const EXCLUDED = ['README.md', 'CLAUDE.md', 'template.md']
const DISABLE_HINT = 'desabilite com /adrs:setup --disable post_tool_use'

function repoRoot() {
  const here = fileURLToPath(new URL('.', import.meta.url))
  return resolve(here, '..', '..', '..')
}

function loadConfig(root) {
  const configPath = join(root, '.harn', 'adrs', 'config.json')
  return JSON.parse(readFileSync(configPath, 'utf8'))
}

export function isAdrRecord(filePath, root, rootDir) {
  if (!filePath) return false
  const name = basename(filePath)
  if (EXCLUDED.includes(name)) return false
  if (!ADR_RECORD.test(name)) return false
  const resolvedRecordsDir = resolve(root, rootDir)
  const resolvedFile = resolve(root, filePath)
  return resolve(resolvedFile, '..') === resolvedRecordsDir
}

export function lintFile(absolutePath) {
  if (!existsSync(absolutePath)) {
    return { ok: true, code: 'file_absent', message: '' }
  }
  const src = readFileSync(absolutePath, 'utf8')
  const { body } = parse(src)
  return lintTemplate(body)
}

function readStdin() {
  try {
    return readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

function main() {
  const root = repoRoot()

  let config
  try {
    config = loadConfig(root)
  } catch {
    process.exit(0)
  }

  if (!config?.hooks?.post_tool_use) process.exit(0)

  const raw = readStdin()
  let payload
  try {
    payload = JSON.parse(raw)
  } catch {
    process.stderr.write(`ADR posttooluse-lint: payload ilegível (${DISABLE_HINT}).\n`)
    process.exit(2)
  }

  const tool = payload.tool_name
  const filePath = payload.tool_input?.file_path || ''

  if (!WRITE_TOOLS.includes(tool)) process.exit(0)
  if (!isAdrRecord(filePath, root, config.root_dir)) process.exit(0)

  let result
  try {
    result = lintFile(resolve(root, filePath))
  } catch (error) {
    process.stderr.write(`ADR posttooluse-lint: erro interno (${error.message}). ${DISABLE_HINT}.\n`)
    process.exit(2)
  }

  if (result.ok) process.exit(0)

  process.stderr.write(
    `ADR fora do template em ${filePath}.\n\n${result.message}\n\n` +
      'O PostToolUse nao desfez a escrita; ajuste o ADR para incluir os headings obrigatorios ' +
      '(## Context, ## Decision, ## Consequences) e salve novamente.\n',
  )
  process.exit(2)
}

function canonical(path) {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

const SELF = canonical(fileURLToPath(import.meta.url))
if (process.argv[1] && canonical(process.argv[1]) === SELF) {
  main()
}
