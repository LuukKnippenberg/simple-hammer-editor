import { describe, expect, it } from 'vitest';
import { panelForTool } from '../src/ui/panelFollow.ts';

describe('panels follow the tool', () => {
  it('maps each tool to its panel', () => {
    expect(panelForTool('paint', false)?.panel).toBe('Materials');
    expect(panelForTool('decal', false)?.panel).toBe('Materials');
    expect(panelForTool('entity', false)?.panel).toBe('Entities');
    expect(panelForTool('kit', false)).toEqual({ panel: 'Mission', focus: 'kits' });
    expect(panelForTool('poi', false)?.panel).toBe('POI');
    expect(panelForTool('cinema', false)?.panel).toBe('Cinema');
  });

  it('the Select tool opens Selection only when something is selected; other tools leave the panel alone', () => {
    expect(panelForTool('select', true)?.panel).toBe('Selection');
    expect(panelForTool('select', false)).toBeNull();
    for (const t of ['block', 'ground', 'sound', 'road', 'powerline', 'generate'] as const) expect(panelForTool(t, true)).toBeNull();
  });
});
