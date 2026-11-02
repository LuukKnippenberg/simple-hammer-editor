import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { boxSolid, translateSolid } from '../src/edit/brushes.ts';
import { POI_TYPES, newSpec } from '../src/gen/poi/registry.ts';
import { applyPoi } from '../src/gen/poi/action.ts';
import '../src/gen/poi/catalogue.ts';
import { stubEditor } from './stubEditor.ts';

/** An editor with five steps: add a brush, a POI generator run, move the brush, add another, delete the first. */
function editedMap() {
  const editor = stubEditor();
  const { doc, history } = editor;
  let clock = 1_000;
  history.now = () => (clock += 60_000);
  const snapshots = [doc.serialize()];
  const snap = () => snapshots.push(doc.serialize());

  const first = doc.addSolid(boxSolid(doc, new Vector3(0, 0, 0), new Vector3(128, 128, 64), 'DEV/DEV_MEASUREGENERIC01B'));
  history.added('Add brush', [first]);
  snap();
  const type = POI_TYPES[0];
  const [w, d] = type.defaultSize;
  applyPoi(editor, newSpec(type, { x0: 1024, y0: -512, x1: 1024 + w, y1: -512 + d }, 64, { seed: 3 }), `Generate ${type.label.toLowerCase()}`);
  snap();
  const end = history.begin('Move', [first]);
  translateSolid(first, new Vector3(64, 0, 0));
  first.reload();
  end();
  snap();
  const second = doc.addSolid(boxSolid(doc, new Vector3(0, 512, 0), new Vector3(64, 576, 64), 'DEV/DEV_MEASUREGENERIC01B'));
  history.added('Add brush', [second]);
  snap();
  history.remove('Delete', [first]);
  snap();
  return { editor, snapshots };
}

describe('History jump-to', () => {
  it('lists the steps with labels and times, a generator run as one step', () => {
    const { editor } = editedMap();
    const steps = editor.history.steps;
    expect(steps.map((s) => s.label)).toEqual(['Add brush', `Generate ${POI_TYPES[0].label.toLowerCase()}`, 'Move', 'Add brush', 'Delete']);
    expect(steps.every((s, i) => i === 0 || s.time > steps[i - 1].time)).toBe(true);
    expect(editor.history.position).toBe(5);
  });

  it('restores the serialized document exactly when jumping back and forward across several steps', () => {
    const { editor, snapshots } = editedMap();
    const { history, doc } = editor;
    expect(new Set(snapshots).size).toBe(6);
    for (const target of [1, 4, 0, 5, 2, 3, 0, 5]) {
      history.jumpTo(target);
      expect(history.position).toBe(target);
      expect(doc.serialize()).toBe(snapshots[target]);
    }
  });

  it('keeps the undone steps redoable until a new edit drops them', () => {
    const { editor } = editedMap();
    const { history, doc } = editor;
    history.jumpTo(2);
    expect(history.steps).toHaveLength(5);
    expect(history.canRedo).toBe(true);
    const extra = doc.addSolid(boxSolid(doc, new Vector3(0, -512, 0), new Vector3(64, -448, 64), 'DEV/DEV_MEASUREGENERIC01B'));
    history.added('Add brush', [extra]);
    expect(history.steps).toHaveLength(3);
    expect(history.position).toBe(3);
    expect(history.canRedo).toBe(false);
  });

  it('fires one change per jump and clamps out-of-range targets', () => {
    const { editor } = editedMap();
    const { history } = editor;
    let changes = 0;
    history.onChange = () => changes++;
    expect(history.jumpTo(-3)).toBe(5);
    expect(changes).toBe(1);
    expect(history.jumpTo(99)).toBe(5);
    expect(history.jumpTo(5)).toBe(0);
    expect(changes).toBe(2);
  });

  it('stamps the start of the history on clear', () => {
    const { editor } = editedMap();
    editor.history.clear();
    expect(editor.history.steps).toEqual([]);
    expect(editor.history.openedAt).toBeGreaterThan(1_000);
  });
});
