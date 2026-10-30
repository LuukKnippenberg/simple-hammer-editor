import type { Editor } from '../editor.ts';
import type { MapEntity } from '../vmf/map.ts';
import type { CinemaTool, CinemaMode } from '../edit/cinemaTool.ts';
import { h, toast } from './dom.ts';
import {
  ATMOSPHERE_PRESETS, FLYBY_MODELS, PATH_CLASSES, SCREEN_MATERIALS, atmosphereOf, cameraShots, chainOf, pathLength, type AtmospherePreset,
} from '../lw/cinematics.ts';
import {
  addShotFromView, atmosphereRelays, buildAtmosphere, buildFlyby, buildFlybyFollow, buildSendAlong, editShot, groundBelow, pathNameOf, removePathNode,
  sendAlongUnit, setPathHeight, setPathLoop, viewTarget,
} from '../lw/cinematicsAction.ts';
import { FAVOURITE_EFFECTS, loadParticleCatalog, particleLook } from '../lw/particles.ts';
import { AtmospherePreview, frameShot, playShot } from '../render/cinemaPreview.ts';
import { logicAnchor } from '../lw/missionAction.ts';

let preview: AtmospherePreview | null = null;
const atmospherePreview = (editor: Editor) => (preview ??= new AtmospherePreview(editor));

const cinemaTool = (editor: Editor) => editor.tools.tools.cinema as CinemaTool;
const setTool = (editor: Editor, mode: CinemaMode) => {
  cinemaTool(editor).mode = mode;
  editor.tools.set('cinema');
  editor.emit('toolchange');
};

const num = (value: number, step: number, onChange: (v: number) => void, min = 0) => {
  const i = h('input', { type: 'number', value: String(value), step: String(step), min: String(min) }) as HTMLInputElement;
  i.addEventListener('change', () => { onChange(Math.max(min, parseFloat(i.value) || 0)); i.blur(); });
  return i;
};
const row = (label: string, ...els: (HTMLElement | string)[]) => h('div.row', {}, h('label', {}, label), ...els);
const names = (editor: Editor, id: string) => h('datalist', { id }, ...[...new Set(editor.doc.entities.map((e) => e.get('targetname')).filter(Boolean))].sort().map((n) => h('option', { value: n! })));

/** A searchable list of the game's particle effects (favourites first); clicking one picks it. */
export function particlePicker(value: string, onPick: (name: string) => void): HTMLElement {
  const search = h('input', { type: 'search', placeholder: 'Search 2,000+ effects: smoke, fire, spark…' }) as HTMLInputElement;
  const results = h('div.sound-list');
  const current = h('div.sound-current');
  const swatch = (n: string) => h('span.cine-swatch', { style: { background: `#${particleLook(n).color.toString(16).padStart(6, '0')}` }, title: particleLook(n).kind });
  const showCurrent = (v: string) => current.replaceChildren(h('span.muted', {}, 'Effect '), swatch(v), h('b', {}, v || '(none)'), h('span.badge', {}, particleLook(v).kind));
  showCurrent(value);
  const pick = (n: string) => { onPick(n); showCurrent(n); };
  const render = async () => {
    const all = await loadParticleCatalog();
    const words = search.value.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) {
      results.replaceChildren(h('div.hint', {}, `Favourites · ${all.length} effects in ${new Set(all.map((e) => e.file)).size} files`),
        ...FAVOURITE_EFFECTS.filter((f) => all.some((e) => e.name === f.name)).map((f) => h('div.sound-row', {}, swatch(f.name),
          h('span', { title: f.name, onclick: () => pick(f.name) }, `${f.label} `, h('span.muted', {}, f.name)))));
      return;
    }
    const hits = all.filter((e) => words.every((w) => e.name.toLowerCase().includes(w) || e.file.includes(w)));
    results.replaceChildren(...hits.slice(0, 150).map((e) => h('div.sound-row', {}, swatch(e.name),
      h('span', { title: `${e.name} (${e.file})`, onclick: () => pick(e.name) }, e.name, ' ', h('span.muted', {}, e.file.replace('particles/', ''))))));
    if (hits.length > 150) results.append(h('div.hint', {}, `${hits.length - 150} more: refine the search`));
    if (!hits.length) results.append(h('div.hint', {}, 'No effects match.'));
  };
  let t = 0;
  search.addEventListener('input', () => { clearTimeout(t); t = window.setTimeout(() => void render(), 120); });
  void render();
  return h('div.sound-browser', {}, current, search, results);
}

/** Options for the cinema tool (shown in the viewport's tool box). */
export function cinemaToolOptions(editor: Editor, rerender: () => void): HTMLElement[] {
  const tool = cinemaTool(editor);
  const modes: [CinemaMode, string][] = [['path', 'Path'], ['particle', 'Particle'], ['screen', 'Screen']];
  const seg = h('div.seg', {}, ...modes.map(([m, l]) => {
    const b = h('button', { onclick: () => { tool.mode = m; rerender(); } }, l);
    b.classList.toggle('active', tool.mode === m);
    return b;
  }));
  const rows: HTMLElement[] = [seg];
  if (tool.mode === 'path') {
    rows.push(row('Height', num(tool.height, 16, (v) => (tool.height = v)), h('span.unit', {}, 'u above the surface')),
      h('div.hint', {}, '16 for unit routes, 400+ for flybys. Select a node to change heights, link a unit or a flyby.'));
  } else if (tool.mode === 'particle') {
    const active = h('input', { type: 'checkbox', checked: tool.startActive }) as HTMLInputElement;
    active.addEventListener('change', () => (tool.startActive = active.checked));
    rows.push(row('Start on', active), particlePicker(tool.effect, (n) => (tool.effect = n)));
  } else {
    const mat = h('select', {}, ...SCREEN_MATERIALS.map((m) => h('option', { value: m.material }, m.label))) as HTMLSelectElement;
    mat.value = tool.screenMaterial;
    mat.addEventListener('change', () => { tool.screenMaterial = mat.value; mat.blur(); });
    rows.push(row('Picture', mat), row('Size', num(tool.screenW, 8, (v) => (tool.screenW = v), 8), num(tool.screenH, 8, (v) => (tool.screenH = v), 8)),
      h('div.hint', {}, 'Click a wall. Enable <name>_static to switch to static.'));
  }
  return rows;
}

function shotSection(editor: Editor, cam: MapEntity): HTMLElement {
  const shot = cameraShots(editor.doc).find((s) => s.camera === cam);
  if (!shot) return h('div');
  const name = cam.get('targetname') ?? '';
  const moving = shot.route.length > 1;
  return h('div.section', {}, h('h3', {}, '🎬 Camera shot'),
    h('div.row', {}, h('button.primary', { onclick: () => playShot(editor, cam) }, '▶ Preview'),
      h('button', { onclick: () => frameShot(editor, cam, 'start') }, 'Start frame'),
      moving ? h('button', { onclick: () => frameShot(editor, cam, 'end') }, 'End frame') : null),
    row('Length', num(shot.duration, 0.5, (v) => editShot(editor, cam, { duration: Math.max(0.5, v) }), 0.5), h('span.unit', {}, 's')),
    h('div.row', {},
      h('button', { title: 'Put the camera where the editor camera is, looking at the middle of the screen', onclick: () => editShot(editor, cam, { from: editor.camera.position.clone(), lookAt: viewTarget(editor) }) }, 'Start = view'),
      h('button', { title: 'Move the camera to where the editor camera is during the shot', onclick: () => editShot(editor, cam, { to: editor.camera.position.clone() }) }, 'End = view'),
      moving ? h('button', { onclick: () => editShot(editor, cam, { to: null }) }, 'Still') : null),
    h('div.row', {}, h('button', { title: 'Look at the point in the middle of the screen', onclick: () => editShot(editor, cam, { lookAt: viewTarget(editor) }) }, 'Look at screen centre')),
    h('p.hint', {}, moving ? `Moves ${Math.round(pathLength(shot.route))} u at ${shot.speed} u/s. ` : 'Still shot. ',
      `Fire `, h('b', {}, `${name} → Enable`), ' from a stage action or an output; the view returns to the player after the shot. The player is frozen meanwhile. The game only finds the player for a camera fired without one (logic_auto, timers, relays) when it runs with one player slot, as missions do; Compile & test launches that way.'));
}

function pathSection(editor: Editor, node: MapEntity): HTMLElement {
  const chain = chainOf(editor.doc, node);
  const nodes = chain?.nodes ?? [node];
  const pts = nodes.map((n) => n.origin!).filter(Boolean);
  const path = pathNameOf(node);
  const ground = node.origin ? groundBelow(editor, node.origin) : null;
  const above = ground === null ? 0 : Math.round(node.origin!.z - ground);
  const hInput = num(above, 16, () => {}, 0);
  const send = sendAlongUnit(editor, node);
  const listId = `cine-names-${node.id}`;
  const unit = h('input', { value: send?.unit ?? '', placeholder: 'unit targetname', list: listId }) as HTMLInputElement;
  const immortal = h('input', { type: 'checkbox', checked: send?.immortal ?? true }) as HTMLInputElement;
  const scripted = h('input', { type: 'checkbox', checked: send?.scripted ?? true }) as HTMLInputElement;
  const model = h('select', {}, ...FLYBY_MODELS.map((m) => h('option', { value: m.id }, m.label))) as HTMLSelectElement;
  const flyby = editor.doc.entities.find((e) => e.get('targetname') === `${path}_flyby`);
  const flyModel = editor.doc.entities.find((e) => e.get('targetname') === `${path}_flyby_model`)?.get('model');
  model.value = FLYBY_MODELS.find((m) => m.model === flyModel)?.id ?? 'dropship';
  const speed = h('input', { type: 'number', value: flyby?.get('startspeed') ?? '600', step: '50', min: '50' }) as HTMLInputElement;
  const len = pathLength(chain?.loop ? [...pts, pts[0]] : pts);
  return h('div.section', {}, h('h3', {}, `🛤 Path ${path}`),
    h('p.hint', {}, `${nodes.length} node${nodes.length > 1 ? 's' : ''} · ${Math.round(len)} u${chain?.loop ? ' · loop' : ''}. With the Cinema tool (C), click to add nodes after this one.`),
    row('Height', hInput, h('span.unit', {}, 'u above ground')),
    h('div.row', {},
      h('button', { onclick: () => setPathHeight(editor, node, Number(hInput.value) || 0, false) }, 'This node'),
      h('button', { onclick: () => setPathHeight(editor, node, Number(hInput.value) || 0, true) }, 'All nodes')),
    h('div.row', {},
      h('button', { onclick: () => removePathNode(editor, node) }, 'Remove node (keep joined)'),
      nodes.length > 2 ? h('button', { onclick: () => setPathLoop(editor, node, !chain?.loop) }, chain?.loop ? 'Open loop' : 'Close loop') : null),
    h('h3', { style: { marginTop: '10px' } }, 'Send a unit along it'),
    names(editor, listId),
    row('Unit', unit), row('Can\'t be hurt', immortal), row('AI-controlled', scripted),
    h('div.row', {}, h('button', {
      onclick: () => {
        if (!unit.value.trim()) return toast(editor.container, 'Type the unit\'s targetname');
        buildSendAlong(editor, node, unit.value.trim(), { immortal: immortal.checked, scripted: scripted.checked });
        toast(editor.container, `Built ${path}_go: fire Trigger on it to start`);
      },
    }, send ? `Update ${path}_go` : `Build ${path}_go`)),
    h('p.hint', {}, 'Orders the unit to each node in turn (Order, then QueueOrder). Units walk or fly at their own height; ground units need nodes on the navmesh. Fire ', h('b', {}, `${path}_go → Trigger`), '.'),
    h('h3', { style: { marginTop: '10px' } }, 'Flyby'),
    row('Aircraft', model), row('Speed', speed, h('span.unit', {}, 'u/s')),
    h('div.row', {}, h('button', {
      onclick: () => { buildFlyby(editor, node, model.value, Number(speed.value) || 600); toast(editor.container, `Built ${path}_flyby: fire StartForward on it`); },
    }, flyby ? 'Rebuild flyby' : 'Build flyby'),
    flyby ? h('button', {
      title: 'A relay that starts the flyby and asks wars_player_follow_entity to hold the RTS camera on it. In the sp_cine_test run the camera did not track the flyby; check it in game.',
      onclick: () => { if (buildFlybyFollow(editor, node)) toast(editor.container, `Built ${path}_flyby_go: fire Trigger on it`); },
    }, 'Camera follows it (untested)') : null),
    h('p.hint', {}, `A model on a func_tracktrain: follows the nodes' exact heights, can't be hurt, has no AI. ${Math.round(len / (Number(speed.value) || 600))} s at this speed. Fire `, h('b', {}, `${path}_flyby → StartForward`), '.'));
}

function particleSection(editor: Editor, e: MapEntity): HTMLElement {
  const set = (k: string, v: string) => {
    const finish = editor.history.begin('Edit particle', [], [e]);
    e.set(k, v);
    finish();
    editor.changed();
  };
  const active = h('input', { type: 'checkbox', checked: e.get('start_active') === '1' }) as HTMLInputElement;
  active.addEventListener('change', () => set('start_active', active.checked ? '1' : '0'));
  const look = particleLook(e.get('effect_name') ?? '');
  return h('div.section', {}, h('h3', {}, '✦ Particle system'),
    row('Start on', active),
    particlePicker(e.get('effect_name') ?? '', (n) => set('effect_name', n)),
    h('p.hint', {}, `Drawn as a ${look.kind} puff about ${look.size} × ${look.height} u (a guess from the name). Inputs: Start, Stop, StopPlayEndCap, DestroyImmediately, Kill.`));
}

function screenSection(e: MapEntity): HTMLElement {
  const name = (e.get('targetname') ?? '').replace(/_static$/, '');
  return h('div.section', {}, h('h3', {}, '📺 Screen'),
    h('p.hint', {}, 'Fire ', h('b', {}, `${name}_static → Enable`), ' to cut to static, ', h('b', {}, 'Disable'), ' to bring the picture back. ',
      'No game material has a ToggleTexture proxy, so env_texturetoggle has nothing to switch; two func_brush panels do it instead.'));
}

function atmosphereEditor(editor: Editor, p: AtmospherePreset, onBuilt?: () => void): HTMLElement {
  const draft = { ...p };
  const color = h('input', { type: 'color', value: `#${draft.fogcolor.split(/\s+/).map((x) => (Number(x) || 0).toString(16).padStart(2, '0')).join('')}` }) as HTMLInputElement;
  color.addEventListener('input', () => {
    const v = color.value;
    draft.fogcolor = [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16)).join(' ');
    if (atmospherePreview(editor).active) void atmospherePreview(editor).show(draft);
  });
  const cc = h('select', {}, h('option', { value: '' }, 'None')) as HTMLSelectElement;
  void fetch('/api/list?folder=scripts/colorcorrection&ext=.raw').then((r) => r.json()).then((list: string[]) => {
    for (const f of [...list, ...['materials/correction/cc_thunder.raw', 'materials/correction/cc_star.raw']]) cc.append(h('option', { value: f }, f.split('/').pop()!));
    cc.value = draft.cc;
  });
  cc.addEventListener('change', () => { draft.cc = cc.value; cc.blur(); });
  return h('div', {},
    row('Fog colour', color),
    row('Fog start', num(draft.fogstart, 64, (v) => (draft.fogstart = v)), h('span.unit', {}, 'u')),
    row('Fog end', num(draft.fogend, 128, (v) => (draft.fogend = v)), h('span.unit', {}, 'u')),
    row('Blend time', num(draft.seconds, 0.5, (v) => (draft.seconds = v)), h('span.unit', {}, 's')),
    row('Colour table', cc),
    row('Strength', num(draft.ccWeight, 0.05, (v) => (draft.ccWeight = Math.min(1, v)))),
    h('div.row', {},
      h('button', { onclick: () => void atmospherePreview(editor).show(draft) }, '👁 Preview'),
      h('button', { onclick: () => void atmospherePreview(editor).show(null) }, 'Map look'),
      h('button.primary', { onclick: () => { buildAtmosphere(editor, draft, logicAnchor(editor.doc)); onBuilt?.(); } }, 'Save to map')));
}

/** Inspector sections for the selected cinematic entity (camera, path node, particle, screen, atmosphere). */
export function cinemaInspector(editor: Editor, ents: MapEntity[]): HTMLElement[] {
  if (ents.length !== 1) return [];
  const e = ents[0];
  if (e.classname === 'point_viewcontrol') return [shotSection(editor, e)];
  if (PATH_CLASSES.includes(e.classname)) return [pathSection(editor, e)];
  if (e.classname === 'info_particle_system') return [particleSection(editor, e)];
  if (e.classname === 'func_brush' && e.get('she_cine')?.startsWith('screen')) return [screenSection(e)];
  const atmo = atmosphereOf(e);
  if (atmo) return [h('div.section', {}, h('h3', {}, `🌫 Atmosphere: ${atmo.label}`), atmosphereEditor(editor, atmo),
    h('p.hint', {}, 'Fire ', h('b', {}, `${atmo.name} → Trigger`), ' to blend to it.'))];
  return [];
}

/** The Cinema tab: camera shots, paths, particles, screens and the atmosphere presets. */
export function mountCinemaPanel(editor: Editor): HTMLElement {
  const panel = h('div');
  const render = () => {
    const shots = cameraShots(editor.doc);
    const relays = atmosphereRelays(editor);
    const select = (e: MapEntity) => { editor.selection.set([], [e]); };
    const pathHeads = editor.doc.entities.filter((e) => e.classname === 'path_track' && e.get('she_cine'));
    const paths = [...new Map(pathHeads.map((e) => [e.get('she_cine')!, e])).values()];
    const particles = editor.doc.entities.filter((e) => e.classname === 'info_particle_system');
    panel.replaceChildren(
      h('div.section', {}, h('h3', {}, '🎬 Camera shots'),
        h('p.hint', {}, 'Frame the shot in the viewport, then add it: the camera goes where the editor camera is and looks at the middle of the screen. Give it an end position for a camera move.'),
        h('button.primary', { onclick: () => addShotFromView(editor) }, '+ Shot from current view'),
        ...shots.map((s) => h('div.sound-row', {},
          h('button', { title: 'Preview', onclick: () => playShot(editor, s.camera) }, '▶'),
          h('span', { onclick: () => select(s.camera) }, s.camera.get('targetname') ?? '(unnamed)', ' ', h('span.muted', {}, `${s.duration}s${s.route.length > 1 ? ' · move' : ''}`))))),
      h('div.section', {}, h('h3', {}, '🛤 Paths'),
        h('p.hint', {}, 'Routes for units (Order/QueueOrder) and flybys (a model on a func_tracktrain).'),
        h('button', { onclick: () => { editor.selection.clear(); setTool(editor, 'path'); } }, 'Draw a path (C)'),
        ...paths.map((p) => h('div.sound-row', {}, h('span', { onclick: () => select(p) }, p.get('she_cine')!, ' ', h('span.muted', {}, `${chainOf(editor.doc, p)?.nodes.length ?? 1} nodes`))))),
      h('div.section', {}, h('h3', {}, '✦ Particles'),
        h('button', { onclick: () => setTool(editor, 'particle') }, 'Place particles (C)'),
        ...particles.slice(0, 40).map((p) => h('div.sound-row', {}, h('span', { onclick: () => select(p) }, p.get('effect_name') ?? '?', ' ', h('span.muted', {}, p.get('targetname') ?? ''))))),
      h('div.section', {}, h('h3', {}, '📺 Screens'),
        h('button', { onclick: () => setTool(editor, 'screen') }, 'Place a screen (C)'),
        h('p.hint', {}, 'A picture panel and a static panel; Enable <name>_static switches to static.')),
      h('div.section', {}, h('h3', {}, '🌫 Atmosphere'),
        h('p.hint', {}, 'Presets the mission blends between: fog colour and distance (env_fog_controller lerp) and colour correction (fades in and out). Fire Trigger on a preset.'),
        ...relays.map((r) => {
          const p = atmosphereOf(r)!;
          return h('div.sound-row', {},
            h('button', { title: 'Preview', onclick: () => void atmospherePreview(editor).show(p) }, '👁'),
            h('span.cine-swatch', { style: { background: `rgb(${p.fogcolor.split(/\s+/).join(',')})` } }),
            h('span', { onclick: () => select(r) }, p.label, ' ', h('span.muted', {}, r.get('targetname') ?? '')));
        }),
        h('div.row', {}, h('span.muted', {}, 'Add: '), ...ATMOSPHERE_PRESETS.filter((p) => !relays.some((r) => r.get('targetname') === p.name)).map((p) =>
          h('button', { onclick: () => buildAtmosphere(editor, p, logicAnchor(editor.doc)) }, p.label))),
        atmospherePreview(editor).active ? h('button', { onclick: () => void atmospherePreview(editor).show(null) }, 'Back to the map look') : null,
        h('p.hint', {}, 'Not possible at runtime: the sun, ambient light and lightmaps are baked by vrad, and the deferred global light has no inputs. For fire glow use fire particles (named lights with switchable styles are untested here).')),
    );
  };
  for (const ev of ['document', 'change', 'atmosphere']) editor.on(ev, render);
  render();
  return panel;
}
