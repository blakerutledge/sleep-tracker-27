import {
    formatMinuteOfDay12h,
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

export const TodayPage = ({
    minuteOfDay,
    events = PLACEHOLDER_SCHEDULE_EVENTS,
}: TodayPageProps) => {
    const status = getScheduleStatus(minuteOfDay, events)
    const currentState = status?.nextEventType === 'asleep' ? 'awake' : 'asleep'
    const primaryLabel = currentState === 'awake' ? 'Awake' : 'Asleep'
    const secondaryLabel = status?.nextEventType === 'asleep' ? 'asleep' : 'awake'

    return (
        <section className={styles.page} aria-label='Today'>
            <h1 className={styles.title}>Today</h1>

            {status && (
                <div className={styles.content}>
                    <div className={styles.primaryStat} data-action={currentState}>
                        <p className={styles.primaryAction}>{primaryLabel}</p>
                        <p className={styles.primaryRow}>
                            <span className={styles.connector}>for</span>
                            <span className={styles.primaryDuration}>
                                {formatMinutesHuman(status.minutesUntilNext)}
                            </span>
                        </p>
                        <p className={styles.primaryTime}>
                            until {formatMinuteOfDay12h(status.nextEventMinuteOfDay)}
                        </p>
                    </div>

                    <p className={styles.secondaryRow} data-action={status.nextEventType}>
                        <span className={styles.secondaryMeta}>Then</span>{' '}
                        <span className={styles.secondaryAction}>{secondaryLabel}</span>{' '}
                        <span className={styles.secondaryMeta}>for</span>{' '}
                        <span className={styles.secondaryDuration}>
                            {formatMinutesHuman(status.nextDurationMinutes)}
                        </span>{' '}
                        <span className={styles.secondaryMeta}>
                            until {formatMinuteOfDay12h(status.afterNextMinuteOfDay)}
                        </span>
                    </p>
                </div>
            )}
        </section>
    )
}
