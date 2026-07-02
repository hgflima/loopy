#!/usr/bin/env node

/**
 * Heal — Changelog Persistence Script
 *
 * Receives a serialized entry as a CLI argument, validates it,
 * appends it to the appropriate component JSON file, and updates index.json.
 *
 * Usage: node persist-entry.js '<json-entry>'
 *
 * The entry must include a "component" field (e.g., "skill:xlsx").
 * The "id" field should be null — this script generates the sequential ID.
 *
 * Exit codes:
 *   0 — success (prints assigned entry ID to stdout)
 *   1 — validation error
 *   2 — file system error
 *   3 — post-write integrity check failed
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';

const BASE_DIR = join(process.cwd(), '.claude', 'heal');
const INDEX_FILE = join(BASE_DIR, 'index.json');

// --- Schema validation ---

const REQUIRED_ENTRY_FIELDS = ['component', 'timestamp', 'severity', 'summary', 'root_cause', 'solution', 'related_entries'];
const REQUIRED_ROOT_CAUSE_FIELDS = ['layer', 'detail', 'confidence'];
const REQUIRED_SOLUTION_FIELDS = ['description', 'actions'];
const REQUIRED_ACTION_FIELDS = ['type', 'target', 'status', 'detail', 'steps'];

const SEVERITY_VALUES = ['low', 'medium', 'high', 'critical'];
const CONFIDENCE_VALUES = ['high', 'medium', 'low'];
const LAYER_VALUES = [
  'skill', 'command', 'code', 'environment', 'rule',
  'orchestration:advise', 'orchestration:research', 'orchestration:plan',
  'orchestration:implement', 'orchestration:ai-validation',
  'orchestration:human-validation', 'orchestration:retrospective'
];
const ACTION_TYPE_VALUES = ['add', 'update', 'remove'];
const ACTION_STATUS_VALUES = ['pending', 'applied'];

function validate(entry) {
  const errors = [];

  for (const field of REQUIRED_ENTRY_FIELDS) {
    if (entry[field] === undefined || entry[field] === null) {
      if (field === 'related_entries') {
        entry[field] = [];
      } else {
        errors.push(`Missing required field: '${field}'`);
      }
    }
  }

  if (errors.length > 0) return errors;

  // Component format
  const componentParts = entry.component.split(':');
  if (componentParts.length !== 2 || !componentParts[0] || !componentParts[1]) {
    errors.push(`Invalid component format: '${entry.component}'. Expected '<category>:<name>'`);
  }

  // Severity
  if (!SEVERITY_VALUES.includes(entry.severity)) {
    errors.push(`Invalid severity: '${entry.severity}'. Expected one of: ${SEVERITY_VALUES.join(', ')}`);
  }

  // Root cause
  if (typeof entry.root_cause === 'object') {
    for (const field of REQUIRED_ROOT_CAUSE_FIELDS) {
      if (!entry.root_cause[field]) {
        errors.push(`Missing root_cause field: '${field}'`);
      }
    }
    if (entry.root_cause.layer && !LAYER_VALUES.includes(entry.root_cause.layer)) {
      errors.push(`Invalid layer: '${entry.root_cause.layer}'. Expected one of: ${LAYER_VALUES.join(', ')}`);
    }
    if (entry.root_cause.confidence && !CONFIDENCE_VALUES.includes(entry.root_cause.confidence)) {
      errors.push(`Invalid confidence: '${entry.root_cause.confidence}'. Expected one of: ${CONFIDENCE_VALUES.join(', ')}`);
    }
  } else {
    errors.push('root_cause must be an object');
  }

  // Solution
  if (typeof entry.solution === 'object') {
    for (const field of REQUIRED_SOLUTION_FIELDS) {
      if (!entry.solution[field]) {
        errors.push(`Missing solution field: '${field}'`);
      }
    }
    if (Array.isArray(entry.solution.actions)) {
      for (let i = 0; i < entry.solution.actions.length; i++) {
        const action = entry.solution.actions[i];
        for (const field of REQUIRED_ACTION_FIELDS) {
          if (!action[field] && action[field] !== '') {
            errors.push(`Missing field '${field}' in solution.actions[${i}]`);
          }
        }
        if (action.type && !ACTION_TYPE_VALUES.includes(action.type)) {
          errors.push(`Invalid action type in actions[${i}]: '${action.type}'`);
        }
        if (action.status && !ACTION_STATUS_VALUES.includes(action.status)) {
          errors.push(`Invalid action status in actions[${i}]: '${action.status}'`);
        }
        if (action.steps && !Array.isArray(action.steps)) {
          errors.push(`actions[${i}].steps must be an array`);
        }
      }
    } else {
      errors.push('solution.actions must be an array');
    }
  } else {
    errors.push('solution must be an object');
  }

  // Related entries
  if (!Array.isArray(entry.related_entries)) {
    errors.push('related_entries must be an array');
  }

  return errors;
}

// --- File operations ---

async function readJsonFile(filePath) {
  try {
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

async function writeJsonFile(filePath, data) {
  await mkdir(dirname(filePath), { recursive: true });
  const content = JSON.stringify(data, null, 2) + '\n';
  await writeFile(filePath, content, 'utf-8');
}

// --- Component path resolution ---

function resolveComponentPath(componentKey) {
  const [category, name] = componentKey.split(':');

  const categoryDirMap = {
    'skill': 'skills',
    'command': 'commands',
    'code': 'code',
    'orchestration': 'orchestration',
    'environment': 'environment',
    'rule': 'rules'
  };

  const dir = categoryDirMap[category];
  if (!dir) {
    throw new Error(`Unknown component category: '${category}'`);
  }

  return join(dir, `${name}.json`);
}

// --- ID generation ---

function generateId(componentKey, entryCount) {
  const name = componentKey.split(':')[1];
  const seq = String(entryCount + 1).padStart(3, '0');
  return `${name}-${seq}`;
}

// --- Main ---

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: node persist-entry.js \'<json-entry>\'');
    process.exit(1);
  }

  // Parse input
  let entry;
  try {
    entry = JSON.parse(arg);
  } catch (err) {
    console.error(`JSON parse error: ${err.message}`);
    process.exit(1);
  }

  // Validate
  const errors = validate(entry);
  if (errors.length > 0) {
    console.error('Validation errors:');
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  const componentKey = entry.component;
  const relativePath = resolveComponentPath(componentKey);
  const componentFile = join(BASE_DIR, relativePath);

  try {
    // Ensure base directory exists
    await mkdir(BASE_DIR, { recursive: true });

    // Read or create index
    let index = await readJsonFile(INDEX_FILE);
    if (!index) {
      index = {
        last_updated: new Date().toISOString(),
        total_entries: 0,
        components: {}
      };
    }

    // Read or create component file
    let componentData = await readJsonFile(componentFile);
    if (!componentData) {
      componentData = {
        component: componentKey,
        entries: []
      };
    }

    // Get current entry count for ID generation
    const currentCount = index.components[componentKey]?.entry_count ?? 0;

    // Generate ID
    const entryId = generateId(componentKey, currentCount);

    // Check ID uniqueness
    const existingIds = componentData.entries.map(e => e.id);
    if (existingIds.includes(entryId)) {
      console.error(`ID collision: '${entryId}' already exists in ${relativePath}`);
      process.exit(1);
    }

    // Set the ID on the entry and remove the component field (it's in the file wrapper)
    entry.id = entryId;
    const { component: _component, ...entryWithoutComponent } = entry;

    // Append entry
    componentData.entries.push(entryWithoutComponent);

    // Update index
    const now = new Date();
    const entryDate = entry.timestamp.split('T')[0];
    index.components[componentKey] = {
      path: relativePath,
      entry_count: currentCount + 1,
      last_entry: entryDate
    };
    index.total_entries = Object.values(index.components).reduce((sum, c) => sum + c.entry_count, 0);
    index.last_updated = now.toISOString();

    // Write both files
    await writeJsonFile(componentFile, componentData);
    await writeJsonFile(INDEX_FILE, index);

    // Post-write integrity check
    const verifyComponent = await readJsonFile(componentFile);
    const verifyIndex = await readJsonFile(INDEX_FILE);

    if (!verifyComponent || !verifyIndex) {
      console.error('Post-write integrity check failed: files not readable after write');
      process.exit(3);
    }

    const lastEntry = verifyComponent.entries[verifyComponent.entries.length - 1];
    if (lastEntry.id !== entryId) {
      console.error(`Post-write integrity check failed: expected last entry ID '${entryId}', got '${lastEntry.id}'`);
      process.exit(3);
    }

    if (verifyIndex.components[componentKey]?.entry_count !== currentCount + 1) {
      console.error('Post-write integrity check failed: index entry_count mismatch');
      process.exit(3);
    }

    // Success
    console.log(entryId);
    process.exit(0);

  } catch (err) {
    console.error(`File system error: ${err.message}`);
    process.exit(2);
  }
}

main();
