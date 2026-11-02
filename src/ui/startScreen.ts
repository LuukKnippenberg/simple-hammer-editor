import type { Editor } from '../editor.ts';
import type { TopBar } from './viewBar.ts';
import { h, toast } from './dom.ts';
import { apiPost } from '../api.ts';
import { getPref } from './prefs.ts';
import { dismissOffer, freeName, pendingOffers, stamp, type Recover, type RecoverOffer } from './recover.ts';
import { fetchInstalls, switchInstall } from './installPicker.ts';

/**
 * The start screen: shown when the editor opens without a map in the address, and from the top bar's Open….
 * Left: make a map (New map, Open… from disk, examples). Middle: recover banners and Recent maps. Right: the setup
 * check (game install, map compiler, navmesh builder), run each time the screen opens.
 */

interface MapInfo {
  id: string;
  name: string;
  mtime: number;
  dir: string;
  mode: string;
  thumb: { w: number; h: number; cells: number[] };
}

interface SetupRow {
  id: 'install' | 'compiler' | 'navmesh';
  ok: boolean;
  detail: string;
  dir: string | null;
}

/** Example maps: they open as a copy, so the original stays as it is. */
const EXAMPLES = [
  { id: 'repo:sp_sofia.vmf', title: 'Sofia', text: 'Mission in an old town' },
  { id: 'repo:sp_garden_district.vmf', title: 'Garden District', text: 'Combine mission, 10 stages' },
];

const SETUP_NAMES: Record<SetupRow['id'], string> = { install: 'Game install', compiler: 'Map compiler', navmesh: 'Navmesh builder' };

/** Help for a missing piece: what it is for and where to get it. */
const MISSING_HELP: Record<SetupRow['id'], { title: string; text: string }> = {
  compiler: {
    title: 'Map compiler not found',
    text: 'The compiler (vbsp, vvis, vrad) comes with the free Alien Swarm SDK: Steam › Library › Tools › Alien Swarm SDK › Install. You can still build and save maps; only Compile & test needs it.',
  },
  install: {
    title: 'Game install not found',
    text: 'Textures, models and the entity list come from Lambda Wars (free on Steam). Install it, or pick another copy with Change game…. You can still build and save maps.',
  },
  navmesh: {
    title: 'Navmesh builder not found',
    text: 'srcds.exe comes with the game install and builds the walkable areas after a compile. Without it the map still compiles and runs, but units can’t move on it.',
  },
};

/** Recent maps' "when": "today 14:02", "yesterday 18:42", "3 days ago", "last week", "5 weeks ago", "7 Nov 2025". */
export function whenText(t: number, now: number): string {
  const sentence = stamp(t, now);
  if (sentence.startsWith('today') || sentence.startsWith('yesterday')) return sentence;
  const days = Math.floor((now - t) / (24 * 60 * 60 * 1000));
  if (days < 7) return `${Math.max(2, days)} days ago`;
  if (days < 14) return 'last week';
  if (days < 7 * 8) return `${Math.floor(days / 7)} weeks ago`;
  return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Where a map lives, as the user knows it: maps/x.vmf (the editor's) or mapsrc/x.vmf (the game's). */
function mapPath(m: { id: string; name: string }): string {
  return `${m.id.startsWith('repo:') ? 'maps' : 'mapsrc'}/${m.name}`;
}

const MODE_CLASS: [RegExp, string][] = [[/^Mission/, 'mission'], [/^Annihilation/, 'annihilation'], [/^Overrun/, 'overrun']];

function modeChip(mode: string): HTMLElement {
  const kind = MODE_CLASS.find(([re]) => re.test(mode))?.[1] ?? 'none';
  return h(`span.mode-chip.${kind}` as 'span', {}, mode);
}

/** Low ground dark, high ground light, in the map's own range. */
const THUMB_LOW = [61, 65, 68], THUMB_HIGH = [200, 184, 154], THUMB_EMPTY = [15, 17, 18];

/** The height thumbnail from /api/recent drawn on a canvas (CSS scales it up). */
function thumbCanvas(thumb: MapInfo['thumb'] | undefined, cls: string): HTMLCanvasElement {
  const canvas = h(`canvas.${cls}` as 'canvas', { width: thumb?.w ?? 1, height: thumb?.h ?? 1 });
  const ctx = canvas.getContext('2d');
  if (!thumb || !ctx) return canvas;
  const img = ctx.createImageData(thumb.w, thumb.h);
  thumb.cells.forEach((v, i) => {
    const rgb = v < 0 ? THUMB_EMPTY : THUMB_LOW.map((lo, c) => Math.round(lo + ((THUMB_HIGH[c] - lo) * v) / 255));
    img.data.set([...rgb, 255], i * 4);
  });
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** "New here? Take the 5-minute tour →". The tour comes in a later update; this placeholder says so. */
export function startTour(): void {
  toast(document.querySelector<HTMLElement>('.start-screen') ?? document.body, 'The tour isn’t built yet.');
}

export interface StartScreen {
  show(): void;
  hide(): void;
}

export function mountStartScreen(editor: Editor, topBar: TopBar, recover: Recover): StartScreen {
  const screen = h('div.start-screen', { hidden: true, role: 'dialog', 'aria-label': 'Start screen' });
  document.body.append(screen);
  let mapOpen = false;
  editor.on('document', () => {
    mapOpen = true;
    hide();
  });

  const examples = h('div.start-examples');
  const banners = h('div.start-banners');
  const recent = h('div.start-recent');
  const setupRows = h('div.setup-rows');
  const missing = h('div.setup-missing');
  const back = h('button.start-back', { onclick: () => hide(), hidden: true });

  /** Opens a map from the screen; the screen comes back when the load fails. */
  const open = async (load: () => Promise<void>) => {
    hide();
    await load();
    if (!mapOpen) show();
  };
  const openExample = (m: MapInfo) => open(() => recover.quietly(async () => {
    const maps: { id: string; name: string }[] = await fetch('/api/maps').then((r) => r.json());
    const copy = freeName(m.name, 'copy', maps.filter((x) => x.id.startsWith('repo:')).map((x) => x.name));
    const url = new URL(location.href);
    url.searchParams.delete('map');
    history.replaceState(null, '', url);
    await topBar.busy(`Opening a copy of ${m.name}…`, () => editor.loadMapById(m.id, copy));
    toast(editor.container, `Opened ${m.name} as ${copy}; the example stays as it was.`, 4000);
  }));

  const sectionHead = (title: string, note: string) => h('div.start-head', {}, h('h3', {}, title), h('span', {}, note));

  const renderMaps = (data: { recent: MapInfo[]; include: MapInfo[]; offers: RecoverOffer[] }) => {
    examples.replaceChildren(...EXAMPLES.flatMap((ex) => {
      const m = data.include.find((x) => x.id === ex.id);
      return m ? [h('button.start-example', { onclick: () => void openExample(m), title: `Open a copy of ${mapPath(m)}` },
        thumbCanvas(m.thumb, 'example-thumb'), h('b', {}, ex.title), h('span', {}, ex.text))] : [];
    }));
    examples.hidden = !examples.children.length;

    const now = Date.now();
    const offers = pendingOffers(data.offers, getPref('recoverDismissed')).slice(0, 3);
    banners.replaceChildren(...offers.map((o) => h('div.recover-banner', {},
      h('span.dot'),
      h('span.text', {}, h('b', {}, o.name.replace(/\.vmf$/i, '')), ` has unsaved work from ${stamp(o.autosave.mtime, now)}.`),
      h('button', { onclick: () => void recover.showCard(o).then(refresh), title: 'What the autosave changes, and the ways to keep it' }, 'Compare'),
      h('button', { onclick: () => { dismissOffer(o); void refresh(); }, title: 'Keep the saved file; the autosave stays under Autosaves in the map picker' }, 'Discard'),
      h('button.primary', { onclick: () => void open(() => recover.recover(o)) }, 'Recover'),
    )));

    recent.replaceChildren(...(data.recent.length ? data.recent.map((m) => h('div.recent-row', { onclick: () => void open(() => topBar.openMap(m.id)), title: `${m.dir}\\${m.name}` },
      thumbCanvas(m.thumb, 'recent-thumb'),
      h('span.recent-text', {},
        h('span.recent-title', {}, h('b', {}, m.name.replace(/\.vmf$/i, '')), modeChip(m.mode)),
        h('span.recent-path', {}, `${mapPath(m)} · ${whenText(m.mtime, now)}`)),
      h('button', {}, 'Open'),
    )) : [h('p.hint', {}, 'No maps yet. Start with + New map or open an example.')]));
  };

  const changeGame = async (anchor: HTMLElement) => {
    screen.querySelector('.install-menu')?.remove();
    const { installs, install } = await fetchInstalls();
    if (!installs.length) return toast(screen, 'No Lambda Wars install found. Install it from Steam, then Check again.', 5000);
    const menu = h('div.install-menu', {}, ...installs.map((i) => h(`button${i.dir === install ? '.active' : ''}` as 'button', {
      title: i.dir,
      onclick: () => { menu.remove(); if (i.dir !== install) void switchInstall(editor, i.dir); },
    }, i.name)));
    (anchor.closest('.start-buttons') ?? anchor).after(menu);
  };
  const locateCompiler = async () => {
    const dir = prompt('Folder with vbsp.exe, vvis.exe and vrad.exe (Alien Swarm SDK, its bin folder):', 'C:/Program Files (x86)/Steam/steamapps/common/Alien Swarm/bin');
    if (!dir) return;
    const r = await apiPost('/api/setup/sdk', JSON.stringify({ dir }));
    const body = await r.json().catch(() => ({ error: r.statusText }));
    if (!r.ok) return toast(screen, body.error, 5000);
    renderSetup(body);
  };

  const renderSetup = (rows: SetupRow[] | null) => {
    if (!rows) {
      setupRows.replaceChildren(...(['install', 'compiler', 'navmesh'] as const).map((id) => setupRow(id, null, 'Checking…')));
      return;
    }
    setupRows.replaceChildren(...rows.map((r) => setupRow(r.id, r.ok, r.detail, r.dir)));
    missing.replaceChildren(...rows.filter((r) => !r.ok).map((r) => h('div.setup-card', {},
      h('div.caps.setup-card-head', {}, 'When something is missing'),
      setupRow(r.id, false, MISSING_HELP[r.id].text, null, MISSING_HELP[r.id].title),
      h('div.start-buttons', {},
        r.id === 'compiler' && h('button', { onclick: () => void locateCompiler() }, 'Locate folder…'),
        r.id === 'install' && h('button', { onclick: (e: Event) => void changeGame(e.currentTarget as HTMLElement) }, 'Change game…'),
        h('button.primary', { onclick: () => void checkSetup() }, 'Check again')),
    )));
  };
  const setupRow = (id: SetupRow['id'], ok: boolean | null, detail: string, dir: string | null = null, title = SETUP_NAMES[id]) =>
    h(`div.setup-row${ok === null ? '' : ok ? '.ok' : '.bad'}` as 'div', { 'data-setup': id, title: dir ?? undefined },
      h('b.setup-icon', {}, ok === null ? '…' : ok ? '✓' : '✕'),
      h('span', {}, h('b', {}, title), h('span.setup-detail', {}, detail)));

  const checkSetup = async () => {
    renderSetup(null);
    renderSetup(await fetch('/api/setup').then((r) => r.json()).catch(() => null));
  };
  const refresh = async () => {
    const include = EXAMPLES.map((e) => e.id).join(',');
    renderMaps(await fetch(`/api/recent?include=${encodeURIComponent(include)}`).then((r) => r.json()));
  };

  const changeGameButton = h('button', { onclick: () => void changeGame(changeGameButton) }, 'Change game…');
  screen.append(
    h('section.start-make', {},
      h('div.start-brand', {}, h('img', { src: '/lambdawars-wordmark.png', alt: 'Lambda Wars', width: 224, height: 40 }), h('span.caps', {}, 'Map editor')),
      h('div', {},
        h('h1', {}, 'Make a map'),
        h('p.start-lead', {}, 'Start from a game mode and the editor lays out the basics: player starts, resources, sky, sun and the map boundary.')),
      h('div.start-buttons.big', {},
        h('button.primary', { onclick: () => topBar.newMap() }, '+ New map'),
        h('button', { onclick: () => topBar.openFile(), title: 'Open a .vmf from disk' }, 'Open…')),
      h('div', {}, sectionHead('Examples', 'open a copy, look around, change anything'), examples),
      h('a.start-tour', { href: '#', onclick: (e: Event) => { e.preventDefault(); startTour(); } }, 'New here? Take the 5-minute tour →'),
    ),
    h('section.start-maps', {}, banners, sectionHead('Recent', 'maps/ and the game’s mapsrc/'), recent),
    h('section.start-setup', {},
      h('div.setup-panel', {},
        sectionHead('Setup', 'checked on every start'),
        setupRows,
        h('div.start-buttons', {}, changeGameButton, h('button', { onclick: () => void checkSetup() }, 'Check again'))),
      missing),
    back,
  );

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && mapOpen && !document.querySelector('.modal-backdrop:not([hidden])')) hide();
  };
  function show(): void {
    back.hidden = !mapOpen;
    back.textContent = `Back to ${editor.mapName.replace(/\.vmf$/i, '')} ✕`;
    screen.hidden = false;
    window.addEventListener('keydown', onKey);
    void refresh();
    void checkSetup();
  }
  function hide(): void {
    screen.hidden = true;
    screen.querySelector('.install-menu')?.remove();
    window.removeEventListener('keydown', onKey);
  }
  return { show, hide };
}
