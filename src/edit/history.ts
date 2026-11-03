import { KVNode, KVPair } from '../vmf/keyvalues.ts';
import type { MapEntity, MapSolid, VmfDocument } from '../vmf/map.ts';

type Items = (KVPair | KVNode)[];
const cloneItems = (n: KVNode): Items => n.clone().items;
const cloneList = (items: Items): Items => items.map((it) => (it instanceof KVNode ? it.clone() : new KVPair(it.key, it.value)));

interface Op {
  label: string;
  /** When the step was recorded (ms since the epoch). */
  time: number;
  undo(): void;
  redo(): void;
}

/** One undo step as the History panel lists it. */
export interface HistoryStep {
  label: string;
  time: number;
}

const MAX_STEPS = 200;

/**
 * Undo/redo. Modifications snapshot the affected nodes' items before and after; creation and deletion
 * keep the original wrapper objects so selection and renderers see the same identities after undo.
 */
export class History {
  private undoStack: Op[] = [];
  private redoStack: Op[] = [];
  onChange: () => void = () => {};
  /** The clock steps are stamped with (tests replace it). */
  now: () => number = Date.now;
  /** When the history was last cleared: the time of the state before the first step. */
  openedAt = this.now();
  private doc: () => VmfDocument;

  constructor(doc: () => VmfDocument) {
    this.doc = doc;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.openedAt = this.now();
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  get undoLabel(): string | null {
    return this.undoStack[this.undoStack.length - 1]?.label ?? null;
  }

  /** Every step, oldest first: the applied ones, then the undone ones that can still be redone. */
  get steps(): HistoryStep[] {
    return [...this.undoStack, ...[...this.redoStack].reverse()].map(({ label, time }) => ({ label, time }));
  }

  /** How many of `steps` are applied; 0 is the state the history started from. */
  get position(): number {
    return this.undoStack.length;
  }

  /** Undoes or redoes one step at a time until `position` steps are applied. Returns how many steps it moved. */
  jumpTo(position: number): number {
    const target = Math.max(0, Math.min(this.steps.length, position));
    let moved = 0;
    while (this.undoStack.length > target && this.stepBack()) moved++;
    while (this.undoStack.length < target && this.stepForward()) moved++;
    if (moved) this.onChange();
    return moved;
  }

  private collecting: Op[] | null = null;

  /** Runs `fn` and records everything it does as a single undo step. */
  group(label: string, fn: () => void): void {
    const outer = this.collecting;
    const ops: Op[] = [];
    this.collecting = ops;
    try {
      fn();
    } finally {
      this.collecting = outer;
    }
    if (!ops.length) return;
    this.push(composite(label, ops));
    this.onChange();
  }

  /** How many steps can be undone: a mark for `squash`. */
  get depth(): number {
    return this.undoStack.length;
  }

  /** Merges the steps recorded since `depth` into one undo step (a generate and every tweak after it). */
  squash(depth: number, label: string): void {
    if (this.collecting || this.undoStack.length - depth < 2) return;
    const ops = this.undoStack.splice(depth);
    this.undoStack.push({ ...composite(label, ops), time: this.now() });
    this.onChange();
  }

  private push(untimed: Omit<Op, 'time'>): void {
    const op = { ...untimed, time: this.now() };
    if (this.collecting) {
      this.collecting.push(op);
      return;
    }
    this.undoStack.push(op);
    if (this.undoStack.length > MAX_STEPS) this.undoStack.shift();
    this.redoStack = [];
  }

  /** Starts a modification of existing objects; call the returned function once the change is done. */
  begin(label: string, solids: MapSolid[], entities: MapEntity[] = []): () => void {
    const before = {
      solids: solids.map((s) => cloneItems(s.node)),
      entities: entities.map((e) => cloneItems(e.node)),
    };
    return () => {
      const after = {
        solids: solids.map((s) => cloneItems(s.node)),
        entities: entities.map((e) => cloneItems(e.node)),
      };
      const apply = (state: typeof before) => {
        solids.forEach((s, i) => { s.node.items = cloneList(state.solids[i]); s.reload(); });
        entities.forEach((e, i) => { e.node.items = cloneList(state.entities[i]); e.reload(); });
      };
      this.push({ label, undo: () => apply(before), redo: () => apply(after) });
      this.onChange();
    };
  }

  /** Records objects that were just added to the document. */
  added(label: string, solids: MapSolid[], entities: MapEntity[] = []): void {
    const places = solids.map((s) => ({ owner: s.entity, index: -1 }));
    const entIdx: number[] = entities.map(() => -1);
    this.push({
      label,
      undo: () => {
        const doc = this.doc();
        solids.forEach((s, i) => { if (!entities.includes(s.entity!)) places[i] = doc.removeSolid(s); });
        entities.forEach((e, i) => (entIdx[i] = doc.removeEntity(e)));
      },
      redo: () => {
        const doc = this.doc();
        for (let i = entities.length - 1; i >= 0; i--) doc.restoreEntity(entities[i], entIdx[i]);
        for (let i = solids.length - 1; i >= 0; i--) if (!entities.includes(solids[i].entity!)) doc.restoreSolid(solids[i], places[i].owner, places[i].index);
      },
    });
    this.onChange();
  }

  /** Removes objects and records how to put them back. */
  remove(label: string, solids: MapSolid[], entities: MapEntity[] = []): void {
    const doc = this.doc();
    // Brushes of entities being deleted go with their entity.
    const loose = solids.filter((s) => !s.entity || !entities.includes(s.entity));
    const places = loose.map((s) => doc.removeSolid(s));
    const entIdx = entities.map((e) => doc.removeEntity(e));
    this.push({
      label,
      undo: () => {
        for (let i = entities.length - 1; i >= 0; i--) doc.restoreEntity(entities[i], entIdx[i]);
        for (let i = loose.length - 1; i >= 0; i--) doc.restoreSolid(loose[i], places[i].owner, places[i].index);
      },
      redo: () => {
        loose.forEach((s, i) => (places[i] = doc.removeSolid(s)));
        entities.forEach((e, i) => (entIdx[i] = doc.removeEntity(e)));
      },
    });
    this.onChange();
  }

  /**
   * Records a change outside the document (a blend file renamed or deleted) that has already been made, with how
   * to take it back and make it again. Inside `group` it joins that step.
   */
  effect(label: string, undo: () => void, redo: () => void): void {
    this.push({ label, undo, redo });
    if (!this.collecting) this.onChange();
  }

  undo(): string | null {
    const op = this.stepBack();
    if (op) this.onChange();
    return op?.label ?? null;
  }

  redo(): string | null {
    const op = this.stepForward();
    if (op) this.onChange();
    return op?.label ?? null;
  }

  private stepBack(): Op | undefined {
    const op = this.undoStack.pop();
    if (!op) return undefined;
    op.undo();
    this.redoStack.push(op);
    return op;
  }

  private stepForward(): Op | undefined {
    const op = this.redoStack.pop();
    if (!op) return undefined;
    op.redo();
    this.undoStack.push(op);
    return op;
  }
}

/** One step made of several recorded ones: undone in reverse order, redone in order. */
function composite(label: string, ops: Op[]): Omit<Op, 'time'> {
  return {
    label,
    undo: () => { for (let i = ops.length - 1; i >= 0; i--) ops[i].undo(); },
    redo: () => { for (const op of ops) op.redo(); },
  };
}
