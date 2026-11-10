// Characterization test for free rotation (feature/free-rotation): POIs and blocks of buildings stored with a quarter
// turn (0, 90, 180, 270), or with no angle at all, still build and turn exactly as before. The hashes were taken on
// main before POIs and blocks could stand at any angle (UPDATE_GOLDEN=1 rewrites them).
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VmfDocument } from '../src/vmf/map.ts';
import { writeKeyValues } from '../src/vmf/keyvalues.ts';
import { buildPoi, POI_TYPES, poiOf, sharedParams } from '../src/gen/poi/registry.ts';
import { decodePoi } from '../src/gen/poi/spec.ts';
import { applyPoi, turnPoi } from '../src/gen/poi/action.ts';
import { decodeBlock } from '../src/gen/buildingStore.ts';
import { applyBlock, turnBlock } from '../src/gen/buildingAction.ts';
import '../src/gen/poi/catalogue.ts';
import { stubEditor } from './stubEditor.ts';

const FILE = new URL('./rotation.same-output.hashes.json', import.meta.url);
const UPDATE = !!process.env.UPDATE_GOLDEN;
const GOLDEN: Record<string, string> = UPDATE ? {} : JSON.parse(readFileSync(FILE, 'utf8'));
const sha1 = (text: string) => createHash('sha1').update(text).digest('hex');
const check = (key: string, text: string) => {
  if (UPDATE) GOLDEN[key] = sha1(text);
  else expect(sha1(text), key).toBe(GOLDEN[key]);
};

/** A stored POI of a type at its default size, as an old map has it (a fixed uid, so the build is repeatable). */
function stored(typeId: string, rotation: number, seed = 7): string {
  const t = POI_TYPES.find((p) => p.id === typeId)!;
  const [w, d] = rotation === 90 || rotation === 270 ? [t.defaultSize[1], t.defaultSize[0]] : t.defaultSize;
  return `${typeId}|abc123|${seed}|128 -64 ${128 + w} ${-64 + d}|${rotation}|16|${t.landscapes[0]}|`;
}

/** Everything buildPoi makes for a stored POI, written out. */
function poiText(raw: string): string {
  const t = POI_TYPES.find((p) => p.id === raw.split('|')[0])!;
  const spec = decodePoi(raw, t, sharedParams(t))!;
  const out = buildPoi(VmfDocument.empty(), spec, (x, y) => 16 + Math.round((x + y) / 64) % 9);
  return writeKeyValues([...out.world, ...out.detail]) + JSON.stringify(out.entities) + JSON.stringify([out.routes, out.terrain ?? null, out.waterLevel ?? null]);
}

/** Stored blocks as old maps have them (no angle), a ring with a cut, and a small row. */
const BLOCKS = {
  ring: 'blk001|grp001|flat|42|0 0 1536 1152|0|seed=3;minFloors=2;maxFloors=5;alleys=false;roofProps=true;architecture=mixed;detail=1',
  row: 'blk002|grp002|ground|9|-1152 64 -256 576|32|seed=17;minFloors=1;maxFloors=4;alleys=true;roofProps=false;architecture=village;detail=1',
};

describe('quarter-turn POIs build as before', () => {
  for (const t of POI_TYPES) {
    it(t.id, () => {
      check(`poi:${t.id}`, [0, 90, 180, 270].map((r) => poiText(stored(t.id, r))).join('\n'));
    });
  }

  it('applying, turning and decoding stored quarter turns', () => {
    for (const id of ['square', 'checkpoint', 'parking']) {
      const editor = stubEditor();
      const t = POI_TYPES.find((p) => p.id === id);
      if (!t) continue;
      const spec = decodePoi(stored(id, 90, 11), t, sharedParams(t))!;
      const detail = applyPoi(editor, spec, 'gen');
      const steps = [editor.doc.serialize()];
      turnPoi(editor, detail, 1);
      steps.push(editor.doc.serialize(), JSON.stringify(poiOf(detail)!.spec));
      turnPoi(editor, detail, -1);
      turnPoi(editor, detail, -1);
      steps.push(editor.doc.serialize(), JSON.stringify(poiOf(detail)!.spec));
      check(`apply:${id}`, steps.join('\n'));
    }
  });
});

describe('blocks of buildings without an angle build as before', () => {
  for (const [name, raw] of Object.entries(BLOCKS)) {
    it(name, () => {
      const editor = stubEditor();
      const spec = decodeBlock(raw)!;
      const { detail } = applyBlock(editor, spec, 'gen');
      const steps = [editor.doc.serialize()];
      turnBlock(editor, detail);
      steps.push(editor.doc.serialize());
      check(`block:${name}`, steps.join('\n'));
    });
  }
});

if (UPDATE) describe('golden', () => it('writes the hashes', () => writeFileSync(FILE, JSON.stringify(GOLDEN, null, 2) + '\n')));
