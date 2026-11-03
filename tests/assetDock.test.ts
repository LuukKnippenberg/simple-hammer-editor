import { describe, expect, it } from 'vitest';
import { DOCK_HEIGHT, snapDockHeight } from '../src/ui/assetDock.ts';

describe('asset finder dock height', () => {
  it('hides below 64 px', () => {
    expect(snapDockHeight(0)).toEqual({ size: 'hidden', height: 0 });
    expect(snapDockHeight(63)).toEqual({ size: 'hidden', height: 0 });
  });

  it('snaps to Strip and Open', () => {
    expect(snapDockHeight(64)).toEqual({ size: 'strip', height: DOCK_HEIGHT.strip });
    expect(snapDockHeight(200)).toEqual({ size: 'strip', height: DOCK_HEIGHT.strip });
    expect(snapDockHeight(230)).toEqual({ size: 'open', height: DOCK_HEIGHT.open });
    expect(snapDockHeight(330)).toEqual({ size: 'open', height: DOCK_HEIGHT.open });
  });

  it('stays where it was dropped above Open', () => {
    expect(snapDockHeight(412.4)).toEqual({ size: 'open', height: 412 });
  });
});
