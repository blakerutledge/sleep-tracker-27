import { ClockPill } from '#src/components/ClockPill/index.tsx'
import {
    getScheduleStatus,
    PLACEHOLDER_SCHEDULE_EVENTS,
    type ScheduleEvent,
} from '#src/data/schedule.ts'
import { formatMinutesHuman } from '#src/lib/temporal.ts'
import styles from './TodayPage.module.scss'

interface TodayPageProps {
    minuteOfDay: number
    events?: readonly ScheduleEvent[]
}

const formatMinuteOfDay12h = (minuteOfDay: number): string => {
    const normalized = ((Math.round(minuteOfDay) % 1440) + 1440) % 1440
    const hour24 = Math.floor(normalized / 60)
    const minute = String(normalized % 60).padStart(2, '0')
    const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12
    const period = hour24 >= 12 ? 'PM' : 'AM'
    return `${hour12}:${minute} ${period}`
}

export const TodayPage = ({
    minuteOfDay,
    events = PLACEHOLDER_SCHEDULE_EVENTS,
}: TodayPageProps) => {
    const status = getScheduleStatus(minuteOfDay, events)
    const primaryLabel = status?.nextEventType === 'asleep' ? 'Go down in' : 'Wake up in'
    const secondaryLabel =
        status?.nextEventType === 'asleep' ? 'Then stay down for' : 'Then stay up for'

    return (
        <section className={styles.page} aria-label='Today'>
            <h1 className={styles.title}>Today</h1>

            <ClockPill minuteOfDay={minuteOfDay} className={styles.timePill} />

            {status && (
                <>
                    <div className={styles.primaryStat}>
                        <p className={styles.primaryLabel}>{primaryLabel}</p>
                        <p className={styles.primaryDuration}>
                            {formatMinutesHuman(status.minutesUntilNext)}
                        </p>
                        <p className={styles.primaryLabel}>
                            at {formatMinuteOfDay12h(status.nextEventMinuteOfDay)}
                        </p>
                    </div>

                    <div className={styles.secondaryStat}>
                        <p className={styles.secondaryLabel}>{secondaryLabel}</p>
                        <p className={styles.secondaryDuration}>
                            {formatMinutesHuman(status.nextDurationMinutes)}
                        </p>
                        <p className={styles.secondaryLabel}>
                            until {formatMinuteOfDay12h(status.afterNextMinuteOfDay)}
                        </p>
                    </div>
                </>
            )}
        </section>
    )
}
