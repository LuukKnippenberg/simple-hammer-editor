import { registerPoi } from './registry.ts';
import { LOT } from './catalog/lot.ts';
import { SQUARE } from './catalog/square.ts';
import { PARKING } from './catalog/parking.ts';
import { PLAYGROUND } from './catalog/playground.ts';

/** Registers every POI type (importing this module is enough). */
registerPoi(SQUARE, PARKING, PLAYGROUND, LOT);
