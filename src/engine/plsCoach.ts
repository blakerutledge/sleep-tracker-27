import { getPhaseForAgeDays, getWakeWindowTargetForAgeDays } from '../data/plsPlaybook.ts';
import {
  formatClockTime,
  formatMinutesHuman,
  getBabyAgeInfo,
  getLocalHour,
  getSleepDayBounds,
  getSleepDayKey,
} from '../lib/temporal.ts';
import type { BabySettings, PlsInsight, SleepEvent, SleepSegment } from '../types.ts';
import { computeRangeStats } from './stats.ts';

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  if (s.length % 2 === 1) return s[mid] ?? null;
  const a = s[mid - 1];
  const b = s[mid];
  if (a === undefined || b === undefined) return null;
  return Math.round((a + b) / 2);
}

export interface CoachEvaluation {
  insights: PlsInsight[];
  optimalSlipBedtimeClock: string | null;
}

export function evaluatePlsCoach(
  segments: readonly SleepSegment[],
  _events: readonly SleepEvent[],
  settings: BabySettings,
  nowMs: number = Date.now(),
): CoachEvaluation {
  const insights: PlsInsight[] = [];
  const age = getBabyAgeInfo(settings, nowMs);

  // Pre-arrival guidance before due date
  if (age.isPreArrival) {
    insights.push({
      id: 'pre-arrival-countdown',
      severity: 'milestone',
      title: `Pre-Arrival Mode · ${age.daysUntilDue} Days Until Due Date`,
      detail:
        'Use Demo Data in Settings anytime to preview the 1d/3d/7d/30d graphs and gap interpolation. Before Jan 1, set up ~50 dB continuous white noise, pitch-black shades, and a video monitor over the bassinet.',
      chapterRef: 'Phase 0 · Ch. 1 & 5',
      metricBadge: `Due ${age.birthPlainDateStr}`,
    });
    return { insights, optimalSlipBedtimeClock: null };
  }

  const tz = settings.timeZone;
  const effectiveDays = Math.max(0, age.totalDays);
  const target = getWakeWindowTargetForAgeDays(effectiveDays);
  const phase = getPhaseForAgeDays(effectiveDays);

  // Evaluate only REAL segments so missed/interpolated taps never trigger false alerts
  const realSegments = segments.filter((s) => s.source === 'real');
  const todayKey = getSleepDayKey(nowMs, settings.dayStartHour, tz);
  const { days } = computeRangeStats(
    realSegments,
    { ...settings, includeInterpolatedInStats: false },
    todayKey,
    7,
    nowMs,
  );
  const realDays = days.filter((d) => d.hasRealData);

  // 1. Live wake-window pacing
  const ongoing = segments[segments.length - 1];
  if (ongoing && ongoing.isOngoing && ongoing.source === 'real' && ongoing.state === 'awake') {
    const durMin = Math.round(ongoing.durationMin);
    const localHr = getLocalHour(nowMs, tz);
    const isPreBedContext = localHr >= settings.nightStartHour - 3;
    const ceiling = isPreBedContext ? target.preBedMax : target.wakeMax;
    const floor = isPreBedContext ? target.preBedMin : target.wakeMin;

    if (durMin >= ceiling + 15) {
      insights.push({
        id: 'live-ww-over',
        severity: 'watch',
        title: `Awake ${formatMinutesHuman(durMin)} — Past Target Window`,
        detail: `For ${target.ageLabel}, PLS Table 7/1 targets ${formatMinutesHuman(floor)}–${formatMinutesHuman(ceiling)}. Extending too long raises overtired cortisol.`,
        chapterRef: 'Ch. 3, 5 & 10 · Table 7',
        metricBadge: `${formatMinutesHuman(durMin)} awake`,
      });
    } else if (durMin >= floor) {
      insights.push({
        id: 'live-ww-sweet',
        severity: 'good',
        title: `In the Sleep Window (${formatMinutesHuman(durMin)} Awake)`,
        detail: `Current wake duration sits inside the ${target.ageLabel} target (${formatMinutesHuman(floor)}–${formatMinutesHuman(ceiling)}). Watch for early sleepy cues.`,
        chapterRef: 'Ch. 10 · Table 7',
        metricBadge: `${formatMinutesHuman(floor)}–${formatMinutesHuman(ceiling)}`,
      });
    }
  }

  // 2. Post-4:00 PM micro-nap deflation check (last 48 hours)
  const cutoff48h = nowMs - 48 * 3600_000;
  const recentLateMicroNaps = realSegments.filter((s) => {
    if (s.state !== 'asleep' || s.isOngoing || s.startMs < cutoff48h) return false;
    const hr = getLocalHour(s.startMs, tz);
    return hr >= 16 && hr < settings.nightStartHour && s.durationMin >= 2 && s.durationMin <= 25;
  });
  if (recentLateMicroNaps.length > 0 && effectiveDays >= 42) {
    const latest = recentLateMicroNaps[recentLateMicroNaps.length - 1]!;
    insights.push({
      id: 'post-4pm-micronap',
      severity: 'watch',
      title: 'Post-4:00 PM Micro-Nap Deflated Sleep Pressure',
      detail: `Logged a ${Math.round(latest.durationMin)}m snooze at ${formatClockTime(latest.startMs, tz)}. PLS Ch. 3 & 4 note even a 5–10m car/nursing doze after 4:00 PM empties the sleep balloon and delays bedtime.`,
      chapterRef: 'Ch. 3, 4 & 10',
      metricBadge: `${Math.round(latest.durationMin)}m @ ${formatClockTime(latest.startMs, tz)}`,
    });
  }

  // 3. Bedtime False Starts (first real night-sleep 25..65m followed by a real night-wake)
  let falseStartNights = 0;
  for (const d of realDays) {
    const firstSleep = d.nightSleeps[0];
    if (!firstSleep || firstSleep.isOngoing) continue;
    if (firstSleep.durationMin >= 25 && firstSleep.durationMin <= 65) {
      const hasImmediateWake = d.nightWakes.some(
        (w) => Math.abs(w.startMs - firstSleep.endMs) <= 2 * 60_000,
      );
      if (hasImmediateWake) falseStartNights++;
    }
  }
  if (falseStartNights >= 2 && effectiveDays >= 60) {
    const preBedSamples = realDays
      .map((d) => d.preBedWakeWindowMin)
      .filter((v): v is number => v !== null);
    const daySamples = realDays
      .map((d) => d.avgDaytimeWakeWindowMin)
      .filter((v): v is number => v !== null);
    const avgPreBed = preBedSamples.length
      ? preBedSamples.reduce((a, b) => a + b, 0) / preBedSamples.length
      : null;
    const avgDay = daySamples.length
      ? daySamples.reduce((a, b) => a + b, 0) / daySamples.length
      : null;
    const multText =
      avgPreBed && avgDay && avgDay > 0
        ? ` Your pre-bed wake ratio is ${(avgPreBed / avgDay).toFixed(2)}x (PLS targets 1.3x–1.5x).`
        : '';

    insights.push({
      id: 'false-starts',
      severity: 'action',
      title: `Recurring Bedtime False Starts (${falseStartNights} of last ${realDays.length} nights)`,
      detail: `Waking ~35–60m after bedtime points to an undertired/overtired pre-bed wake window OR a lingering bedtime sleep association (ensure feeding ends 20–30m before crib and put down 100% awake).${multText}`,
      chapterRef: 'Ch. 3, 4 & 7',
      metricBadge: `${falseStartNights} nights`,
    });
  }

  // 4. Split Nights / "Night Gaps" (Ch. 12: >= 60m real mid-night wake)
  const splitGapLengths: number[] = [];
  for (const d of realDays) {
    for (const w of d.nightWakes) {
      if (w.durationMin >= 60) {
        splitGapLengths.push(Math.round(w.durationMin));
      }
    }
  }
  if (splitGapLengths.length > 0 && effectiveDays >= 150) {
    const medianGap = median(splitGapLengths) ?? 60;
    insights.push({
      id: 'split-nights',
      severity: 'action',
      title: `Split-Night "Night Gap" Detected (~${formatMinutesHuman(medianGap)})`,
      detail: `Being wide awake mid-night for 1–2 hours signals "Too Long in Bed" (undertiredness). PLS Ch. 12 prescribes trimming total daily scheduled sleep (nap caps or time in bed at night) by ~${formatMinutesHuman(medianGap)}, the exact length of the gap.`,
      chapterRef: 'Ch. 12 · Too Long in Bed',
      metricBadge: `-${formatMinutesHuman(medianGap)} sleep budget`,
    });
  }

  // 5. Bedtime Consistency Drift (Ch. 3: >35m spread at >=3m)
  const bedtimeOffsets = realDays
    .map((d) => d.bedtimeMinOfSleepDay)
    .filter((v): v is number => v !== null);
  if (effectiveDays >= 90 && bedtimeOffsets.length >= 4) {
    const minOff = Math.min(...bedtimeOffsets);
    const maxOff = Math.max(...bedtimeOffsets);
    const spread = maxOff - minOff;
    if (spread > 40) {
      insights.push({
        id: 'bedtime-drift',
        severity: 'watch',
        title: `Bedtime Spread of ${formatMinutesHuman(spread)} Over Past Week`,
        detail:
          'After 3 months, PLS Ch. 3 emphasizes locking bedtime within a 15–30 minute window 7 days a week to anchor circadian rhythm and cut bedtime crying.',
        chapterRef: 'Ch. 3 · Goddess of Consistency',
        metricBadge: `±${Math.round(spread / 2)}m swing`,
      });
    }
  }

  // 6. Habitual Short Naps (Ch. 10: >=6m old + Nap 1/2 averaging <= 38m)
  if (effectiveDays >= 180) {
    const earlyNaps = realDays
      .flatMap((d) => [d.napDurationsByIndex[1], d.napDurationsByIndex[2]])
      .filter((v): v is number => v !== undefined);
    if (earlyNaps.length >= 4) {
      const avgEarlyNap = Math.round(earlyNaps.reduce((a, b) => a + b, 0) / earlyNaps.length);
      if (avgEarlyNap <= 38) {
        insights.push({
          id: 'short-naps',
          severity: 'watch',
          title: `Habitual Short Naps (~${avgEarlyNap}m Avg on Naps 1–2)`,
          detail:
            'If naps are independent at 6+ months but stay <=35m, commit 5–7 days to either Bore-to-Sleep (wait 15–30m in dark crib) OR Wake-to-Sleep (gently stir 5–10m before usual wakeup).',
          chapterRef: 'Ch. 10 · Extending Short Naps',
          metricBadge: `${avgEarlyNap}m avg`,
        });
      }
    }
  }

  // 7. 12-Month 1-Nap Fake-Out Guardrail & 3->2 Nap Drop
  if (effectiveDays >= 285 && effectiveDays <= 400 && realDays.length >= 3) {
    const daysWithSingleLongN1 = realDays.filter(
      (d) => d.napCount === 1 && (d.napDurationsByIndex[1] ?? 0) > 65,
    );
    if (daysWithSingleLongN1.length >= 2) {
      insights.push({
        id: 'fake-out-1-nap',
        severity: 'watch',
        title: 'Beware the 12-Month "1-Nap Fake-Out"',
        detail:
          'Before dropping to 1 nap permanently around 9.5–13 months, PLS Ch. 10 & 12 advise capping Nap 1 at 60 mins max so enough sleep pressure remains for Nap 2.',
        chapterRef: 'Ch. 10 & 12',
        metricBadge: 'Cap Nap 1 @ 60m',
      });
    }
  } else if (effectiveDays >= 180 && effectiveDays <= 275 && realDays.length >= 3) {
    const lateBed3Naps = realDays.filter(
      (d) => d.napCount >= 3 && d.bedtimeMs !== null && getLocalHour(d.bedtimeMs, tz) >= 20,
    );
    if (lateBed3Naps.length >= 2) {
      insights.push({
        id: 'nap-drop-3-to-2',
        severity: 'watch',
        title: 'Signs of 3 → 2 Nap Transition',
        detail:
          'A 3rd catnap pushing bedtime past 8:00–8:30 PM is a classic sign to stretch wake windows toward 2.5/3/3.5–4 hrs on 2 naps (using a temporary 6:00–6:30 PM early bedtime on short-nap days).',
        chapterRef: 'Ch. 10 · Nap Transitions',
        metricBadge: '3 → 2 Naps',
      });
    }
  }

  // 8. Ch. 7 Optimal Night-1 SLIP Bedtime Calculator
  let optimalSlipBedtimeClock: string | null = null;
  if (bedtimeOffsets.length >= 2) {
    const medianOffset = median(bedtimeOffsets);
    if (medianOffset !== null) {
      const { startMs } = getSleepDayBounds(todayKey, settings.dayStartHour, tz);
      const sampleBedMs = startMs + medianOffset * 60_000;
      optimalSlipBedtimeClock = formatClockTime(sampleBedMs, tz);
      if (effectiveDays >= 105 && effectiveDays <= 240) {
        insights.push({
          id: 'optimal-slip-time',
          severity: 'milestone',
          title: `Ch. 7 SLIP Put-Down Target: ${optimalSlipBedtimeClock}`,
          detail: `Based on recent real bedtimes, baby actually falls 100% asleep around ${optimalSlipBedtimeClock}. On SLIP Night 1, put baby in the crib wide awake right at ${optimalSlipBedtimeClock} (not earlier) to prevent undertired crying.`,
          chapterRef: 'Ch. 7 · Pre-SLIP Timing',
          metricBadge: optimalSlipBedtimeClock,
        });
      }
    }
  }

  // 9. Active Phase Milestone Summary
  insights.push({
    id: `phase-${phase.id}`,
    severity: 'milestone',
    title: `${phase.title} (${phase.ageSpan})`,
    detail: phase.rules[0] ?? phase.biology,
    chapterRef: `PLS Chronological Guide · ${phase.calendarWindow}`,
    metricBadge: target.wakeTimeLabel,
  });

  return { insights, optimalSlipBedtimeClock };
}
