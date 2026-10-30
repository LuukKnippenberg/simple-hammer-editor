import { Editor } from './editor.ts';
import { mountTopBar } from './ui/viewBar.ts';
import { mountStats } from './ui/stats.ts';
import { mountDocumentPanel } from './ui/documentPanel.ts';
import { mountToolbar } from './ui/toolbar.ts';
import { mountSidebar } from './ui/sidebar.ts';
import { mountInspector } from './ui/inspector.ts';
import { mountMaterialBrowser } from './ui/materialBrowser.ts';
import { mountEntityPalette } from './ui/entityPalette.ts';
import { mountToolOptions } from './ui/toolOptions.ts';
import { mountCompileDialog } from './ui/compileDialog.ts';
import { mountGeneratorDialog } from './ui/generatorDialog.ts';
import { mountOutliner } from './ui/outliner.ts';
import { mountHelp } from './ui/help.ts';
import { Hover } from './edit/hover.ts';
import { h } from './ui/dom.ts';
import { Vector3 } from 'three';

const viewport = document.getElementById('viewport')!;
const loading = h('div.loading', { hidden: true });
viewport.append(loading);

const editor = new Editor(viewport);
mountTopBar(editor, document.getElementById('topbar')!, loading);
const hover = new Hover(editor);
mountStats(editor, viewport, document.getElementById('statusbar')!, () => hover.label);
const help = mountHelp();
mountToolbar(editor, document.getElementById('toolbar')!, { hoverPoint: () => hover.point, help: () => help.toggle() });
mountToolOptions(editor, viewport);
const compileDialog = mountCompileDialog(editor);
const generatorDialog = mountGeneratorDialog(editor);
document.getElementById('topbar')!.querySelector('.spacer')!.before(
  h('button', { onclick: () => generatorDialog.open(), title: 'Generate a complete map from a painted layout' }, '⚙ Generate map'),
  h('button.primary', { onclick: () => compileDialog.open(), title: 'Compile the map and run it in Lambda Wars' }, '▶ Compile & test'),
);
const tabs = mountSidebar(document.getElementById('sidebar')!);
tabs.add('Selection', mountInspector(editor));
tabs.add('Materials', mountMaterialBrowser(editor));
tabs.add('Entities', mountEntityPalette(editor, () => document.querySelector<HTMLButtonElement>('#toolbar button[title^="Entity"]')?.click()));
const mapPanel = h('div');
mountDocumentPanel(editor, mapPanel);
mapPanel.append(mountOutliner(editor));
tabs.add('Map', mapPanel);
editor.on('selection', () => {
  if (!editor.selection.isEmpty && editor.tools.current.name === 'select') tabs.show('Selection');
});

/** Hooks for scripted screenshots and debugging from the console. */
declare global {
  interface Window {
    __editor: {
      editor: Editor;
      ready: boolean;
      busy(): boolean;
      tabs: typeof tabs;
      setView(pos: [number, number, number], target: [number, number, number]): void;
      /** Page coordinates of a world point (for scripted mouse input). */
      project(p: [number, number, number]): [number, number];
      /** Page coordinates of a point on the gizmo handle for an axis. */
      gizmoHandle(axis: 'x' | 'y' | 'z'): [number, number];
    };
  }
}
window.__editor = {
  editor,
  ready: false,
  busy: () => editor.busy(),
  tabs,
  setView(pos, target) {
    editor.camera.position.set(...pos);
    editor.controls.lookAt(new Vector3(...target));
  },
  gizmoHandle(axis) {
    const g = editor.tools.select.gizmo;
    const pos = g.object!.position.clone();
    const cam = editor.activeCamera as import("three").PerspectiveCamera;
    // Same scale as TransformControlsGizmo; the handle pickers start near the centre and run ~0.6 along the axis.
    const factor = pos.distanceTo(cam.position) * Math.min((1.9 * Math.tan((Math.PI * cam.fov) / 360)) / cam.zoom, 7) * (g.size / 4);
    const dir = new Vector3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0);
    const p = pos.addScaledVector(dir, factor * 0.42);
    return window.__editor.project([p.x, p.y, p.z]);
  },
  project(p) {
    const v = new Vector3(...p).project(editor.activeCamera);
    const r = editor.renderer.domElement.getBoundingClientRect();
    return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
  },
};
editor.on('document', () => (window.__editor.ready = true));

// Autosave unsaved work every minute to .autosave/ (listed under "Autosaves" in the map picker).
setInterval(() => {
  if (!editor.dirty || !editor.doc.allSolids().length) return;
  const name = editor.mapName.replace(/\.vmf$/i, '') + '.autosave.vmf';
  void fetch(`/api/autosave?name=${encodeURIComponent(name)}`, { method: 'POST', body: editor.doc.serialize() }).then((r) => {
    if (!r.ok) return;
    editor.lastAutosave = new Date();
    editor.emit('autosave');
  });
}, 60_000);
