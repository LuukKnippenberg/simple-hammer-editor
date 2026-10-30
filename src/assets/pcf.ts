/**
 * Particle system names from the game's PCF files (binary DMX) and the manifest that lists them.
 * Only the element table is read: every `DmeParticleSystemDefinition` element is one effect name that
 * `info_particle_system`'s `effect_name` can use.
 */

/** Effect names defined in a binary DMX particle file (encodings 2 to 5). */
export function pcfSystemNames(buf: ArrayBuffer): string[] {
  const bytes = new Uint8Array(buf);
  const view = new DataView(buf);
  let p = 0;
  const cstr = () => {
    const start = p;
    while (p < bytes.length && bytes[p] !== 0) p++;
    const s = new TextDecoder('latin1').decode(bytes.subarray(start, p));
    p++;
    return s;
  };
  const header = cstr();
  const m = /dmx encoding binary (\d+)/.exec(header);
  if (!m) return [];
  const version = Number(m[1]);
  if (version < 2 || version > 5) return [];
  const int = () => { const v = view.getInt32(p, true); p += 4; return v; };
  const short = () => { const v = view.getInt16(p, true); p += 2; return v; };
  // The string table: a short count before encoding 4, an int after.
  const count = version >= 4 ? int() : short();
  const strings: string[] = [];
  for (let i = 0; i < count && p < bytes.length; i++) strings.push(cstr());
  const elements = int();
  const names: string[] = [];
  for (let i = 0; i < elements && p < bytes.length; i++) {
    const type = strings[version >= 5 ? int() : short()];
    const name = version >= 4 ? strings[version >= 5 ? int() : short()] : cstr();
    p += 16; // GUID
    if (type === 'DmeParticleSystemDefinition' && name) names.push(name);
  }
  return names;
}

/** PCF paths listed in particles_manifest.txt (a leading `!` only marks preloading). */
export function manifestFiles(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const code = line.replace(/\/\/.*$/, '');
    const m = /"file"\s+"!?([^"]+)"/i.exec(code);
    if (m) out.push(m[1].replace(/\\/g, '/').toLowerCase());
  }
  return out;
}
