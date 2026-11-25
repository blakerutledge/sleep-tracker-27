import { useMemo, useState } from 'react'
import { RasterChart } from '#src/components/RasterChart/index.tsx'
import { TotalsChart } from '#src/components/TotalsChart/index.tsx'
import { getWakeWindowTargetForAgeDays } from '#src/data/plsPlaybook.ts'
import { computeRangeStats, getCurrentAnchorDayKey } from '#src/engine/stats.ts'
import {
    formatMinutesHuman,
    formatShortDate,
    getBabyAgeInfo,
    shiftPlainDate,
} from '#src/lib/temporal.ts'
import type { BabySettings, SleepSegment } from '#src/types.ts'
import styles from './GraphsView.module.scss'

interface GraphsViewProps {
    segments: readonly SleepSegment[]
    settings: BabySettings
    nowMs: number
    onSelectSegment: (seg: SleepSegment) => void
}

const RANGES = [1, 3, 7, 30] as const
type RangeDays = (typeof RANGES)[number]

export const GraphsView = ({ segments, settings, nowMs, onSelectSegment }: GraphsViewProps) => {
    const [rangeDays, setRangeDays] = useState<RangeDays>(7)
    const currentDayKey = useMemo(() => getCurrentAnchorDayKey(settings, nowMs), [settings, nowMs])
    const [anchorOffsetDays, setAnchorOffsetDays] = useState(0)

    const anchorDayKey = useMemo(
        () => shiftPlainDate(currentDayKey, anchorOffsetDays),
        [currentDayKey, anchorOffsetDays],
    )

    const { days, summary } = useMemo(
        () => computeRangeStats(segments, settings, anchorDayKey, rangeDays, nowMs),
        [segments, settings, anchorDayKey, rangeDays, nowMs],
    )

    const age = useMemo(() => getBabyAgeInfo(settings, nowMs), [settings, nowMs])
    const target = useMemo(
        () => getWakeWindowTargetForAgeDays(Math.max(0, age.totalDays)),
        [age.totalDays],
    )

    const periodLabel =
        rangeDays === 1
            ? formatShortDate(anchorDayKey)
            : `${formatShortDate(days[0]?.sleepDayKey ?? anchorDayKey)} – ${formatShortDate(anchorDayKey)}`

    return (
        <>
            <section className={styles.rangeBar}>
                <fieldset className={styles.segmented} aria-label='Timeframe'>
                    {RANGES.map((d) => (
                        <button
                            key={d}
                            type='button'
                            className={`${styles.segBtn} ${rangeDays === d ? styles.active : ''}`}
                            onClick={() => setRangeDays(d)}>
                            {d}D
                        </button>
                    ))}
                </fieldset>

                <div className='chip-row' style={{ alignItems: 'center' }}>
                    <button
                        type='button'
                        className='icon-btn'
                        onClick={() =>
                            setAnchorOffsetDays(
                                (o) =>
                                    o -
                                    Math.max(1, rangeDays === 1 ? 1 : Math.floor(rangeDays / 2)),
                            )
                        }
                        aria-label='Previous period'>
                        ‹
                    </button>
                    <span className='muted' style={{ fontWeight: 600 }}>
                        {periodLabel}
                    </span>
                    <button
                        type='button'
                        className='icon-btn'
                        onClick={() =>
                            setAnchorOffsetDays((o) =>
                                Math.min(
                                    0,
                                    o +
                                        Math.max(
                                            1,
                                            rangeDays === 1 ? 1 : Math.floor(rangeDays / 2),
                                        ),
                                ),
                            )
                        }
                        disabled={anchorOffsetDays >= 0}
                        aria-label='Next period'>
                        ›
                    </button>
                    {anchorOffsetDays < 0 ? (
                        <button
                            type='button'
                            className='chip-btn'
                            onClick={() => setAnchorOffsetDays(0)}>
                            Today
                        </button>
                    ) : null}
                </div>
            </section>

            <section className='box'>
                <div className='box-head'>
                    <h2 className='box-title'>24-Hour Timeline</h2>
                    <span className='muted'>
                        {settings.dayStartHour}:00 → {settings.dayStartHour}:00
                    </span>
                </div>

                <div className={styles.legendRow}>
                    <span className={styles.legendItem}>
                        <span className={`${styles.swatch} ${styles.night}`} /> Night
                    </span>
                    <span className={styles.legendItem}>
                        <span className={`${styles.swatch} ${styles.nap}`} /> Nap
                    </span>
                    <span className={styles.legendItem}>
                        <span className={`${styles.swatch} ${styles.wake}`} /> Wake
                    </span>
                    <span className={styles.legendItem}>
                        <span className={`${styles.swatch} ${styles.interp}`} /> Estimated (tap to
                        confirm)
                    </span>
                </div>

                {segments.length === 0 ? (
                    <p className='muted' style={{ margin: 0 }}>
                        Log your first sleep or wake event (or load Demo Data in Setup) to render
                        the timeline.
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
                <section className='box'>
                    <div className='box-head'>
                        <h2 className='box-title'>Daily Sleep Totals</h2>
                        <span className='muted'>
                            PLS target {target.totalSleepMinHrs}–{target.totalSleepMaxHrs}h/day
                        </span>
                    </div>
                    <TotalsChart days={days} settings={settings} nowMs={nowMs} />
                </section>
            ) : null}

            <section aria-label='Sleep statistics'>
                <div className={styles.statsMatrix}>
                    <div className={styles.statCell}>
                        <span className={styles.statLabel}>Naps / Day</span>
                        <span className={styles.statVal}>
                            {summary.avgNapCount !== null ? summary.avgNapCount : '—'}
                        </span>
                        <span className={styles.statSub}>Target {target.napsPerDayLabel}</span>
                    </div>

                    <div className={styles.statCell}>
                        <span className={styles.statLabel}>Nap 1 Avg</span>
                        <span className={styles.statVal}>
                            {formatMinutesHuman(summary.napAvgMin[1])}
                        </span>
                        <span className={styles.statSub}>Target {target.napDurationLabel}</span>
                    </div>

                    <div className={styles.statCell}>
                        <span className={styles.statLabel}>Nap 2 Avg</span>
                        <span className={styles.statVal}>
                            {formatMinutesHuman(summary.napAvgMin[2])}
                        </span>
                        <span className={styles.statSub}>Midday</span>
                    </div>

                    <div className={styles.statCell}>
                        <span className={styles.statLabel}>Nap 3 Avg</span>
                        <span className={styles.statVal}>
                            {formatMinutesHuman(summary.napAvgMin[3])}
                        </span>
                        <span className={styles.statSub}>Bridge nap</span>
                    </div>

                    {summary.napAvgMin[4] !== null ? (
                        <div className={styles.statCell}>
                            <span className={styles.statLabel}>Nap 4 Avg</span>
                            <span className={styles.statVal}>
                                {formatMinutesHuman(summary.napAvgMin[4])}
                            </span>
                            <span className={styles.statSub}>Newborn</span>
                        </div>
                    ) : null}

                    <div className={styles.statCell}>
                        <span className={styles.statLabel}>Night Wakes</span>
                        <span className={styles.statVal}>
                            {summary.avgNightWakes !== null ? summary.avgNightWakes : '—'}
                        </span>
                        <span className={styles.statSub}>Per night</span>
                    </div>

                    <div className={styles.statCell}>
                        <span className={styles.statLabel}>Longest Stretch</span>
                        <span className={styles.statVal}>
                            {formatMinutesHuman(summary.avgLongestNightStretchMin)}
                        </span>
                        <span className={styles.statSub}>Night unbroken</span>
                    </div>

                    <div className={styles.statCell}>
                        <span className={styles.statLabel}>Night / Day</span>
                        <span className={styles.statVal}>
                            {formatMinutesHuman(summary.avgNightSleepMin)} /{' '}
                            {formatMinutesHuman(summary.avgDayNapMin)}
                        </span>
                        <span className={styles.statSub}>
                            Total {formatMinutesHuman(summary.avgTotalSleepMin)}
                        </span>
                    </div>

                    <div className={styles.statCell}>
                        <span className={styles.statLabel}>Pre-Bed Wake</span>
                        <span className={styles.statVal}>
                            {formatMinutesHuman(summary.avgPreBedWakeWindowMin)}
                        </span>
                        <span className={styles.statSub}>
                            {summary.preBedMultiplier !== null
                                ? `${summary.preBedMultiplier}x day WW`
                                : 'Last window'}
                        </span>
                    </div>

                    <div className={styles.statCell}>
                        <span className={styles.statLabel}>Coverage</span>
                        <span className={styles.statVal}>{summary.realCoveragePct}%</span>
                        <span className={styles.statSub}>
                            {summary.daysWithRealData}/{summary.daysCount} days
                        </span>
                    </div>
                </div>
            </section>
        </>
    )
}
