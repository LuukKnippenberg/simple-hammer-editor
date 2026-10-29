import { BufferAttribute, BufferGeometry, Box3, Vector3 } from 'three';
import { fetchGameFile } from './fetch.ts';

/** One drawable part of a model: triangles that share a skin reference. */
export interface ModelPart {
  geometry: BufferGeometry;
  /** Index into the skin table columns (mesh "material" in MDL terms). */
  skinRef: number;
}

export interface SourceModel {
  name: string;
  parts: ModelPart[];
  /** Material paths per skin family: skins[family][skinRef] → "models/props/foo/bar". */
  skins: string[][];
  bounds: Box3;
}

const cache = new Map<string, Promise<SourceModel | null>>();

function cstr(dv: DataView, off: number): string {
  let s = '';
  for (let i = off; i < dv.byteLength; i++) {
    const c = dv.getUint8(i);
    if (!c) break;
    s += String.fromCharCode(c);
  }
  return s;
}

interface MdlMesh { material: number; vertexOffset: number; }
interface MdlModel { vertexIndex: number; meshes: MdlMesh[]; }

function parseMdl(buf: ArrayBuffer) {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x54534449) throw new Error('not an MDL'); // IDST
  const version = dv.getInt32(4, true);
  const numTextures = dv.getInt32(204, true), textureIndex = dv.getInt32(208, true);
  const numCd = dv.getInt32(212, true), cdIndex = dv.getInt32(216, true);
  const numSkinRef = dv.getInt32(220, true), numSkinFamilies = dv.getInt32(224, true), skinIndex = dv.getInt32(228, true);
  const numBodyParts = dv.getInt32(232, true), bodyPartIndex = dv.getInt32(236, true);

  const textures: string[] = [];
  for (let i = 0; i < numTextures; i++) {
    const o = textureIndex + i * 64;
    textures.push(cstr(dv, o + dv.getInt32(o, true)));
  }
  const cdmaterials: string[] = [];
  for (let i = 0; i < numCd; i++) cdmaterials.push(cstr(dv, dv.getInt32(cdIndex + i * 4, true)));
  const skinTable: number[][] = [];
  for (let f = 0; f < numSkinFamilies; f++) {
    const row: number[] = [];
    for (let r = 0; r < numSkinRef; r++) row.push(dv.getInt16(skinIndex + (f * numSkinRef + r) * 2, true));
    skinTable.push(row);
  }

  // First model of every body part (default bodygroup selection).
  const models: (MdlModel | null)[] = [];
  for (let b = 0; b < numBodyParts; b++) {
    const bp = bodyPartIndex + b * 16;
    const numModels = dv.getInt32(bp + 4, true);
    const modelIndex = dv.getInt32(bp + 12, true);
    if (numModels < 1) { models.push(null); continue; }
    const m = bp + modelIndex; // model 0
    const numMeshes = dv.getInt32(m + 72, true), meshIndex = dv.getInt32(m + 76, true);
    const vertexIndex = dv.getInt32(m + 84, true);
    const meshes: MdlMesh[] = [];
    for (let k = 0; k < numMeshes; k++) {
      const me = m + meshIndex + k * 116;
      meshes.push({ material: dv.getInt32(me, true), vertexOffset: dv.getInt32(me + 12, true) });
    }
    models.push({ vertexIndex: vertexIndex / 48, meshes });
  }
  return { version, textures, cdmaterials, skinTable, models };
}

/** LOD 0 vertices of a VVD (positions, normals, uvs), with fixups applied. */
function parseVvd(buf: ArrayBuffer) {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x56534449) throw new Error('not a VVD'); // IDSV
  const numLod0 = dv.getInt32(16, true);
  const numFixups = dv.getInt32(48, true), fixupStart = dv.getInt32(52, true);
  const vertexStart = dv.getInt32(56, true);
  const order: number[] = [];
  if (numFixups > 0) {
    for (let i = 0; i < numFixups; i++) {
      const o = fixupStart + i * 12;
      const lod = dv.getInt32(o, true), src = dv.getInt32(o + 4, true), n = dv.getInt32(o + 8, true);
      if (lod >= 0) for (let k = 0; k < n; k++) order.push(src + k);
    }
  } else {
    for (let i = 0; i < numLod0; i++) order.push(i);
  }
  const n = order.length;
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const o = vertexStart + order[i] * 48;
    pos[i * 3] = dv.getFloat32(o + 16, true); pos[i * 3 + 1] = dv.getFloat32(o + 20, true); pos[i * 3 + 2] = dv.getFloat32(o + 24, true);
    nrm[i * 3] = dv.getFloat32(o + 28, true); nrm[i * 3 + 1] = dv.getFloat32(o + 32, true); nrm[i * 3 + 2] = dv.getFloat32(o + 36, true);
    uv[i * 2] = dv.getFloat32(o + 40, true); uv[i * 2 + 1] = dv.getFloat32(o + 44, true);
  }
  return { pos, nrm, uv, count: n };
}

/**
 * Triangle indices from a .dx90.vtx (LOD 0), mapped to VVD vertex indices and grouped by skin reference.
 * Strip group headers grew 8 bytes in later MDL versions; the stride is chosen by validating offsets.
 */
function parseVtx(buf: ArrayBuffer, models: (MdlModel | null)[], mdlVersion: number): Map<number, number[]> {
  const dv = new DataView(buf);
  const size = buf.byteLength;
  const numBodyParts = dv.getInt32(28, true), bodyPartOffset = dv.getInt32(32, true);
  const bySkinRef = new Map<number, number[]>();
  const inFile = (o: number) => o >= 0 && o < size;

  for (let b = 0; b < numBodyParts && b < models.length; b++) {
    const model = models[b];
    if (!model) continue;
    const bp = bodyPartOffset + b * 8;
    const numModels = dv.getInt32(bp, true);
    if (numModels < 1) continue;
    const m = bp + dv.getInt32(bp + 4, true); // model 0
    const numLods = dv.getInt32(m, true);
    if (numLods < 1) continue;
    const lod = m + dv.getInt32(m + 4, true); // LOD 0
    const numMeshes = dv.getInt32(lod, true);
    const meshOff = lod + dv.getInt32(lod + 4, true);
    for (let k = 0; k < numMeshes && k < model.meshes.length; k++) {
      const mesh = meshOff + k * 9;
      const numSG = dv.getInt32(mesh, true);
      const sgOff = mesh + dv.getInt32(mesh + 4, true);
      let stride = mdlVersion >= 49 ? 33 : 25;
      if (numSG > 1) {
        const ok = (s: number) => {
          const o = sgOff + s;
          return inFile(o + 24) && inFile(o + dv.getInt32(o + 4, true)) && inFile(o + dv.getInt32(o + 12, true)) && dv.getInt32(o, true) >= 0;
        };
        if (!ok(stride)) stride = stride === 33 ? 25 : 33;
      }
      const mdlMesh = model.meshes[k];
      const vbase = model.vertexIndex + mdlMesh.vertexOffset;
      let out = bySkinRef.get(mdlMesh.material);
      if (!out) bySkinRef.set(mdlMesh.material, (out = []));
      for (let g = 0; g < numSG; g++) {
        const sg = sgOff + g * stride;
        const numVerts = dv.getInt32(sg, true), vertOff = sg + dv.getInt32(sg + 4, true);
        const numIdx = dv.getInt32(sg + 8, true), idxOff = sg + dv.getInt32(sg + 12, true);
        if (!inFile(vertOff) || !inFile(idxOff)) continue;
        const remap = new Int32Array(numVerts);
        for (let v = 0; v < numVerts; v++) remap[v] = vbase + dv.getUint16(vertOff + v * 9 + 4, true);
        // Source winds triangles clockwise; three.js expects counter-clockwise.
        for (let t = 0; t + 2 < numIdx; t += 3) {
          const a = dv.getUint16(idxOff + t * 2, true), b2 = dv.getUint16(idxOff + t * 2 + 2, true), c = dv.getUint16(idxOff + t * 2 + 4, true);
          out.push(remap[a], remap[c], remap[b2]);
        }
      }
    }
  }
  return bySkinRef;
}

function resolveMaterials(textures: string[], cdmaterials: string[]): string[] {
  return textures.map((t) => {
    const name = t.replace(/\\/g, '/').toLowerCase();
    const dirs = cdmaterials.map((c) => c.replace(/\\/g, '/').toLowerCase().replace(/^\/+/, ''));
    // The material browser resolves which cd path actually exists; prefer the first.
    const dir = dirs[0] ?? '';
    return (dir && !dir.endsWith('/') ? dir + '/' : dir) + name;
  });
}

async function load(path: string): Promise<SourceModel | null> {
  const base = path.replace(/\.mdl$/i, '');
  const [mdlBuf, vvdBuf, vtxBuf] = await Promise.all([
    fetchGameFile(base + '.mdl'), fetchGameFile(base + '.vvd'), fetchGameFile(base + '.dx90.vtx'),
  ]);
  if (!mdlBuf || !vvdBuf || !vtxBuf) return null;
  const mdl = parseMdl(mdlBuf);
  const vvd = parseVvd(vvdBuf);
  const groups = parseVtx(vtxBuf, mdl.models, mdl.version);

  const materials = resolveMaterials(mdl.textures, mdl.cdmaterials);
  const alt = mdl.cdmaterials.length > 1 ? mdl.cdmaterials : null;
  const skins = mdl.skinTable.map((row) => row.map((ti) => materials[ti] ?? materials[0] ?? ''));

  const bounds = new Box3();
  const parts: ModelPart[] = [];
  for (const [skinRef, idx] of groups) {
    if (!idx.length) continue;
    // Compact to the vertices this part uses.
    const map = new Map<number, number>();
    const local = new Uint32Array(idx.length);
    for (let i = 0; i < idx.length; i++) {
      let j = map.get(idx[i]);
      if (j === undefined) map.set(idx[i], (j = map.size));
      local[i] = j;
    }
    const n = map.size;
    const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), uv = new Float32Array(n * 2);
    for (const [src, dst] of map) {
      if (src >= vvd.count) continue;
      pos.set(vvd.pos.subarray(src * 3, src * 3 + 3), dst * 3);
      nrm.set(vvd.nrm.subarray(src * 3, src * 3 + 3), dst * 3);
      uv.set(vvd.uv.subarray(src * 2, src * 2 + 2), dst * 2);
      bounds.expandByPoint(new Vector3(pos[dst * 3], pos[dst * 3 + 1], pos[dst * 3 + 2]));
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setAttribute('normal', new BufferAttribute(nrm, 3));
    geo.setAttribute('uv', new BufferAttribute(uv, 2));
    geo.setIndex(new BufferAttribute(local, 1));
    geo.computeBoundingSphere();
    parts.push({ geometry: geo, skinRef });
  }
  const model: SourceModel = { name: path, parts, skins, bounds };
  if (alt) await pickCdMaterials(model, mdl.textures, alt);
  return model;
}

/** With several $cdmaterials paths, pick the first one where each texture's VMT exists. */
async function pickCdMaterials(model: SourceModel, textures: string[], cds: string[]): Promise<void> {
  const resolved = await Promise.all(
    textures.map(async (t) => {
      const name = t.replace(/\\/g, '/').toLowerCase();
      for (const cd of cds) {
        let dir = cd.replace(/\\/g, '/').toLowerCase().replace(/^\/+/, '');
        if (dir && !dir.endsWith('/')) dir += '/';
        if (await fetchGameFile(`materials/${dir}${name}.vmt`)) return dir + name;
      }
      return null;
    }),
  );
  const first = resolveMaterials(textures, cds);
  model.skins = model.skins.map((row) => row.map((m) => {
    const ti = first.indexOf(m);
    return ti >= 0 && resolved[ti] ? resolved[ti]! : m;
  }));
}

export function loadModel(path: string): Promise<SourceModel | null> {
  const key = path.toLowerCase().replace(/\\/g, '/');
  let p = cache.get(key);
  if (!p) {
    p = load(key).catch((e) => {
      console.warn(`[mdl] ${key}:`, e);
      return null;
    });
    cache.set(key, p);
  }
  return p;
}
