import { describe, expect, it } from 'vitest';
import { parseLine, readNight } from '../src/digest/read.js';

describe('readNight', () => {
  it('reads 2026-10-28: 5 jobs, 1 bad line', () => {
    const n = readNight('runs', '2026-10-28')!;
    expect(n.badLines).toBe(1);
    expect(n.rows.map((r) => r.job)).toEqual(['digest/render', 'fixtures/refresh', 'lane/sync', 'notes/backup', 'rig/rotate-logs']);
    const fx = n.rows.find((r) => r.job === 'fixtures/refresh')!;
    expect(fx).toMatchObject({ runs: 4, retries: 3, lastStatus: 'ok', lastError: 'upstream 503', owner: 'rook' });
    expect(n.rows.find((r) => r.job === 'notes/backup')).toMatchObject({ lastStatus: 'fail', lastError: 'quota exceeded' });
    expect(n.rows.find((r) => r.job === 'digest/render')!.owner).toBeNull();
  });

  it('keeps the offset from the log', () => {
    const n = readNight('runs', '2026-10-28')!;
    expect(n.rows.find((r) => r.job === 'rig/rotate-logs')!.firstAt).toBe('2026-10-28T23:00:02+01:00');
  });

  it('returns null for a night with no file, or a bad night name', () => {
    expect(readNight('runs', '2026-01-01')).toBeNull();
    expect(readNight('runs', '../package')).toBeNull();
  });

  it('counts lines that do not parse instead of throwing', () => {
    expect(parseLine('{not json')).toBeNull();
    expect(parseLine('{"at":"x","job":"j","status":"maybe","owner":null}')).toBeNull();
  });
});
