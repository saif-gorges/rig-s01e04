import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { Night } from '../src/digest/types.js';

// Fixture nights live in a temp dir; runs/ is read-only and never touched here.
const NORMAL = '2026-11-01';
const EMPTY = '2026-11-02';
const BAD = '2026-11-03';
const MISSING = '2026-11-09';

const JOB_A = 'lane/sync';
const JOB_B = 'rig/rotate-logs';

const normalLines = [
  { at: '2026-11-01T23:00:02+01:00', job: JOB_B, status: 'ok', owner: 'lane-07' },
  { at: '2026-11-01T23:00:06+01:00', job: JOB_A, status: 'retry', owner: 'rook', error: 'timeout' },
  { at: '2026-11-01T23:01:06+01:00', job: JOB_A, status: 'ok', owner: 'rook' },
  { at: '2026-11-01T23:00:40+01:00', job: JOB_B, status: 'ok', owner: null },
];

let runsDir: string;
let config: { adapter: string; installed: string; beatEverySeconds: number; runsDir: string };

beforeAll(() => {
  runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-routes-'));
  writeFileSync(
    join(runsDir, `${NORMAL}.jsonl`),
    normalLines.map((l) => JSON.stringify(l)).join('\n') + '\n',
  );
  writeFileSync(join(runsDir, `${EMPTY}.jsonl`), '');
  writeFileSync(
    join(runsDir, `${BAD}.jsonl`),
    [
      JSON.stringify({ at: '2026-11-03T23:00:02+01:00', job: JOB_A, status: 'ok', owner: 'rook' }),
      'this is not json',
    ].join('\n') + '\n',
  );
  config = {
    adapter: 'shim',
    installed: '2026-10-29T14:06:00+01:00',
    beatEverySeconds: 60,
    runsDir,
  };
});

afterAll(() => {
  rmSync(runsDir, { recursive: true, force: true });
});

// Job names in the order they first appear in the page HTML.
function jobOrderInHtml(html: string, jobs: string[]): string[] {
  return jobs
    .map((job) => ({ job, at: html.indexOf(job) }))
    .filter((x) => x.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((x) => x.job);
}

describe('GET /digest/:night', () => {
  it('renders 200 with the usual layout and each job name', async () => {
    const res = await createApp(config).request(`/digest/${NORMAL}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('<html');
    expect(html).toContain(JOB_A);
    expect(html).toContain(JOB_B);
  });

  it('renders "nothing ran" for an empty night file', async () => {
    const res = await createApp(config).request(`/digest/${EMPTY}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('nothing ran');
  });

  it('returns 404 for a night with no file', async () => {
    const res = await createApp(config).request(`/digest/${MISSING}`);
    expect(res.status).toBe(404);
  });

  it('still renders 200 for a night with a bad line and mentions the bad line count', async () => {
    const res = await createApp(config).request(`/digest/${BAD}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain(JOB_A);
    expect(html).toContain('1 line');
  });
});

describe('GET /api/digest/:night', () => {
  it('returns 200 with the Night shape and rows for an existing night', async () => {
    const res = await createApp(config).request(`/api/digest/${NORMAL}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Night;
    expect(body.night).toBe(NORMAL);
    expect(body.badLines).toBe(0);
    expect(body.rows.map((r) => r.job)).toEqual([JOB_A, JOB_B]);

    const syncRow = body.rows.find((r) => r.job === JOB_A);
    expect(syncRow).toMatchObject({ runs: 2, retries: 1, lastStatus: 'ok', owner: 'rook' });
    expect(syncRow?.lastError).toBe('timeout');

    const rotateRow = body.rows.find((r) => r.job === JOB_B);
    expect(rotateRow).toMatchObject({ runs: 2, retries: 0, lastStatus: 'ok', owner: 'lane-07' });
  });

  it('returns 404 for a night with no file', async () => {
    const res = await createApp(config).request(`/api/digest/${MISSING}`);
    expect(res.status).toBe(404);
  });

  it('returns 200 with rows: [] for an empty night file', async () => {
    const res = await createApp(config).request(`/api/digest/${EMPTY}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Night;
    expect(body).toEqual({ night: EMPTY, rows: [], badLines: 0 });
  });

  it('counts a bad line and still returns the good rows', async () => {
    const res = await createApp(config).request(`/api/digest/${BAD}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Night;
    expect(body.badLines).toBe(1);
    expect(body.rows.map((r) => r.job)).toEqual([JOB_A]);
    expect(body.rows[0]?.runs).toBe(1);
  });

  it('lists jobs in the same order as the job names appear in the HTML page', async () => {
    const app = createApp(config);
    const json = (await (await app.request(`/api/digest/${NORMAL}`)).json()) as Night;
    const html = await (await app.request(`/digest/${NORMAL}`)).text();

    const jobs = json.rows.map((r) => r.job);
    expect(jobOrderInHtml(html, jobs)).toEqual(jobs);
  });
});
