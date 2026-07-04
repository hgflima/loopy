#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs'
import { join, resolve, isAbsolute, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateEdit } from '../scripts/validate.mjs'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const HARNESS_DIR = join(HERE, '..')
const REPO_ROOT = join(HARNESS_DIR, '..', '..')
const EXCLUDED_BASENAMES = new Set(['README.md', 'CLAUDE.md', 'template.md'])
const ADR_BASENAME_PATTERN = /^\d{4}-.*\.md$/
const DISABLE_HINT = 'desabilite com /adrs:setup --disable pre_tool_use'

function readJsonIfExists(file) {
  if (!existsSync(file)) return null
  return JSON.parse(readFileSync(file, 'utf8'))
}

function loadConfig() {
  const base = readJsonIfExists(join(HARNESS_DIR, 'config.json')) ?? {}
  const local = readJsonIfExists(join(HARNESS_DIR, 'config.local.json'))
  return local ? { ...base, ...local } : base
}

function resolveRootDir(config) {
  const rootDir = config.root_dir ?? ''
  return isAbsolute(rootDir) ? rootDir : resolve(REPO_ROOT, rootDir)
}

function isAdrRecord(filePath, rootDir) {
  if (!filePath) return false
  const resolved = isAbsolute(filePath) ? filePath : resolve(REPO_ROOT, filePath)
  const name = basename(resolved)
  if (EXCLUDED_BASENAMES.has(name)) return false
  if (!ADR_BASENAME_PATTERN.test(name)) return false
  return resolve(resolved, '..') === resolve(rootDir)
}

function applyEdit(source, oldString, newString) {
  const index = source.indexOf(oldString)
  if (index === -1) {
    throw new Error(`old_string não encontrado no conteúdo atual do ADR.`)
  }
  return source.slice(0, index) + newString + source.slice(index + oldString.length)
}

function reconstruct(tool, input, currentContent) {
  if (tool === 'Write') {
    return { current: currentContent, proposed: input.content ?? '' }
  }
  if (tool === 'Edit') {
    if (currentContent == null) {
      throw new Error('Edit em ADR inexistente: não há conteúdo atual para reconstruir.')
    }
    return {
      current: currentContent,
      proposed: applyEdit(currentContent, input.old_string ?? '', input.new_string ?? ''),
    }
  }
  if (currentContent == null) {
    throw new Error('MultiEdit em ADR inexistente: não há conteúdo atual para reconstruir.')
  }
  let proposed = currentContent
  for (const edit of input.edits ?? []) {
    proposed = applyEdit(proposed, edit.old_string ?? '', edit.new_string ?? '')
  }
  return { current: currentContent, proposed }
}

function blockInternal(message) {
  process.stderr.write(`BLOQUEADO (adr_management, erro interno): ${message}\n\n${DISABLE_HINT}\n`)
  process.exit(2)
}

function main() {
  let raw = ''
  try {
    raw = readFileSync(0, 'utf8')
  } catch {
    process.exit(0)
  }

  let payload
  try {
    payload = JSON.parse(raw)
  } catch {
    process.exit(0)
  }

  const tool = payload.tool_name
  const input = payload.tool_input || {}
  const filePath = input.file_path || ''

  if (!['Write', 'Edit', 'MultiEdit'].includes(tool)) process.exit(0)

  let config
  try {
    config = loadConfig()
  } catch (error) {
    blockInternal(`falha ao carregar config: ${error.message}`)
    return
  }

  if (config?.hooks?.pre_tool_use !== true) process.exit(0)

  let rootDir
  try {
    rootDir = resolveRootDir(config)
  } catch (error) {
    blockInternal(`falha ao resolver root_dir: ${error.message}`)
    return
  }

  if (!isAdrRecord(filePath, rootDir)) process.exit(0)

  const resolvedPath = isAbsolute(filePath) ? filePath : resolve(REPO_ROOT, filePath)
  const currentContent = existsSync(resolvedPath) ? readFileSync(resolvedPath, 'utf8') : null

  let reconstructed
  try {
    reconstructed = reconstruct(tool, input, currentContent)
  } catch (error) {
    blockInternal(`falha ao reconstruir o conteúdo proposto: ${error.message}`)
    return
  }

  let result
  try {
    result = validateEdit(resolvedPath, reconstructed.current, reconstructed.proposed, config)
  } catch (error) {
    blockInternal(`falha na validação determinística: ${error.message}`)
    return
  }

  if (result.ok) process.exit(0)

  process.stderr.write(
    `BLOQUEADO (adr_management): este ${tool} em ${basename(resolvedPath)} viola a máquina de estados de ADRs.\n\n` +
      `Causa: ${result.message}\n\n` +
      `Se acredita que o hook está errado, ${DISABLE_HINT}.\n`,
  )
  process.exit(2)
}

main()
