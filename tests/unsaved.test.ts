import { describe, expect, it } from 'vitest';
import { SAVE_REMINDER_MS, UnsavedClock } from '../src/edit/unsaved.ts';

const MIN = 60_000;

function clockAt(start: number) {
  const clock = new UnsavedClock();
  let now = start;
  clock.now = () => now;
  return { clock, advance: (ms: number) => (now += ms) };
}

describe('UnsavedClock', () => {
  it('remembers when the map first became dirty, not the latest change', () => {
    const { clock, advance } = clockAt(1_000);
    expect(clock.dirty).toBe(false);
    clock.dirty = true;
    advance(5 * MIN);
    clock.dirty = true;
    expect(clock.since).toBe(1_000);
  });

  it('offers a save only after 20 minutes of unsaved changes, in whole minutes', () => {
    const { clock, advance } = clockAt(0);
    expect(SAVE_REMINDER_MS).toBe(20 * MIN);
    expect(clock.reminderMinutes()).toBeNull();
    clock.dirty = true;
    advance(20 * MIN - 1);
    expect(clock.reminderMinutes()).toBeNull();
    advance(1);
    expect(clock.reminderMinutes()).toBe(20);
    advance(5 * MIN + 30_000);
    expect(clock.reminderMinutes()).toBe(25);
  });

  it('resets when saved', () => {
    const { clock, advance } = clockAt(0);
    clock.dirty = true;
    advance(30 * MIN);
    clock.dirty = false;
    expect(clock.since).toBeNull();
    expect(clock.reminderMinutes()).toBeNull();
    clock.dirty = true;
    advance(MIN);
    expect(clock.reminderMinutes()).toBeNull();
  });

  it('takes a shorter threshold', () => {
    const { clock, advance } = clockAt(0);
    clock.reminderMs = 2_000;
    clock.dirty = true;
    advance(2_000);
    expect(clock.reminderMinutes()).toBe(0);
  });
});
