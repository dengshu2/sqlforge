import { describe, expect, it } from 'vitest';
import { packDraft, sharedIn, unpackDraft } from './draft';

describe('share links', () => {
  it('round-trips SQL with any characters', async () => {
    const d = { sql: "SELECT '中文 ✓' AS x -- note\nFROM t;", from: 'hive', to: 'postgres' };
    const packed = await packDraft(d);
    expect(packed).toMatch(/^z[A-Za-z0-9_-]+$/);
    expect(await unpackDraft(packed)).toEqual(d);
  });

  it('compresses long SQL', async () => {
    const sql = 'SELECT a, b, c FROM some_table WHERE x = 1;\n'.repeat(200);
    expect((await packDraft({ sql, from: '', to: 'spark' })).length).toBeLessThan(sql.length / 10);
  });

  it('rejects unknown dialects and junk', async () => {
    const bad = await packDraft({ sql: 'select 1', from: 'hive', to: 'nosuch' });
    expect(await unpackDraft(bad)).toBeNull();
    expect(await unpackDraft('znot-base64!')).toBeNull();
    expect(await unpackDraft('x' + 'abc')).toBeNull();
  });

  it('accepts a generic source but not a generic target', async () => {
    expect(await unpackDraft(await packDraft({ sql: 's', from: '', to: 'mysql' }))).not.toBeNull();
    expect(await unpackDraft(await packDraft({ sql: 's', from: 'mysql', to: '' }))).toBeNull();
  });

  it('finds the draft in a hash', () => {
    expect(sharedIn('#s=zAbC_-1')).toBe('zAbC_-1');
    expect(sharedIn('#s=')).toBeNull();
    expect(sharedIn('#other')).toBeNull();
  });
});
