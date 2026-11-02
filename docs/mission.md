# Missions: kits and the mission flowchart

The **Mission** panel holds the Lambda Wars kits, the mission title and description, player relations and the
mission flowchart. Code: `src/lw/` (`kits.ts`, `mission.ts`, `missionBuild.ts`, `missionCheck.ts`, `missionSim.ts`,
`unitCatalog.ts`, `gameAbilities.ts`) and `src/ui/missionPanel.ts`, `missionFlow.ts`, `missionViewport.ts`.

## Kits

Placed with the kit tool (5). Each kit creates the entities a feature needs and wires their outputs, as one undo
step.

| Kit | Creates |
|---|---|
| Capture point | `control_point` (flag) + `trigger_capture_area` with the chosen radius, owner and capture time |
| Multiplayer start | `info_start_wars` (HQ spawn, team hint) + its `info_player_wars` camera |
| Mission player start | camera spawn, `wars_player_setup` (faction, colour) and a starting squad of mixed units |
| Unit group | N units of any unit type, for an owner, with a shared name and an optional custom unittype |
| Attack wave | `unit_maker` → `wars_give_order` sending the units to the order entity itself (move it to change the goal); starts disabled so a trigger can enable it |
| Walking queue | a line of people at a counter: every few seconds the one in front walks off and back to the entrance and the rest step up, driven by one `wars_give_order` per spot and a loop of `logic_relay`s |
| Mission message | `wars_messagebox`, shown at map start through a shared `logic_auto` or wired to a trigger |
| Objective | `wars_mission_objective`; "completing wins" wires it to the map's `wars_win_condition` |

- **Apply standard relations** makes the player hate every other unit owner (`wars_player_relation` +
  `ApplyRelation` at map start), as the shipped missions do.
- The mission title and description are stored on worldspawn; compiling an `sp_*` map writes the `.res` entry the
  game's mission list reads.
- The **gameplay overlay** draws capture-area rings coloured by owner, base rings round player starts and the
  route from each wave to its goal.
- Camera spawns account for the game forcing the spawn camera to pitch 65°, yaw 135°, so the camera looks at the
  start.

### Unit types

The unit list comes from the game: `scripts/gen-unit-catalog.py` reads the install and writes
`src/lw/unitCatalog.ts` (checked in). It parses `lambdawars.fgd` for every `unit_*` class, its model and the
unittypes it accepts, and the game's Python with `ast` (nothing is imported) for each `UnitInfo`: name, entity
class, model, display name, hull, z offset, scale, and the hover height of air units. Re-run it after the game's
unit list changes:

```bash
python scripts/gen-unit-catalog.py
```

- Unit pickers are searchable and grouped by faction (✈ marks air units).
- **Custom unittype** replaces the `unittype` key (or a wave's `NPCType`) while the entity class stays that of the
  chosen unit, for mission-only variants.
- Air units are placed at their locomotion's height above the ground; big hulls get more spacing.
- The viewport draws units with the model and scale of their unittype.

## The mission flowchart

**Mission panel → Mission flow** opens a flowchart of the mission, saved next to the map as
`maps/<name>.mission.json`.

- **Stages** are cards: a title, the **messages** shown when the stage starts (with an optional speaker and hint
  line), the **objectives** shown while it runs, **actions** fired as it starts (an entity input with a delay),
  **ability gates**, and **transitions**. The first transition whose condition is met wins; it leads to another
  stage, to 🏆 Victory or to 💀 Defeat, and completes or fails the stage's objectives.
- Drag cards to arrange them, drag the background to pan, the wheel zooms, ⤢ Fit shows it all. Drag a
  transition's dot onto a card to send it there.

| Condition | Met when |
|---|---|
| 📍 Reach | units of an owner enter an area drawn in the viewport (**Draw in viewport**) |
| 💥 Destroy | named units or objects die (N of them, if several share the name) |
| 🛡 Lose | a named unit or object dies (lead it to Defeat for "keep it alive") |
| ☠ Destroy faction / 👥 Troops | an owner's population drops to 0, or is at least / at most N |
| ⏱ Survive | a time passes |
| ⚑ Capture | a control point is captured by a player |
| 🏗 Build | a player finishes (or starts placing) N buildings of a type |
| 🔬 Research or train | a player completes an ability N times: a research, a trained unit, a placed building, a cast ability |
| ∧ All of | every part has been met, in any order |
| 💰 Resources | listed, but not built: the game has no entity that reports a player's resources |

Counts only count while the stage runs. **Abilities** lock, unlock, hide or show while unavailable, or research
instantly, any ability or build-menu entry for a player as the stage starts. Ability and building names come from
`src/lw/gameAbilities.ts`, generated from the game's Python by `node scripts/extract-abilities.mjs`.

### Building it into the map

**Build into map** turns the flowchart into entities as one undo step, and **Compile & test** does the same on the
compiled copy, so a compiled map always has the flowchart as it stands. Built entities carry `she_mission 1` and
are named `mf_<stage>_…`; building again replaces them, so they are never edited by hand.

- `mf_start` (`logic_auto`) triggers the start stage's `mf_<stage>_enter` relay. Entering a stage shows its
  messages one after another, makes its objectives visible and enables its transitions.
- Each transition is a disabled relay `mf_<stage>_tN` fed by its condition. When it fires it disables the stage's
  other transitions, completes or fails the objectives and triggers the next stage, or `PlayerVictory` /
  `PlayerLost` on a `wars_win_condition`.

| Piece | Entities |
|---|---|
| 📍 reach | a disabled `trigger_multiple` over the area (ground −32 to +320), filtered with `filter_owner` |
| 💥 destroy, 🛡 lose | the death output (`OnUnitKilled`, `OnBreak` for props, `OnAllSpawnedDead` for a unit_maker); several entities count up a `math_counter` |
| ☠ / 👥 | `wars_population_listener` + `logic_compare` (population is food used, not unit count) |
| ⏱ survive | `wars_mission_timer`, started with the stage, paused when it ends |
| ⚑ capture | the control point's `OnCaptured_Player<n>` |
| 🏗 building | `event_building_listener` → `filter_owner` → `filter_unittype` (the build menu's unit info names, not FGD classes) |
| 🔬 ability | `wars_ability_manager`.AbilityCompleted → `logic_case` → `filter_owner` |
| N of X | a `math_counter`, reset and enabled when the stage starts (it ignores Add while disabled) |
| ∧ all of | each part feeds a relay that adds 1 to `…_all` and disables itself |
| ability gate | one `wars_ability_manager` per player: `LockAbility`, `UnlockAbility`, `HideAbilityOnUnavailabe` (the game's spelling), `ShowAbilityOnUnavailabe`, `ResearchAbility` |
| speaker, hint | the message box text becomes `<b>Speaker:</b> text<br><i>hint</i>` (the HUD sets it as HTML) |

A message starting with `#` is a localisation token the client looks up as a whole, so it can't carry a speaker or
hint.

### Checking and playing it through

- **✓ Check** (also run when the flowchart opens and after a build) lists problems and outlines their stages.
  Errors: no start stage, nothing leading to Victory, a stage with no transitions, a transition to a deleted stage,
  a reach with no area, targets or action entities that aren't in the map, unknown ability names. Warnings:
  unreachable stages, stages that can't reach Victory, no Defeat, a start stage without an objective, a destroy
  target that can't die, an input the target's class doesn't have, and messages or objectives placed by hand.
- **▶ Play through** steps through the mission the way the built map plays it: the current stage lights up, its
  messages show with Continue, objectives tick off, and the side panel lists the conditions it waits for. Click the
  one that happens to move on; the path taken is drawn and logged. It follows the flowchart only, without the game.
- **M** shows the mission objectives in the viewport; PageUp and PageDown step through them.
