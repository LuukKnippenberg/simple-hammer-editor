import { describe, expect, it } from 'vitest';
import { buildTemplate, templateInfo, type TemplateOptions } from '../src/lw/mapTemplates.ts';
import { checkState, detectMode, mapChecklist, modeChecks, type MapMode } from '../src/edit/preflight.ts';
import { VmfDocument } from '../src/vmf/map.ts';
import type { Editor } from '../src/editor.ts';
import { stubEditor } from './stubEditor.ts';

/** A stub editor holding a freshly built template under its default name (or `name`). */
function templateEditor(o: TemplateOptions, name = templateInfo(o.kind).defaultName(o)): Editor {
  const built = buildTemplate(o);
  const editor = stubEditor(built.doc);
  Object.assign(editor, { mapName: name, mission: built.mission });
  return editor;
}

const ids = (editor: Editor, mode: MapMode) => modeChecks(editor, mode).map((c) => c.id);
const byId = (editor: Editor, id: string) => mapChecklist(editor).checks.find((c) => c.id === id)!;
const removeClass = (editor: Editor, cls: string) => {
  for (const e of editor.doc.entities.filter((x) => x.classname === cls)) editor.doc.removeEntity(e);
};

describe('map checklist: mode detection', () => {
  it('reads the mode from the name prefix first', () => {
    const editor = templateEditor({ kind: 'overrun', players: 2, size: 'small' }, 'hlw_mixed.vmf');
    expect(detectMode(editor)).toBe('annihilation');
    Object.assign(editor, { mapName: 'maps/SP_Story.vmf' });
    expect(detectMode(editor)).toBe('mission');
  });

  it('falls back to what the map holds', () => {
    expect(detectMode(templateEditor({ kind: 'overrun', players: 2, size: 'small' }, 'untitled.vmf'))).toBe('overrun');
    expect(detectMode(templateEditor({ kind: 'mission', players: 1, size: 'small' }, 'untitled.vmf'))).toBe('mission');
    expect(detectMode(templateEditor({ kind: 'annihilation', players: 2, size: 'small' }, 'untitled.vmf'))).toBe('annihilation');
    expect(detectMode(templateEditor({ kind: 'empty', players: 1, size: 'small' }))).toBe('empty');
  });

  it('every template is detected as its own mode under its default name', () => {
    for (const kind of ['annihilation', 'overrun', 'mission', 'empty'] as const) {
      expect(detectMode(templateEditor({ kind, players: kind === 'annihilation' ? 2 : 1, size: 'small' }))).toBe(kind);
    }
  });
});

describe('map checklist: lists per mode', () => {
  it('each mode has the board\'s items in the board\'s order', () => {
    const editor = templateEditor({ kind: 'annihilation', players: 2, size: 'small' });
    expect(ids(editor, 'annihilation')).toEqual(['players', 'resources', 'shell', 'sun', 'name', 'boundary', 'reach']);
    expect(ids(editor, 'overrun')).toEqual(['players', 'waves', 'manager', 'shell', 'sun', 'boundary']);
    expect(ids(editor, 'mission')).toEqual(['camera', 'flow', 'reach', 'name', 'shell', 'sun', 'boundary']);
    expect(ids(editor, 'empty')).toEqual(['shell', 'sun', 'boundary', 'mode']);
  });

  it('annihilation template: everything but the path check is ready, and the chip is green', () => {
    const list = mapChecklist(templateEditor({ kind: 'annihilation', players: 4, size: 'medium' }));
    expect(list.mode).toBe('annihilation');
    expect(list.players).toBe(4);
    expect([list.ready, list.total]).toEqual([6, 7]);
    expect(list.allReady).toBe(true);
    expect(list.checks[0].label).toBe('Player starts 4/4');
    expect(list.checks[0].detail).toBe('Placed symmetrically, one per player.');
    expect(list.checks.find((c) => c.id === 'resources')!.detail).toBe('9 requisition points, 16 scrap piles.');
    const reach = list.checks.find((c) => c.id === 'reach')!;
    expect(checkState(reach)).toBe('pending');
    expect(reach.fix ?? reach.show).toBeUndefined();
  });

  it('overrun template: all six ready', () => {
    const list = mapChecklist(templateEditor({ kind: 'overrun', players: 3, size: 'small', wavetype: 'zombie' }));
    expect([list.mode, list.players, list.ready, list.total, list.allReady]).toEqual(['overrun', 3, 6, 6, true]);
    expect(list.checks.find((c) => c.id === 'players')!.detail).toBe('3 together in the centre.');
    expect(list.checks.find((c) => c.id === 'manager')!.detail).toBe('Wave type: Zombies.');
  });

  it('mission template: six of seven, the path check pending', () => {
    const list = mapChecklist(templateEditor({ kind: 'mission', players: 1, size: 'small' }));
    expect([list.mode, list.players, list.ready, list.total, list.allReady]).toEqual(['mission', 1, 6, 7, true]);
    expect(list.checks.find((c) => c.id === 'flow')!.detail).toBe('1 stage, a way to win and a way to lose.');
  });

  it('empty template: Pick a mode counts and is never ready, so the chip stays amber', () => {
    const list = mapChecklist(templateEditor({ kind: 'empty', players: 1, size: 'small' }));
    // The sun counts: Compile adds one with default values (Settings tab on Auto).
    expect([list.mode, list.players, list.ready, list.total, list.allReady]).toEqual(['empty', 0, 1, 4, false]);
    expect(list.checks[1].detail).toMatch(/^Added with default values/);
    expect(checkState(list.checks[3])).toBe('warning');
    // Fixes place things around the content, so an empty map offers none.
    for (const c of list.checks) expect(c.fix).toBeUndefined();
  });

  it('the count equals the passing counted checks of the mode', () => {
    for (const kind of ['annihilation', 'overrun', 'mission', 'empty'] as const) {
      const editor = templateEditor({ kind, players: 2, size: 'small' });
      for (const mode of ['annihilation', 'overrun', 'mission', 'empty'] as const) {
        const list = mapChecklist(editor, mode);
        const checks = modeChecks(editor, mode);
        expect(list.total).toBe(checks.length);
        expect(list.ready).toBe(checks.filter((c) => c.ok).length);
      }
    }
  });
});

describe('map checklist: failures and fixes', () => {
  it('a wrong prefix fails Name for annihilation and missions', () => {
    const editor = templateEditor({ kind: 'annihilation', players: 2, size: 'small' }, 'canals.vmf');
    expect(byId(editor, 'name').ok).toBe(false);
    const mission = templateEditor({ kind: 'mission', players: 1, size: 'small' }, 'story.vmf');
    expect(byId(mission, 'name').detail).toMatch(/No sp_ prefix/);
  });

  it('a missing boundary is fixed in one undo step and the count goes up; undo brings it back down', () => {
    const editor = templateEditor({ kind: 'annihilation', players: 2, size: 'small' });
    removeClass(editor, 'func_map_boundary');
    const before = mapChecklist(editor);
    const boundary = before.checks.find((c) => c.id === 'boundary')!;
    expect(boundary.ok).toBe(false);
    expect(boundary.detail).toBe('Missing: the camera has no limits and fog of war no height data.');
    expect(before.allReady).toBe(false);
    boundary.fix!();
    const after = mapChecklist(editor);
    expect(after.ready).toBe(before.ready + 1);
    expect(after.allReady).toBe(true);
    expect(editor.history.undoLabel).toBe('Add boundary');
    editor.history.undo();
    expect(mapChecklist(editor).ready).toBe(before.ready);
    expect(editor.history.canUndo).toBe(false);
  });

  it('overrun without a manager offers one; missing waves and spread starts are reported', () => {
    const editor = templateEditor({ kind: 'overrun', players: 2, size: 'small' });
    removeClass(editor, 'overrun_manager');
    removeClass(editor, 'overrun_wave_spawnpoint');
    expect(detectMode(editor)).toBe('overrun');
    expect(byId(editor, 'waves').ok).toBe(false);
    const manager = byId(editor, 'manager');
    expect(manager.ok).toBe(false);
    manager.fix!();
    expect(byId(editor, 'manager').detail).toBe('Wave type: Antlions.');
  });

  it('a mission that can\'t be won or has no camera fails', () => {
    const editor = templateEditor({ kind: 'mission', players: 1, size: 'small' });
    editor.mission!.stages[0].transitions = editor.mission!.stages[0].transitions.filter((t) => t.to !== 'victory');
    expect(byId(editor, 'flow').detail).toBe('Nothing leads to Victory: the mission can\'t be won.');
    removeClass(editor, 'info_player_wars');
    const camera = byId(editor, 'camera');
    expect(checkState(camera)).toBe('error');
    camera.fix!();
    expect(byId(editor, 'camera').ok).toBe(true);
    Object.assign(editor, { mission: null });
    expect(byId(editor, 'flow').detail).toMatch(/^No stages yet/);
  });

  it('unnumbered or too few starts fail annihilation', () => {
    const editor = templateEditor({ kind: 'annihilation', players: 2, size: 'small' });
    const starts = editor.doc.entities.filter((e) => e.classname === 'info_start_wars');
    starts[1].set('ownernumber', starts[0].get('ownernumber')!);
    expect(byId(editor, 'players').label).toBe('Player starts 0/2');
    editor.doc.removeEntity(starts[1]);
    expect(byId(editor, 'players').detail).toMatch(/^1 placed: Annihilation needs at least 2/);
  });

  it('Empty with sky, sun and boundary in place reads 3/4, not ready: a mode is still to pick', () => {
    const list = mapChecklist(templateEditor({ kind: 'annihilation', players: 2, size: 'small' }), 'empty');
    expect([list.ready, list.total, list.allReady]).toEqual([3, 4, false]);
    expect(list.checks.map(checkState)).toEqual(['ok', 'ok', 'ok', 'warning']);
  });

  it('an empty document reads as Empty with no fixes', () => {
    const editor = stubEditor(VmfDocument.empty());
    const list = mapChecklist(editor);
    expect(list.mode).toBe('empty');
    expect(list.checks[0].detail).toMatch(/^Nothing to enclose yet/);
  });
});
