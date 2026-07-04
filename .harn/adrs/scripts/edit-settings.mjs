const OWNED_MARKER = '/.harn/adrs/hooks/'

const ADR_MATCHER = 'Write|Edit|MultiEdit'

const PRETOOLUSE_COMMAND = 'node ${CLAUDE_PROJECT_DIR}/.harn/adrs/hooks/pretooluse-validate.mjs'

const POSTTOOLUSE_COMMAND = 'node ${CLAUDE_PROJECT_DIR}/.harn/adrs/hooks/posttooluse-lint.mjs'

export function isOwnedCommand(command) {
  return typeof command === 'string' && command.includes(OWNED_MARKER)
}

function isOwnedBlock(block) {
  const hooks = block && Array.isArray(block.hooks) ? block.hooks : []
  return hooks.some((hook) => isOwnedCommand(hook && hook.command))
}

function makeBlock(command) {
  return {
    matcher: ADR_MATCHER,
    hooks: [{ type: 'command', command }],
  }
}

function withAddedBlock(blocks, command) {
  const existing = Array.isArray(blocks) ? blocks : []
  if (existing.some((block) => isOwnedBlock(block))) return existing
  return [...existing, makeBlock(command)]
}

function withoutOwnedBlocks(blocks) {
  const existing = Array.isArray(blocks) ? blocks : []
  return existing.filter((block) => !isOwnedBlock(block))
}

export function addAdrHooks(settings) {
  const hooks = settings && typeof settings === 'object' ? settings.hooks || {} : {}
  return {
    ...settings,
    hooks: {
      ...hooks,
      PreToolUse: withAddedBlock(hooks.PreToolUse, PRETOOLUSE_COMMAND),
      PostToolUse: withAddedBlock(hooks.PostToolUse, POSTTOOLUSE_COMMAND),
    },
  }
}

export function removeAdrHooks(settings) {
  const hooks = settings && typeof settings === 'object' ? settings.hooks || {} : {}
  return {
    ...settings,
    hooks: {
      ...hooks,
      PreToolUse: withoutOwnedBlocks(hooks.PreToolUse),
      PostToolUse: withoutOwnedBlocks(hooks.PostToolUse),
    },
  }
}

function format(settings) {
  return JSON.stringify(settings, null, 2) + '\n'
}

export function addAdrHooksToString(source) {
  return format(addAdrHooks(JSON.parse(source)))
}

export function removeAdrHooksFromString(source) {
  return format(removeAdrHooks(JSON.parse(source)))
}
