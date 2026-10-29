/** A `"key" "value"` line. */
export class KVPair {
  constructor(public key: string, public value: string) {}
}

/**
 * Valve KeyValues, as used by VMF and VMT files.
 *
 * Pairs and child blocks are kept in one ordered list: Hammer sometimes writes a child block
 * (e.g. `connections`) before later pairs, and a byte-identical round-trip needs that order.
 */
export class KVNode {
  name: string;
  items: (KVPair | KVNode)[] = [];

  constructor(name: string) {
    this.name = name;
  }

  /** Key/value pairs in order (a fresh array; mutate through set/addProp/delete). */
  get props(): [string, string][] {
    const out: [string, string][] = [];
    for (const it of this.items) if (it instanceof KVPair) out.push([it.key, it.value]);
    return out;
  }

  get children(): KVNode[] {
    const out: KVNode[] = [];
    for (const it of this.items) if (it instanceof KVNode) out.push(it);
    return out;
  }

  get(key: string): string | undefined {
    const k = key.toLowerCase();
    for (const it of this.items) if (it instanceof KVPair && it.key.toLowerCase() === k) return it.value;
    return undefined;
  }

  set(key: string, value: string): void {
    const k = key.toLowerCase();
    for (const it of this.items) {
      if (it instanceof KVPair && it.key.toLowerCase() === k) {
        it.value = value;
        return;
      }
    }
    this.addProp(key, value);
  }

  /** Appends a pair after the last existing pair (before child blocks, as Hammer writes new keys). */
  addProp(key: string, value: string): void {
    let at = 0;
    for (let i = 0; i < this.items.length; i++) if (this.items[i] instanceof KVPair) at = i + 1;
    this.items.splice(at, 0, new KVPair(key, value));
  }

  addChild(node: KVNode): KVNode {
    this.items.push(node);
    return node;
  }

  removeChild(node: KVNode): boolean {
    const i = this.items.indexOf(node);
    if (i >= 0) this.items.splice(i, 1);
    return i >= 0;
  }

  delete(key: string): void {
    const k = key.toLowerCase();
    this.items = this.items.filter((it) => !(it instanceof KVPair && it.key.toLowerCase() === k));
  }

  child(name: string): KVNode | undefined {
    const n = name.toLowerCase();
    for (const it of this.items) if (it instanceof KVNode && it.name.toLowerCase() === n) return it;
    return undefined;
  }

  childrenNamed(name: string): KVNode[] {
    const n = name.toLowerCase();
    const out: KVNode[] = [];
    for (const it of this.items) if (it instanceof KVNode && it.name.toLowerCase() === n) out.push(it);
    return out;
  }

  clone(): KVNode {
    const n = new KVNode(this.name);
    n.items = this.items.map((it) => (it instanceof KVPair ? new KVPair(it.key, it.value) : it.clone()));
    return n;
  }
}

const QUOTE = 34, LBRACE = 123, RBRACE = 125, SLASH = 47, LBRACKET = 91, NL = 10;

function isSpace(c: number): boolean {
  return c === 32 || c === 9 || c === 10 || c === 13 || c === 0xfeff;
}

/**
 * Parses KeyValues text into a list of root nodes. Lenient enough for VMT files:
 * unquoted tokens, `//` comments and `[$PLATFORM]` conditionals are accepted.
 */
export function parseKeyValues(text: string): KVNode[] {
  const len = text.length;
  let i = 0;

  const nextToken = (): string | number | null => {
    for (;;) {
      while (i < len && isSpace(text.charCodeAt(i))) i++;
      if (i >= len) return null;
      const c = text.charCodeAt(i);
      if (c === SLASH && text.charCodeAt(i + 1) === SLASH) {
        while (i < len && text.charCodeAt(i) !== NL) i++;
        continue;
      }
      if (c === LBRACE || c === RBRACE) {
        i++;
        return c;
      }
      if (c === QUOTE) {
        const end = text.indexOf('"', i + 1);
        const s = text.slice(i + 1, end < 0 ? len : end);
        i = end < 0 ? len : end + 1;
        return s;
      }
      const start = i;
      while (i < len) {
        const d = text.charCodeAt(i);
        if (isSpace(d) || d === QUOTE || d === LBRACE || d === RBRACE) break;
        i++;
      }
      return text.slice(start, i);
    }
  };

  const roots: KVNode[] = [];
  const stack: KVNode[] = [];
  let pending: string | null = null;

  for (;;) {
    const t = nextToken();
    if (t === null) break;
    if (t === LBRACE) {
      const node = new KVNode(pending ?? '');
      pending = null;
      if (stack.length) stack[stack.length - 1].items.push(node);
      else roots.push(node);
      stack.push(node);
    } else if (t === RBRACE) {
      pending = null;
      stack.pop();
    } else if (typeof t === 'string') {
      // A `[$X360]` conditional following a key/value is ignored.
      if (t.charCodeAt(0) === LBRACKET && pending === null && t.endsWith(']') && t.includes('$')) continue;
      if (pending === null) {
        pending = t;
      } else {
        if (stack.length) stack[stack.length - 1].items.push(new KVPair(pending, t));
        pending = null;
      }
    }
  }
  return roots;
}

/** Writes nodes in Hammer's layout: tab indentation, `"key" "value"`, braces on their own lines. */
export function writeKeyValues(nodes: KVNode[], eol = '\r\n'): string {
  const out: string[] = [];
  const write = (n: KVNode, depth: number) => {
    const ind = '\t'.repeat(depth);
    out.push(ind + n.name, ind + '{');
    const ind2 = ind + '\t';
    for (const it of n.items) {
      if (it instanceof KVPair) out.push(`${ind2}"${it.key}" "${it.value}"`);
      else write(it, depth + 1);
    }
    out.push(ind + '}');
  };
  for (const n of nodes) write(n, 0);
  return out.join(eol) + eol;
}
