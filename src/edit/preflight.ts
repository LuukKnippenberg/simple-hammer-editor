import { Box3, Vector3 } from 'three';
import type { Editor } from '../editor.ts';
import { KVNode, KVPair } from '../vmf/keyvalues.ts';
import type { MapEntity, MapSolid } from '../vmf/map.ts';
import { boxSolid, solidBounds } from './brushes.ts';
import { editorBlock, entityNode } from './actions.ts';
import { loadModel } from '../assets/mdl.ts';
import { fetchGameFile } from '../assets/fetch.ts';
import { SETTING_GROUPS, groupState } from '../lw/mapSettings.ts';

export interface Check {
  id: string;
  label: string;
  ok: boolean;
  /** Errors stop a useful compile; warnings only reduce what works in game. */
  severity: 'error' | 'warning';
  detail: string;
  fix?: () => void;
  fixLabel?: string;
}

const SKY = 'TOOLS/TOOLSSKYBOX';
const isSky = (s: MapSolid) => s.sides.every((x) => x.material.toUpperCase() === SKY);

/** Bounds of the playable content: everything except the sky shell and the map boundary. */
export function contentBounds(editor: Editor): Box3 {
  const box = new Box3();
  for (const s of editor.doc.worldEntity.solids) if (!isSky(s)) box.union(solidBounds(s));
  for (const e of editor.doc.entities) {
    if (e.classname === 'func_map_boundary') continue;
    for (const s of e.solids) box.union(solidBounds(s));
    if (!e.solids.length && e.origin) box.expandByPoint(e.origin);
  }
  return box;
}

/** True when world sky brushes cover all six sides around the content. */
function hasSkyShell(editor: Editor, content: Box3): boolean {
  const sky = editor.doc.worldEntity.solids.filter(isSky).map(solidBounds);
  if (sky.length < 6 || content.isEmpty()) return false;
  const covers = (axis: 'x' | 'y' | 'z', side: 'min' | 'max') => sky.some((b) => {
    const beyond = side === 'min' ? b.max[axis] <= content.min[axis] + 1 : b.min[axis] >= content.max[axis] - 1;
    if (!beyond) return false;
    return (['x', 'y', 'z'] as const).filter((a) => a !== axis).every((a) => b.min[a] <= content.min[a] && b.max[a] >= content.max[a]);
  });
  return (['x', 'y', 'z'] as const).every((a) => covers(a, 'min') && covers(a, 'max'));
}

/** Six world sky brushes around a box (the inside of the box stays empty). */
export function addShell(editor: Editor, inner: Box3, material = SKY, thickness = 32, owner: MapEntity | null = null): MapSolid[] {
  const doc = editor.doc;
  const t = thickness;
  const a = inner.min, b = inner.max;
  const parts: [Vector3, Vector3][] = [
    [new Vector3(a.x - t, a.y - t, a.z - t), new Vector3(b.x + t, b.y + t, a.z)], // floor
    [new Vector3(a.x - t, a.y - t, b.z), new Vector3(b.x + t, b.y + t, b.z + t)], // ceiling
    [new Vector3(a.x - t, a.y - t, a.z), new Vector3(a.x, b.y + t, b.z)], // -x
    [new Vector3(b.x, a.y - t, a.z), new Vector3(b.x + t, b.y + t, b.z)], // +x
    [new Vector3(a.x, a.y - t, a.z), new Vector3(b.x, a.y, b.z)], // -y
    [new Vector3(a.x, b.y, a.z), new Vector3(b.x, b.y + t, b.z)], // +y
  ];
  return parts.map(([min, max]) => doc.addSolid(boxSolid(doc, min, max, material), owner));
}

function snapOut(box: Box3, g = 64): Box3 {
  return new Box3(
    new Vector3(Math.floor(box.min.x / g) * g, Math.floor(box.min.y / g) * g, Math.floor(box.min.z / g) * g),
    new Vector3(Math.ceil(box.max.x / g) * g, Math.ceil(box.max.y / g) * g, Math.ceil(box.max.z / g) * g),
  );
}

/** prop_static entities whose model was not compiled as a static prop (vbsp deletes these). */
export async function nonStaticProps(editor: Editor): Promise<MapEntity[]> {
  const props = editor.doc.entities.filter((e) => e.classname === 'prop_static' && e.get('model'));
  const models = new Map<string, boolean>();
  await Promise.all([...new Set(props.map((e) => e.get('model')!.toLowerCase()))].map(async (m) => {
    const mdl = await loadModel(m);
    // Moved models keep their old compiled-in name; vbsp then can't find the .vvd and stops.
    const name = mdl?.internalName.replace(/\.mdl$/, '');
    const moved = !!mdl && !!name && `models/${name}.mdl` !== m && !(await fetchGameFile(`models/${name}.vvd`));
    models.set(m, !mdl || (mdl.isStatic && !moved));
  }));
  return props.filter((e) => models.get(e.get('model')!.toLowerCase()) === false);
}

/** Turns props into prop_dynamic with the same model, placement and skin (one undo step). */
export function convertToDynamic(editor: Editor, props: MapEntity[]): void {
  if (!props.length) return;
  const end = editor.history.begin('Convert to prop_dynamic', [], props);
  for (const e of props) {
    e.set('classname', 'prop_dynamic');
    e.set('solid', '6');
    e.set('DisableBoneFollowers', '1');
    for (const k of ['disableselfshadowing', 'disablevertexlighting', 'ignorenormals', 'screenspacefade', 'uniformscale']) e.node.delete(k);
  }
  end();
  editor.changed();
}

export function runChecks(editor: Editor): Check[] {
  const doc = editor.doc;
  const ents = doc.entities;
  const count = (cls: string) => ents.filter((e) => e.classname === cls).length;
  const content = contentBounds(editor);
  const checks: Check[] = [];
  const fixed = (label: string, fn: () => { solids?: MapSolid[]; entities?: MapEntity[] }) => () => {
    const r = fn();
    editor.history.added(label, r.solids ?? [], r.entities ?? []);
    editor.changed();
  };

  checks.push({
    id: 'content', label: 'Map has geometry', severity: 'error', ok: !content.isEmpty(),
    detail: content.isEmpty() ? 'Draw at least a floor with the Block tool.' : `${doc.worldEntity.solids.length} world brushes`,
  });

  const sealed = hasSkyShell(editor, content);
  checks.push({
    id: 'shell', label: 'Sealed by a sky shell', severity: 'error', ok: sealed,
    detail: sealed ? 'World sky brushes enclose the map.' : 'Without a closed shell of world brushes the map leaks: no visibility data and a dark sky.',
    fixLabel: 'Add sky shell',
    fix: fixed('Add sky shell', () => {
      const inner = snapOut(content);
      inner.min.x -= 256; inner.min.y -= 256; inner.max.x += 256; inner.max.y += 256;
      inner.min.z -= 64; inner.max.z += 1024;
      return { solids: addShell(editor, inner) };
    }),
  });

  const sun = count('light_environment');
  const sunAuto = sun === 0 && groupState(doc, SETTING_GROUPS.find((g) => g.id === 'sun')!) === 'auto';
  checks.push({
    id: 'sun', label: 'Sun light (light_environment)', severity: 'warning', ok: sun === 1 || sunAuto,
    detail: sunAuto ? 'Added with default values when compiling (Settings tab).'
      : sun === 0 ? 'Without it outdoor areas are pitch black.' : sun > 1 ? `${sun} found; only one is used.` : 'Present.',
    fixLabel: 'Add sun',
    fix: sun === 0 ? fixed('Add sun', () => {
      const c = content.getCenter(new Vector3());
      const e = doc.addEntity(entityNode(editor, 'light_environment', new Vector3(c.x, c.y, content.max.z + 64), {
        pitch: '-55', angles: '0 35 0', _light: '255 238 214 450', _ambient: '170 185 210 140',
        _lightHDR: '-1 -1 -1 1', _ambientHDR: '-1 -1 -1 1', _lightscaleHDR: '1', _AmbientScaleHDR: '1', SunSpreadAngle: '2',
      }));
      return { entities: [e] };
    }) : undefined,
  });

  const spawn = count('info_player_start') + count('info_player_wars');
  checks.push({
    id: 'spawn', label: 'Camera spawn (info_player_start)', severity: 'error', ok: spawn > 0,
    detail: spawn ? 'Present.' : 'The engine needs a spawn point to load the map.',
    fixLabel: 'Add spawn',
    fix: spawn ? undefined : fixed('Add spawn', () => {
      const c = content.getCenter(new Vector3());
      const e = doc.addEntity(entityNode(editor, 'info_player_start', new Vector3(Math.round(c.x), Math.round(c.y), Math.round(content.max.z + 256)), { angles: '0 0 0' }));
      return { entities: [e] };
    }),
  });

  const starts = count('info_start_wars');
  const mission = count('wars_player_setup') + count('wars_mission_objective') > 0;
  checks.push({
    id: 'starts', label: mission ? 'Mission setup' : 'Player starts (info_start_wars)', severity: 'warning', ok: mission || starts >= 2,
    detail: mission
      ? 'Singleplayer mission: the player spawns at its info_player_wars; no multiplayer starts needed.'
      : `${starts} found. Place one per player with the Entity tool ("Player start").`,
  });

  const boundary = count('func_map_boundary');
  checks.push({
    id: 'boundary', label: 'Map boundary (func_map_boundary)', severity: 'warning', ok: boundary > 0,
    detail: boundary ? 'Present.' : 'Limits the RTS camera and gives fog of war its height data.',
    fixLabel: 'Add boundary',
    fix: boundary ? undefined : fixed('Add boundary', () => {
      const node = new KVNode('entity');
      node.items.push(new KVPair('id', String(doc.nextId())), new KVPair('classname', 'func_map_boundary'), new KVPair('bloat', '-32.0'));
      const e = doc.addEntity(node);
      const inner = snapOut(content);
      inner.max.z += 1024;
      addShell(editor, inner, 'TOOLS/TOOLSPLAYERCLIP', 32, e);
      node.items.push(editorBlock());
      e.reload();
      return { entities: [e] };
    }),
  });
  return checks;
}
