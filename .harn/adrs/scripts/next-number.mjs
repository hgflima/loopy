import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ADR_FILE_PATTERN = /^(\d{4})-/

function parseNumber(filename) {
  const match = ADR_FILE_PATTERN.exec(filename)
  return match ? Number(match[1]) : null
}

export function nextNumber(rootDir) {
  const entries = readdirSync(rootDir)
  const numbers = entries.map(parseNumber).filter((n) => n !== null)
  const max = numbers.length === 0 ? 0 : Math.max(...numbers)
  return String(max + 1).padStart(4, '0')
}

const SELF = fileURLToPath(import.meta.url)

if (process.argv[1] === SELF) {
  const here = fileURLToPath(new URL('.', import.meta.url))
  const configFile = join(here, '..', 'config.json')
  const config = JSON.parse(readFileSync(configFile, 'utf8'))
  const repoRoot = join(here, '..', '..', '..')
  const rootDir = join(repoRoot, config.root_dir)
  process.stdout.write(nextNumber(rootDir) + '\n')
}
