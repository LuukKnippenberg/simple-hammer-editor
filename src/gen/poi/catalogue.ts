import { registerPoi } from './registry.ts';
import { LOT } from './catalog/lot.ts';
import { SQUARE } from './catalog/square.ts';
import { PARKING } from './catalog/parking.ts';
import { PLAYGROUND } from './catalog/playground.ts';
import { PARK } from './catalog/park.ts';
import { MARKET } from './catalog/market.ts';
import { BASKETBALL, FOOTBALL } from './catalog/sports.ts';
import { BARRICADE, CHECKPOINT, RATIONS } from './catalog/combine.ts';

/** Registers every POI type (importing this module is enough). */
registerPoi(SQUARE, PARKING, PLAYGROUND, MARKET, BASKETBALL, CHECKPOINT, BARRICADE, RATIONS, PARK, FOOTBALL, LOT);
