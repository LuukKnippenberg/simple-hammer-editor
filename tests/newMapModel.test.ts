import { describe, expect, it } from 'vitest';
import { BASICS, MAP_SIZES, TEMPLATES, buildBasics, buildTemplate, planTemplate, type TemplateKind, type TemplateOptions } from '../src/lw/mapTemplates.ts';
import { GROUND_SETS } from '../src/edit/terrain.ts';
import { SKETCH_CELL, generateFromSketch, placeMarkers } from '../src/gen/sketch.ts';
import { buildNewMap, defaultRest, fileNameFor, nameChecks, nameRest, placedLines, previewPlan, sketchFromPlan, validPlayers } from '../src/ui/newMapModel.ts';
import { combinations, hashBuilt, hashTemplate } from './newMapCombinations.ts';

const KINDS = TEMPLATES.map((t) => t.kind);
const none = new Set<string>();

describe('New map wizard: player count', () => {
  it('stays valid for every mode, whatever was picked before', () => {
    for (const kind of KINDS) for (let wanted = 0; wanted <= 9; wanted++) {
      const players = validPlayers(kind, wanted);
      const offered = TEMPLATES.find((t) => t.kind === kind)!.players;
      expect(offered.length ? offered.includes(players) : players === 1, `${kind} ${wanted} → ${players}`).toBe(true);
    }
  });
  it('keeps a count the mode offers and otherwise takes the closest, the lower one on a tie', () => {
    expect(validPlayers('annihilation', 6)).toBe(6);
    expect(validPlayers('overrun', 6)).toBe(4);
    expect(validPlayers('overrun', 8)).toBe(4);
    expect(validPlayers('annihilation', 1)).toBe(2);
    expect(validPlayers('annihilation', 3)).toBe(2);
    expect(validPlayers('overrun', 2)).toBe(2);
    expect(validPlayers('mission', 4)).toBe(1);
    expect(validPlayers('empty', 8)).toBe(1);
  });
});

describe('New map wizard: name', () => {
  it('drops a typed or pasted prefix and .vmf, so the prefix stays the chip’s', () => {
    expect(nameRest('annihilation', 'hlw_canals_2p')).toBe('canals_2p');
    expect(nameRest('annihilation', 'HLW_canals')).toBe('canals');
    expect(nameRest('overrun', ' or_dam.vmf ')).toBe('dam');
    expect(nameRest('annihilation', 'or_dam')).toBe('or_dam');
    expect(nameRest('empty', 'hlw_test')).toBe('hlw_test');
    expect(fileNameFor('annihilation', nameRest('annihilation', 'hlw_canals_2p'))).toBe('hlw_canals_2p.vmf');
    expect(fileNameFor('empty', 'scratch')).toBe('scratch.vmf');
  });
  it('checks the prefix, lowercase without spaces, and a free name', () => {
    const ok = (kind: TemplateKind, rest: string, existing = none) => nameChecks(kind, rest, existing).map((c) => c.ok);
    expect(nameChecks('annihilation', 'canals_2p', none).map((c) => c.text)).toEqual(['hlw_ prefix: listed in the multiplayer lobby', 'lowercase, no spaces', 'no map with this name yet']);
    expect(ok('annihilation', 'canals_2p')).toEqual([true, true, true]);
    expect(ok('annihilation', 'Canals')).toEqual([true, false, true]);
    expect(ok('annihilation', 'canals 2p')).toEqual([true, false, true]);
    expect(ok('annihilation', 'canals-2p')).toEqual([true, false, true]);
    expect(ok('annihilation', '')).toEqual([true, false, true]);
    expect(ok('annihilation', 'canals', new Set(['hlw_canals.vmf']))).toEqual([true, true, false]);
    // The same name under another mode's prefix is free.
    expect(ok('overrun', 'canals', new Set(['hlw_canals.vmf']))).toEqual([true, true, true]);
  });
  it('defaults to the old dialog’s names, numbered past maps that exist', () => {
    const o = { kind: 'annihilation' as const, players: 4, size: 'medium' as const };
    expect(fileNameFor('annihilation', defaultRest(o, none))).toBe(TEMPLATES[0].defaultName(o));
    expect(defaultRest(o, new Set(['hlw_untitled_4p.vmf', 'hlw_untitled_4p_2.vmf']))).toBe('untitled_4p_3');
    for (const t of TEMPLATES) {
      const options = { kind: t.kind, players: t.defaultPlayers, size: 'small' as const };
      expect(fileNameFor(t.kind, defaultRest(options, none))).toBe(t.defaultName(options));
    }
  });
});

describe('New map wizard: what Create builds', () => {
  it('Template layout and Sketch it build exactly the old dialog’s map, but for Empty', () => {
    // One combination per mode and size here; tests/newMap.same-output.test.ts pins all of them through buildTemplate.
    const seen = new Set<string>();
    for (const [key, o] of combinations()) {
      const group = `${o.kind}/${o.size}`;
      if (o.kind === 'empty' || seen.has(group)) continue;
      seen.add(group);
      expect(hashBuilt(buildNewMap(o, 'template')), key).toBe(hashTemplate(o));
      expect(hashBuilt(buildNewMap(o, 'sketch')), key).toBe(hashTemplate(o));
    }
  });
  it('Empty ground builds only the basics, at the chosen size', () => {
    for (const kind of KINDS) {
      const { doc, mission, plan } = buildNewMap({ kind, players: 2, size: 'large', wavetype: 'zombie', faction: 'combine' }, 'basics');
      const classes = new Set(doc.entities.map((e) => e.classname));
      for (const cls of ['light_environment', 'env_fog_controller', 'func_map_boundary']) expect(classes.has(cls), `${kind} ${cls}`).toBe(true);
      for (const cls of ['info_start_wars', 'control_point', 'scrap_marker_small', 'overrun_manager', 'wars_player_setup']) expect(classes.has(cls), `${kind} ${cls}`).toBe(false);
      expect(mission).toBe(null);
      expect(plan.size).toBe(MAP_SIZES.large.units);
      expect(doc.worldEntity.solids.some((s) => s.isDisplacement)).toBe(true);
    }
    // The same for every mode: what differs is the prefix and the checklist.
    const empty = buildNewMap({ kind: 'empty', players: 1, size: 'small' }, 'basics').doc.serialize();
    expect(buildNewMap({ kind: 'annihilation', players: 2, size: 'small' }, 'basics').doc.serialize()).toBe(empty);
    expect(placedLines({ kind: 'overrun', players: 2, size: 'small' }, 'basics')).toEqual(['Ground, sky shell, sun, fog and map boundary']);
  });
  it('Empty builds ground, sky and sun of the chosen size and ground with every start', () => {
    const ground = GROUND_SETS[1].material;
    for (const start of ['template', 'sketch', 'basics'] as const) {
      const o = { kind: 'empty' as const, players: 1, size: 'small' as const, ground };
      const { doc, mission, plan } = buildNewMap(o, start);
      expect(doc.serialize(), start).toBe(buildBasics(o).doc.serialize());
      expect(doc.world.get('skyname'), start).toBeTruthy();
      const classes = new Set(doc.entities.map((e) => e.classname));
      for (const cls of ['light_environment', 'env_fog_controller', 'func_map_boundary']) expect(classes.has(cls), `${start} ${cls}`).toBe(true);
      expect(doc.worldEntity.solids.some((s) => s.isDisplacement && s.sides.some((side) => side.material === ground)), start).toBe(true);
      expect(mission).toBe(null);
      expect(plan.size).toBe(MAP_SIZES.small.units);
      expect(placedLines(o, start)).toEqual([BASICS]);
      // The preview draws the boundary and nothing else.
      const shown = previewPlan(planTemplate(o), start);
      expect([shown.starts, shown.points, shown.scrap, shown.waves, shown.squad].every((list) => list.length === 0)).toBe(true);
    }
    expect(sketchFromPlan({ kind: 'empty', players: 1, size: 'small' }, planTemplate({ kind: 'empty', players: 1, size: 'small' })).markers).toEqual([]);
  });
  it('the preview shows nothing but the boundary for Empty ground', () => {
    const plan = previewPlan(planTemplate({ kind: 'annihilation', players: 4, size: 'medium' }), 'basics');
    expect([plan.starts, plan.points, plan.scrap, plan.waves, plan.squad].every((list) => list.length === 0)).toBe(true);
    expect(plan.goal).toBe(null);
  });
  it('the sketch for Sketch it is the map’s size, with its starts, points and scrap where the preview shows them', () => {
    const half = MAP_SIZES.medium.units / 2;
    for (const players of [2, 8]) {
      const o = { kind: 'annihilation' as const, players, size: 'medium' as const };
      const built = buildTemplate(o);
      const sketch = sketchFromPlan(o, built.plan);
      expect(sketch.w * SKETCH_CELL).toBe(MAP_SIZES.medium.units);
      const of = (kind: string) => sketch.markers.filter((m) => m.kind === kind);
      expect(of('mp_start').length).toBe(players);
      expect(of('capture_point').length).toBe(built.plan.points.length);
      expect(of('scrap').length).toBe(built.plan.scrap.length);
      const first = built.plan.starts[0];
      expect(of('mp_start')[0]).toMatchObject({ x: (first.x + half) / SKETCH_CELL, y: (first.y + half) / SKETCH_CELL, params: { yaw: first.yaw } });
    }
    const mission = { kind: 'mission' as const, players: 1, size: 'small' as const, faction: 'combine' as const };
    expect(sketchFromPlan(mission, planTemplate(mission)).markers).toEqual([expect.objectContaining({ kind: 'sp_start', params: { faction: 'combine', yaw: 90 } })]);
  });
  it('generating the sketch for Sketch it keeps what each mode placed', () => {
    const generated = (o: TemplateOptions) => {
      const sketch = sketchFromPlan(o, buildNewMap(o, 'sketch').plan);
      const r = generateFromSketch(sketch);
      placeMarkers({ doc: r.doc }, sketch, r);
      return (cls: string) => r.doc.entities.filter((e) => e.classname === cls);
    };
    const overrun = { kind: 'overrun' as const, players: 3, size: 'small' as const, wavetype: 'zombie' };
    const plan = planTemplate(overrun);
    const ofOverrun = generated(overrun);
    const waves = ofOverrun('overrun_wave_spawnpoint');
    expect(waves.length).toBe(plan.waves.length);
    expect(waves.map((e) => e.get('angles'))).toEqual(plan.waves.map((w) => `0 ${w.yaw} 0`));
    // Same place as the template's spawns: the sketch's map is centred like the template's.
    expect(waves.map((e) => [e.origin!.x, e.origin!.y])).toEqual(plan.waves.map((w) => [w.x, w.y]));
    expect(ofOverrun('overrun_manager').map((e) => e.get('wavetype'))).toEqual(['zombie']);
    expect(ofOverrun('info_start_wars').length).toBe(3);

    const ofAnnihilation = generated({ kind: 'annihilation', players: 4, size: 'small' });
    expect(ofAnnihilation('info_start_wars').length).toBe(4);
    expect(ofAnnihilation('control_point').length).toBe(planTemplate({ kind: 'annihilation', players: 4, size: 'small' }).points.length);
    expect(ofAnnihilation('overrun_manager').length + ofAnnihilation('overrun_wave_spawnpoint').length).toBe(0);
    const ofMission = generated({ kind: 'mission', players: 1, size: 'small', faction: 'combine' });
    expect(ofMission('info_player_wars').length).toBe(1);
    expect(ofMission('wars_player_setup').map((e) => e.get('Faction'))).toEqual(['combine']);
  });
});
