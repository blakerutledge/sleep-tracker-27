import { beforeAll, describe, expect, test } from 'bun:test';
import { DEFAULT_SETTINGS } from '../../lib/storage.ts';
import { ensureTemporal, getBabyAgeInfo, getSleepDayKey } from '../../lib/temporal.ts';
import type { BabySettings, SleepEvent } from '../../types.ts';
import { buildSleepSegments } from '../interpolation.ts';
import { evaluatePlsCoach } from '../plsCoach.ts';
import { computeRangeStats } from '../stats.ts';

const TZ = 'America/Denver';

function ts(isoLocal: string): number {
  const pdt = Temporal.PlainDateTime.from(isoLocal);
  return pdt.toZonedDateTime(TZ).epochMilliseconds;
}

const baseSettings: BabySettings = {
  ...DEFAULT_SETTINGS,
  birthDate: '2026-07-01', // ~4.5 months old on 2026-11-15
  timeZone: TZ,
  dayStartHour: 7,
  nightStartHour: 19,
  includeInterpolatedInStats: false,
};

beforeAll(async () => {
  await ensureTemporal();
});

describe('Temporal & Age Math', () => {
  test('Temporal.PlainDate.from parses 2027-01-01 without UTC off-by-one drift', () => {
    const preArrivalSettings: BabySettings = {
      ...DEFAULT_SETTINGS,
      birthDate: '2027-01-01',
      timeZone: TZ,
    };
    const refMs = ts('2026-11-15T22:30:00');
    const age = getBabyAgeInfo(preArrivalSettings, refMs);
    expect(age.isPreArrival).toBe(true);
    expect(age.birthPlainDateStr).toBe('2027-01-01');
    expect(age.daysUntilDue).toBe(47);
  });

  test('Sleep-day anchor groups 2:00 AM under previous calendar sleep-day', () => {
    const key = getSleepDayKey(ts('2026-11-15T02:15:00'), 7, TZ);
    expect(key).toBe('2026-11-14');
  });
});

describe('Forgiving Gap Interpolation & Stats Engine', () => {
  test('Classifies clean day + night events into Nap 1, Nap 2, Night Sleep & Night Wake', () => {
    const events: SleepEvent[] = [
      { id: '1', type: 'awake', timestamp: ts('2026-11-14T07:00:00'), updatedAt: 1 },
      { id: '2', type: 'asleep', timestamp: ts('2026-11-14T09:00:00'), updatedAt: 2 },
      { id: '3', type: 'awake', timestamp: ts('2026-11-14T10:30:00'), updatedAt: 3 },
      { id: '4', type: 'asleep', timestamp: ts('2026-11-14T13:00:00'), updatedAt: 4 },
      { id: '5', type: 'awake', timestamp: ts('2026-11-14T14:15:00'), updatedAt: 5 },
      { id: '6', type: 'asleep', timestamp: ts('2026-11-14T19:30:00'), updatedAt: 6 },
      { id: '7', type: 'awake', timestamp: ts('2026-11-15T02:00:00'), updatedAt: 7 },
      { id: '8', type: 'asleep', timestamp: ts('2026-11-15T02:20:00'), updatedAt: 8 },
      { id: '9', type: 'awake', timestamp: ts('2026-11-15T06:50:00'), updatedAt: 9 },
    ];

    const nowMs = ts('2026-11-15T08:00:00');
    const segs = buildSleepSegments(events, baseSettings, nowMs);
    expect(segs.every((s) => s.source === 'real')).toBe(true);

    const { days, summary } = computeRangeStats(segs, baseSettings, '2026-11-14', 1, nowMs);
    const day = days[0]!;
    expect(day.napCount).toBe(2);
    expect(day.napDurationsByIndex[1]).toBe(90);
    expect(day.napDurationsByIndex[2]).toBe(75);
    expect(day.nightWakeCount).toBe(1);
    expect(day.longestNightStretchMin).toBe(390); // 7:30p -> 2:00a = 6.5h
    expect(summary.avgPreBedWakeWindowMin).toBe(315); // 2:15p -> 7:30p = 5h 15m
  });

  test('Interpolates missed morning wake tap (asleep -> asleep) without breaking graph continuity', () => {
    const events: SleepEvent[] = [
      { id: '2', type: 'asleep', timestamp: ts('2026-11-13T19:30:00'), updatedAt: 2 },
      // Missed morning awake on 2026-11-14! Next tap is Nap 1 asleep:
      { id: '3', type: 'asleep', timestamp: ts('2026-11-14T09:00:00'), updatedAt: 3 },
      { id: '4', type: 'awake', timestamp: ts('2026-11-14T10:15:00'), updatedAt: 4 },
    ];

    const segs = buildSleepSegments(events, baseSettings, ts('2026-11-14T11:00:00'));
    const interpolated = segs.filter((s) => s.source === 'interpolated');
    expect(interpolated.length).toBe(2);
    expect(interpolated[0]!.state).toBe('asleep');
    expect(interpolated[0]!.kind).toBe('night-sleep');
    expect(interpolated[0]!.inferredBoundaryType).toBe('awake');
    expect(interpolated[1]!.state).toBe('awake');
    expect(interpolated[1]!.kind).toBe('wake-window');

    const realNap1 = segs.find((s) => s.source === 'real' && s.kind === 'nap');
    expect(realNap1?.durationMin).toBe(75);
  });

  test('Interpolates missed return-to-sleep tap after 2:15 AM night wake (awake -> awake)', () => {
    const events: SleepEvent[] = [
      { id: '1', type: 'asleep', timestamp: ts('2026-11-13T19:30:00'), updatedAt: 1 },
      { id: '2', type: 'awake', timestamp: ts('2026-11-14T02:15:00'), updatedAt: 2 },
      // Missed return-to-sleep! Next tap is morning wake:
      { id: '3', type: 'awake', timestamp: ts('2026-11-14T06:45:00'), updatedAt: 3 },
    ];

    const segs = buildSleepSegments(events, baseSettings, ts('2026-11-14T07:30:00'));
    const nightWake = segs.find((s) => s.kind === 'night-wake');
    const secondNightSleep = segs.find(
      (s) => s.source === 'interpolated' && s.kind === 'night-sleep',
    );
    expect(nightWake?.source).toBe('interpolated');
    expect(nightWake?.durationMin).toBeLessThan(46);
    expect(secondNightSleep?.durationMin).toBeGreaterThan(180);
  });

  test('Untracked multi-day gap is bridged cleanly and excluded from real Nap 1 average', () => {
    const events: SleepEvent[] = [
      // Day 1: clean Nap 1 = 80m
      { id: '1', type: 'awake', timestamp: ts('2026-11-10T07:00:00'), updatedAt: 1 },
      { id: '2', type: 'asleep', timestamp: ts('2026-11-10T09:00:00'), updatedAt: 2 },
      { id: '3', type: 'awake', timestamp: ts('2026-11-10T10:20:00'), updatedAt: 3 },
      // Forgot to log for 46 hours!
      { id: '4', type: 'awake', timestamp: ts('2026-11-12T07:00:00'), updatedAt: 4 },
      { id: '5', type: 'asleep', timestamp: ts('2026-11-12T09:00:00'), updatedAt: 5 },
      { id: '6', type: 'awake', timestamp: ts('2026-11-12T10:00:00'), updatedAt: 6 },
    ];

    const nowMs = ts('2026-11-12T11:00:00');
    const segs = buildSleepSegments(events, baseSettings, nowMs);
    expect(segs.some((s) => s.source === 'interpolated')).toBe(true);

    const { summary } = computeRangeStats(segs, baseSettings, '2026-11-12', 3, nowMs);
    expect(summary.daysWithRealData).toBe(2);
    expect(summary.napAvgMin[1]).toBe(70); // (80 + 60) / 2 — unpolluted by interpolated Day 2
  });
});

describe('Deterministic PLS Coach Rules', () => {
  test('Detects Bedtime False Starts, Post-4 PM Micro-Nap, and Split-Night Gap', () => {
    const events: SleepEvent[] = [
      // Day 1: false start + 4:30 PM micro-nap
      { id: 'd1-w', type: 'awake', timestamp: ts('2026-11-13T07:00:00'), updatedAt: 1 },
      { id: 'd1-m1', type: 'asleep', timestamp: ts('2026-11-13T16:30:00'), updatedAt: 2 },
      { id: 'd1-m2', type: 'awake', timestamp: ts('2026-11-13T16:42:00'), updatedAt: 3 },
      { id: 'd1-b1', type: 'asleep', timestamp: ts('2026-11-13T19:30:00'), updatedAt: 4 },
      { id: 'd1-fs1', type: 'awake', timestamp: ts('2026-11-13T20:15:00'), updatedAt: 5 },
      { id: 'd1-fs2', type: 'asleep', timestamp: ts('2026-11-13T20:30:00'), updatedAt: 6 },
      // Day 2 morning + false start + 90m split night gap
      { id: 'd2-w', type: 'awake', timestamp: ts('2026-11-14T07:00:00'), updatedAt: 7 },
      { id: 'd2-b1', type: 'asleep', timestamp: ts('2026-11-14T19:30:00'), updatedAt: 8 },
      { id: 'd2-fs1', type: 'awake', timestamp: ts('2026-11-14T20:10:00'), updatedAt: 9 },
      { id: 'd2-fs2', type: 'asleep', timestamp: ts('2026-11-14T20:25:00'), updatedAt: 10 },
      { id: 'd2-sg1', type: 'awake', timestamp: ts('2026-11-15T01:30:00'), updatedAt: 11 },
      { id: 'd2-sg2', type: 'asleep', timestamp: ts('2026-11-15T03:00:00'), updatedAt: 12 },
      { id: 'd3-w', type: 'awake', timestamp: ts('2026-11-15T07:00:00'), updatedAt: 13 },
    ];

    const settings7m: BabySettings = { ...baseSettings, birthDate: '2026-04-15' }; // 7 months old
    const nowMs = ts('2026-11-15T08:00:00');
    const segs = buildSleepSegments(events, settings7m, nowMs);
    const { insights, optimalSlipBedtimeClock } = evaluatePlsCoach(segs, events, settings7m, nowMs);

    const ids = insights.map((i) => i.id);
    expect(ids).toContain('false-starts');
    expect(ids).toContain('split-nights');
    expect(ids).toContain('post-4pm-micronap');
    expect(optimalSlipBedtimeClock).toBe('7:30p');
  });

  test('Triggers 12-Month 1-Nap Fake-Out guardrail when Nap 2 is skipped with long Nap 1', () => {
    const events: SleepEvent[] = [];
    for (const dayStr of ['2026-11-12', '2026-11-13', '2026-11-14']) {
      events.push(
        { id: `${dayStr}-w`, type: 'awake', timestamp: ts(`${dayStr}T07:00:00`), updatedAt: 1 },
        { id: `${dayStr}-n1a`, type: 'asleep', timestamp: ts(`${dayStr}T09:30:00`), updatedAt: 2 },
        { id: `${dayStr}-n1b`, type: 'awake', timestamp: ts(`${dayStr}T11:30:00`), updatedAt: 3 }, // 120m Nap 1
        { id: `${dayStr}-bed`, type: 'asleep', timestamp: ts(`${dayStr}T19:00:00`), updatedAt: 4 },
      );
    }
    const settings11m: BabySettings = { ...baseSettings, birthDate: '2025-12-15' }; // 11 months old
    const nowMs = ts('2026-11-15T08:00:00');
    const segs = buildSleepSegments(events, settings11m, nowMs);
    const { insights } = evaluatePlsCoach(segs, events, settings11m, nowMs);
    expect(insights.some((i) => i.id === 'fake-out-1-nap')).toBe(true);
  });
});
