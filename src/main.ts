import { Editor } from './editor.ts';
import { mountTopBar } from './ui/viewBar.ts';
import { mountStats } from './ui/stats.ts';
import { mountDocumentPanel } from './ui/documentPanel.ts';
import { mountToolbar } from './ui/toolbar.ts';
import { installTooltips } from './ui/tooltip.ts';
import { mountSidebar } from './ui/sidebar.ts';
import { mountPanelFollow } from './ui/panelFollow.ts';
import { mountInspector } from './ui/inspector.ts';
import { mountEntityPalette } from './ui/entityPalette.ts';
import { mountToolOptions } from './ui/toolOptions.ts';
import { mountGeneratePanel } from './ui/generatePanel.ts';
import { mountCompileDialog } from './ui/compileDialog.ts';
import { mountGeneratorDialog } from './ui/generatorDialog.ts';
import { mountOutliner } from './ui/outliner.ts';
import { mountHelp } from './ui/help.ts';
import { Hover } from './edit/hover.ts';
import { mountLogicPanel } from './ui/logicPanel.ts';
import { IoLines } from './render/ioLines.ts';
import { RopeRenderer } from './render/ropeRenderer.ts';
import { SoundRenderer } from './render/soundRenderer.ts';
import { SoundscapeController } from './audio/listener.ts';
import { LocalSoundPlayer } from './audio/localSounds.ts';
import { setSoundscapeController } from './ui/soundUi.ts';
import { audio } from './audio/engine.ts';
import { mountMissionPanel } from './ui/missionPanel.ts';
import { mountMissionFlow } from './ui/missionFlow.ts';
import { mountMissionViewport } from './ui/missionViewport.ts';
import { pickArea } from './edit/areaPick.ts';
import { buildMission } from './lw/missionAction.ts';
import { checkMission } from './lw/missionCheck.ts';
import { toast } from './ui/dom.ts';
import { GameplayOverlay } from './render/gameplayOverlay.ts';
import { LightingPreview } from './render/lightingPreview.ts';
import { mountLightingPanel } from './ui/lightingPanel.ts';
import { mountSketchDialog } from './ui/sketchDialog.ts';
import { mountInstallPicker } from './ui/installPicker.ts';
import { mountStartScreen, skipsStartScreen } from './ui/startScreen.ts';
import { mountRecover } from './ui/recover.ts';
import { mountMapSettingsPanel } from './ui/mapSettingsPanel.ts';
import { mountPoiPanel } from './ui/poiPanel.ts';
import { mountCinemaPanel } from './ui/cinemaPanel.ts';
import { CinematicsRenderer } from './render/cinematicsRenderer.ts';
import { h } from './ui/dom.ts';
import { Vector3 } from 'three';
import { apiPost } from './api.ts';
import { mountAssetDock } from './ui/assetDock.ts';
import { mountAssetDrop } from './edit/assetDrop.ts';

const viewport = document.getElementById('viewport')!;
const loading = h('div.loading', { hidden: true });
viewport.append(loading);

const editor = new Editor(viewport);
// Without a map in the address the editor opens on the start screen (startScreen.ts).
const topBar = mountTopBar(editor, document.getElementById('topbar')!, loading, () => startScreen.show());
const recover = mountRecover(editor, topBar);
const startScreen = mountStartScreen(editor, topBar, recover);
if (!skipsStartScreen(new URL(location.href))) startScreen.show();
const hover = new Hover(editor);
const status = mountStats(editor, viewport, document.getElementById('statusbar')!, () => hover.label);
const help = mountHelp();
installTooltips();
mountToolbar(editor, document.getElementById('toolbar')!, { hoverPoint: () => hover.point, help: () => help.toggle() });
mountToolOptions(editor, viewport, () => assetDock.show('material'));
mountGeneratePanel(editor, viewport);
const compileDialog = mountCompileDialog(editor);
const generatorDialog = mountGeneratorDialog(editor);
const sketchDialog = mountSketchDialog(editor);
document.getElementById('topbar')!.querySelector('.spacer')!.before(
  h('button', { onclick: () => sketchDialog.open(), title: 'Draw the map in 2D with height levels, then generate it' }, '✎ Sketch'),
  h('button', { onclick: () => generatorDialog.open(), title: 'Generate a complete map from a painted layout' }, '⚙ Generate map'),
  h('button.primary', { onclick: () => compileDialog.open(), title: 'Compile the map and run it in Lambda Wars' }, '▶ Compile & test'),
  mountInstallPicker(editor),
);
// Audio preview: soundscapes (and local sounds) where the camera looks.
const audioBtn = h('button', { title: 'Hear the map: soundscapes where the camera looks, and local sounds' }, '🔇 Audio');
const syncAudio = () => {
  audioBtn.classList.toggle('active', audio.enabled);
  audioBtn.textContent = audio.enabled ? '🔊 Audio' : '🔇 Audio';
};
audioBtn.addEventListener('click', async () => { await audio.setEnabled(!audio.enabled); syncAudio(); });
document.addEventListener('she-audio', syncAudio);
document.getElementById('topbar')!.querySelector('.spacer')!.after(audioBtn);
const tabs = mountSidebar(document.getElementById('sidebar')!);
tabs.add('Selection', mountInspector(editor));
// Materials and decals are browsed in the asset finder (below the view); the rail's Material item opens it.
tabs.link('Materials', () => assetDock.show('material'));
const missionFlow = mountMissionFlow(editor, {
  pickArea: async () => {
    // Hide the flowchart while the area is drawn in the viewport.
    const backdrop = missionFlow.dialog.parentElement!;
    backdrop.hidden = true;
    const area = await pickArea(editor);
    backdrop.hidden = false;
    return area;
  },
  build: () => {
    if (!editor.mission) return;
    const r = buildMission(editor, editor.mission);
    toast(editor.container, `Mission built: ${r.entities} entities, ${r.connections} outputs${r.warnings.length ? ` \u00b7 ${r.warnings.length} warning${r.warnings.length > 1 ? 's' : ''}` : ''}`, 4000);
  },
  check: () => (editor.mission ? checkMission(editor.mission, editor.doc) : []),
});
// Objectives panel in the viewport (M): step through the mission and retarget it from the view.
const missionView = mountMissionViewport(editor, viewport, { openFlow: () => missionFlow.open() });
tabs.add('Mission', mountMissionPanel(editor, () => missionFlow.open(), () => missionView.toggle()));
tabs.add('POI', mountPoiPanel(editor, () => tabs.follow('POI')));
tabs.add('Cinema', mountCinemaPanel(editor));
tabs.add('Entities', mountEntityPalette(editor, () => document.querySelector<HTMLButtonElement>('#toolbar button[aria-label^="Entity"]')?.click()));
const mapPanel = h('div');
mountDocumentPanel(editor, mapPanel);
const lighting = new LightingPreview(editor);
mapPanel.append(mountLightingPanel(editor, lighting), mountOutliner(editor));
window.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() !== 'l' || e.ctrlKey || e.metaKey || (e.target as HTMLElement)?.closest?.('input, textarea, select')) return;
  lighting.setEnabled(!lighting.enabled);
  editor.emit('lighting');
});
tabs.add('Map', mapPanel);
tabs.add('Settings', mountMapSettingsPanel(editor, lighting));
const logic = mountLogicPanel(editor);
tabs.add('Logic', logic.panel);
new IoLines(editor);
new RopeRenderer(editor);
const soundscapes = new SoundscapeController(editor);
setSoundscapeController(soundscapes);
const sounds = new SoundRenderer(editor);
const localSounds = new LocalSoundPlayer(editor, soundscapes);
sounds.localRanges = () => localSounds.sounds.map((s) => ({ entity: s.entity, radius: s.radius }));
sounds.update();
editor.on('soundscape', () => sounds.update(soundscapes.active?.entity ?? null));
new GameplayOverlay(editor);
new CinematicsRenderer(editor);
// The asset finder under the view (B): models, materials, decals and sounds.
mountAssetDrop(editor);
const assetDock = mountAssetDock(editor, document.getElementById('assetdock')!, status.right);
// Panels follow the tool and the selection (Paint and Decal: the asset finder's tab); badges on the rail show
// selection, mission and logic state.
mountPanelFollow(editor, tabs, (kind) => assetDock.follow(kind));

/** Hooks for scripted screenshots and debugging from the console. */
declare global {
  interface Window {
    __editor: {
      editor: Editor;
      ready: boolean;
      busy(): boolean;
      tabs: typeof tabs;
      logic: typeof logic;
      lighting: LightingPreview;
      soundscapes: SoundscapeController;
      audio: typeof audio;
      sketch: typeof sketchDialog;
      startScreen: typeof startScreen;
      missionFlow: typeof missionFlow;
      missionView: typeof missionView;
      assetDock: typeof assetDock;
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
  logic,
  lighting,
  soundscapes,
  audio,
  sketch: sketchDialog,
  startScreen,
  missionFlow,
  missionView,
  assetDock,
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
    const r = editor.viewRect();
    return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
  },
};
editor.on('document', () => (window.__editor.ready = true));

// Autosave unsaved work every minute to .autosave/: listed under "Autosaves" in the map picker, and offered back
// (recover.ts) when it is newer than the map's saved file.
setInterval(() => {
  if (!editor.dirty || !editor.doc.allSolids().length) return;
  const name = editor.mapName.replace(/\.vmf$/i, '') + '.autosave.vmf';
  void apiPost(`/api/autosave?name=${encodeURIComponent(name)}`, editor.doc.serialize()).then((r) => {
    if (!r.ok) return;
    editor.lastAutosave = new Date();
    editor.emit('autosave');
  });
}, 60_000);
