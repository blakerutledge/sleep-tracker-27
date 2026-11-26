import styles from './ClockPill.module.scss'

interface ClockPillProps {
    minuteOfDay: number
    className?: string
    onClick?: () => void
}

export const ClockPill = ({ minuteOfDay, className, onClick }: ClockPillProps) => {
    const normalized = ((Math.round(minuteOfDay) % 1440) + 1440) % 1440
    const hour24 = Math.floor(normalized / 60)
    const minute = normalized % 60
    const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12
    const period = hour24 >= 12 ? 'PM' : 'AM'

    const hourStr = String(hour12).padStart(2, '0')
    const minStr = String(minute).padStart(2, '0')
    const iso = `${String(hour24).padStart(2, '0')}:${minStr}`

    return (
        <time
            className={className ? `${styles.pill} ${className}` : styles.pill}
            dateTime={iso}
            onClick={onClick}>
            <span className={styles.digits}>
                <span className={styles.slot}>{hourStr[0]}</span>
                <span className={styles.slot}>{hourStr[1]}</span>
                <span className={styles.colon}>:</span>
                <span className={styles.slot}>{minStr[0]}</span>
                <span className={styles.slot}>{minStr[1]}</span>
            </span>
            <span className={styles.period}>{period}</span>
        </time>
    )
}
