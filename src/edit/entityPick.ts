import { Box3, Box3Helper, Color } from 'three';
import type { Editor } from '../editor.ts';
import type { MapEntity } from '../vmf/map.ts';
import { pickObject } from './tools.ts';
import { entityBox } from '../render/missionMarkers.ts';
import { toast } from '../ui/dom.ts';

/**
 * Lets the user click an entity in the viewport (a brush entity by any of its brushes) and resolves with it,
 * or null on Escape. Only entities `accept` passes are outlined and taken; `what` names them in the hints.
 * Pointer input is taken before the tools see it.
 */
export function pickEntity(editor: Editor, accept: (e: MapEntity) => boolean, what: string): Promise<MapEntity | null> {
  return new Promise((resolve) => {
    const dom = editor.renderer.domElement;
    toast(editor.container, `Click ${what} · Esc cancels`, 4000);
    const outline = new Box3Helper(new Box3(), new Color(0xffa630));
    (outline.material as { depthTest: boolean }).depthTest = false;
    outline.renderOrder = 14;
    outline.visible = false;
    editor.scene.add(outline);
    const under = (e: PointerEvent): MapEntity | null => {
      const hit = pickObject(editor, editor.ndcFromEvent(e));
      const ent = hit?.entity ?? hit?.solid?.entity ?? null;
      return ent && ent !== editor.doc.worldEntity && ent.get('she_mission') !== '1' ? ent : null;
    };
    let taken = false;
    const finish = (result: MapEntity | null) => {
      dom.removeEventListener('pointerdown', down, true);
      dom.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('keydown', key, true);
      editor.scene.remove(outline);
      outline.dispose();
      resolve(result);
    };
    // Hover moves are kept from the editor's own hover outline (it would outline brushes and handles too).
    const move = (e: PointerEvent) => {
      if (e.buttons) return;
      e.stopImmediatePropagation();
      const ent = under(e);
      outline.visible = !!ent && accept(ent);
      if (outline.visible) outline.box.copy(entityBox(editor, ent!)).expandByScalar(12);
      dom.style.cursor = outline.visible ? 'crosshair' : '';
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || e.altKey) return;
      e.stopImmediatePropagation();
      taken = true;
      const ent = under(e);
      if (ent && accept(ent)) { dom.style.cursor = ''; finish(ent); }
      else toast(editor.container, ent ? `${ent.classname} isn't ${what} · Esc cancels` : `Click ${what} · Esc cancels`, 2500);
    };
    // The click's release belongs to the pick too, not to the select tool.
    const up = (e: PointerEvent) => {
      if (!taken || e.button !== 0) return;
      taken = false;
      e.stopImmediatePropagation();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      dom.style.cursor = '';
      finish(null);
    };
    dom.addEventListener('pointerdown', down, true);
    dom.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('keydown', key, true);
  });
}
