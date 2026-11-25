import { useMemo, useState } from 'react'
import { getWakeWindowTargetForAgeDays } from '#src/data/plsPlaybook.ts'
import {
    epochToLocalDateTimeInput,
    formatClockTime,
    formatElapsedSince,
    formatMinutesHuman,
    getBabyAgeInfo,
    localDateTimeInputToEpoch,
} from '#src/lib/temporal.ts'
import type { BabySettings, SleepEvent, SleepEventType, SleepSegment } from '#src/types.ts'
import styles from './EntryView.module.scss'

interface EntryViewProps {
    events: readonly SleepEvent[]
    segments: readonly SleepSegment[]
    settings: BabySettings
    nowMs: number
    onAddEvent: (type: SleepEventType, timestamp: number, comment?: string) => Promise<SleepEvent>
    onDeleteEvent: (id: string) => Promise<void>
    onSelectEditEvent: (event: SleepEvent) => void
    onLoadDemo: () => Promise<void>
}

const OFFSET_CHIPS = [
    { label: 'Now', minutes: 0 },
    { label: '-5m', minutes: 5 },
    { label: '-10m', minutes: 10 },
    { label: '-15m', minutes: 15 },
    { label: '-30m', minutes: 30 },
    { label: '-1h', minutes: 60 },
] as const

export const EntryView = ({
    events,
    segments,
    settings,
    nowMs,
    onAddEvent,
    onDeleteEvent,
    onSelectEditEvent,
    onLoadDemo,
}: EntryViewProps) => {
    const [selectedOffsetMin, setSelectedOffsetMin] = useState<number | 'custom'>(0)
    const [customDateTime, setCustomDateTime] = useState(() =>
        epochToLocalDateTimeInput(nowMs, settings.timeZone),
    )
    const [comment, setComment] = useState('')
    const [lastLogged, setLastLogged] = useState<SleepEvent | null>(null)
    const [saving, setSaving] = useState(false)

    const tz = settings.timeZone
    const age = useMemo(() => getBabyAgeInfo(settings, nowMs), [settings, nowMs])
    const target = useMemo(
        () => getWakeWindowTargetForAgeDays(Math.max(0, age.totalDays)),
        [age.totalDays],
    )

    const sortedDesc = useMemo(
        () => [...events].sort((a, b) => b.timestamp - a.timestamp),
        [events],
    )
    const latestEvent = sortedDesc[0] ?? null
    const ongoingSegment = segments[segments.length - 1] ?? null

    const isCurrentlyAsleep = latestEvent?.type === 'asleep'
    const recommendedNext: SleepEventType | null = latestEvent
        ? latestEvent.type === 'asleep'
            ? 'awake'
            : 'asleep'
        : null

    const resolveTimestamp = (): number => {
        if (selectedOffsetMin === 'custom') {
            const parsed = localDateTimeInputToEpoch(customDateTime, tz)
            if (parsed !== null) return parsed
        }
        const mins = typeof selectedOffsetMin === 'number' ? selectedOffsetMin : 0
        return Date.now() - mins * 60_000
    }

    const handleTap = async (type: SleepEventType) => {
        if (saving) return
        setSaving(true)
        try {
            const timestamp = resolveTimestamp()
            const created = await onAddEvent(type, timestamp, comment)
            setLastLogged(created)
            setComment('')
            setSelectedOffsetMin(0)
        } finally {
            setSaving(false)
        }
    }

    const offsetSubLabel =
        selectedOffsetMin === 0
            ? 'right now'
            : selectedOffsetMin === 'custom'
              ? 'custom time'
              : `${selectedOffsetMin}m ago`

    return (
        <>
            <section className={styles.heroZone}>
                <span className={styles.heroKicker}>
                    {latestEvent ? (isCurrentlyAsleep ? 'Sleeping' : 'Awake') : 'Ready'}
                </span>
                <h2 className={styles.heroState}>
                    {latestEvent
                        ? `${isCurrentlyAsleep ? 'Asleep' : 'Awake'} — ${formatElapsedSince(latestEvent.timestamp, nowMs, tz)}`
                        : 'No sleep logs yet'}
                </h2>
                <p className='muted' style={{ margin: 0 }}>
                    {latestEvent ? (
                        <>
                            Since {formatClockTime(latestEvent.timestamp, tz)} · Target{' '}
                            {target.wakeTimeLabel}
                            {ongoingSegment?.source === 'interpolated'
                                ? ' (older timer capped — tap below to log fresh transition)'
                                : ''}
                        </>
                    ) : age.isPreArrival ? (
                        `Due ${age.birthPlainDateStr} (${age.daysUntilDue}d away) · 0–6w target ${target.wakeTimeLabel}`
                    ) : (
                        `Target wake window: ${target.wakeTimeLabel}`
                    )}
                </p>
            </section>

            <section className={styles.actionGrid} aria-label='Log sleep transition'>
                <button
                    type='button'
                    className={`${styles.actionBtn} ${recommendedNext === 'asleep' ? styles.isNext : ''}`}
                    onClick={() => handleTap('asleep')}
                    disabled={saving}>
                    <span className={styles.actionTitle}>Sleep</span>
                    <span className={styles.actionSub}>{offsetSubLabel}</span>
                </button>

                <button
                    type='button'
                    className={`${styles.actionBtn} ${recommendedNext === 'awake' ? styles.isNext : ''}`}
                    onClick={() => handleTap('awake')}
                    disabled={saving}>
                    <span className={styles.actionTitle}>Wake</span>
                    <span className={styles.actionSub}>{offsetSubLabel}</span>
                </button>
            </section>

            {lastLogged ? (
                <div className='banner' role='status'>
                    <span>
                        Saved {lastLogged.type === 'asleep' ? 'Sleep' : 'Wake'} at{' '}
                        {formatClockTime(lastLogged.timestamp, tz)}
                    </span>
                    <button
                        type='button'
                        className='btn'
                        onClick={async () => {
                            await onDeleteEvent(lastLogged.id)
                            setLastLogged(null)
                        }}>
                        Undo
                    </button>
                </div>
            ) : null}

            <section className={styles.inlineControls} aria-label='Time offset and note'>
                <div className='chip-row'>
                    {OFFSET_CHIPS.map((c) => (
                        <button
                            key={c.label}
                            type='button'
                            className={`chip-btn ${selectedOffsetMin === c.minutes ? 'active' : ''}`}
                            onClick={() => setSelectedOffsetMin(c.minutes)}>
                            {c.label}
                        </button>
                    ))}
                    <button
                        type='button'
                        className={`chip-btn ${selectedOffsetMin === 'custom' ? 'active' : ''}`}
                        onClick={() => {
                            setCustomDateTime(epochToLocalDateTimeInput(Date.now(), tz))
                            setSelectedOffsetMin('custom')
                        }}>
                        Custom
                    </button>
                </div>

                {selectedOffsetMin === 'custom' ? (
                    <input
                        aria-label='Exact date and time'
                        type='datetime-local'
                        className='input-control'
                        value={customDateTime}
                        onChange={(e) => setCustomDateTime(e.target.value)}
                    />
                ) : null}

                <textarea
                    aria-label='Optional note'
                    className='input-control'
                    placeholder='Add note (optional)...'
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                />
            </section>

            {sortedDesc.length > 0 ? (
                <section aria-label='Recent transitions'>
                    <div className={styles.logList}>
                        {sortedDesc.slice(0, 6).map((ev, idx) => {
                            const prevOlder = sortedDesc[idx + 1]
                            const gapLabel = prevOlder
                                ? formatMinutesHuman((ev.timestamp - prevOlder.timestamp) / 60_000)
                                : null
                            return (
                                <button
                                    key={ev.id}
                                    type='button'
                                    className={styles.logRow}
                                    onClick={() => onSelectEditEvent(ev)}>
                                    <div className={styles.logRowMain}>
                                        <span className={styles.logRowTitle}>
                                            {ev.type === 'asleep' ? 'Sleep' : 'Wake'}
                                            {gapLabel ? (
                                                <span
                                                    className='muted'
                                                    style={{
                                                        marginLeft: '0.5rem',
                                                        fontWeight: 400,
                                                    }}>
                                                    (
                                                    {prevOlder?.type === 'asleep'
                                                        ? 'slept'
                                                        : 'awake'}{' '}
                                                    {gapLabel})
                                                </span>
                                            ) : null}
                                        </span>
                                        {ev.comment ? (
                                            <span className='muted'>{ev.comment}</span>
                                        ) : null}
                                    </div>
                                    <span className={styles.logRowTime}>
                                        {formatClockTime(ev.timestamp, tz)}
                                    </span>
                                </button>
                            )
                        })}
                    </div>
                </section>
            ) : (
                <div>
                    <button type='button' className='btn' onClick={onLoadDemo}>
                        Load 14-day sample data
                    </button>
                </div>
            )}
        </>
    )
}
