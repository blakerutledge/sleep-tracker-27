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
    const primaryAction = status?.nextEventType === 'asleep' ? 'Go down' : 'Wake up'
    const secondaryAction = status?.nextEventType === 'asleep' ? 'Stay down' : 'Stay up'

    return (
        <section className={styles.page} aria-label='Today'>
            <h1 className={styles.title}>Today</h1>

            {status && (
                <div className={styles.content}>
                    <div className={styles.primaryStat}>
                        <p className={styles.primaryRow}>
                            <span className={styles.primaryAction}>{primaryAction}</span>
                            <span className={styles.connector}>in</span>
                            <span className={styles.primaryDuration}>
                                {formatMinutesHuman(status.minutesUntilNext)}
                            </span>
                        </p>
                        <p className={styles.primaryTime}>
                            at {formatMinuteOfDay12h(status.nextEventMinuteOfDay)}
                        </p>
                    </div>

                    <div className={styles.secondaryStat}>
                        <p className={styles.secondaryMeta}>and then</p>
                        <p className={styles.secondaryRow}>
                            <span className={styles.secondaryAction}>{secondaryAction}</span>
                            <span className={styles.connector}>for</span>
                            <span className={styles.secondaryDuration}>
                                {formatMinutesHuman(status.nextDurationMinutes)}
                            </span>
                        </p>
                        <p className={styles.secondaryMeta}>
                            until {formatMinuteOfDay12h(status.afterNextMinuteOfDay)}
                        </p>
                    </div>
                </div>
            )}
        </section>
    )
}
