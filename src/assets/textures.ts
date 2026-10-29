import {
  CompressedTexture, DataTexture, RGBAFormat, UnsignedByteType, RepeatWrapping, LinearFilter,
  LinearMipmapLinearFilter, SRGBColorSpace, RGB_S3TC_DXT1_Format, RGBA_S3TC_DXT1_Format, RGBA_S3TC_DXT3_Format,
  RGBA_S3TC_DXT5_Format, type Texture, type CompressedPixelFormat,
} from 'three';
import { parseVtf, type VtfImage, type VtfMip } from './vtf.ts';
import { fetchGameFile } from './fetch.ts';

export interface LoadedTexture {
  texture: Texture;
  width: number;
  height: number;
  hasAlpha: boolean;
}

/** Set by the editor once the WebGL context exists. Without S3TC sRGB support DXT is decoded on the CPU. */
export const textureSupport = { s3tcSrgb: true, anisotropy: 4 };

const cache = new Map<string, Promise<LoadedTexture | null>>();

function rgb565(c: number, out: number[], o: number) {
  out[o] = ((c >> 11) & 31) * 255 / 31;
  out[o + 1] = ((c >> 5) & 63) * 255 / 63;
  out[o + 2] = (c & 31) * 255 / 31;
}

/** Software DXT1/3/5 decoder, used only when the GPU lacks sRGB S3TC. */
function decodeDxt(mip: VtfMip, enc: string): Uint8Array {
  const { width: w, height: h, data } = mip;
  const out = new Uint8Array(w * h * 4);
  const bw = Math.max(1, (w + 3) >> 2), bh = Math.max(1, (h + 3) >> 2);
  const blockSize = enc === 'dxt1' || enc === 'dxt1a' ? 8 : 16;
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const col: number[] = new Array(16).fill(0);
  const alpha = new Uint8Array(16);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      let o = (by * bw + bx) * blockSize;
      alpha.fill(255);
      if (enc === 'dxt3') {
        for (let i = 0; i < 16; i++) alpha[i] = ((data[o + (i >> 1)] >> ((i & 1) * 4)) & 15) * 17;
        o += 8;
      } else if (enc === 'dxt5') {
        const a0 = data[o], a1 = data[o + 1];
        const pal = [a0, a1];
        if (a0 > a1) for (let i = 1; i < 7; i++) pal.push(((7 - i) * a0 + i * a1) / 7);
        else { for (let i = 1; i < 5; i++) pal.push(((5 - i) * a0 + i * a1) / 5); pal.push(0, 255); }
        let bits = 0n;
        for (let i = 0; i < 6; i++) bits |= BigInt(data[o + 2 + i]) << BigInt(8 * i);
        for (let i = 0; i < 16; i++) alpha[i] = pal[Number((bits >> BigInt(3 * i)) & 7n)];
        o += 8;
      }
      const c0 = dv.getUint16(o, true), c1 = dv.getUint16(o + 2, true);
      rgb565(c0, col, 0); rgb565(c1, col, 4);
      const fourColor = c0 > c1 || blockSize === 16;
      for (let k = 0; k < 3; k++) {
        col[8 + k] = fourColor ? (2 * col[k] + col[4 + k]) / 3 : (col[k] + col[4 + k]) / 2;
        col[12 + k] = fourColor ? (col[k] + 2 * col[4 + k]) / 3 : 0;
      }
      const idx = dv.getUint32(o + 4, true);
      for (let i = 0; i < 16; i++) {
        const x = bx * 4 + (i & 3), y = by * 4 + (i >> 2);
        if (x >= w || y >= h) continue;
        const ci = (idx >> (2 * i)) & 3;
        const p = (y * w + x) * 4;
        out[p] = col[ci * 4]; out[p + 1] = col[ci * 4 + 1]; out[p + 2] = col[ci * 4 + 2];
        out[p + 3] = !fourColor && ci === 3 && enc === 'dxt1a' ? 0 : alpha[i];
      }
    }
  }
  return out;
}

const DXT_FORMATS: Record<string, CompressedPixelFormat> = {
  dxt1: RGB_S3TC_DXT1_Format, dxt1a: RGBA_S3TC_DXT1_Format, dxt3: RGBA_S3TC_DXT3_Format, dxt5: RGBA_S3TC_DXT5_Format,
};

export function vtfToTexture(img: VtfImage): Texture {
  // Keep only a mip chain that halves cleanly, otherwise WebGL rejects the texture.
  const mips = img.mips.filter((m, i) => i === 0 || (m.width === Math.max(1, img.width >> i) && m.height === Math.max(1, img.height >> i)));
  let tex: Texture;
  if (img.encoding !== 'rgba' && textureSupport.s3tcSrgb) {
    tex = new CompressedTexture(mips.map((m) => ({ data: m.data, width: m.width, height: m.height })) as never, img.width, img.height, DXT_FORMATS[img.encoding]);
  } else {
    const levels = img.encoding === 'rgba' ? mips.map((m) => m.data) : mips.map((m) => decodeDxt(m, img.encoding));
    const dt = new DataTexture(levels[0], img.width, img.height, RGBAFormat, UnsignedByteType);
    if (levels.length > 1) dt.mipmaps = levels.map((d, i) => ({ data: d, width: mips[i].width, height: mips[i].height })) as never;
    tex = dt;
  }
  const fullChain = mips.length === Math.floor(Math.log2(Math.max(img.width, img.height))) + 1;
  tex.minFilter = fullChain ? LinearMipmapLinearFilter : LinearFilter;
  tex.magFilter = LinearFilter;
  tex.generateMipmaps = false;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = textureSupport.anisotropy;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}

/** Loads `materials/<name>.vtf`. Results are shared; clone the texture to change repeat/offset. */
export function loadTexture(name: string): Promise<LoadedTexture | null> {
  const key = name.toLowerCase().replace(/\\/g, '/').replace(/\.vtf$/, '');
  let p = cache.get(key);
  if (!p) {
    p = fetchGameFile(`materials/${key}.vtf`).then((buf) => {
      if (!buf) return null;
      const img = parseVtf(buf);
      if (!img) return null;
      return { texture: vtfToTexture(img), width: img.width, height: img.height, hasAlpha: img.hasAlpha };
    });
    cache.set(key, p);
  }
  return p;
}
