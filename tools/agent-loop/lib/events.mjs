// Append-only event log (.agent-loop/events.jsonl): one JSON object per line,
// so `status`, a dashboard or `tail -f` can follow what every agent is doing.
// The file rotates at 5 MB instead of growing without limit.

import fs from 'node:fs';
import path from 'node:path';

const ROTATE_BYTES = 5 * 1024 * 1024;

export function createEventLog(stateDir, { echo = true, clock = Date.now } = {}) {
  const file = path.join(stateDir, 'events.jsonl');
  fs.mkdirSync(stateDir, { recursive: true });
  return {
    file,
    emit(type, fields = {}) {
      const event = { at: new Date(clock()).toISOString(), type, ...fields };
      try {
        if (fs.existsSync(file) && fs.statSync(file).size > ROTATE_BYTES) fs.renameSync(file, `${file}.1`);
        fs.appendFileSync(file, JSON.stringify(event) + '\n');
      } catch { /* logging must never stop an agent */ }
      if (echo) {
        const who = fields.task ? `[${fields.task}${fields.attempt ? `#${fields.attempt}` : ''}]` : '[loop]';
        const detail = fields.message ?? fields.check ?? fields.provider ?? '';
        console.log(`${event.at.slice(11, 19)} ${who} ${type}${detail ? ` - ${detail}` : ''}`);
      }
      return event;
    },
  };
}

export function readRecentEvents(stateDir, limit = 20) {
  const file = path.join(stateDir, 'events.jsonl');
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
  return lines.slice(-limit).map((line) => {
    try { return JSON.parse(line); } catch { return { type: 'unreadable', message: line }; }
  });
}
