import {
    formatMinuteOfDay24h,
    getClassifiedScheduleEvent,
    parseTime24hToMinute,
    type ScheduleEvent,
} from '#src/data/schedule.ts'
import styles from './TimePickerBar.module.scss'

interface TimePickerBarProps {
    event: ScheduleEvent
    events: readonly ScheduleEvent[]
    onChangeMinute: (eventId: string, minuteOfDay: number) => void
}

export const TimePickerBar = ({ event, events, onChangeMinute }: TimePickerBarProps) => {
    const classified = getClassifiedScheduleEvent(event.id, events)
    const label = classified?.label ?? 'Event'
    const timeValue = formatMinuteOfDay24h(event.minuteOfDay)

    const handleTimeInput = (raw: string) => {
        const parsed = parseTime24hToMinute(raw)
        if (parsed !== null) {
            onChangeMinute(event.id, parsed)
        }
    }

    return (
        <section className={styles.bar} aria-label={`Edit ${label}`}>
            <span className={styles.label}>{label}</span>

            <input
                type='time'
                className={styles.timeInput}
                aria-label={`${label} time`}
                value={timeValue}
                onChange={(e) => handleTimeInput(e.target.value)}
            />
        </section>
    )
}
