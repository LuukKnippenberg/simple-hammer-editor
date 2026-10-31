import { Color, DataTexture, DoubleSide, MeshLambertMaterial, Vector2, Vector4, type Texture } from 'three';
import { forgetVmt, loadVmt, normalizeMaterialPath, type Vmt } from '../assets/vmt.ts';
import { loadTexture } from '../assets/textures.ts';
import { blendFromParams, type BlendDef } from '../edit/multiblend.ts';

/** `handle`: editor-only boxes (POI and building handles), drawn faint and never compiled. */
export type MaterialKind = 'opaque' | 'tool' | 'sky' | 'translucent' | 'blend' | 'handle';

export interface MaterialInfo {
  name: string;
  kind: MaterialKind;
  /** Texture size in texels; brush UVs are stored in texels and scaled by the texture matrix. */
  width: number;
  height: number;
  material: MeshLambertMaterial;
  /** Set once the VMT and textures are resolved (or failed to). */
  loaded: boolean;
  /** Base texture (unscaled, shared) for previews in the material browser. */
  preview: Texture | null;
  /** For MultiBlend materials: the layers, base first (set once the VMT loaded). */
  multiblend?: BlendDef;
}

/** Tool textures that render in game (everything else under tools/ is invisible). */
const VISIBLE_TOOLS = new Set(['tools/toolsblack', 'tools/toolsblack_noportal', 'tools/toolsblack_nodraw']);
const TOOL_FLAGS = ['%compilenodraw', '%compileclip', '%compileplayerclip', '%compilenpcclip', '%compiletrigger', '%compileskip', '%compilehint', '%compileorigin', '%compileareaportal', '%compileinvisible', '%compilenochop'];

export function classify(name: string, vmt?: Vmt | null): MaterialKind {
  const n = name.toLowerCase();
  if (n.startsWith('editor/')) return 'handle';
  if (vmt) {
    const p = vmt.params;
    if (p.get('%compilesky') === '1' || p.get('%compile2dsky') === '1') return 'sky';
    if (TOOL_FLAGS.some((f) => p.get(f) === '1') && !VISIBLE_TOOLS.has(n)) return 'tool';
    if (vmt.shader === 'water' || p.get('%compilewater') === '1') return 'translucent';
    if (vmt.shader === 'worldvertextransition' || vmt.shader.includes('4wayblend') || vmt.shader === 'multiblend') return 'blend';
    if (p.get('$translucent') === '1') return 'translucent';
  }
  if (n === 'tools/toolsskybox' || n === 'tools/toolsskybox2d') return 'sky';
  if (n.startsWith('tools/') && !VISIBLE_TOOLS.has(n)) return 'tool';
  return 'opaque';
}

function hashColor(name: string): Color {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  return new Color().setHSL(((h >>> 0) % 360) / 360, 0.3, 0.5);
}

function toolTint(name: string, kind: MaterialKind): Color {
  if (kind === 'sky') return new Color(0.35, 0.6, 0.95);
  if (name.includes('trigger')) return new Color(1, 0.55, 0.1);
  if (name.includes('clip')) return new Color(0.8, 0.2, 0.9);
  if (name.includes('hint') || name.includes('skip')) return new Color(0.9, 0.3, 0.3);
  return new Color(0.95, 0.85, 0.2);
}

/** Makes a Lambert material blend `map` and `map2` by the per-vertex `alpha` attribute (displacement blends). */
function makeBlend(mat: MeshLambertMaterial, map2: Texture, scale: Vector2): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.map2 = { value: map2 };
    shader.uniforms.map2Scale = { value: scale };
    shader.vertexShader =
      'attribute float alpha;\nvarying float vBlend;\n' +
      shader.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n\tvBlend = alpha;');
    shader.fragmentShader =
      'uniform sampler2D map2;\nuniform vec2 map2Scale;\nvarying float vBlend;\n' +
      shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
	vec4 sampledDiffuseColor = mix( texture2D( map, vMapUv ), texture2D( map2, vMapUv * map2Scale ), clamp( vBlend, 0.0, 1.0 ) );
	diffuseColor *= sampledDiffuseColor;
#endif`,
      );
  };
  mat.customProgramCacheKey = () => 'wvt-blend';
}

/** What the engine binds when a $spectexture is missing: alpha 0, so that layer's edges are hard. */
const BLACK = new DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
BLACK.needsUpdate = true;

/**
 * Makes a Lambert material show a MultiBlend: four textures mixed by the per-vertex `mblend` weights with the
 * engine's rules (common_deferred_fxc.h ComputeMultiBlendFactor): slots take their share in order, base texture
 * alpha is the blend height, spec texture alpha the softness, and slot 4 gets the rest.
 */
function makeMultiBlend(mat: MeshLambertMaterial, maps: Texture[], specs: (Texture | null)[], rotations: number[], scales: number[]): void {
  mat.onBeforeCompile = (shader) => {
    maps.forEach((m, i) => (shader.uniforms[`mbMap${i}`] = { value: m }));
    specs.forEach((s, i) => (shader.uniforms[`mbSpec${i}`] = { value: s ?? BLACK }));
    shader.uniforms.mbRot = { value: new Vector4(...rotations.map((d) => (d * Math.PI) / 180)) };
    shader.uniforms.mbScale = { value: new Vector4(...scales.map((s) => (s > 0 ? s : 1))) };
    shader.vertexShader =
      'attribute vec4 mblend;\nvarying vec4 vMBlend;\n' +
      shader.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n\tvMBlend = mblend;');
    shader.fragmentShader =
      `uniform sampler2D mbMap0, mbMap1, mbMap2, mbMap3, mbSpec0, mbSpec1, mbSpec2, mbSpec3;
uniform vec4 mbRot, mbScale;
varying vec4 vMBlend;
vec2 mbCoord( vec2 uv, float r, float s ) {
	vec2 a = uv - 0.5;
	float c = cos( r ), sn = sin( r );
	return vec2( a.x * c - a.y * sn, a.x * sn + a.y * c ) / s + 0.5;
}
float mbFactor( float bstart, float bend, float amount, inout float remaining ) {
	float res = 0.0;
	if ( remaining > 0.0 && amount > 0.0 ) {
		float minb = max( 0.0, bend - bstart ), maxb = min( 1.0, bend + bstart );
		if ( minb != maxb ) res = smoothstep( minb, maxb, amount );
		else if ( amount >= minb ) res = 1.0;
	}
	res = clamp( res, 0.0, remaining );
	remaining -= res;
	return res;
}
` +
      shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
	vec2 uv0 = mbCoord( vMapUv, mbRot.x, mbScale.x ), uv1 = mbCoord( vMapUv, mbRot.y, mbScale.y );
	vec2 uv2 = mbCoord( vMapUv, mbRot.z, mbScale.z ), uv3 = mbCoord( vMapUv, mbRot.w, mbScale.w );
	vec4 c0 = texture2D( mbMap0, uv0 ), c1 = texture2D( mbMap1, uv1 ), c2 = texture2D( mbMap2, uv2 ), c3 = texture2D( mbMap3, uv3 );
	float remaining = 1.0;
	float f0 = mbFactor( texture2D( mbSpec0, uv0 ).a, c0.a, vMBlend.x, remaining );
	float f1 = mbFactor( texture2D( mbSpec1, uv1 ).a, c1.a, vMBlend.y, remaining );
	float f2 = mbFactor( texture2D( mbSpec2, uv2 ).a, c2.a, vMBlend.z, remaining );
	diffuseColor.rgb *= c0.rgb * f0 + c1.rgb * f1 + c2.rgb * f2 + c3.rgb * remaining;
#endif`,
      );
  };
  mat.customProgramCacheKey = () => 'multiblend';
}

/**
 * Hands out one three.js material per VMT. Materials start as a flat colour and are upgraded in place
 * once the VMT and VTF files arrive, so batched meshes never need rebuilding.
 * World materials expect UVs in texels; model materials expect regular 0..1 UVs.
 */
export class MaterialLibrary {
  private world = new Map<string, MaterialInfo>();
  private models = new Map<string, MaterialInfo>();
  /** Called (batched per frame) when a material's kind changes after its VMT loaded. */
  onKindChange: () => void = () => {};
  private kindChangeQueued = false;

  get(name: string): MaterialInfo {
    const key = normalizeMaterialPath(name);
    let info = this.world.get(key);
    if (!info) {
      const kind = classify(key);
      if (kind === 'handle') {
        // Not a game material: nothing to load.
        // Orange for POIs, blue for blocks of buildings, green for interior buildings.
        const [color, emissive] = key.includes('building') ? [0x40a8ff, 0x00203a] : key.includes('rooms') ? [0x60c878, 0x0a2a12] : [0xffa630, 0x3a2000];
        const material = new MeshLambertMaterial({ color, emissive, transparent: true, opacity: 0.16, depthWrite: false });
        info = { name: key, kind, width: 512, height: 512, material, loaded: true, preview: null };
        this.world.set(key, info);
        return info;
      }
      const material = kind === 'tool' || kind === 'sky'
        ? new MeshLambertMaterial({ color: toolTint(key, kind), transparent: true, opacity: 0.3, depthWrite: false })
        : new MeshLambertMaterial({ color: hashColor(key) });
      info = { name: key, kind, width: 512, height: 512, material, loaded: false, preview: null };
      this.world.set(key, info);
      void this.load(info, false);
    }
    return info;
  }

  getModel(name: string): MaterialInfo {
    const key = normalizeMaterialPath(name);
    let info = this.models.get(key);
    if (!info) {
      const material = new MeshLambertMaterial({ color: 0x9a9a9a });
      info = { name: key, kind: 'opaque', width: 1, height: 1, material, loaded: false, preview: null };
      this.models.set(key, info);
      void this.load(info, true);
    }
    return info;
  }

  /** Resolves once a material is fully loaded (used by the material browser). */
  async ready(name: string): Promise<MaterialInfo> {
    const info = this.get(name);
    while (!info.loaded) await new Promise((r) => setTimeout(r, 30));
    return info;
  }

  /** Re-reads a world material whose VMT changed on disk; meshes keep their material object. */
  async reload(name: string): Promise<MaterialInfo> {
    const info = this.get(name);
    while (!info.loaded) await new Promise((r) => setTimeout(r, 30));
    forgetVmt(info.name);
    info.loaded = false;
    info.multiblend = undefined;
    await this.load(info, false);
    info.material.needsUpdate = true;
    return info;
  }

  all(): MaterialInfo[] {
    return [...this.world.values(), ...this.models.values()];
  }

  private queueKindChange(): void {
    if (this.kindChangeQueued) return;
    this.kindChangeQueued = true;
    requestAnimationFrame(() => {
      this.kindChangeQueued = false;
      this.onKindChange();
    });
  }

  private async load(info: MaterialInfo, isModel: boolean): Promise<void> {
    try {
      const vmt = await loadVmt(info.name);
      if (!vmt) return;
      const p = vmt.params;
      const kind = isModel ? (p.get('$translucent') === '1' ? 'translucent' : 'opaque') : classify(info.name, vmt);
      if (kind !== info.kind) {
        info.kind = kind;
        if (!isModel) this.queueKindChange();
      }
      if (kind === 'tool' || kind === 'sky') return;

      const mat = info.material;
      const baseName = p.get('$basetexture');
      const base = baseName ? await loadTexture(baseName) : null;
      if (!base) {
        if (vmt.shader === 'water') mat.color.setRGB(0.15, 0.3, 0.38);
        if (kind === 'translucent') Object.assign(mat, { transparent: true, opacity: 0.6, depthWrite: false });
        return;
      }
      info.width = base.width;
      info.height = base.height;
      info.preview = base.texture;
      const map = isModel ? base.texture : base.texture.clone();
      if (!isModel) map.repeat.set(1 / base.width, 1 / base.height);

      if (vmt.shader === 'multiblend') {
        info.multiblend = blendFromParams(info.name, p);
        const slot = (i: number, k: string) => p.get(`${k}${i ? i + 1 : ''}`);
        const maps: Texture[] = [], specs: (Texture | null)[] = [];
        for (let i = 0; i < 4; i++) {
          const t = slot(i, '$basetexture');
          maps.push((t && (await loadTexture(t))?.texture) || base.texture);
          const s = slot(i, '$spectexture');
          specs.push(s ? (await loadTexture(s))?.texture ?? null : null);
        }
        makeMultiBlend(mat, maps, specs, [0, 1, 2, 3].map((i) => parseFloat(slot(i, '$rotation') ?? '0') || 0), [0, 1, 2, 3].map((i) => parseFloat(slot(i, '$scale') ?? '1') || 1));
      } else if (kind === 'blend' && p.get('$basetexture2')) {
        const b2 = await loadTexture(p.get('$basetexture2')!);
        if (b2) makeBlend(mat, b2.texture, new Vector2(base.width / b2.width, base.height / b2.height));
      }
      mat.map = map;
      mat.color.set(0xffffff);
      if (p.get('$alphatest') === '1') mat.alphaTest = 0.5;
      else if (kind === 'translucent' || (p.get('$translucent') === '1' && base.hasAlpha)) {
        mat.transparent = true;
        mat.depthWrite = false;
      }
      if (p.get('$nocull') === '1') mat.side = DoubleSide;
      mat.needsUpdate = true;
    } catch (e) {
      console.warn(`[materials] ${info.name}:`, e);
    } finally {
      info.loaded = true;
    }
  }
}
