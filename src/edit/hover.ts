import { Box3, Box3Helper, Color, Vector3 } from 'three';
import type { Editor } from '../editor.ts';
import { pickObject } from './tools.ts';

/**
 * Highlights what is under the cursor and keeps the last surface point (used for paste-at-cursor).
 * Picking is throttled to one raycast per frame.
 */
export class Hover {
  readonly helper = new Box3Helper(new Box3(), new Color(0xbfe3ff));
  label = '';
  point: Vector3 | null = null;
  private pending: PointerEvent | null = null;
  private editor: Editor;

  constructor(editor: Editor) {
    this.editor = editor;
    this.helper.visible = false;
    this.helper.renderOrder = 8;
    (this.helper.material as { depthTest: boolean }).depthTest = false;
    editor.scene.add(this.helper);
    editor.quad.helpers.push(this.helper);
    const dom = editor.renderer.domElement;
    dom.addEventListener('pointermove', (e) => {
      if (e.buttons) { this.clear(); return; }
      this.pending = e;
    });
    dom.addEventListener('pointerleave', () => this.clear());
    editor.on('frame', () => this.update());
  }

  private clear(): void {
    this.pending = null;
    if (this.helper.visible || this.label) {
      this.helper.visible = false;
      this.label = '';
      this.editor.emit('hover');
    }
  }

  private update(): void {
    const e = this.pending;
    if (!e) return;
    this.pending = null;
    const ed = this.editor;
    const ndc = ed.ndcFromEvent(e);
    // The cursor point (paste, placing) is on what's under a generator handle; the outline shows the handle.
    const under = pickObject(ed, ndc);
    const hit = ed.tools.current.name === 'select' ? pickObject(ed, ndc, { handles: true }) : under;
    this.point = under?.point.clone() ?? null;
    let label = '';
    let box: Box3 | null = null;
    if (hit?.entity) {
      const name = hit.entity.get('targetname');
      label = `${hit.entity.classname}${name ? ` "${name}"` : ''}`;
      box = ed.entities.entityBounds(hit.entity);
    } else if (hit?.solid) {
      label = `brush #${hit.solid.id} · ${hit.side?.material.toLowerCase() ?? ''}${hit.solid.entity ? ` · in ${hit.solid.entity.classname}` : ''}`;
      box = ed.world.solidBounds(hit.solid);
    }
    const selected = (hit?.solid && ed.selection.solids.has(hit.solid)) || (hit?.entity && ed.selection.entities.has(hit.entity));
    this.helper.visible = !!box && !selected && ed.tools.current.name === 'select' && ed.selection.mode === 'object';
    if (box) this.helper.box.copy(box);
    if (label !== this.label) {
      this.label = label;
      ed.emit('hover');
    }
  }
}
