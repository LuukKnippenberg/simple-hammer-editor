# Ambient and local sound

Code: `src/audio/` (`soundscapes.ts`, `engine.ts`, `listener.ts`, `localSounds.ts`), `src/lw/soundPresets.ts`,
`src/ui/soundBrowser.ts`, `src/ui/soundUi.ts`, `src/render/soundRenderer.ts`.

## Soundscapes

- The editor reads `scripts/soundscapes_manifest.txt` and every script it lists: looping beds, random one-shots with
  time, volume and pitch ranges, and nested soundscapes.
- **Map default**: the **Ambient sound** card in the Settings panel (an `env_soundscape` with radius -1), with the
  soundscapes grouped by script and a ▶ button to listen for 15 seconds.
- **Zones**: the **Sound tool** (0) places `env_soundscape` zones with a soundscape and radius. The viewport draws
  them as cylinders, the one heard now brighter. Zones act as columns (distance on the ground plan), so a zone on a
  roof still covers the street below.

## Local sounds

- The **sound browser** searches the game's sounds by words ("fire loop", "drip"), each with ▶, and shows whether a
  sound **loops** (has loop points) or plays **once**.
- The Sound tool's *Local sound* mode places an `ambient_generic` with the picked file, radius and volume, or a
  **preset**: a sound with the effects that belong to it.

| Preset | Adds | Sound |
|---|---|---|
| 💡 Broken lamp | a light with the fluorescent-flicker style (baked by vrad), sparks (`env_spark`) | electric buzz |
| 🔥 Fire | `env_fire` (infinite, full size), a flickering orange light | small fire loop |
| 💨 Steam leak | an `env_steam` jet | steam loop |
| 📻 Radio | a radio prop | music (plays once) |
| 💧 Dripping water | – | water leak loop |
| ⚙ Generator | a generator prop | generator hum |

- Presets that bring a prop place it when clicked on the ground; clicked on a fitting prop they add only their
  effects to it. Selecting a lamp post, oil drum, fireplace, radio or generator offers the fitting presets in the
  inspector, and the effects go to the right spot on the model.
- Selecting an `ambient_generic` shows its radius, volume and the sound browser in the inspector.

## Audio preview

**🔊 Audio** in the top bar (browsers only allow sound after a click) plays the map:

- the soundscape of the zone at the ground point in the middle of the screen (the RTS camera hangs high above it),
  or of the camera itself when it is low, cross-fading between soundscapes; loops play continuously and random
  sounds at random times, panned, as the game does;
- local sounds positioned round the listener, fading out over their radius; loops run while in range, one-shots
  play on coming into range, sparks crackle at random.

The viewport readout shows the soundscape and how many sounds are playing. In game the last zone heard keeps playing
until another takes over; the preview falls back to the map default instead, which shows each zone's extent more
clearly.
