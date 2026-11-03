/** Valve Texture Format decoder (7.0 – 7.5). Returns frame 0, face 0 with every mip level. */

export enum VtfFormat {
  RGBA8888 = 0, ABGR8888 = 1, RGB888 = 2, BGR888 = 3, RGB565 = 4, I8 = 5, IA88 = 6, P8 = 7, A8 = 8,
  RGB888_BLUESCREEN = 9, BGR888_BLUESCREEN = 10, ARGB8888 = 11, BGRA8888 = 12, DXT1 = 13, DXT3 = 14, DXT5 = 15,
  BGRX8888 = 16, BGR565 = 17, BGRX5551 = 18, BGRA4444 = 19, DXT1_ONEBITALPHA = 20, BGRA5551 = 21, UV88 = 22,
  UVWQ8888 = 23, RGBA16161616F = 24, RGBA16161616 = 25, UVLX8888 = 26,
}

export interface VtfMip {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface VtfImage {
  width: number;
  height: number;
  flags: number;
  format: VtfFormat;
  /** 'dxt1' | 'dxt1a' | 'dxt3' | 'dxt5' for block-compressed data, otherwise 'rgba' (already converted). */
  encoding: 'dxt1' | 'dxt1a' | 'dxt3' | 'dxt5' | 'rgba';
  /** Largest level first. */
  mips: VtfMip[];
  hasAlpha: boolean;
}

const TEXTUREFLAGS_ENVMAP = 0x4000;
const TEXTUREFLAGS_ONEBITALPHA = 0x1000;
const TEXTUREFLAGS_EIGHTBITALPHA = 0x2000;

function bytesPerPixel(f: number): number {
  switch (f) {
    case VtfFormat.RGBA8888: case VtfFormat.ABGR8888: case VtfFormat.ARGB8888: case VtfFormat.BGRA8888:
    case VtfFormat.BGRX8888: case VtfFormat.UVWQ8888: case VtfFormat.UVLX8888:
      return 4;
    case VtfFormat.RGB888: case VtfFormat.BGR888: case VtfFormat.RGB888_BLUESCREEN: case VtfFormat.BGR888_BLUESCREEN:
      return 3;
    case VtfFormat.RGB565: case VtfFormat.BGR565: case VtfFormat.BGRX5551: case VtfFormat.BGRA4444:
    case VtfFormat.BGRA5551: case VtfFormat.IA88: case VtfFormat.UV88:
      return 2;
    case VtfFormat.I8: case VtfFormat.A8: case VtfFormat.P8:
      return 1;
    case VtfFormat.RGBA16161616F: case VtfFormat.RGBA16161616:
      return 8;
    default:
      return 0;
  }
}

export function imageSize(f: number, w: number, h: number): number {
  if (f === VtfFormat.DXT1 || f === VtfFormat.DXT1_ONEBITALPHA) return Math.max(1, (w + 3) >> 2) * Math.max(1, (h + 3) >> 2) * 8;
  if (f === VtfFormat.DXT3 || f === VtfFormat.DXT5) return Math.max(1, (w + 3) >> 2) * Math.max(1, (h + 3) >> 2) * 16;
  return w * h * bytesPerPixel(f);
}

const halfToFloat = (h: number) => {
  const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, m = h & 0x3ff;
  if (e === 0) return s * Math.pow(2, -14) * (m / 1024);
  if (e === 31) return m ? NaN : s * Infinity;
  return s * Math.pow(2, e - 15) * (1 + m / 1024);
};

/** Converts one uncompressed level to RGBA8. */
function toRGBA(f: number, src: Uint8Array, w: number, h: number): Uint8Array {
  const n = w * h;
  const out = new Uint8Array(n * 4);
  const dv = new DataView(src.buffer, src.byteOffset, src.byteLength);
  for (let i = 0; i < n; i++) {
    let r = 0, g = 0, b = 0, a = 255;
    switch (f) {
      case VtfFormat.RGBA8888: case VtfFormat.UVWQ8888: case VtfFormat.UVLX8888:
        r = src[i * 4]; g = src[i * 4 + 1]; b = src[i * 4 + 2]; a = src[i * 4 + 3]; break;
      case VtfFormat.ABGR8888:
        a = src[i * 4]; b = src[i * 4 + 1]; g = src[i * 4 + 2]; r = src[i * 4 + 3]; break;
      case VtfFormat.ARGB8888:
        a = src[i * 4]; r = src[i * 4 + 1]; g = src[i * 4 + 2]; b = src[i * 4 + 3]; break;
      case VtfFormat.BGRA8888:
        b = src[i * 4]; g = src[i * 4 + 1]; r = src[i * 4 + 2]; a = src[i * 4 + 3]; break;
      case VtfFormat.BGRX8888:
        b = src[i * 4]; g = src[i * 4 + 1]; r = src[i * 4 + 2]; break;
      case VtfFormat.RGB888: case VtfFormat.RGB888_BLUESCREEN:
        r = src[i * 3]; g = src[i * 3 + 1]; b = src[i * 3 + 2];
        if (f === VtfFormat.RGB888_BLUESCREEN && r === 0 && g === 0 && b === 255) a = 0;
        break;
      case VtfFormat.BGR888: case VtfFormat.BGR888_BLUESCREEN:
        b = src[i * 3]; g = src[i * 3 + 1]; r = src[i * 3 + 2];
        if (f === VtfFormat.BGR888_BLUESCREEN && r === 0 && g === 0 && b === 255) a = 0;
        break;
      case VtfFormat.RGB565: {
        const v = dv.getUint16(i * 2, true);
        r = ((v >> 11) & 31) * 255 / 31; g = ((v >> 5) & 63) * 255 / 63; b = (v & 31) * 255 / 31; break;
      }
      case VtfFormat.BGR565: {
        const v = dv.getUint16(i * 2, true);
        b = ((v >> 11) & 31) * 255 / 31; g = ((v >> 5) & 63) * 255 / 63; r = (v & 31) * 255 / 31; break;
      }
      case VtfFormat.BGRX5551: case VtfFormat.BGRA5551: {
        const v = dv.getUint16(i * 2, true);
        b = (v & 31) * 255 / 31; g = ((v >> 5) & 31) * 255 / 31; r = ((v >> 10) & 31) * 255 / 31;
        if (f === VtfFormat.BGRA5551) a = v & 0x8000 ? 255 : 0;
        break;
      }
      case VtfFormat.BGRA4444: {
        const v = dv.getUint16(i * 2, true);
        b = (v & 15) * 17; g = ((v >> 4) & 15) * 17; r = ((v >> 8) & 15) * 17; a = ((v >> 12) & 15) * 17; break;
      }
      case VtfFormat.I8: r = g = b = src[i]; break;
      case VtfFormat.P8: r = g = b = src[i]; break;
      case VtfFormat.A8: r = g = b = 255; a = src[i]; break;
      case VtfFormat.IA88: r = g = b = src[i * 2]; a = src[i * 2 + 1]; break;
      case VtfFormat.UV88: r = src[i * 2]; g = src[i * 2 + 1]; b = 255; break;
      case VtfFormat.RGBA16161616F: {
        // HDR: simple clamp-tonemap to LDR.
        const t = (x: number) => Math.min(255, Math.max(0, Math.pow(Math.max(0, x), 1 / 2.2) * 255));
        r = t(halfToFloat(dv.getUint16(i * 8, true))); g = t(halfToFloat(dv.getUint16(i * 8 + 2, true)));
        b = t(halfToFloat(dv.getUint16(i * 8 + 4, true))); a = 255; break;
      }
      case VtfFormat.RGBA16161616:
        r = src[i * 8 + 1]; g = src[i * 8 + 3]; b = src[i * 8 + 5]; a = src[i * 8 + 7]; break;
    }
    out[i * 4] = r; out[i * 4 + 1] = g; out[i * 4 + 2] = b; out[i * 4 + 3] = a;
  }
  return out;
}

/** Whether a VTF's pixel format or flags carry an alpha channel. */
export function formatHasAlpha(format: VtfFormat, flags: number): boolean {
  return format === VtfFormat.DXT5 || format === VtfFormat.DXT3 || format === VtfFormat.DXT1_ONEBITALPHA ||
    !!(flags & (TEXTUREFLAGS_ONEBITALPHA | TEXTUREFLAGS_EIGHTBITALPHA)) ||
    [VtfFormat.RGBA8888, VtfFormat.ABGR8888, VtfFormat.ARGB8888, VtfFormat.BGRA8888, VtfFormat.BGRA4444, VtfFormat.BGRA5551, VtfFormat.IA88, VtfFormat.A8].includes(format);
}

/** Alpha from a VTF file's header alone (flags at 20, format at 52), without decoding it; false for a non-VTF. */
export function vtfHeaderHasAlpha(buffer: Uint8Array): boolean {
  if (buffer.byteLength < 64) return false;
  const dv = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (dv.getUint32(0, true) !== 0x00465456) return false;
  return formatHasAlpha(dv.getInt32(52, true) as VtfFormat, dv.getUint32(20, true));
}

export function parseVtf(buffer: ArrayBuffer): VtfImage | null {
  const dv = new DataView(buffer);
  if (buffer.byteLength < 64 || dv.getUint32(0, true) !== 0x00465456) return null; // "VTF\0"
  const minor = dv.getUint32(8, true);
  const headerSize = dv.getUint32(12, true);
  const width = dv.getUint16(16, true);
  const height = dv.getUint16(18, true);
  const flags = dv.getUint32(20, true);
  const frames = Math.max(1, dv.getUint16(24, true));
  const format = dv.getInt32(52, true) as VtfFormat;
  const mipCount = Math.max(1, dv.getUint8(56));
  const lowFormat = dv.getInt32(57, true);
  const lowW = dv.getUint8(61), lowH = dv.getUint8(62);
  const depth = minor >= 2 ? Math.max(1, dv.getUint16(63, true)) : 1;
  if (flags & TEXTUREFLAGS_ENVMAP) return null; // cubemaps are not needed by the editor
  if (depth > 1) return null;

  let start = -1;
  if (minor >= 3) {
    const numResources = dv.getUint32(68, true);
    for (let i = 0; i < numResources; i++) {
      const o = 80 + i * 8;
      if (dv.getUint8(o) === 0x30 && dv.getUint8(o + 1) === 0 && dv.getUint8(o + 2) === 0) start = dv.getUint32(o + 4, true);
    }
  }
  if (start < 0) start = headerSize + (lowFormat >= 0 ? imageSize(lowFormat, lowW, lowH) : 0);

  const levelSize = (m: number) => imageSize(format, Math.max(1, width >> m), Math.max(1, height >> m));
  // Levels are stored smallest first; each holds every frame.
  const mips: VtfMip[] = [];
  let offset = start;
  const offsets: number[] = new Array(mipCount);
  for (let m = mipCount - 1; m >= 0; m--) {
    offsets[m] = offset;
    offset += levelSize(m) * frames;
  }
  const compressed = format === VtfFormat.DXT1 || format === VtfFormat.DXT1_ONEBITALPHA || format === VtfFormat.DXT3 || format === VtfFormat.DXT5;
  if (!compressed && bytesPerPixel(format) === 0) return null;
  for (let m = 0; m < mipCount; m++) {
    const w = Math.max(1, width >> m), h = Math.max(1, height >> m);
    const size = levelSize(m);
    if (offsets[m] + size > buffer.byteLength) break;
    const raw = new Uint8Array(buffer, offsets[m], size);
    mips.push({ width: w, height: h, data: compressed ? raw.slice() : toRGBA(format, raw, w, h) });
  }
  if (!mips.length) return null;

  const hasAlpha = formatHasAlpha(format, flags);
  const encoding =
    format === VtfFormat.DXT1 ? (flags & TEXTUREFLAGS_ONEBITALPHA ? 'dxt1a' : 'dxt1')
      : format === VtfFormat.DXT1_ONEBITALPHA ? 'dxt1a'
        : format === VtfFormat.DXT3 ? 'dxt3' : format === VtfFormat.DXT5 ? 'dxt5' : 'rgba';
  return { width, height, flags, format, encoding, mips, hasAlpha };
}
