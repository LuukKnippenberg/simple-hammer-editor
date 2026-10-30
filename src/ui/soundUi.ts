import { audio } from '../audio/engine.ts';
import { loadSoundscapes } from '../audio/soundscapes.ts';
import type { SoundscapeController } from '../audio/listener.ts';
import { h } from './dom.ts';

let controller: SoundscapeController | null = null;
export function setSoundscapeController(c: SoundscapeController): void {
  controller = c;
}

/** A select of all the game's soundscapes, grouped by script file. */
export function soundscapeSelect(value: string, onChange: (v: string) => void): HTMLSelectElement {
  const sel = h('select', {}, h('option', { value }, value || '(none)')) as HTMLSelectElement;
  void loadSoundscapes().then((all) => {
    const groups = new Map<string, string[]>();
    for (const s of all.values()) {
      const g = s.file.replace(/^scripts\/soundscapes_?/, '').replace(/\.txt$/, '') || 'general';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push(s.name);
    }
    sel.replaceChildren(
      h('option', { value: '' }, '(none)'),
      ...[...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([g, names]) =>
        h('optgroup', { label: g }, ...names.sort().map((n) => h('option', { value: n }, n)))),
    );
    sel.value = [...all.values()].find((s) => s.name.toLowerCase() === value.toLowerCase())?.name ?? value;
  });
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}

/** Plays a soundscape for 15 seconds, over whatever the zones would play. Turns audio on if needed. */
export async function auditionSoundscape(name: string): Promise<void> {
  if (!name) return;
  if (!audio.enabled) await audio.setEnabled(true);
  if (controller) controller.audition = { name: name.toLowerCase(), until: performance.now() + 15000 };
  audio.playSoundscape(name);
  document.dispatchEvent(new Event('she-audio'));
}
