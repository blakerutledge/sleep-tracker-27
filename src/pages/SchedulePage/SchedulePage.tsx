import { ClockPill } from '#src/components/ClockPill/index.tsx'
import styles from './SchedulePage.module.scss'

interface SchedulePageProps {
    minuteOfDay: number
}

export const SchedulePage = ({ minuteOfDay }: SchedulePageProps) => (
    <section className={styles.page} aria-label='Schedule'>
        <h1 className={styles.title}>Schedule</h1>
        <ClockPill minuteOfDay={minuteOfDay} className={styles.timePill} />
    </section>
)
