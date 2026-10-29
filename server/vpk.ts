import { openSync, readSync, closeSync, readFileSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';

/** One file inside a VPK archive. */
interface VpkEntry {
  archiveIndex: number;
  offset: number;
  length: number;
  preload: Buffer | null;
}

/**
 * Reader for Valve VPK v1/v2 directory archives (`pak01_dir.vpk` + `pak01_###.vpk`).
 * Only the directory tree is held in memory; file data is read on demand.
 */
export class VpkArchive {
  readonly entries = new Map<string, VpkEntry>();
  private readonly dirPath: string;
  private dataStart = 0;

  constructor(dirPath: string) {
    this.dirPath = dirPath;
    const buf = readFileSync(dirPath);
    const sig = buf.readUInt32LE(0);
    if (sig !== 0x55aa1234) throw new Error(`Not a VPK: ${dirPath}`);
    const version = buf.readUInt32LE(4);
    const treeSize = buf.readUInt32LE(8);
    const headerSize = version === 1 ? 12 : 28;
    this.dataStart = headerSize + treeSize;

    let p = headerSize;
    const readStr = (): string => {
      const end = buf.indexOf(0, p);
      const s = buf.toString('latin1', p, end);
      p = end + 1;
      return s;
    };
    for (;;) {
      const ext = readStr();
      if (!ext) break;
      for (;;) {
        const path = readStr();
        if (!path) break;
        for (;;) {
          const name = readStr();
          if (!name) break;
          p += 4; // crc
          const preloadBytes = buf.readUInt16LE(p); p += 2;
          const archiveIndex = buf.readUInt16LE(p); p += 2;
          const offset = buf.readUInt32LE(p); p += 4;
          const length = buf.readUInt32LE(p); p += 4;
          p += 2; // terminator 0xffff
          const preload = preloadBytes ? buf.subarray(p, p + preloadBytes) : null;
          p += preloadBytes;
          const full = (path === ' ' ? '' : path + '/') + name + (ext === ' ' ? '' : '.' + ext);
          this.entries.set(full.toLowerCase(), { archiveIndex, offset, length, preload });
        }
      }
    }
  }

  has(path: string): boolean {
    return this.entries.has(path.toLowerCase());
  }

  read(path: string): Buffer | null {
    const e = this.entries.get(path.toLowerCase());
    if (!e) return null;
    const parts: Buffer[] = [];
    if (e.preload) parts.push(e.preload);
    if (e.length > 0) {
      let file: string;
      let offset = e.offset;
      if (e.archiveIndex === 0x7fff) {
        file = this.dirPath;
        offset += this.dataStart;
      } else {
        const base = basename(this.dirPath).replace(/_dir\.vpk$/i, '');
        file = join(dirname(this.dirPath), `${base}_${String(e.archiveIndex).padStart(3, '0')}.vpk`);
      }
      const fd = openSync(file, 'r');
      try {
        const data = Buffer.alloc(e.length);
        readSync(fd, data, 0, e.length, offset);
        parts.push(data);
      } finally {
        closeSync(fd);
      }
    }
    return parts.length === 1 ? parts[0] : Buffer.concat(parts);
  }

  /** Paths of all entries below a directory prefix (lowercase, no trailing slash). */
  list(prefix: string, ext?: string): string[] {
    const pre = prefix.toLowerCase().replace(/\/$/, '') + '/';
    const out: string[] = [];
    for (const k of this.entries.keys()) {
      if (k.startsWith(pre) && (!ext || k.endsWith(ext))) out.push(k);
    }
    return out;
  }
}
