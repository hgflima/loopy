#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { join, basename, isAbsolute, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { validateEdit } from '../scripts/validate.mjs'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const HARNESS_DIR = join(HERE, '..')
const REPO_ROOT = join(HARNESS_DIR, '..', '..')
const EXCLUDED_BASENAMES = new Set(['README.md', 'CLAUDE.md', 'template.md'])
const RECORD_BASENAME = /^\d{4}-.*\.md$/

function loadConfig() {
  const base = JSON.parse(readFileSync(join(HARNESS_DIR, 'config.json'), 'utf8'))
  try {
    const local = JSON.parse(readFileSync(join(HARNESS_DIR, 'config.local.json'), 'utf8'))
    return { ...base, ...local, hooks: { ...base.hooks, ...local.hooks } }
  } catch {
    return base
  }
}

function toRepoRelative(path) {
  const absolute = isAbsolute(path) ? path : join(REPO_ROOT, path)
  return relative(REPO_ROOT, absolute).split('\\').join('/')
}

function isAdrRecord(repoRelativePath, rootDir) {
  const normalizedRoot = rootDir.replace(/\/+$/, '')
  if (!repoRelativePath.startsWith(`${normalizedRoot}/`)) return false
  const name = basename(repoRelativePath)
  if (EXCLUDED_BASENAMES.has(name)) return false
  return RECORD_BASENAME.test(name)
}

function gitShow(revspec) {
  try {
    return execFileSync('git', ['show', revspec], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return null
  }
}

function blocked(message) {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

function main() {
  const config = loadConfig()
  if (!config?.hooks?.pre_commit) process.exit(0)

  let rootDir
  let staged
  try {
    rootDir = config.root_dir
    staged = process.argv.slice(2).map(toRepoRelative).filter((p) => isAdrRecord(p, rootDir))
  } catch (error) {
    blocked(
      `BLOQUEADO (pre-commit ADR): erro interno ao preparar a validação — ${error.message}\n` +
        'Desabilite com /adrs:setup --disable pre_commit se precisar contornar.',
    )
    return
  }

  if (staged.length === 0) process.exit(0)

  for (const path of staged) {
    let current
    let proposed
    let result
    try {
      current = gitShow(`HEAD:${path}`)
      proposed = gitShow(`:${path}`)
      if (proposed == null) {
        blocked(
          `BLOQUEADO (pre-commit ADR): não foi possível ler a versão staged de ${path} via "git show :${path}".\n` +
            'Desabilite com /adrs:setup --disable pre_commit se precisar contornar.',
        )
        return
      }
      result = validateEdit(path, current, proposed, config)
    } catch (error) {
      blocked(
        `BLOQUEADO (pre-commit ADR): erro interno validando ${path} — ${error.message}\n` +
          'Desabilite com /adrs:setup --disable pre_commit se precisar contornar.',
      )
      return
    }

    if (!result.ok) {
      blocked(
        `BLOQUEADO (pre-commit ADR): edição ilegal em ${path} [${result.code}]\n` +
          `${result.message}\n` +
          'Desfaça a alteração ou faça uma transição válida. ' +
          'Desabilite com /adrs:setup --disable pre_commit se precisar contornar.',
      )
      return
    }
  }

  process.exit(0)
}

main()
