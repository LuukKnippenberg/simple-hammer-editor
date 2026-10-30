import { audio } from '../audio/engine.ts';
import { wavLoops } from '../audio/localSounds.ts';
import { h } from './dom.ts';

let list: Promise<string[]> | null = null;
/** All game sounds (sound/**.wav and .mp3), as paths relative to sound/. */
export function soundList(): Promise<string[]> {
  list ??= Promise.all(['.wav', '.mp3'].map((ext) => fetch(`/api/list?folder=sound&ext=${ext}`).then((r) => (r.ok ? r.json() : []))))
    .then(([a, b]: string[][]) => [...a, ...b].map((p) => p.slice(6)).sort());
  return list;
}

/**
 * A searchable list of game sounds: type words to filter (all must match), ▶ plays one, clicking a name
 * picks it. Shows whether the picked sound loops (it has loop points, so the game repeats it).
 */
export function soundBrowser(value: string, onPick: (path: string) => void): HTMLElement {
  const search = h('input', { type: 'search', placeholder: 'Search 3,900 sounds: fire loop, drip, spark…' }) as HTMLInputElement;
  const results = h('div.sound-list');
  const current = h('div.sound-current');
  const showCurrent = (v: string) => {
    current.replaceChildren(h('span.muted', {}, 'Sound '), h('b', {}, v || '(none)'));
    if (v) void wavLoops(`sound/${v}`).then((loop) => current.append(h('span.badge', { title: loop ? 'Has loop points: plays continuously' : 'Plays once (at map start, or when triggered)' }, loop ? 'loops' : 'once')));
  };
  showCurrent(value);
  const render = async () => {
    const all = await soundList();
    const words = search.value.toLowerCase().split(/\s+/).filter(Boolean);
    const hits = words.length ? all.filter((p) => words.every((w) => p.includes(w))) : all.filter((p) => p.startsWith('ambient/'));
    results.replaceChildren(...hits.slice(0, 120).map((p) => h('div.sound-row', {},
      h('button', { title: 'Play', onclick: () => void audio.preview(`sound/${p}`) }, '▶'),
      h('span', { title: p, onclick: () => { onPick(p); showCurrent(p); } }, p))));
    if (hits.length > 120) results.append(h('div.hint', {}, `${hits.length - 120} more: refine the search`));
    if (!hits.length) results.append(h('div.hint', {}, 'No sounds match.'));
  };
  let t = 0;
  search.addEventListener('input', () => { clearTimeout(t); t = window.setTimeout(() => void render(), 120); });
  void render();
  return h('div.sound-browser', {}, current, search, results);
}
