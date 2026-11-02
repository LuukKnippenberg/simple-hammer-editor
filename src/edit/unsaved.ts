/** How long changes stay unsaved before the status bar offers a save. */
export const SAVE_REMINDER_MS = 20 * 60_000;
const MINUTE_MS = 60_000;

/** Whether the map has unsaved changes, and since when: the clock behind the status bar's save reminder. */
export class UnsavedClock {
  /** When the map first changed after it was loaded or saved (ms since the epoch), or null when nothing is unsaved. */
  since: number | null = null;
  /** Tests and the browser script shorten it. */
  reminderMs = SAVE_REMINDER_MS;
  now: () => number = Date.now;

  get dirty(): boolean {
    return this.since !== null;
  }
  /** Marking it dirty again keeps the first time; marking it clean resets it. */
  set dirty(on: boolean) {
    if (!on) this.since = null;
    else this.since ??= this.now();
  }

  /** Whole minutes unsaved once that is past the reminder, otherwise null. */
  reminderMinutes(): number | null {
    if (this.since === null) return null;
    const unsaved = this.now() - this.since;
    return unsaved < this.reminderMs ? null : Math.floor(unsaved / MINUTE_MS);
  }
}
