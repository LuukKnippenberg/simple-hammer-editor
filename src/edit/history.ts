import { KVNode, KVPair } from '../vmf/keyvalues.ts';
import type { MapEntity, MapSolid, VmfDocument } from '../vmf/map.ts';

type Items = (KVPair | KVNode)[];
const cloneItems = (n: KVNode): Items => n.clone().items;
const cloneList = (items: Items): Items => items.map((it) => (it instanceof KVNode ? it.clone() : new KVPair(it.key, it.value)));

interface Op {
  label: string;
  undo(): void;
  redo(): void;
}

/**
 * Undo/redo. Modifications snapshot the affected nodes' items before and after; creation and deletion
 * keep the original wrapper objects so selection and renderers see the same identities after undo.
 */
export class History {
  private undoStack: Op[] = [];
  private redoStack: Op[] = [];
  onChange: () => void = () => {};
  private doc: () => VmfDocument;

  constructor(doc: () => VmfDocument) {
    this.doc = doc;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
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
    this.push({
      label,
      undo: () => { for (let i = ops.length - 1; i >= 0; i--) ops[i].undo(); },
      redo: () => { for (const op of ops) op.redo(); },
    });
    this.onChange();
  }

  private push(op: Op): void {
    if (this.collecting) {
      this.collecting.push(op);
      return;
    }
    this.undoStack.push(op);
    if (this.undoStack.length > 200) this.undoStack.shift();
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

  undo(): string | null {
    const op = this.undoStack.pop();
    if (!op) return null;
    op.undo();
    this.redoStack.push(op);
    this.onChange();
    return op.label;
  }

  redo(): string | null {
    const op = this.redoStack.pop();
    if (!op) return null;
    op.redo();
    this.undoStack.push(op);
    this.onChange();
    return op.label;
  }
}
