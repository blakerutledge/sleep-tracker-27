import { useMemo, useState } from 'react';
import { getWakeWindowTargetForAgeDays } from '../data/plsPlaybook.ts';
import { computeRangeStats, getCurrentAnchorDayKey } from '../engine/stats.ts';
import {
  formatMinutesHuman,
  formatShortDate,
  getBabyAgeInfo,
  shiftPlainDate,
} from '../lib/temporal.ts';
import type { BabySettings, SleepSegment } from '../types.ts';
import { RasterChart } from './RasterChart.tsx';
import { TotalsChart } from './TotalsChart.tsx';

interface GraphsViewProps {
  segments: readonly SleepSegment[];
  settings: BabySettings;
  nowMs: number;
  onSelectSegment: (seg: SleepSegment) => void;
}

const RANGES = [1, 3, 7, 30] as const;
type RangeDays = (typeof RANGES)[number];

export function GraphsView({
  segments,
  settings,
  nowMs,
  onSelectSegment,
}: GraphsViewProps) {
  const [rangeDays, setRangeDays] = useState<RangeDays>(7);
  const currentDayKey = useMemo(
    () => getCurrentAnchorDayKey(settings, nowMs),
    [settings, nowMs],
  );
  const [anchorOffsetDays, setAnchorOffsetDays] = useState(0);

  const anchorDayKey = useMemo(
    () => shiftPlainDate(currentDayKey, anchorOffsetDays),
    [currentDayKey, anchorOffsetDays],
  );

  const { days, summary } = useMemo(
    () => computeRangeStats(segments, settings, anchorDayKey, rangeDays, nowMs),
    [segments, settings, anchorDayKey, rangeDays, nowMs],
  );

  const age = useMemo(() => getBabyAgeInfo(settings, nowMs), [settings, nowMs]);
  const target = useMemo(
    () => getWakeWindowTargetForAgeDays(Math.max(0, age.totalDays)),
    [age.totalDays],
  );

  const periodLabel =
    rangeDays === 1
      ? formatShortDate(anchorDayKey)
      : `${formatShortDate(days[0]?.sleepDayKey ?? anchorDayKey)} – ${formatShortDate(anchorDayKey)}`;

  return (
    <>
      <section className="range-bar">
        <div className="segmented" role="group" aria-label="Timeframe">
          {RANGES.map((d) => (
            <button
              key={d}
              type="button"
              className={`seg-btn ${rangeDays === d ? 'active' : ''}`}
              onClick={() => setRangeDays(d)}
            >
              {d}D
            </button>
          ))}
        </div>

        <div className="chip-row" style={{ alignItems: 'center' }}>
          <button
            type="button"
            className="icon-btn"
            onClick={() =>
              setAnchorOffsetDays(
                (o) => o - Math.max(1, rangeDays === 1 ? 1 : Math.floor(rangeDays / 2)),
              )
            }
            aria-label="Previous period"
          >
            ‹
          </button>
          <span className="muted" style={{ fontWeight: 600 }}>
            {periodLabel}
          </span>
          <button
            type="button"
            className="icon-btn"
            onClick={() =>
              setAnchorOffsetDays((o) =>
                Math.min(0, o + Math.max(1, rangeDays === 1 ? 1 : Math.floor(rangeDays / 2))),
              )
            }
            disabled={anchorOffsetDays >= 0}
            aria-label="Next period"
          >
            ›
          </button>
          {anchorOffsetDays < 0 ? (
            <button type="button" className="chip-btn" onClick={() => setAnchorOffsetDays(0)}>
              Today
            </button>
          ) : null}
        </div>
      </section>

      <section className="box">
        <div className="box-head">
          <h2 className="box-title">24-Hour Timeline</h2>
          <span className="muted">
            {settings.dayStartHour}:00 → {settings.dayStartHour}:00
          </span>
        </div>

        <div className="legend-row">
          <span className="legend-item">
            <span className="swatch night" /> Night
          </span>
          <span className="legend-item">
            <span className="swatch nap" /> Nap
          </span>
          <span className="legend-item">
            <span className="swatch wake" /> Wake
          </span>
          <span className="legend-item">
            <span className="swatch interp" /> Estimated (tap to confirm)
          </span>
        </div>

        {segments.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Log your first sleep or wake event (or load Demo Data in Setup) to render the timeline.
          </p>
        ) : (
          <RasterChart
            days={days}
            allSegments={segments}
            settings={settings}
            onSelectSegment={onSelectSegment}
          />
        )}
      </section>

      {rangeDays > 1 && segments.length > 0 ? (
        <section className="box">
          <div className="box-head">
            <h2 className="box-title">Daily Sleep Totals</h2>
            <span className="muted">
              PLS target {target.totalSleepMinHrs}–{target.totalSleepMaxHrs}h/day
            </span>
          </div>
          <TotalsChart days={days} settings={settings} nowMs={nowMs} />
        </section>
      ) : null}

      <section aria-label="Sleep statistics">
        <div className="stats-matrix">
          <div className="stat-cell">
            <span className="stat-label">Naps / Day</span>
            <span className="stat-val">
              {summary.avgNapCount !== null ? summary.avgNapCount : '—'}
            </span>
            <span className="stat-sub">Target {target.napsPerDayLabel}</span>
          </div>

          <div className="stat-cell">
            <span className="stat-label">Nap 1 Avg</span>
            <span className="stat-val">{formatMinutesHuman(summary.napAvgMin[1])}</span>
            <span className="stat-sub">Target {target.napDurationLabel}</span>
          </div>

          <div className="stat-cell">
            <span className="stat-label">Nap 2 Avg</span>
            <span className="stat-val">{formatMinutesHuman(summary.napAvgMin[2])}</span>
            <span className="stat-sub">Midday</span>
          </div>

          <div className="stat-cell">
            <span className="stat-label">Nap 3 Avg</span>
            <span className="stat-val">{formatMinutesHuman(summary.napAvgMin[3])}</span>
            <span className="stat-sub">Bridge nap</span>
          </div>

          {summary.napAvgMin[4] !== null ? (
            <div className="stat-cell">
              <span className="stat-label">Nap 4 Avg</span>
              <span className="stat-val">{formatMinutesHuman(summary.napAvgMin[4])}</span>
              <span className="stat-sub">Newborn</span>
            </div>
          ) : null}

          <div className="stat-cell">
            <span className="stat-label">Night Wakes</span>
            <span className="stat-val">
              {summary.avgNightWakes !== null ? summary.avgNightWakes : '—'}
            </span>
            <span className="stat-sub">Per night</span>
          </div>

          <div className="stat-cell">
            <span className="stat-label">Longest Stretch</span>
            <span className="stat-val">
              {formatMinutesHuman(summary.avgLongestNightStretchMin)}
            </span>
            <span className="stat-sub">Night unbroken</span>
          </div>

          <div className="stat-cell">
            <span className="stat-label">Night / Day</span>
            <span className="stat-val">
              {formatMinutesHuman(summary.avgNightSleepMin)} /{' '}
              {formatMinutesHuman(summary.avgDayNapMin)}
            </span>
            <span className="stat-sub">Total {formatMinutesHuman(summary.avgTotalSleepMin)}</span>
          </div>

          <div className="stat-cell">
            <span className="stat-label">Pre-Bed Wake</span>
            <span className="stat-val">{formatMinutesHuman(summary.avgPreBedWakeWindowMin)}</span>
            <span className="stat-sub">
              {summary.preBedMultiplier !== null
                ? `${summary.preBedMultiplier}x day WW`
                : 'Last window'}
            </span>
          </div>

          <div className="stat-cell">
            <span className="stat-label">Coverage</span>
            <span className="stat-val">{summary.realCoveragePct}%</span>
            <span className="stat-sub">
              {summary.daysWithRealData}/{summary.daysCount} days
            </span>
          </div>
        </div>
      </section>
    </>
  );
}
