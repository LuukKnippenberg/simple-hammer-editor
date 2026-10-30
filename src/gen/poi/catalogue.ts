import { registerPoi } from './registry.ts';
import { LOT } from './catalog/lot.ts';

/** Registers every POI type (importing this module is enough). */
registerPoi(LOT);
