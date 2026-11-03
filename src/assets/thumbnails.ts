import { loadVmt } from './vmt.ts';
import { fetchGameFile } from './fetch.ts';
import { parseVtf } from './vtf.ts';
import { decodeDxt } from './textures.ts';
import { cachedThumb, canvasPng, taskQueue, type StoredThumb, type ThumbOptions } from './thumbCache.ts';

/** A preview URL and the full size of a material's base texture. */
export interface MaterialPreview {
  url: string;
  width: number;
  height: number;
}

/** Fetching and decoding on the CPU: a few at once, so a full grid doesn't stall the page. */
const decodes = taskQueue(4);

/** A small preview URL of a material's base texture, decoded on the CPU from a low mip level. */
export function materialThumbnail(name: string, size = 64, opts: ThumbOptions = {}): Promise<string | null> {
  return materialPreview(name, size, opts).then((p) => p?.url ?? null);
}

/**
 * The preview plus the texture's size in pixels (decal tiles show it), kept across reloads.
 * `opts.priority` moves it up the queue; aborting `opts.signal` resolves null and drops it when nobody else waits.
 */
export function materialPreview(name: string, size = 64, opts: ThumbOptions = {}): Promise<MaterialPreview | null> {
  const key = name.toLowerCase();
  return cachedThumb(`material|${key}|${size}`, (priority, signal) => decodes.run(() => decode(key, size), priority, signal), opts);
}

async function decode(key: string, size: number): Promise<StoredThumb | null> {
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
  const blob = await canvasPng(canvas);
  return blob && { blob, width: img.width, height: img.height };
}
