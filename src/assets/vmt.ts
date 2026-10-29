import { parseKeyValues, type KVNode } from '../vmf/keyvalues.ts';
import { fetchGameText } from './fetch.ts';

export interface Vmt {
  /** Shader name, lowercase (lightmappedgeneric, worldvertextransition, vertexlitgeneric, ...). */
  shader: string;
  /** Parameters with lowercase keys ($basetexture, %compilenodraw, ...). */
  params: Map<string, string>;
}

const cache = new Map<string, Promise<Vmt | null>>();

export function normalizeMaterialPath(name: string): string {
  let n = name.toLowerCase().replace(/\\/g, '/').replace(/^\/+/, '');
  if (n.startsWith('materials/')) n = n.slice(10);
  if (n.endsWith('.vmt')) n = n.slice(0, -4);
  return n;
}

function readParams(node: KVNode, into: Map<string, string>): void {
  for (const [k, v] of node.props) into.set(k.toLowerCase(), v);
  for (const c of node.children) {
    // Conditional blocks like ">=dx90" or "dx9" carry overrides; apply them, skip proxies and fallbacks.
    const n = c.name.toLowerCase();
    if (n === 'proxies' || n.startsWith('<') || n.includes('dx8') || n.includes('dx7') || n.includes('_dx6')) continue;
    if (n.startsWith('>=') || n.startsWith('dx9') || n.startsWith('dx90') || n === 'gpu>=1') readParams(c, into);
  }
}

async function load(name: string, depth: number): Promise<Vmt | null> {
  const text = await fetchGameText(`materials/${name}.vmt`);
  if (!text) return null;
  const root = parseKeyValues(text)[0];
  if (!root) return null;
  const shader = root.name.toLowerCase();
  if (shader === 'patch' && depth < 4) {
    const include = root.get('include');
    const base = include ? await load(normalizeMaterialPath(include), depth + 1) : null;
    const params = new Map(base?.params ?? []);
    for (const block of ['insert', 'replace']) {
      const b = root.child(block);
      if (b) readParams(b, params);
    }
    return { shader: base?.shader ?? 'lightmappedgeneric', params };
  }
  const params = new Map<string, string>();
  readParams(root, params);
  return { shader, params };
}

export function loadVmt(name: string): Promise<Vmt | null> {
  const key = normalizeMaterialPath(name);
  let p = cache.get(key);
  if (!p) cache.set(key, (p = load(key, 0)));
  return p;
}
