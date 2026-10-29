import { Editor } from './editor.ts';
import { mountTopBar } from './ui/viewBar.ts';
import { mountStats } from './ui/stats.ts';
import { h } from './ui/dom.ts';
import { Vector3 } from 'three';

const viewport = document.getElementById('viewport')!;
const loading = h('div.loading', { hidden: true });
viewport.append(loading);

const editor = new Editor(viewport);
mountTopBar(editor, document.getElementById('topbar')!, loading);
mountStats(editor, viewport, document.getElementById('statusbar')!);

/** Hooks for scripted screenshots and debugging from the console. */
declare global {
  interface Window {
    __editor: {
      editor: Editor;
      ready: boolean;
      busy(): boolean;
      setView(pos: [number, number, number], target: [number, number, number]): void;
    };
  }
}
window.__editor = {
  editor,
  ready: false,
  busy: () => editor.busy(),
  setView(pos, target) {
    editor.camera.position.set(...pos);
    editor.controls.lookAt(new Vector3(...target));
  },
};
editor.on('document', () => (window.__editor.ready = true));
