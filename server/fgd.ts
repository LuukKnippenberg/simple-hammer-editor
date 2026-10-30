import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface FgdKey {
  name: string;
  type: string;
  label: string;
  default: string;
  description: string;
  choices?: { value: string; label: string }[];
}

export interface FgdClass {
  name: string;
  /** PointClass, SolidClass, NPCClass, ... */
  type: string;
  description: string;
  studio?: string;
  iconsprite?: string;
  keys: FgdKey[];
}

type Tok = { t: 'str' | 'word' | 'p'; v: string };

function tokenize(text: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '/') { while (i < n && text[i] !== '\n') i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '"') {
      const end = text.indexOf('"', i + 1);
      let s = text.slice(i + 1, end < 0 ? n : end);
      i = end < 0 ? n : end + 1;
      // "a" + "b" string concatenation
      for (;;) {
        let j = i;
        while (j < n && /\s/.test(text[j])) j++;
        if (text[j] !== '+') break;
        j++;
        while (j < n && /\s/.test(text[j])) j++;
        if (text[j] !== '"') break;
        const e2 = text.indexOf('"', j + 1);
        s += text.slice(j + 1, e2);
        i = e2 + 1;
      }
      out.push({ t: 'str', v: s });
      continue;
    }
    if ('()[]=:,@'.includes(c)) { out.push({ t: 'p', v: c }); i++; continue; }
    let j = i;
    while (j < n && !/[\s()[\]=:,@"]/.test(text[j])) j++;
    out.push({ t: 'word', v: text.slice(i, j) });
    i = j;
  }
  return out;
}

interface RawClass extends FgdClass {
  bases: string[];
}

function parse(text: string, classes: Map<string, RawClass>, includes: string[]): void {
  const toks = tokenize(text);
  let i = 0;
  const peek = (o = 0) => toks[i + o];
  const isP = (v: string, o = 0) => peek(o)?.t === 'p' && peek(o).v === v;
  const skipParens = () => {
    let depth = 0;
    do {
      if (isP('(')) depth++;
      else if (isP(')')) depth--;
      i++;
    } while (depth > 0 && i < toks.length);
  };

  while (i < toks.length) {
    if (!isP('@')) { i++; continue; }
    i++;
    const kind = peek()?.v ?? '';
    i++;
    if (/^include$/i.test(kind)) { includes.push(peek().v); i++; continue; }
    if (!/Class$/i.test(kind)) {
      // @mapsize(...), @MaterialExclusion [...], @AutoVisGroup = "x" [...]
      while (i < toks.length && !isP('@')) i++;
      continue;
    }
    const cls: RawClass = { name: '', type: kind, description: '', keys: [], bases: [] };
    // helpers until '='
    while (i < toks.length && !isP('=')) {
      const w = peek();
      if (w.t === 'word' && isP('(', 1)) {
        const helper = w.v.toLowerCase();
        i += 2;
        const args: string[] = [];
        while (i < toks.length && !isP(')')) {
          if (isP('(')) { skipParens(); continue; }
          if (peek().t !== 'p' || peek().v !== ',') args.push(peek().v);
          i++;
        }
        i++;
        if (helper === 'base') cls.bases.push(...args);
        else if (helper === 'studio' && args[0]) cls.studio = args[0];
        else if (helper === 'iconsprite' && args[0]) cls.iconsprite = args[0];
      } else i++;
    }
    i++; // '='
    cls.name = peek()?.v ?? '';
    i++;
    if (isP(':')) { i++; if (peek()?.t === 'str') { cls.description = peek().v; i++; } }
    if (!isP('[')) { classes.set(cls.name.toLowerCase(), cls); continue; }
    i++;
    while (i < toks.length && !isP(']')) {
      const w = peek();
      if (w.t !== 'word') { i++; continue; }
      if (/^(input|output)$/i.test(w.v)) {
        i++;
        if (peek()?.t === 'word') i++;
        if (isP('(')) skipParens();
        if (isP(':')) { i++; if (peek()?.t === 'str') i++; }
        continue;
      }
      if (!isP('(', 1)) { i++; continue; }
      const key: FgdKey = { name: w.v, type: peek(2)?.v.toLowerCase() ?? 'string', label: w.v, default: '', description: '' };
      i += 2;
      while (i < toks.length && !isP(')')) i++;
      i++;
      if (peek()?.t === 'word' && /^(readonly|report)$/i.test(peek().v)) i++;
      const fields: string[] = [];
      while (isP(':')) {
        i++;
        if (isP(':') || isP('=') || isP(']')) { fields.push(''); continue; }
        // A field is a single token; numbers may come as words.
        fields.push(peek().v);
        i++;
      }
      key.label = fields[0] || key.name;
      key.default = fields[1] ?? '';
      key.description = fields[2] ?? '';
      if (isP('=') && isP('[', 1)) {
        i += 2;
        const choices: { value: string; label: string }[] = [];
        while (i < toks.length && !isP(']')) {
          const value = peek().v;
          i++;
          let label = value;
          if (isP(':')) { i++; label = peek().v; i++; }
          if (isP(':')) { i += 2; } // flags default
          choices.push({ value, label });
        }
        i++;
        key.choices = choices;
      }
      cls.keys.push(key);
    }
    i++;
    classes.set(cls.name.toLowerCase(), cls);
  }
}

/** Parses an FGD and its includes; returns classes with inherited keys resolved. */
export function loadFgd(file: string, searchDirs: string[]): Map<string, FgdClass> {
  const raw = new Map<string, RawClass>();
  const seen = new Set<string>();
  const load = (name: string, from: string) => {
    const candidates = [join(from, name), ...searchDirs.map((d) => join(d, name))];
    const path = candidates.find((p) => existsSync(p));
    if (!path || seen.has(path.toLowerCase())) return;
    seen.add(path.toLowerCase());
    const includes: string[] = [];
    const text = readFileSync(path, 'latin1');
    // Includes come first in the file, so load them before this file's own classes.
    const inc = [...text.matchAll(/@include\s+"([^"]+)"/gi)].map((m) => m[1]);
    for (const n of inc) load(n, dirname(path));
    parse(text, raw, includes);
  };
  load(file.split(/[\\/]/).pop()!, dirname(file));

  const resolved = new Map<string, FgdClass>();
  const resolve = (name: string, stack: string[] = []): FgdKey[] => {
    const c = raw.get(name.toLowerCase());
    if (!c || stack.includes(name)) return [];
    const keys = new Map<string, FgdKey>();
    for (const b of c.bases) for (const k of resolve(b, [...stack, name])) keys.set(k.name.toLowerCase(), k);
    for (const k of c.keys) keys.set(k.name.toLowerCase(), k);
    return [...keys.values()];
  };
  for (const [k, c] of raw) {
    if (/^BaseClass$/i.test(c.type)) continue;
    let studio = c.studio, iconsprite = c.iconsprite;
    for (const b of c.bases) {
      const bc = raw.get(b.toLowerCase());
      studio ??= bc?.studio;
      iconsprite ??= bc?.iconsprite;
    }
    resolved.set(k, { name: c.name, type: c.type, description: c.description, studio, iconsprite, keys: resolve(c.name) });
  }
  return resolved;
}
