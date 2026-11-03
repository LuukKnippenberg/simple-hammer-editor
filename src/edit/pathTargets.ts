import type { Editor } from '../editor.ts';
import type { PathTarget } from './pathPins.ts';
import { selectedStairsTarget } from './stairsPath.ts';
import { selectedRoadTarget } from './roadPath.ts';
import { selectedPowerlineTarget } from './powerlinePath.ts';

/**
 * Which object the Select tool's pins edit: one finder per generator, in its own file; the first that knows the
 * selection wins. A generator joins by adding its finder here (and nowhere else in the Select tool).
 */
export type PathTargetFinder = (editor: Editor) => PathTarget | null;

const FINDERS: PathTargetFinder[] = [selectedStairsTarget, selectedRoadTarget, selectedPowerlineTarget];

/** The path the selection stands for, if it is one object a generator drew from points. */
export function selectedPathTarget(editor: Editor): PathTarget | null {
  for (const find of FINDERS) {
    const target = find(editor);
    if (target) return target;
  }
  return null;
}
