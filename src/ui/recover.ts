import type { Editor } from '../editor.ts';
import type { TopBar } from './viewBar.ts';
import { h, toast } from './dom.ts';
import { apiPost } from '../api.ts';
import { getPref, setPref } from './prefs.ts';

/**
 * Recover: when a map has an autosave newer than its saved file, the start screen shows a banner and opening the
 * map shows a card, offering the work back. Recover opens the autosave under the map's name, Open saved version
 * keeps the file, Keep both saves the autosave next to it as <name>_recovered.vmf. Saves go to maps/ as always.
 */

export interface MapRef {
  id: string;
  name: string;
  mtime: number;
}

/** An autosave newer than its map's saved file (`saved` is null for a map that was never saved). From /api/recent. */
export interface RecoverOffer {
  name: string;
  autosave: MapRef;
  saved: MapRef | null;
}

/** Offers not yet turned down; turning one down holds until a newer autosave is made. */
export function pendingOffers(offers: RecoverOffer[], dismissed: Record<string, number> = {}): RecoverOffer[] {
  return offers.filter((o) => !(dismissed[o.autosave.name] >= o.autosave.mtime));
}

export function dismissOffer(offer: RecoverOffer): void {
  setPref('recoverDismissed', { ...getPref('recoverDismissed'), [offer.autosave.name]: offer.autosave.mtime });
}

/** `sp_sofia.vmf` + `copy` → `sp_sofia_copy.vmf`, or `sp_sofia_copy_2.vmf` when that is taken (case-insensitive). */
export function freeName(name: string, suffix: string, taken: string[]): string {
  const base = name.replace(/\.vmf$/i, '');
  const used = new Set(taken.map((t) => t.toLowerCase()));
  for (let i = 1; ; i++) {
    const candidate = `${base}_${suffix}${i > 1 ? `_${i}` : ''}.vmf`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

const pad = (n: number) => String(n).padStart(2, '0');
const clock = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const DAY = 24 * 60 * 60 * 1000;
/** Whole calendar days between two times (local time). */
const daysApart = (t: number, now: number) => {
  const a = new Date(t), b = new Date(now);
  return Math.round((new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime() - new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime()) / DAY);
};

/**
 * A moment for a sentence: "today 14:02", "yesterday 18:42", "Tuesday 14:02" (this week), else "7 Nov 14:02".
 * With `sameDayAs`, a time on that same day is just "18:42".
 */
export function stamp(t: number, now: number, sameDayAs?: number): string {
  const d = new Date(t);
  if (sameDayAs !== undefined && daysApart(t, sameDayAs) === 0) return clock(d);
  const days = daysApart(t, now);
  if (days === 0) return `today ${clock(d)}`;
  if (days === 1) return `yesterday ${clock(d)}`;
  if (days > 1 && days < 7) return `${d.toLocaleDateString('en-GB', { weekday: 'long' })} ${clock(d)}`;
  const year = d.getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric';
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year })} ${clock(d)}`;
}

export interface Recover {
  /** Opens the autosave as the map, unsaved. */
  recover(offer: RecoverOffer): Promise<void>;
  /** Keeps the saved file: opens it unless it is open already. */
  openSaved(offer: RecoverOffer): Promise<void>;
  /** Saves the autosave as <name>_recovered.vmf in maps/ and opens that. */
  keepBoth(offer: RecoverOffer): Promise<void>;
  /** The "Unsaved work found" card; resolves once a button was used or it was closed. */
  showCard(offer: RecoverOffer): Promise<void>;
  /** Runs a load that must not ask about pending work (an example copy, the actions above). */
  quietly<T>(fn: () => Promise<T>): Promise<T>;
}

/**
 * The recover actions, opening maps through the top bar (loading overlay, page address). Also shows the card when
 * a map with pending work is opened directly (from the address, the map picker or Recent); autosave files opened
 * as such don't ask.
 */
export function mountRecover(editor: Editor, topBar: TopBar): Recover {
  let quiet = 0;
  const quietly = async <T>(fn: () => Promise<T>): Promise<T> => {
    quiet++;
    try { return await fn(); } finally { quiet--; }
  };
  const setAddress = (id: string | null) => {
    const url = new URL(location.href);
    if (id) url.searchParams.set('map', id);
    else url.searchParams.delete('map');
    history.replaceState(null, '', url);
  };
  const self: Recover = {
    recover: (offer) => quietly(async () => {
      setAddress(offer.saved?.id ?? null);
      await topBar.busy(`Recovering ${offer.name}…`, async () => {
        await editor.loadMapById(offer.autosave.id, offer.name, offer.saved?.id ?? offer.autosave.id);
        // The work is back but not saved yet: the title shows it, autosave keeps going, Ctrl+S writes maps/.
        editor.dirty = true;
        editor.emit('change');
      });
      toast(editor.container, `Recovered ${offer.name} from the autosave. Save to keep it (Ctrl+S).`, 5000);
    }),
    openSaved: (offer) => quietly(async () => {
      dismissOffer(offer);
      if (offer.saved && editor.mapName.toLowerCase() !== offer.name.toLowerCase()) await topBar.openMap(offer.saved.id);
    }),
    keepBoth: (offer) => quietly(async () => {
      const maps: { id: string; name: string }[] = await fetch('/api/maps').then((r) => r.json());
      const name = freeName(offer.name, 'recovered', maps.filter((m) => m.id.startsWith('repo:')).map((m) => m.name));
      const text = await fetch(`/api/map?id=${encodeURIComponent(offer.autosave.id)}`).then((r) => r.text());
      const r = await apiPost(`/api/map/save?name=${encodeURIComponent(name)}`, text);
      if (!r.ok) return toast(editor.container, `Could not save ${name}: ${(await r.json().catch(() => ({ error: r.statusText }))).error}`);
      dismissOffer(offer);
      await topBar.openMap(`repo:${name}`);
      toast(editor.container, `Saved the autosave as maps/${name}.${offer.saved ? ` ${offer.name} stays as it was.` : ''}`, 5000);
    }),
    showCard: (offer) => showRecoverCard(offer, self),
    quietly,
  };
  editor.on('document', () => {
    const name = editor.mapName;
    if (quiet || name.toLowerCase().endsWith(AUTOSAVE_SUFFIX)) return;
    void fetch('/api/recent?limit=1').then((r) => r.json()).then(({ offers }: { offers: RecoverOffer[] }) => {
      const offer = pendingOffers(offers, getPref('recoverDismissed')).find((o) => o.saved && o.name.toLowerCase() === name.toLowerCase());
      if (offer && editor.mapName === name) void self.showCard(offer);
    });
  });
  return self;
}

const AUTOSAVE_SUFFIX = '.autosave.vmf';

/** "An autosave from 18:42" sentence for the card, and whether the map was saved before. */
function cardSentence(offer: RecoverOffer, changes: number | null): HTMLElement {
  const now = Date.now();
  const saved = offer.saved
    ? ` was last saved ${stamp(offer.saved.mtime, now)}. An autosave from ${stamp(offer.autosave.mtime, now, offer.saved.mtime)}`
    : ` was never saved. An autosave from ${stamp(offer.autosave.mtime, now)}`;
  const count = changes === null ? ' has unsaved changes.' : ` has ${changes} ${offer.saved ? 'more ' : ''}change${changes === 1 ? '' : 's'}.`;
  return h('p', {}, h('span.mono', {}, offer.name), saved + count);
}

function showRecoverCard(offer: RecoverOffer, actions: Recover): Promise<void> {
  return new Promise((resolve) => {
    const backdrop = h('div.modal-backdrop.recover-backdrop');
    const sentence = h('div', {}, cardSentence(offer, null));
    const summary = h('div.recover-summary', { hidden: true });
    const close = () => {
      backdrop.remove();
      window.removeEventListener('keydown', onKey, true);
      resolve();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close();
    };
    const act = (fn: () => Promise<void>) => async () => {
      close();
      await fn();
    };
    const keepName = `${offer.name.replace(/\.vmf$/i, '')}_recovered.vmf`;
    backdrop.append(h('div.recover-card', { role: 'dialog', 'aria-label': 'Unsaved work found' },
      h('b.caps', {}, 'Unsaved work found'),
      sentence,
      summary,
      h('div.recover-actions',
        {},
        h('button.primary', { onclick: act(() => actions.recover(offer)) }, 'Recover'),
        offer.saved && h('button', { onclick: act(() => actions.openSaved(offer)) }, 'Open saved version'),
        h('button', { onclick: act(() => actions.keepBoth(offer)) }, 'Keep both'),
      ),
      h('p.hint', {}, h('b', {}, 'Keep both'), ' saves the autosave as ', h('span.mono', {}, keepName), '. Saving never overwrites the game’s own mapsrc/.'),
    ));
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
    window.addEventListener('keydown', onKey, true);
    document.body.append(backdrop);

    const query = new URLSearchParams({ autosave: offer.autosave.id, ...(offer.saved ? { saved: offer.saved.id } : {}) });
    void fetch(`/api/recover?${query}`).then((r) => (r.ok ? r.json() : null)).then((d: { total: number; summary: string } | null) => {
      if (!d) return;
      sentence.replaceChildren(cardSentence(offer, d.total));
      summary.textContent = d.summary;
      summary.hidden = !d.summary;
    }).catch(() => { /* the card works without the summary */ });
  });
}
