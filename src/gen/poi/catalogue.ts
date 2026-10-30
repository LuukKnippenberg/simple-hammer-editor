import { registerPoi } from './registry.ts';
import { LOT } from './catalog/lot.ts';
import { SQUARE } from './catalog/square.ts';
import { PARKING } from './catalog/parking.ts';
import { PLAYGROUND } from './catalog/playground.ts';
import { PARK } from './catalog/park.ts';
import { MARKET } from './catalog/market.ts';
import { BASKETBALL, FOOTBALL } from './catalog/sports.ts';
import { BARRICADE, CHECKPOINT, RATIONS } from './catalog/combine.ts';
import { CONSTRUCTION, JUNKYARD, TANKFARM } from './catalog/industry.ts';
import { GASSTATION, RAILYARD } from './catalog/transport.ts';
import { CRASHSITE, REBELCAMP, THUMPER } from './catalog/wilds.ts';
import { FARMSTEAD, GRAVEYARD, LOOKOUT } from './catalog/rural.ts';

/** Registers every POI type (importing this module is enough). */
registerPoi(SQUARE, PARKING, PLAYGROUND, MARKET, BASKETBALL, CHECKPOINT, BARRICADE, RATIONS, JUNKYARD, CONSTRUCTION, TANKFARM, RAILYARD, GASSTATION, PARK, FOOTBALL, REBELCAMP, THUMPER, CRASHSITE, FARMSTEAD, GRAVEYARD, LOOKOUT, LOT);
