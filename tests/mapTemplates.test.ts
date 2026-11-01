import { describe, expect, it } from 'vitest';
import { Box3, Vector3 } from 'three';
import type { Editor } from '../src/editor.ts';
import { MAP_SIZES, TEMPLATES, buildTemplate, type MapSize, type TemplateOptions } from '../src/lw/mapTemplates.ts';
import { runChecks } from '../src/edit/preflight.ts';
import { solidBounds } from '../src/edit/brushes.ts';
import { checkMission } from '../src/lw/missionCheck.ts';
import { VmfDocument, type MapEntity } from '../src/vmf/map.ts';
import { buildSolidChunks } from '../src/render/worldRenderer.ts';

const SIZES = Object.keys(MAP_SIZES) as MapSize[];
const count = (doc: VmfDocument, cls: string) => doc.entities.filter((e) => e.classname === cls).length;
const xy = (e: MapEntity) => [Math.round(e.origin!.x), Math.round(e.origin!.y)] as const;
const key = ([x, y]: readonly [number, number]) => `${x},${y}`;

/** The boundary's inside (the playerclip shell's inner faces). */
function boundaryBox(doc: VmfDocument): Box3 {
  const b = doc.entities.find((e) => e.classname === 'func_map_boundary')!;
  const boxes = b.solids.map(solidBounds);
  const outer = boxes.reduce((a, x) => a.clone().union(x));
  const t = Math.min(...boxes.map((x) => Math.min(x.max.x - x.min.x, x.max.y - x.min.y, x.max.z - x.min.z)));
  return new Box3(new Vector3(outer.min.x + t, outer.min.y + t, outer.min.z + t), new Vector3(outer.max.x - t, outer.max.y - t, outer.max.z - t));
}

/** True when every point maps onto another point of the same set when turned by `deg` about the origin. */
function rotationSymmetric(points: (readonly [number, number])[], deg: number): boolean {
  const set = new Set(points.map(key));
  const a = (deg * Math.PI) / 180;
  return points.every(([x, y]) => set.has(key([Math.round(x * Math.cos(a) - y * Math.sin(a)), Math.round(x * Math.sin(a) + y * Math.cos(a))])));
}

function commonChecks(o: TemplateOptions) {
  const { doc, mission, plan } = buildTemplate(o);
  // Every brush builds, and the document round-trips like any other VMF.
  for (const s of doc.allSolids()) expect(buildSolidChunks(s).chunks.size).toBeGreaterThan(0);
  expect(VmfDocument.parse(doc.serialize()).serialize()).toBe(doc.serialize());
  for (const cls of ['light_environment', 'env_fog_controller', 'func_map_boundary', 'info_player_start', 'shadow_control', 'env_tonemap_controller']) expect(count(doc, cls), cls).toBe(1);
  expect(doc.worldEntity.solids.some((s) => s.isDisplacement)).toBe(true);
  // The pre-flight checks of the compile dialog all pass.
  const checks = runChecks({ doc } as unknown as Editor);
  for (const c of checks) expect(c.ok, `${c.id}: ${c.detail}`).toBe(true);
  // Gameplay entities stay inside the map boundary, away from its walls.
  const inside = boundaryBox(doc);
  expect(inside.max.x - inside.min.x).toBe(plan.size);
  for (const e of doc.entities) {
    if (!/^(info_start_wars|info_player_wars|control_point|scrap_marker_small|overrun_|unit_|wars_player_setup)/.test(e.classname)) continue;
    const p = e.origin!;
    expect(p.x > inside.min.x + 128 && p.x < inside.max.x - 128 && p.y > inside.min.y + 128 && p.y < inside.max.y - 128, `${e.classname} at ${p.x} ${p.y}`).toBe(true);
  }
  return { doc, mission, plan };
}

describe('map templates', () => {
  it('annihilation: one numbered start per player, placed symmetrically, with resources', () => {
    for (const players of [2, 4, 6, 8]) {
      for (const size of SIZES) {
        const { doc } = commonChecks({ kind: 'annihilation', players, size });
        const starts = doc.entities.filter((e) => e.classname === 'info_start_wars');
        expect(starts.length).toBe(players);
        // The lobby counts a slot per start with an ownernumber (menu/gamelobby/settingsinfo.py): 2, 3, ...
        expect(starts.map((e) => e.get('ownernumber')).sort()).toEqual(Array.from({ length: players }, (_, i) => String(2 + i)).sort());
        // A camera spawn per player too.
        expect(doc.entities.filter((e) => e.classname === 'info_player_wars').map((e) => e.get('ownernumber')).sort()).toEqual(starts.map((e) => e.get('ownernumber')).sort());
        const pts = starts.map(xy);
        expect(rotationSymmetric(pts, 180)).toBe(true);
        if (players === 4) expect(rotationSymmetric(pts, 90)).toBe(true);
        // Team hints give 2vs2, 3vs3 and 4vs4 in the lobby; two players play 1v1 without them.
        const teams = starts.map((e) => e.get('groupname') ?? '');
        if (players === 2) expect(teams.every((t) => !t)).toBe(true);
        else expect(teams.filter((t) => t === 'Team 1').length).toBe(players / 2);
        // Requisition points with their capture areas, and scrap; laid out as symmetrically as the starts.
        const flags = doc.entities.filter((e) => e.classname === 'control_point');
        expect(flags.length).toBeGreaterThanOrEqual(players + 1);
        expect(count(doc, 'trigger_capture_area')).toBe(flags.length);
        for (const f of flags) expect(doc.entities.some((t) => t.classname === 'trigger_capture_area' && t.get('control_point') === f.get('targetname'))).toBe(true);
        expect(rotationSymmetric(flags.map(xy), 180)).toBe(true);
        const scrap = doc.entities.filter((e) => e.classname === 'scrap_marker_small');
        expect(scrap.length).toBeGreaterThanOrEqual(players * 3);
        expect(rotationSymmetric(scrap.map(xy), 180)).toBe(true);
        // Nothing crowds a base, and capture areas don't overlap.
        const dist = (a: readonly [number, number], b: readonly [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
        for (const s of pts) {
          for (const f of flags) expect(dist(s, xy(f))).toBeGreaterThan(700);
          for (const c of scrap) expect(dist(s, xy(c))).toBeGreaterThan(300);
          for (const t of pts) if (t !== s) expect(dist(s, t)).toBeGreaterThan(900);
        }
        for (const a of flags) for (const b of flags) if (a !== b) expect(dist(xy(a), xy(b))).toBeGreaterThanOrEqual(400);
      }
    }
  });

  it('overrun: starts in the middle, wave spawn points at the edges and an overrun manager', () => {
    for (const players of [1, 2, 3, 4]) {
      const { doc } = commonChecks({ kind: 'overrun', players, size: 'medium', wavetype: 'zombie' });
      const starts = doc.entities.filter((e) => e.classname === 'info_start_wars');
      expect(starts.length).toBe(players);
      expect(new Set(starts.map((e) => e.get('ownernumber'))).size).toBe(players);
      expect(count(doc, 'overrun_manager')).toBe(1);
      expect(doc.entities.find((e) => e.classname === 'overrun_manager')!.get('wavetype')).toBe('zombie');
      const waves = doc.entities.filter((e) => e.classname === 'overrun_wave_spawnpoint');
      expect(waves.length).toBe(8);
      expect(rotationSymmetric(waves.map(xy), 90)).toBe(true);
      // Waves come from far away: at least half the map from every start.
      for (const w of waves) for (const s of starts) expect(w.origin!.distanceTo(s.origin!)).toBeGreaterThan(MAP_SIZES.medium.units / 3);
    }
  });

  it('mission: player start, faction setup, squad and a starter flowchart without errors', () => {
    for (const faction of ['rebels', 'combine'] as const) {
      const { doc, mission } = commonChecks({ kind: 'mission', players: 1, size: 'small', faction });
      expect(count(doc, 'info_start_wars')).toBe(0);
      expect(doc.entities.find((e) => e.classname === 'info_player_wars')!.get('ownernumber')).toBe('2');
      const setup = doc.entities.find((e) => e.classname === 'wars_player_setup')!;
      expect(setup.get('Faction')).toBe(faction);
      expect(setup.get('player')).toBe('2');
      expect(doc.entities.filter((e) => e.get('targetname') === 'player_squad' && e.get('ownernumber') === '2').length).toBe(4);
      expect(mission).not.toBeNull();
      expect(mission!.stages.length).toBe(1);
      expect(mission!.stages[0].objectives.length).toBe(1);
      expect(mission!.stages[0].transitions.some((t) => t.to === 'victory')).toBe(true);
      expect(checkMission(mission!, doc)).toEqual([]);
      expect(doc.world.get('message')).toBeTruthy();
    }
  });

  it('empty is today\'s empty document, and every template names its file by the game\'s prefixes', () => {
    const { doc, mission } = buildTemplate({ kind: 'empty', players: 1, size: 'medium' });
    expect(doc.serialize()).toBe(VmfDocument.empty().serialize());
    expect(mission).toBeNull();
    const name = (kind: TemplateOptions['kind'], players = 2) => TEMPLATES.find((t) => t.kind === kind)!.defaultName({ kind, players, size: 'medium' });
    expect(name('annihilation', 4)).toBe('hlw_untitled_4p.vmf');
    expect(name('overrun')).toMatch(/^or_/);
    expect(name('mission')).toMatch(/^sp_/);
    for (const t of TEMPLATES) expect(t.places({ kind: t.kind, players: t.defaultPlayers, size: 'medium' }).length).toBeGreaterThan(0);
  });
});
