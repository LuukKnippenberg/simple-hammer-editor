import type { Editor } from '../editor.ts';
import type { ToolName } from '../edit/tools.ts';
import { checkMission } from '../lw/missionCheck.ts';
import { validateConnections } from '../vmf/io.ts';
import type { SidebarTabs } from './sidebar.ts';

/** Where the sidebar goes when a tool is picked; null leaves it where it is. */
export function panelForTool(tool: ToolName, hasSelection: boolean): { panel: string; focus?: 'kits' } | null {
  switch (tool) {
    case 'select': return hasSelection ? { panel: 'Selection' } : null;
    case 'paint': case 'decal': return { panel: 'Materials' };
    case 'entity': return { panel: 'Entities' };
    case 'kit': return { panel: 'Mission', focus: 'kits' };
    case 'poi': return { panel: 'POI' };
    case 'cinema': return { panel: 'Cinema' };
    default: return null;
  }
}

const plural = (n: number, word: string) => `${n} ${n === 1 ? word : word === 'vertex' ? 'vertices' : `${word}s`}`;

/** Makes the sidebar follow the tool and selection, and keeps the rail badges (selection, mission, logic) current. */
export function mountPanelFollow(editor: Editor, tabs: SidebarTabs): void {
  const selectionSize = () => {
    const s = editor.selection;
    return s.mode === 'object' ? s.solids.size + s.entities.size : s.parts.length;
  };
  const followTool = () => {
    const to = panelForTool(editor.tools.current.name, !editor.selection.isEmpty);
    if (to) tabs.follow(to.panel, to.focus === 'kits' ? (p) => p.querySelector<HTMLElement>('.kits')?.closest<HTMLElement>('.section') ?? null : undefined);
  };
  let tool = editor.tools.current.name;
  editor.on('toolchange', () => {
    // Gizmo mode changes send toolchange too; only a different tool counts as a switch.
    if (editor.tools.current.name === tool) return;
    tool = editor.tools.current.name;
    tabs.release();
    followTool();
  });

  const syncSelection = () => {
    const n = selectionSize();
    tabs.badge('Selection', n ? String(n) : null, 'accent', `${plural(n, editor.selection.mode === 'object' ? 'object' : editor.selection.mode)} selected`);
  };
  editor.on('selection', () => {
    syncSelection();
    if (tool === 'select') followTool();
  });
  syncSelection();

  // Mission warnings and logic problems only badge their panels; they never take over.
  let timer = 0;
  const syncChecks = () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      const issues = editor.mission ? checkMission(editor.mission, editor.doc) : [];
      const errors = issues.filter((i) => i.severity === 'error').length;
      tabs.badge('Mission', issues.length ? '!' : null, errors ? 'danger' : 'accent',
        `${[errors && plural(errors, 'error'), issues.length > errors && plural(issues.length - errors, 'warning')].filter(Boolean).join(', ')} in the mission flow`);
      const problems = validateConnections(editor.doc);
      tabs.badge('Logic', problems.length ? String(problems.length) : null, 'danger', plural(problems.length, 'connection problem'));
    }, 250);
  };
  for (const ev of ['document', 'change', 'mission', 'fgd']) editor.on(ev, syncChecks);
  syncChecks();
}
