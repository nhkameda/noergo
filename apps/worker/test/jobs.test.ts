import { describe, expect, it } from 'vitest';
import { JOBS } from '../src/jobs';

describe('jobs', () => {
  it('have unique names and sane intervals', () => {
    const names = JOBS.map((j) => j.name);
    expect(new Set(names).size).toBe(names.length);
    for (const j of JOBS) expect(j.everyMs).toBeGreaterThanOrEqual(60_000);
  });
});
