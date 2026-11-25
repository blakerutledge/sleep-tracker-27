import { getWakeWindowTargetForAgeDays } from '../data/plsPlaybook.ts';
import {
  epochToZonedDateTime,
  getBabyAgeInfo,
  getLocalHour,
  getMinutesOfDay,
  getSleepDayBounds,
  getSleepDayKey,
  getTimeZoneId,
  makeEpochOnSleepDay,
  shiftPlainDate,
} from '../lib/temporal.ts';
import type { BabySettings, SegmentKind, SleepEvent, SleepSegment } from '../types.ts';

const MIN_MS = 60_000;

interface Baselines {
  morningWakeMinSinceDayStart: number;
  bedtimeMinSinceDayStart: number;
  typicalNapMin: number;
  typicalWakeWindowMin: number;
  typicalNightWakeMin: number;
  maxPlausibleWakeMin: number;
  maxPlausibleDaySleepMin: number;
  maxPlausibleNightSleepMin: number;
}

function clamp(val: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.max(min, Math.min(max, val));
}

function median(values: number[], fallback: number): number {
  if (values.length === 0) return fallback;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid] ?? fallback;
  }
  const a = sorted[mid - 1] ?? fallback;
  const b = sorted[mid] ?? fallback;
  return Math.round((a + b) / 2);
}

function deduplicateEvents(events: readonly SleepEvent[]): SleepEvent[] {
  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
  const deduped: SleepEvent[] = [];
  for (const ev of sorted) {
    const prev = deduped[deduped.length - 1];
    if (prev && prev.type === ev.type && ev.timestamp - prev.timestamp < MIN_MS) {
      if (!prev.comment && ev.comment) {
        prev.comment = ev.comment;
      }
      continue;
    }
    deduped.push({ ...ev });
  }
  return deduped;
}

function isNightClockHour(hour: number, settings: BabySettings): boolean {
  return hour >= settings.nightStartHour || hour < settings.dayStartHour;
}

function computeBaselines(events: readonly SleepEvent[], settings: BabySettings, nowMs: number): Baselines {
  const tz = getTimeZoneId(settings.timeZone);
  const age = getBabyAgeInfo(settings, nowMs);
  const target = getWakeWindowTargetForAgeDays(Math.max(0, age.totalDays));
  const defaultNapMin = Math.round((target.napDurMin + Math.min(target.napDurMax, 120)) / 2);
  const defaultWakeWindowMin = Math.round((target.wakeMin + target.wakeMax) / 2);

  let maxPlausibleWakeMin = 360;
  if (age.totalDays >= 548) maxPlausibleWakeMin = 840;
  else if (age.totalDays >= 365) maxPlausibleWakeMin = 600;
  else if (age.totalDays >= 180) maxPlausibleWakeMin = 480;

  const morningWakes: number[] = [];
  const bedtimes: number[] = [];
  const napLengths: number[] = [];
  const wakeLengths: number[] = [];
  const nightWakeLengths: number[] = [];

  for (let i = 0; i < events.length - 1; i++) {
    const a = events[i];
    const b = events[i + 1];
    if (!a || !b || a.type === b.type) continue;
    const durMin = (b.timestamp - a.timestamp) / MIN_MS;
    if (durMin <= 0) continue;

    if (a.type === 'asleep' && b.type === 'awake') {
      const aHour = getLocalHour(a.timestamp, tz);
      const bHour = getLocalHour(b.timestamp, tz);
      const startedDaytime = aHour >= settings.dayStartHour && aHour < settings.nightStartHour;
      if (startedDaytime && durMin <= 270) {
        napLengths.push(durMin);
      } else if (durMin <= 900) {
        if (durMin >= 180) {
          const sleepDayKey = getSleepDayKey(a.timestamp, settings.dayStartHour, tz);
          const { startMs } = getSleepDayBounds(sleepDayKey, settings.dayStartHour, tz);
          const offsetMin = (a.timestamp - startMs) / MIN_MS;
          if (offsetMin >= (settings.nightStartHour - settings.dayStartHour - 1) * 60) {
            bedtimes.push(offsetMin);
          }
        }
        if (bHour >= settings.dayStartHour - 2 && bHour <= settings.dayStartHour + 3) {
          const bDayKey = getSleepDayKey(b.timestamp, settings.dayStartHour, tz);
          const { startMs } = getSleepDayBounds(bDayKey, settings.dayStartHour, tz);
          const wakeOffset = (b.timestamp - startMs) / MIN_MS;
          if (wakeOffset >= -120 && wakeOffset <= 240) {
            morningWakes.push(wakeOffset);
          }
        }
      }
    } else if (a.type === 'awake' && b.type === 'asleep') {
      if (isNightClockHour(getLocalHour(a.timestamp, tz), settings) && durMin <= 150) {
        nightWakeLengths.push(durMin);
      } else if (durMin <= maxPlausibleWakeMin) {
        wakeLengths.push(durMin);
      }
    }
  }

  const defaultBedOffsetMin = (settings.nightStartHour - settings.dayStartHour) * 60 + 30;
  return {
    morningWakeMinSinceDayStart: median(morningWakes, 0),
    bedtimeMinSinceDayStart: median(bedtimes, defaultBedOffsetMin),
    typicalNapMin: clamp(median(napLengths, defaultNapMin), 35, 135),
    typicalWakeWindowMin: clamp(median(wakeLengths, defaultWakeWindowMin), 45, 300),
    typicalNightWakeMin: clamp(median(nightWakeLengths, 25), 15, 45),
    maxPlausibleWakeMin,
    maxPlausibleDaySleepMin: 330,
    maxPlausibleNightSleepMin: 900,
  };
}

function bridgeLongGap(
  startMs: number,
  endMs: number,
  initialType: 'asleep' | 'awake',
  baselines: Baselines,
  settings: BabySettings,
  prefixId: string,
  reason: string,
): SleepSegment[] {
  const out: SleepSegment[] = [];
  if (endMs <= startMs) return out;
  const tz = getTimeZoneId(settings.timeZone);

  // Build synthetic schedule milestones inside (startMs, endMs)
  const firstDayKey = getSleepDayKey(startMs, settings.dayStartHour, tz);
  const lastDayKey = getSleepDayKey(endMs, settings.dayStartHour, tz);

  interface Milestone {
    ts: number;
    type: 'asleep' | 'awake';
  }
  const milestones: Milestone[] = [];

  let cursorDay = shiftPlainDate(firstDayKey, -1);
  const stopAfterDay = shiftPlainDate(lastDayKey, 1);

  while (cursorDay <= stopAfterDay) {
    const wakeTs = makeEpochOnSleepDay(
      cursorDay,
      settings.dayStartHour,
      baselines.morningWakeMinSinceDayStart,
      tz,
    );
    const bedTs = makeEpochOnSleepDay(
      cursorDay,
      settings.dayStartHour,
      baselines.bedtimeMinSinceDayStart,
      tz,
    );

    const napStepMin = baselines.typicalWakeWindowMin + baselines.typicalNapMin;
    const nap1Start = wakeTs + baselines.typicalWakeWindowMin * MIN_MS;
    const nap1End = nap1Start + baselines.typicalNapMin * MIN_MS;
    const nap2Start = nap1End + baselines.typicalWakeWindowMin * MIN_MS;
    const nap2End = nap2Start + baselines.typicalNapMin * MIN_MS;

    const candidates: Milestone[] = [
      { ts: wakeTs, type: 'awake' },
      { ts: nap1Start, type: 'asleep' },
      { ts: nap1End, type: 'awake' },
    ];
    if (nap2End + 60 * MIN_MS < bedTs) {
      candidates.push({ ts: nap2Start, type: 'asleep' }, { ts: nap2End, type: 'awake' });
    }
    if (napStepMin > 0 && nap2End + baselines.typicalWakeWindowMin * MIN_MS + 40 * MIN_MS < bedTs) {
      const nap3Start = nap2End + baselines.typicalWakeWindowMin * MIN_MS;
      const nap3End = nap3Start + 35 * MIN_MS;
      if (nap3End + 60 * MIN_MS < bedTs) {
        candidates.push({ ts: nap3Start, type: 'asleep' }, { ts: nap3End, type: 'awake' });
      }
    }
    candidates.push({ ts: bedTs, type: 'asleep' });

    for (const m of candidates) {
      if (m.ts > startMs + 25 * MIN_MS && m.ts < endMs - 25 * MIN_MS) {
        milestones.push(m);
      }
    }

    if (cursorDay === stopAfterDay) break;
    cursorDay = shiftPlainDate(cursorDay, 1);
  }

  milestones.sort((a, b) => a.ts - b.ts);

  // Filter milestones so states alternate starting from initialType
  let curState: 'asleep' | 'awake' = initialType;
  let curTs = startMs;
  let idx = 0;

  for (const m of milestones) {
    if (m.type === curState) continue;
    if (m.ts - curTs < 20 * MIN_MS) continue;
    out.push({
      id: `${prefixId}-bridge-${idx++}`,
      state: curState,
      startMs: curTs,
      endMs: m.ts,
      durationMin: (m.ts - curTs) / MIN_MS,
      source: 'interpolated',
      interpolationReason: reason,
      inferredBoundaryType: m.type,
      inferredBoundaryMs: m.ts,
      kind: curState === 'asleep' ? 'nap' : 'wake-window',
    });
    curState = m.type;
    curTs = m.ts;
  }

  out.push({
    id: `${prefixId}-bridge-${idx}`,
    state: curState,
    startMs: curTs,
    endMs,
    durationMin: (endMs - curTs) / MIN_MS,
    source: 'interpolated',
    interpolationReason: reason,
    kind: curState === 'asleep' ? 'nap' : 'wake-window',
  });

  return out;
}

function classifySegments(raw: SleepSegment[], settings: BabySettings): SleepSegment[] {
  const tz = getTimeZoneId(settings.timeZone);
  const napCounterByDay = new Map<string, number>();

  return raw.map((seg, idx) => {
    const startHour = getLocalHour(seg.startMs, tz);
    const isDaytimeStart = startHour >= settings.dayStartHour && startHour < settings.nightStartHour;
    let kind: SegmentKind;
    let napIndex: number | undefined;

    if (seg.state === 'asleep') {
      if (isDaytimeStart && seg.durationMin < 270) {
        kind = 'nap';
        const dayKey = getSleepDayKey(seg.startMs, settings.dayStartHour, tz);
        const nextNap = (napCounterByDay.get(dayKey) ?? 0) + 1;
        napCounterByDay.set(dayKey, nextNap);
        napIndex = nextNap;
      } else {
        kind = 'night-sleep';
      }
    } else {
      const prev = raw[idx - 1];
      const next = raw[idx + 1];
      const nightTime =
        startHour < settings.dayStartHour || startHour >= settings.nightStartHour + 1;
      const betweenNightSleeps =
        (prev?.state === 'asleep' && !isDaytimeStart) ||
        (prev?.state === 'asleep' && getLocalHour(prev.startMs, tz) >= settings.nightStartHour);

      if (nightTime && next && next.state === 'asleep' && !isDaytimeStart && seg.durationMin <= 240) {
        kind = 'night-wake';
      } else if (
        nightTime &&
        startHour < settings.dayStartHour &&
        next &&
        next.state === 'asleep' &&
        getLocalHour(next.startMs, tz) < settings.dayStartHour
      ) {
        kind = 'night-wake';
      } else if (
        betweenNightSleeps &&
        startHour >= settings.nightStartHour &&
        seg.durationMin <= 180
      ) {
        kind = 'night-wake';
      } else {
        kind = 'wake-window';
      }
    }

    return {
      ...seg,
      kind,
      ...(napIndex !== undefined ? { napIndex } : {}),
    };
  });
}

export function buildSleepSegments(
  events: readonly SleepEvent[],
  settings: BabySettings,
  nowMs: number = Date.now(),
): SleepSegment[] {
  const tz = getTimeZoneId(settings.timeZone);
  const cleanEvents = deduplicateEvents(events);
  if (cleanEvents.length === 0) return [];

  const baselines = computeBaselines(cleanEvents, settings, nowMs);
  const segments: SleepSegment[] = [];

  for (let i = 0; i < cleanEvents.length - 1; i++) {
    const a = cleanEvents[i];
    const b = cleanEvents[i + 1];
    if (!a || !b) continue;
    const gapMs = b.timestamp - a.timestamp;
    const gapMin = gapMs / MIN_MS;
    if (gapMin <= 0) continue;

    // Case 1: Normal alternating pair
    if (a.type !== b.type) {
      const aHour = getLocalHour(a.timestamp, tz);
      const isDaytimeAsleep =
        a.type === 'asleep' && aHour >= settings.dayStartHour && aHour < settings.nightStartHour;
      const maxMin =
        a.type === 'asleep'
          ? isDaytimeAsleep
            ? baselines.maxPlausibleDaySleepMin
            : baselines.maxPlausibleNightSleepMin
          : baselines.maxPlausibleWakeMin;

      if (gapMin <= maxMin) {
        segments.push({
          id: `${a.id}__${b.id}`,
          state: a.type,
          startMs: a.timestamp,
          endMs: b.timestamp,
          durationMin: gapMin,
          source: 'real',
          kind: a.type === 'asleep' ? 'nap' : 'wake-window',
          startEventId: a.id,
          endEventId: b.id,
          comment: a.comment ?? b.comment,
        });
      } else {
        segments.push(
          ...bridgeLongGap(
            a.timestamp,
            b.timestamp,
            a.type,
            baselines,
            settings,
            `${a.id}__${b.id}`,
            'Untracked gap bridged from typical schedule (implausibly long gap between taps)',
          ),
        );
      }
      continue;
    }

    // Case 2: Missed wake tap (asleep -> asleep)
    if (a.type === 'asleep' && b.type === 'asleep') {
      const aHour = getLocalHour(a.timestamp, tz);
      const startedAtNight = isNightClockHour(aHour, settings);
      const crossesMorning =
        getSleepDayKey(a.timestamp, settings.dayStartHour, tz) !==
          getSleepDayKey(b.timestamp, settings.dayStartHour, tz) || gapMin >= 180;

      if (gapMin <= 18 * 60 && (startedAtNight || crossesMorning)) {
        const bDayKey = getSleepDayKey(b.timestamp, settings.dayStartHour, tz);
        const nominalMorningWakeMs = makeEpochOnSleepDay(
          bDayKey,
          settings.dayStartHour,
          baselines.morningWakeMinSinceDayStart,
          tz,
        );
        const minWakeMs = a.timestamp + 90 * MIN_MS;
        const maxWakeMs = b.timestamp - Math.min(baselines.typicalWakeWindowMin * MIN_MS, gapMs * 0.35);
        const estWakeMs = clamp(nominalMorningWakeMs, minWakeMs, Math.max(minWakeMs, maxWakeMs));

        segments.push(
          {
            id: `${a.id}__est-wake`,
            state: 'asleep',
            startMs: a.timestamp,
            endMs: estWakeMs,
            durationMin: (estWakeMs - a.timestamp) / MIN_MS,
            source: 'interpolated',
            interpolationReason: 'Missed morning wake-up tap — estimated from rolling baseline',
            inferredBoundaryType: 'awake',
            inferredBoundaryMs: estWakeMs,
            kind: 'night-sleep',
            startEventId: a.id,
            comment: a.comment,
          },
          {
            id: `est-wake__${b.id}`,
            state: 'awake',
            startMs: estWakeMs,
            endMs: b.timestamp,
            durationMin: (b.timestamp - estWakeMs) / MIN_MS,
            source: 'interpolated',
            interpolationReason: 'Estimated wake window before logged sleep (missed wake tap)',
            inferredBoundaryType: 'awake',
            inferredBoundaryMs: estWakeMs,
            kind: 'wake-window',
            endEventId: b.id,
          },
        );
      } else if (gapMin <= 12 * 60) {
        const estNapMin = clamp(baselines.typicalNapMin, 30, Math.max(30, gapMin * 0.55));
        const estWakeMs = a.timestamp + estNapMin * MIN_MS;
        segments.push(
          {
            id: `${a.id}__est-nap-wake`,
            state: 'asleep',
            startMs: a.timestamp,
            endMs: estWakeMs,
            durationMin: (estWakeMs - a.timestamp) / MIN_MS,
            source: 'interpolated',
            interpolationReason: 'Missed nap wake-up tap — estimated from typical nap length',
            inferredBoundaryType: 'awake',
            inferredBoundaryMs: estWakeMs,
            kind: 'nap',
            startEventId: a.id,
            comment: a.comment,
          },
          {
            id: `est-nap-wake__${b.id}`,
            state: 'awake',
            startMs: estWakeMs,
            endMs: b.timestamp,
            durationMin: (b.timestamp - estWakeMs) / MIN_MS,
            source: 'interpolated',
            interpolationReason: 'Estimated wake window after missed nap wake tap',
            inferredBoundaryType: 'awake',
            inferredBoundaryMs: estWakeMs,
            kind: 'wake-window',
            endEventId: b.id,
          },
        );
      } else {
        segments.push(
          ...bridgeLongGap(
            a.timestamp,
            b.timestamp,
            'asleep',
            baselines,
            settings,
            `${a.id}__${b.id}`,
            'Untracked multi-hour sleep/wake gap bridged automatically',
          ),
        );
      }
      continue;
    }

    // Case 3: Missed sleep tap (awake -> awake)
    if (a.type === 'awake' && b.type === 'awake') {
      const aHour = getLocalHour(a.timestamp, tz);
      const isNightWakeStart = isNightClockHour(aHour, settings);

      if (isNightWakeStart && gapMin <= 12 * 60) {
        const estNightWakeMin = clamp(baselines.typicalNightWakeMin, 15, Math.min(45, gapMin * 0.3));
        const estSleepMs = a.timestamp + estNightWakeMin * MIN_MS;
        segments.push(
          {
            id: `${a.id}__est-resleep`,
            state: 'awake',
            startMs: a.timestamp,
            endMs: estSleepMs,
            durationMin: (estSleepMs - a.timestamp) / MIN_MS,
            source: 'interpolated',
            interpolationReason: 'Missed return-to-sleep tap after night wake (~25m estimate)',
            inferredBoundaryType: 'asleep',
            inferredBoundaryMs: estSleepMs,
            kind: 'night-wake',
            startEventId: a.id,
            comment: a.comment,
          },
          {
            id: `est-resleep__${b.id}`,
            state: 'asleep',
            startMs: estSleepMs,
            endMs: b.timestamp,
            durationMin: (b.timestamp - estSleepMs) / MIN_MS,
            source: 'interpolated',
            interpolationReason: 'Estimated night sleep following missed return-to-sleep tap',
            inferredBoundaryType: 'asleep',
            inferredBoundaryMs: estSleepMs,
            kind: 'night-sleep',
            endEventId: b.id,
          },
        );
      } else if (
        gapMin <= 14 * 60 &&
        getSleepDayKey(a.timestamp, settings.dayStartHour, tz) ===
          getSleepDayKey(b.timestamp, settings.dayStartHour, tz)
      ) {
        const estWakeMin = clamp(baselines.typicalWakeWindowMin, 45, Math.max(45, gapMin * 0.55));
        const estSleepMs = a.timestamp + estWakeMin * MIN_MS;
        segments.push(
          {
            id: `${a.id}__est-nap`,
            state: 'awake',
            startMs: a.timestamp,
            endMs: estSleepMs,
            durationMin: (estSleepMs - a.timestamp) / MIN_MS,
            source: 'interpolated',
            interpolationReason: 'Missed asleep tap — estimated wake window before missed nap',
            inferredBoundaryType: 'asleep',
            inferredBoundaryMs: estSleepMs,
            kind: 'wake-window',
            startEventId: a.id,
            comment: a.comment,
          },
          {
            id: `est-nap__${b.id}`,
            state: 'asleep',
            startMs: estSleepMs,
            endMs: b.timestamp,
            durationMin: (b.timestamp - estSleepMs) / MIN_MS,
            source: 'interpolated',
            interpolationReason: 'Estimated missed nap before logged wake tap',
            inferredBoundaryType: 'asleep',
            inferredBoundaryMs: estSleepMs,
            kind: 'nap',
            endEventId: b.id,
          },
        );
      } else {
        segments.push(
          ...bridgeLongGap(
            a.timestamp,
            b.timestamp,
            'awake',
            baselines,
            settings,
            `${a.id}__${b.id}`,
            'Untracked multi-hour gap bridged from typical rhythm',
          ),
        );
      }
    }
  }

  // Trailing open segment from last event -> nowMs
  const last = cleanEvents[cleanEvents.length - 1];
  if (last && nowMs > last.timestamp) {
    const openMin = (nowMs - last.timestamp) / MIN_MS;
    const maxOpenMin =
      last.type === 'asleep'
        ? baselines.maxPlausibleNightSleepMin
        : baselines.maxPlausibleWakeMin * 1.25;

    if (openMin <= maxOpenMin) {
      segments.push({
        id: `${last.id}__now`,
        state: last.type,
        startMs: last.timestamp,
        endMs: nowMs,
        durationMin: openMin,
        source: 'real',
        kind: last.type === 'asleep' ? 'nap' : 'wake-window',
        startEventId: last.id,
        comment: last.comment,
        isOngoing: true,
      });
    } else {
      const bridged = bridgeLongGap(
        last.timestamp,
        nowMs,
        last.type,
        baselines,
        settings,
        `${last.id}__now`,
        'Forgotten older timer bridged up to current time',
      );
      const lastPiece = bridged[bridged.length - 1];
      if (lastPiece) {
        lastPiece.isOngoing = true;
      }
      segments.push(...bridged);
    }
  }

  return classifySegments(segments, settings);
}

export function getEstimatedClockSummary(events: readonly SleepEvent[], settings: BabySettings) {
  const b = computeBaselines(deduplicateEvents(events), settings, Date.now());
  return {
    typicalWakeMinutesOfDay: (settings.dayStartHour * 60 + b.morningWakeMinSinceDayStart + 1440) % 1440,
    typicalBedtimeMinutesOfDay: (settings.dayStartHour * 60 + b.bedtimeMinSinceDayStart + 1440) % 1440,
    typicalNapMin: b.typicalNapMin,
    typicalWakeWindowMin: b.typicalWakeWindowMin,
  };
}

export { getMinutesOfDay, epochToZonedDateTime };
