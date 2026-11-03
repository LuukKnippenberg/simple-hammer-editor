import { describe, expect, it } from 'vitest';
import { panelForTool } from '../src/ui/panelFollow.ts';

describe('panels follow the tool', () => {
  it('maps each tool to its panel', () => {
    expect(panelForTool('paint', false)).toEqual({ dock: 'material' });
    expect(panelForTool('decal', false)).toEqual({ dock: 'decal' });
    expect(panelForTool('entity', false)).toEqual({ panel: 'Entities' });
    expect(panelForTool('kit', false)).toEqual({ panel: 'Mission', focus: 'kits' });
    expect(panelForTool('poi', false)).toEqual({ panel: 'POI' });
    expect(panelForTool('cinema', false)).toEqual({ panel: 'Cinema' });
  });

  it('the Select tool opens Selection only when something is selected; other tools leave the panel alone', () => {
    expect(panelForTool('select', true)).toEqual({ panel: 'Selection' });
    expect(panelForTool('select', false)).toBeNull();
    for (const t of ['block', 'ground', 'sound', 'road', 'powerline', 'generate'] as const) expect(panelForTool(t, true)).toBeNull();
  });
});
