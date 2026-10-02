/** The draft (SQL and both dialects): remembered on this device, and packed
 * into share links. A link carries it in the fragment, which browsers never
 * send to the server. */

import { isDialect } from './dialects';

export interface Draft {
  sql: string;
  from: string;
  to: string;
}

export const MAX_SQL = 100_000;
const KEY = 'sqlforge:draft:v1';

function valid(d: unknown): d is Draft {
  const x = d as Draft;
  return !!x && typeof x.sql === 'string' && x.sql.length <= MAX_SQL && isDialect(x.from, true) && isDialect(x.to, false);
}

export function loadDraft(): Draft | null {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return valid(d) ? d : null;
  } catch {
    return null;
  }
}

export function saveDraft(d: Draft): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    // Private mode or full storage: the draft just is not remembered.
  }
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function through(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

const canZip = typeof CompressionStream === 'function';

/** "z" + deflated JSON where the browser can compress, else "p" + plain. */
export async function packDraft(d: Draft): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify({ s: d.sql, f: d.from, t: d.to }));
  return canZip ? 'z' + toBase64Url(await through(bytes, new CompressionStream('deflate-raw'))) : 'p' + toBase64Url(bytes);
}

export async function unpackDraft(packed: string): Promise<Draft | null> {
  try {
    const kind = packed[0];
    let bytes = fromBase64Url(packed.slice(1));
    if (kind === 'z') bytes = await through(bytes, new DecompressionStream('deflate-raw'));
    else if (kind !== 'p') return null;
    const raw = JSON.parse(new TextDecoder().decode(bytes));
    const d = { sql: raw.s, from: raw.f, to: raw.t };
    return valid(d) ? d : null;
  } catch {
    return null;
  }
}

/** The packed draft in a location hash like "#s=z…", if there is one. */
export function sharedIn(hash: string): string | null {
  const m = /^#s=([zp][A-Za-z0-9_-]+)$/.exec(hash);
  return m ? m[1] : null;
}
