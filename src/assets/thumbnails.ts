import { loadVmt } from './vmt.ts';
import { fetchGameFile } from './fetch.ts';
import { parseVtf } from './vtf.ts';
import { decodeDxt } from './textures.ts';

const cache = new Map<string, Promise<string | null>>();

/** A small data-URL preview of a material's base texture, decoded on the CPU from a low mip level. */
export function materialThumbnail(name: string, size = 64): Promise<string | null> {
  const key = name.toLowerCase();
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      const vmt = await loadVmt(key);
      const base = vmt?.params.get('$basetexture');
      if (!base) return null;
      const buf = await fetchGameFile(`materials/${base.toLowerCase().replace(/\\/g, '/')}.vtf`);
      const img = buf && parseVtf(buf);
      if (!img) return null;
      const mip = img.mips.find((m) => m.width <= size * 2 && m.height <= size * 2) ?? img.mips[img.mips.length - 1];
      const rgba = img.encoding === 'rgba' ? mip.data : decodeDxt(mip, img.encoding);
      const canvas = document.createElement('canvas');
      canvas.width = mip.width;
      canvas.height = mip.height;
      const ctx = canvas.getContext('2d')!;
      const data = new Uint8ClampedArray(rgba.length);
      data.set(rgba);
      // Brush previews ignore alpha; decals keep it so their shape shows.
      if (!/^(decals|overlays)\//.test(key)) for (let i = 3; i < data.length; i += 4) data[i] = 255;
      ctx.putImageData(new ImageData(data, mip.width, mip.height), 0, 0);
      return canvas.toDataURL();
    })().catch(() => null);
    cache.set(key, p);
  }
  return p;
}
