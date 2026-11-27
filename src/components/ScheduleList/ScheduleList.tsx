import {
    classifyScheduleEvents,
    formatMinuteOfDay24h,
    parseTime24hToMinute,
    type ScheduleEvent,
    SNAP_STEP_MIN,
} from '#src/data/schedule.ts'
import { formatMinutesHuman } from '#src/lib/temporal.ts'
import styles from './ScheduleList.module.scss'

interface ScheduleListProps {
    events: readonly ScheduleEvent[]
    hasActionBar?: boolean
    onChangeMinute: (eventId: string, minuteOfDay: number) => void
    onRemoveSleepWindow: (startEventId: string) => void
}

export const ScheduleList = ({
    events,
    hasActionBar = false,
    onChangeMinute,
    onRemoveSleepWindow,
}: ScheduleListProps) => {
    const classified = classifyScheduleEvents(events)

    const handleTimeChange = (eventId: string, raw: string) => {
        const parsed = parseTime24hToMinute(raw)
        if (parsed !== null) {
            onChangeMinute(eventId, parsed)
        }
    }

    return (
        <div className={styles.scrollBody} data-has-action-bar={hasActionBar}>
            {classified.map((item) => {
                const { event, label, durationMinutes, removable, removeLabel, isPairStart } = item
                const timeValue = formatMinuteOfDay24h(event.minuteOfDay)

                return (
                    <div key={event.id} className={styles.card}>
                        <div className={styles.rowHeader}>
                            <div className={styles.labelGroup}>
                                <span
                                    className={styles.badge}
                                    data-state={event.type}
                                    aria-hidden='true'>
                                    {event.type === 'asleep' ? 'Sleep' : 'Wake'}
                                </span>
                                <span className={styles.eventLabel}>{label}</span>
                            </div>
                            <span className={styles.duration}>
                                {formatMinutesHuman(durationMinutes)}
                            </span>
                        </div>

                        <div className={styles.controls}>
                            <button
                                type='button'
                                className={styles.stepButton}
                                aria-label={`Subtract ${SNAP_STEP_MIN} minutes from ${label}`}
                                onClick={() =>
                                    onChangeMinute(event.id, event.minuteOfDay - SNAP_STEP_MIN)
                                }>
                                -{SNAP_STEP_MIN}m
                            </button>

                            <input
                                type='time'
                                className={styles.timeInput}
                                aria-label={`${label} time`}
                                value={timeValue}
                                onChange={(e) => handleTimeChange(event.id, e.target.value)}
                            />

                            <button
                                type='button'
                                className={styles.stepButton}
                                aria-label={`Add ${SNAP_STEP_MIN} minutes to ${label}`}
                                onClick={() =>
                                    onChangeMinute(event.id, event.minuteOfDay + SNAP_STEP_MIN)
                                }>
                                +{SNAP_STEP_MIN}m
                            </button>
                        </div>

                        {removable && isPairStart && removeLabel && (
                            <div className={styles.cardFooter}>
                                <button
                                    type='button'
                                    className={styles.removeButton}
                                    onClick={() => onRemoveSleepWindow(event.id)}>
                                    {removeLabel}
                                </button>
                            </div>
                        )}
                    </div>
                )
            })}
        </div>
    )
}
