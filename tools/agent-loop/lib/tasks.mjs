// Task files: one Markdown file per job in agent-tasks/, with a small front
// matter block. The body is the instruction the agent gets.
//
//   ---
//   id: preset-travel-tests
//   title: Cover parseTravelInput edge cases
//   role: test
//   files: [src/presets/presetLibrary.ts, test/machine-presets.test.ts]
//   checks: [typecheck, unit]
//   maxAttempts: 4
//   dependsOn: [other-task-id]
//   runsOn: [windows, gpu]       # only hosts with all these tags take it
//   updateGoldens: true          # refresh regression baselines, for review
//   ---
//   Add tests for ...
//
// Progress lives in .agent-loop/state.json, so task files stay clean in git.

import fs from 'node:fs';
import path from 'node:path';

function parseScalar(text) {
  const value = text.trim();
  if (value === '') return '';
  if (/^(true|false)$/i.test(value)) return value.toLowerCase() === 'true';
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (value.startsWith('[') && value.endsWith(']')) {
    return value.slice(1, -1).split(',').map(item => parseScalar(item)).filter(item => item !== '');
  }
  return value.replace(/^(['"])(.*)\1$/, '$2');
}

/** Parse the YAML subset task files use: `key: value`, `[a, b]` lists and `- item` lists. */
export function parseFrontMatter(text) {
  const match = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!match) return { data: {}, body: text.trim() };
  const data = {};
  let listKey;
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && listKey) {
      data[listKey].push(parseScalar(item[1]));
      continue;
    }
    const pair = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!pair) throw new Error(`Front matter line not understood: "${line}"`);
    const [, key, rest] = pair;
    if (rest.trim() === '') {
      data[key] = [];
      listKey = key;
    } else {
      data[key] = parseScalar(rest);
      listKey = undefined;
    }
  }
  return { data, body: match[2].trim() };
}

export function parseTask(text, filePath) {
  const { data, body } = parseFrontMatter(text);
  const fallbackId = path.basename(filePath, path.extname(filePath));
  const id = String(data.id ?? fallbackId).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!id) throw new Error(`${filePath}: task needs an id`);
  if (!body) throw new Error(`${filePath}: task has no instructions`);
  const list = (value) => [].concat(value ?? []).map(String).filter(Boolean);
  return {
    id,
    title: String(data.title ?? id),
    role: String(data.role ?? 'develop'),
    files: list(data.files),
    checks: data.checks === undefined ? undefined : list(data.checks),
    maxAttempts: data.maxAttempts === undefined ? undefined : Number(data.maxAttempts),
    review: data.review === undefined ? undefined : Boolean(data.review),
    screenshots: Boolean(data.screenshots),
    dependsOn: list(data.dependsOn),
    runsOn: list(data.runsOn),
    updateGoldens: Boolean(data.updateGoldens),
    auto: Boolean(data.auto),
    priority: Number(data.priority ?? 0),
    enabled: data.enabled !== false,
    body,
    filePath,
  };
}

/** Every task in the top level of `dir`, highest priority first. Subfolders are not scanned. */
export function listTasks(dir) {
  if (!fs.existsSync(dir)) return { tasks: [], problems: [] };
  const tasks = [];
  const problems = [];
  const seen = new Map();
  for (const name of fs.readdirSync(dir).filter(n => n.endsWith('.md') && n.toLowerCase() !== 'readme.md').sort()) {
    const filePath = path.join(dir, name);
    try {
      const task = parseTask(fs.readFileSync(filePath, 'utf8'), filePath);
      if (seen.has(task.id)) problems.push(`${name}: id "${task.id}" is already used by ${seen.get(task.id)}`);
      else { seen.set(task.id, name); tasks.push(task); }
    } catch (err) {
      problems.push(err.message);
    }
  }
  tasks.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  return { tasks, problems };
}

export function newTaskTemplate(title, { role = 'develop', checks = [] } = {}) {
  const id = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return {
    id,
    text: `---\nid: ${id}\ntitle: ${title}\nrole: ${role}\nfiles: []\n${checks.length ? `checks: [${checks.join(', ')}]\n` : ''}---\nDescribe the change, what "done" looks like, and anything the agent must not touch.\n`,
  };
}
