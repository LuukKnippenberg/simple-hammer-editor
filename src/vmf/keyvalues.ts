/**
 * Valve KeyValues, as used by VMF and VMT files.
 *
 * A node has an ordered list of `key "value"` pairs and an ordered list of child blocks.
 * Hammer always writes the pairs of a block before its child blocks, so keeping the two lists
 * separate is enough to write a VMF back out byte for byte.
 */
export class KVNode {
  name: string;
  props: [string, string][] = [];
  children: KVNode[] = [];

  constructor(name: string) {
    this.name = name;
  }

  get(key: string): string | undefined {
    const k = key.toLowerCase();
    for (const p of this.props) if (p[0].toLowerCase() === k) return p[1];
    return undefined;
  }

  set(key: string, value: string): void {
    const k = key.toLowerCase();
    for (const p of this.props) {
      if (p[0].toLowerCase() === k) {
        p[1] = value;
        return;
      }
    }
    this.props.push([key, value]);
  }

  delete(key: string): void {
    const k = key.toLowerCase();
    this.props = this.props.filter((p) => p[0].toLowerCase() !== k);
  }

  child(name: string): KVNode | undefined {
    const n = name.toLowerCase();
    return this.children.find((c) => c.name.toLowerCase() === n);
  }

  childrenNamed(name: string): KVNode[] {
    const n = name.toLowerCase();
    return this.children.filter((c) => c.name.toLowerCase() === n);
  }

  clone(): KVNode {
    const n = new KVNode(this.name);
    n.props = this.props.map((p) => [p[0], p[1]]);
    n.children = this.children.map((c) => c.clone());
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
      if (stack.length) stack[stack.length - 1].children.push(node);
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
        if (stack.length) stack[stack.length - 1].props.push([pending, t]);
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
    for (const [k, v] of n.props) out.push(`${ind2}"${k}" "${v}"`);
    for (const c of n.children) write(c, depth + 1);
    out.push(ind + '}');
  };
  for (const n of nodes) write(n, 0);
  return out.join(eol) + eol;
}
