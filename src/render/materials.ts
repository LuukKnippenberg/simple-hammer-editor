import { Color, MeshLambertMaterial, type Material } from 'three';

export type MaterialKind = 'opaque' | 'tool' | 'sky' | 'translucent' | 'blend';

export interface MaterialInfo {
  name: string;
  kind: MaterialKind;
  /** Texture size in texels; brush UVs are stored in texels and scaled by the texture matrix. */
  width: number;
  height: number;
  material: Material;
}

/** Tool textures that render in game (everything else under tools/ is invisible). */
const VISIBLE_TOOLS = new Set(['tools/toolsblack', 'tools/toolsblack_noportal', 'tools/toolsblack_nodraw']);

export function classify(name: string): MaterialKind {
  const n = name.toLowerCase();
  if (n === 'tools/toolsskybox' || n === 'tools/toolsskybox2d') return 'sky';
  if (n.startsWith('tools/') && !VISIBLE_TOOLS.has(n)) return 'tool';
  return 'opaque';
}

function hashColor(name: string): Color {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  const hue = ((h >>> 0) % 360) / 360;
  return new Color().setHSL(hue, 0.35, 0.55);
}

/**
 * Hands out one three.js material per VMF material name. Phase 0 uses flat colours
 * derived from the name; tool textures get translucent tints.
 */
export class MaterialLibrary {
  private map = new Map<string, MaterialInfo>();

  get(name: string): MaterialInfo {
    const key = name.toLowerCase();
    let info = this.map.get(key);
    if (!info) {
      const kind = classify(key);
      let material: Material;
      if (kind === 'tool' || kind === 'sky') {
        const tint = kind === 'sky' ? new Color(0.35, 0.6, 0.95) : key.includes('trigger') ? new Color(1, 0.55, 0.1) : key.includes('clip') ? new Color(0.8, 0.2, 0.9) : new Color(0.95, 0.85, 0.2);
        material = new MeshLambertMaterial({ color: tint, transparent: true, opacity: 0.25, depthWrite: false });
      } else {
        material = new MeshLambertMaterial({ color: hashColor(key) });
      }
      info = { name: key, kind, width: 512, height: 512, material };
      this.map.set(key, info);
    }
    return info;
  }

  all(): MaterialInfo[] {
    return [...this.map.values()];
  }
}
