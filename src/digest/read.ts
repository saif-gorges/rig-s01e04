import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, Night, ReadNight, RunLine, RunStatus } from './types.js';

const STATUSES: readonly RunStatus[] = ['ok', 'retry', 'fail'];
const NIGHT = /^\d{4}-\d{2}-\d{2}$/;

// Parse at the edge: a line is either a valid RunLine or null (counted as bad).
export function parseLine(text: string): RunLine | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.at !== 'string' || typeof o.job !== 'string' || o.job === '') return null;
  if (typeof o.status !== 'string' || !STATUSES.includes(o.status as RunStatus)) return null;
  if (o.owner !== null && typeof o.owner !== 'string') return null;
  if (o.error !== undefined && typeof o.error !== 'string') return null;
  return {
    at: o.at,
    job: o.job,
    status: o.status as RunStatus,
    owner: o.owner,
    ...(o.error !== undefined ? { error: o.error } : {}),
  };
}

export function digest(lines: RunLine[]): DigestRow[] {
  const byJob = new Map<string, RunLine[]>();
  for (const l of lines) byJob.set(l.job, [...(byJob.get(l.job) ?? []), l]);
  return [...byJob.entries()]
    .map(([job, ls]): DigestRow => {
      const last = ls[ls.length - 1];
      const withError = ls.filter((l) => l.error !== undefined);
      const owners = ls.map((l) => l.owner).filter((o): o is string => o !== null);
      return {
        job,
        owner: owners.length ? owners[owners.length - 1] : null,
        runs: ls.length,
        retries: ls.filter((l) => l.status === 'retry').length,
        lastStatus: last.status,
        lastError: withError.length ? (withError[withError.length - 1].error ?? null) : null,
        firstAt: ls[0].at,
        lastAt: last.at,
      };
    })
    .sort((a, b) => (a.job < b.job ? -1 : a.job > b.job ? 1 : 0));
}

export function parseNight(night: string, text: string): Night {
  let badLines = 0;
  const lines: RunLine[] = [];
  for (const raw of text.split('\n')) {
    if (raw.trim() === '') continue;
    const l = parseLine(raw);
    if (l) lines.push(l);
    else badLines++;
  }
  return { night, rows: digest(lines), badLines };
}

export const readNight: ReadNight = (runsDir, night) => {
  if (!NIGHT.test(night)) return null;
  let text: string;
  try {
    text = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch {
    return null;
  }
  return parseNight(night, text);
};
