import { KVNode, KVPair } from './keyvalues.ts';
import type { MapEntity, VmfDocument } from './map.ts';
import { fgdClass } from '../assets/fgd.ts';

/** Hammer writes connection fields separated by ESC (0x1B); old maps use commas. */
export const SEP = '\x1b';

/** One entity output connection: when `output` fires, send `input` (with `param`) to `target` after `delay`. */
export interface Connection {
  output: string;
  target: string;
  input: string;
  param: string;
  delay: number;
  /** -1 for unlimited. */
  times: number;
}

export function parseConnection(output: string, value: string): Connection {
  const parts = value.includes(SEP) ? value.split(SEP) : value.split(',');
  return {
    output,
    target: parts[0] ?? '',
    input: parts[1] ?? '',
    param: parts[2] ?? '',
    delay: parseFloat(parts[3] ?? '0') || 0,
    times: parseInt(parts[4] ?? '-1', 10) || -1,
  };
}

export function connectionValue(c: Connection): string {
  return [c.target, c.input, c.param, String(c.delay), String(c.times)].join(SEP);
}

export function getConnections(e: MapEntity): Connection[] {
  const block = e.node.child('connections');
  return block ? block.props.map(([k, v]) => parseConnection(k, v)) : [];
}

/** Replaces the entity's connections block (removes it when empty, as Hammer does). */
export function setConnections(e: MapEntity, list: Connection[]): void {
  let block = e.node.child('connections');
  if (!list.length) {
    if (block) e.node.removeChild(block);
    e.version++;
    return;
  }
  if (!block) {
    block = new KVNode('connections');
    // Hammer writes connections after the keyvalues and before solids/editor.
    const at = e.node.items.findIndex((it) => it instanceof KVNode);
    if (at >= 0) e.node.items.splice(at, 0, block);
    else e.node.items.push(block);
  }
  block.items = list.map((c) => new KVPair(c.output, connectionValue(c)));
  e.version++;
}

/** Special target names the engine resolves at runtime. */
const SPECIAL_TARGETS = new Set(['!self', '!activator', '!caller', '!player', '!pvsplayer', '!speechtarget', '!picker']);

export function entitiesByName(doc: VmfDocument): Map<string, MapEntity[]> {
  const map = new Map<string, MapEntity[]>();
  for (const e of doc.entities) {
    const n = e.get('targetname');
    if (!n) continue;
    const k = n.toLowerCase();
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(e);
  }
  return map;
}

/** Entities matching a target name, including Source's trailing `*` wildcard and `!` names. */
export function resolveTarget(byName: Map<string, MapEntity[]>, target: string): MapEntity[] | 'special' {
  const t = target.toLowerCase();
  if (SPECIAL_TARGETS.has(t)) return 'special';
  if (t.endsWith('*')) {
    const pre = t.slice(0, -1);
    return [...byName.entries()].filter(([k]) => k.startsWith(pre)).flatMap(([, v]) => v);
  }
  return byName.get(t) ?? [];
}

export interface IoProblem {
  entity: MapEntity;
  index: number;
  severity: 'error' | 'warning';
  message: string;
}

/** Finds connections to missing targets, unknown outputs and inputs (checked against the FGD). */
export function validateConnections(doc: VmfDocument): IoProblem[] {
  const byName = entitiesByName(doc);
  const problems: IoProblem[] = [];
  for (const e of doc.entities) {
    const cls = fgdClass(e.classname);
    getConnections(e).forEach((c, index) => {
      if (cls && cls.outputs.length && !cls.outputs.some((o) => o.name.toLowerCase() === c.output.toLowerCase())) {
        problems.push({ entity: e, index, severity: 'warning', message: `${e.classname} has no output "${c.output}"` });
      }
      if (!c.target) {
        problems.push({ entity: e, index, severity: 'error', message: `${c.output} has no target` });
        return;
      }
      const targets = resolveTarget(byName, c.target);
      if (targets === 'special') return;
      if (!targets.length) {
        problems.push({ entity: e, index, severity: 'error', message: `${c.output} → "${c.target}": no entity with that name` });
        return;
      }
      const ok = targets.some((t) => {
        const tc = fgdClass(t.classname);
        return !tc || !tc.inputs.length || tc.inputs.some((i) => i.name.toLowerCase() === c.input.toLowerCase());
      });
      if (!ok) problems.push({ entity: e, index, severity: 'error', message: `"${c.target}" (${targets[0].classname}) has no input "${c.input}"` });
    });
  }
  return problems;
}

/** Connections from other entities that target this one. */
export function incomingConnections(doc: VmfDocument, e: MapEntity): { from: MapEntity; c: Connection }[] {
  const name = e.get('targetname')?.toLowerCase();
  if (!name) return [];
  const out: { from: MapEntity; c: Connection }[] = [];
  for (const from of doc.entities) {
    for (const c of getConnections(from)) {
      const t = c.target.toLowerCase();
      if (t === name || (t.endsWith('*') && name.startsWith(t.slice(0, -1)))) out.push({ from, c });
    }
  }
  return out;
}
