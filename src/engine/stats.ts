import {
  epochToZonedDateTime,
  getSleepDayBounds,
  getSleepDayKey,
  shiftPlainDate,
} from '../lib/temporal.ts';
import type { BabySettings, DaySummary, RangeSummary, SleepSegment } from '../types.ts';

const MIN_MS = 60_000;

function avgOrNull(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sum = values.reduce((acc, v) => acc + v, 0);
  return Math.round(sum / values.length);
}

export function getDayAnchorKeys(
  endSleepDayKey: string,
  daysCount: number,
): string[] {
  const keys: string[] = [];
  for (let offset = -(daysCount - 1); offset <= 0; offset++) {
    keys.push(shiftPlainDate(endSleepDayKey, offset));
  }
  return keys;
}

export function summarizeSleepDay(
  segments: readonly SleepSegment[],
  sleepDayKey: string,
  settings: BabySettings,
  nowMs: number = Date.now(),
): DaySummary {
  const { startMs: dayStartMs, endMs: dayEndMs } = getSleepDayBounds(
    sleepDayKey,
    settings.dayStartHour,
    settings.timeZone,
  );
  const effectiveEndMs = Math.min(dayEndMs, nowMs);

  const slicedAll: SleepSegment[] = [];
  let realMs = 0;
  let totalObservedMs = 0;
  let interpolatedCount = 0;

  for (const seg of segments) {
    if (seg.endMs <= dayStartMs || seg.startMs >= dayEndMs) continue;
    const s = Math.max(seg.startMs, dayStartMs);
    const e = Math.min(seg.endMs, effectiveEndMs > dayStartMs ? effectiveEndMs : dayEndMs);
    if (e <= s) continue;
    const durMin = (e - s) / MIN_MS;
    totalObservedMs += e - s;
    if (seg.source === 'real') {
      realMs += e - s;
    } else {
      interpolatedCount++;
    }
    slicedAll.push({
      ...seg,
      startMs: s,
      endMs: e,
      durationMin: durMin,
    });
  }

  const eligible = settings.includeInterpolatedInStats
    ? slicedAll
    : slicedAll.filter((seg) => seg.source === 'real');

  const naps = eligible.filter((seg) => seg.kind === 'nap');
  const nightSleeps = eligible.filter((seg) => seg.kind === 'night-sleep');
  const nightWakes = eligible.filter((seg) => seg.kind === 'night-wake');
  const wakeWindows = eligible.filter((seg) => seg.kind === 'wake-window');

  const napDurationsByIndex: Record<number, number> = {};
  naps.forEach((nap, idx) => {
    const num = nap.napIndex ?? idx + 1;
    napDurationsByIndex[num] = Math.round(nap.durationMin);
  });

  const totalDaySleepMin = Math.round(naps.reduce((acc, s) => acc + s.durationMin, 0));
  const totalNightSleepMin = Math.round(nightSleeps.reduce((acc, s) => acc + s.durationMin, 0));
  const total24hSleepMin = totalDaySleepMin + totalNightSleepMin;
  const totalAwakeMin = Math.round(
    eligible.filter((s) => s.state === 'awake').reduce((acc, s) => acc + s.durationMin, 0),
  );

  // Merge back-to-back night-sleep segments separated by < 1 min when computing longest unbroken stretch
  let longestNightStretchMin = 0;
  let runningStretch = 0;
  let prevEnd: number | null = null;
  for (const ns of nightSleeps) {
    if (prevEnd !== null && ns.startMs - prevEnd <= MIN_MS) {
      runningStretch += ns.durationMin;
    } else {
      runningStretch = ns.durationMin;
    }
    if (runningStretch > longestNightStretchMin) {
      longestNightStretchMin = runningStretch;
    }
    prevEnd = ns.endMs;
  }
  longestNightStretchMin = Math.round(longestNightStretchMin);

  const firstNightSleep = nightSleeps[0] ?? null;
  const bedtimeMs = firstNightSleep ? firstNightSleep.startMs : null;
  const bedtimeMinOfSleepDay = bedtimeMs !== null ? Math.round((bedtimeMs - dayStartMs) / MIN_MS) : null;

  const firstWakeWindow = wakeWindows[0] ?? null;
  const morningWakeMs = firstWakeWindow ? firstWakeWindow.startMs : null;

  let preBedWakeWindowMin: number | null = null;
  if (firstNightSleep) {
    const precedingAwake = eligible.find(
      (s) =>
        s.state === 'awake' &&
        Math.abs(s.endMs - firstNightSleep.startMs) <= 2 * MIN_MS &&
        s.startMs >= dayStartMs,
    );
    if (precedingAwake) {
      preBedWakeWindowMin = Math.round(precedingAwake.durationMin);
    }
  }

  const daytimeWakeDurations = wakeWindows
    .filter((w) => w.endMs <= (bedtimeMs ?? dayEndMs) - MIN_MS)
    .map((w) => w.durationMin);
  const avgDaytimeWakeWindowMin = avgOrNull(daytimeWakeDurations);

  const realCoveragePct =
    totalObservedMs > 0 ? Math.round((realMs / totalObservedMs) * 100) : 0;

  return {
    sleepDayKey,
    dayStartMs,
    dayEndMs,
    naps,
    napCount: naps.length,
    napDurationsByIndex,
    nightSleeps,
    nightWakes,
    wakeWindows,
    totalDaySleepMin,
    totalNightSleepMin,
    total24hSleepMin,
    totalAwakeMin,
    nightWakeCount: nightWakes.length,
    longestNightStretchMin,
    bedtimeMs,
    bedtimeMinOfSleepDay,
    morningWakeMs,
    preBedWakeWindowMin,
    avgDaytimeWakeWindowMin,
    realCoveragePct,
    interpolatedCount,
    hasRealData: realMs > 0,
  };
}

export function computeRangeStats(
  segments: readonly SleepSegment[],
  settings: BabySettings,
  anchorSleepDayKey: string,
  daysCount: number,
  nowMs: number = Date.now(),
): { days: DaySummary[]; summary: RangeSummary } {
  const keys = getDayAnchorKeys(anchorSleepDayKey, daysCount);
  const days = keys.map((key) => summarizeSleepDay(segments, key, settings, nowMs));

  const daysWithData = days.filter((d) => d.total24hSleepMin > 0 || d.totalAwakeMin > 0);
  const daysWithRealData = days.filter((d) => d.hasRealData);

  const statDays = settings.includeInterpolatedInStats ? daysWithData : daysWithRealData;

  const nap1List: number[] = [];
  const nap2List: number[] = [];
  const nap3List: number[] = [];
  const nap4List: number[] = [];
  const preBedList: number[] = [];
  const dayWWList: number[] = [];

  for (const d of statDays) {
    if (d.napDurationsByIndex[1] !== undefined) nap1List.push(d.napDurationsByIndex[1]);
    if (d.napDurationsByIndex[2] !== undefined) nap2List.push(d.napDurationsByIndex[2]);
    if (d.napDurationsByIndex[3] !== undefined) nap3List.push(d.napDurationsByIndex[3]);
    if (d.napDurationsByIndex[4] !== undefined) nap4List.push(d.napDurationsByIndex[4]);
    if (d.preBedWakeWindowMin !== null) preBedList.push(d.preBedWakeWindowMin);
    if (d.avgDaytimeWakeWindowMin !== null) dayWWList.push(d.avgDaytimeWakeWindowMin);
  }

  const avgNapCount =
    statDays.length > 0
      ? Number((statDays.reduce((a, d) => a + d.napCount, 0) / statDays.length).toFixed(1))
      : null;

  const avgNightWakes =
    statDays.length > 0
      ? Number((statDays.reduce((a, d) => a + d.nightWakeCount, 0) / statDays.length).toFixed(1))
      : null;

  const avgPreBed = avgOrNull(preBedList);
  const avgDayWW = avgOrNull(dayWWList);
  const preBedMultiplier =
    avgPreBed !== null && avgDayWW !== null && avgDayWW > 0
      ? Number((avgPreBed / avgDayWW).toFixed(2))
      : null;

  const nonEmptyCoverage = daysWithData.map((d) => d.realCoveragePct);
  const realCoveragePct = avgOrNull(nonEmptyCoverage) ?? 0;

  const interpolatedSegmentCount = days.reduce((acc, d) => acc + d.interpolatedCount, 0);

  return {
    days,
    summary: {
      daysCount,
      daysWithData: daysWithData.length,
      daysWithRealData: daysWithRealData.length,
      avgNapCount,
      napAvgMin: {
        1: avgOrNull(nap1List),
        2: avgOrNull(nap2List),
        3: avgOrNull(nap3List),
        4: avgOrNull(nap4List),
      },
      avgNightWakes,
      avgLongestNightStretchMin: avgOrNull(
        statDays.filter((d) => d.longestNightStretchMin > 0).map((d) => d.longestNightStretchMin),
      ),
      avgNightSleepMin: avgOrNull(
        statDays.filter((d) => d.totalNightSleepMin > 0).map((d) => d.totalNightSleepMin),
      ),
      avgDayNapMin: avgOrNull(statDays.map((d) => d.totalDaySleepMin)),
      avgTotalSleepMin: avgOrNull(
        statDays.filter((d) => d.total24hSleepMin > 0).map((d) => d.total24hSleepMin),
      ),
      avgPreBedWakeWindowMin: avgPreBed,
      avgDaytimeWakeWindowMin: avgDayWW,
      preBedMultiplier,
      realCoveragePct,
      interpolatedSegmentCount,
    },
  };
}

export function getCurrentAnchorDayKey(settings: BabySettings, nowMs: number = Date.now()): string {
  return getSleepDayKey(nowMs, settings.dayStartHour, settings.timeZone);
}

export { epochToZonedDateTime };
