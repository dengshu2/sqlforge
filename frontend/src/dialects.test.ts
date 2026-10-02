import { describe, expect, it } from 'vitest';
import { COMMON, groups } from './dialects';

describe('dialect picker groups', () => {
  it('lists common dialects first, generic only for the source', () => {
    const [common, rest] = groups('', true);
    expect(common.items).toEqual(['', ...COMMON]);
    expect(rest.items).not.toContain('hive');
    expect(groups('', false)[0].items).toEqual(COMMON);
  });

  it('matches names and aliases, best match first', () => {
    expect(groups('pg', false)[0].items[0]).toBe('postgres');
    expect(groups('mssql', false)[0].items).toEqual(['tsql']);
    expect(groups('s', false)[0].items[0]).toBe('snowflake');
    expect(groups('spark', false)[0].items).toEqual(['spark']);
    expect(groups('zzz', false)[0].items).toEqual([]);
  });
});
