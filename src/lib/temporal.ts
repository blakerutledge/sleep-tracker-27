import type { BabyAgeInfo, BabySettings } from '#src/types.ts'

export async function ensureTemporal(): Promise<typeof Temporal> {
    if (typeof Reflect.get(globalThis, 'Temporal') === 'undefined') {
        const mod = await import('temporal-polyfill')
        Reflect.set(globalThis, 'Temporal', mod.Temporal)
    }
    return Temporal
}

export function getTimeZoneId(overrideTz?: string): string {
    return overrideTz || Temporal.Now.timeZoneId()
}

export function epochToZonedDateTime(
    epochMs: number,
    timeZone = getTimeZoneId(),
): Temporal.ZonedDateTime {
    return Temporal.Instant.fromEpochMilliseconds(Math.round(epochMs)).toZonedDateTimeISO(timeZone)
}

export function getBabyAgeInfo(
    settings: BabySettings,
    refEpochMs: number = Date.now(),
): BabyAgeInfo {
    const tz = getTimeZoneId(settings.timeZone)
    const refDate = epochToZonedDateTime(refEpochMs, tz).toPlainDate()
    const birthPlain = safePlainDate(settings.birthDate) ?? Temporal.PlainDate.from('2027-01-01')
    const adjustedPlain = settings.adjustedBirthDate
        ? safePlainDate(settings.adjustedBirthDate)
        : null
    const effectiveBirth = adjustedPlain ?? birthPlain

    const diffDays = effectiveBirth.until(refDate, { largestUnit: 'day' }).days
    if (diffDays < 0) {
        const daysUntilDue = Math.abs(diffDays)
        return {
            birthPlainDateStr: birthPlain.toString(),
            effectiveBirthDateStr: effectiveBirth.toString(),
            referenceDateStr: refDate.toString(),
            totalDays: diffDays,
            weeks: 0,
            monthsApprox: -1,
            isPreArrival: true,
            daysUntilDue,
            displayLabel:
                daysUntilDue === 1
                    ? 'Due tomorrow'
                    : `Pre-arrival · ${daysUntilDue}d until due (${birthPlain.toString()})`,
        }
    }

    const calMonths = effectiveBirth.until(refDate, { largestUnit: 'month' })
    const monthsApprox = Number((diffDays / 30.4375).toFixed(1))
    const weeks = Math.floor(diffDays / 7)

    let displayLabel: string
    if (diffDays < 84) {
        const remDays = diffDays % 7
        displayLabel =
            weeks === 0
                ? `${diffDays}d old`
                : remDays > 0
                  ? `${weeks}w ${remDays}d old`
                  : `${weeks}w old`
    } else {
        displayLabel = `${calMonths.months}m ${calMonths.days}d old`
    }

    return {
        birthPlainDateStr: birthPlain.toString(),
        effectiveBirthDateStr: effectiveBirth.toString(),
        referenceDateStr: refDate.toString(),
        totalDays: diffDays,
        weeks,
        monthsApprox,
        isPreArrival: false,
        daysUntilDue: 0,
        displayLabel,
    }
}

export function safePlainDate(isoDate: string | undefined): Temporal.PlainDate | null {
    if (!isoDate) return null
    try {
        return Temporal.PlainDate.from(isoDate.trim())
    } catch {
        return null
    }
}

export function formatDurationObject(dur: Temporal.Duration): string {
    const rounded = dur.round({ largestUnit: 'hour', smallestUnit: 'minute' })
    if (rounded.hours === 0 && rounded.minutes === 0) {
        return '0m'
    }
    return rounded.toLocaleString('en-US', { style: 'narrow' })
}

export function formatElapsedSince(
    startMs: number,
    endMs: number = Date.now(),
    timeZone?: string,
): string {
    if (endMs <= startMs) return '0m'
    const tz = getTimeZoneId(timeZone)
    const startZdt = epochToZonedDateTime(startMs, tz)
    const endZdt = epochToZonedDateTime(endMs, tz)
    const diff = endZdt.since(startZdt, { largestUnit: 'hour', smallestUnit: 'minute' })
    return formatDurationObject(diff)
}

export function formatMinutesHuman(totalMinutes: number | null | undefined): string {
    if (totalMinutes === null || totalMinutes === undefined || !Number.isFinite(totalMinutes)) {
        return '—'
    }
    const mins = Math.max(0, Math.round(totalMinutes))
    if (mins === 0) return '0m'
    const dur = Temporal.Duration.from({ minutes: mins })
    return formatDurationObject(dur)
}

export function epochToLocalDateTimeInput(epochMs: number, timeZone?: string): string {
    const zdt = epochToZonedDateTime(epochMs, getTimeZoneId(timeZone))
    return zdt.toPlainDateTime().toString({ smallestUnit: 'minute' })
}

export function localDateTimeInputToEpoch(value: string, timeZone?: string): number | null {
    if (!value) return null
    try {
        const pdt = Temporal.PlainDateTime.from(value)
        return pdt.toZonedDateTime(getTimeZoneId(timeZone)).epochMilliseconds
    } catch {
        return null
    }
}

export function formatClockTime(epochMs: number, timeZone?: string): string {
    const zdt = epochToZonedDateTime(epochMs, getTimeZoneId(timeZone))
    const hour24 = zdt.hour
    const min = String(zdt.minute).padStart(2, '0')
    const suffix = hour24 >= 12 ? 'p' : 'a'
    const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12
    return `${hour12}:${min}${suffix}`
}

export function formatShortDate(plainDateStr: string): string {
    try {
        const pd = Temporal.PlainDate.from(plainDateStr)
        const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][pd.dayOfWeek - 1] ?? ''
        return `${weekday} ${pd.month}/${pd.day}`
    } catch {
        return plainDateStr
    }
}

export function getSleepDayKey(epochMs: number, dayStartHour: number, timeZone?: string): string {
    const zdt = epochToZonedDateTime(epochMs, getTimeZoneId(timeZone))
    const date =
        zdt.hour < dayStartHour ? zdt.toPlainDate().subtract({ days: 1 }) : zdt.toPlainDate()
    return date.toString()
}

export function getSleepDayBounds(
    sleepDayKey: string,
    dayStartHour: number,
    timeZone?: string,
): { startMs: number; endMs: number } {
    const tz = getTimeZoneId(timeZone)
    const pd = Temporal.PlainDate.from(sleepDayKey)
    const startTime = Temporal.PlainTime.from({ hour: dayStartHour, minute: 0 })
    const startZdt = pd.toPlainDateTime(startTime).toZonedDateTime(tz)
    const endZdt = pd.add({ days: 1 }).toPlainDateTime(startTime).toZonedDateTime(tz)
    return {
        startMs: startZdt.epochMilliseconds,
        endMs: endZdt.epochMilliseconds,
    }
}

export function shiftPlainDate(plainDateStr: string, deltaDays: number): string {
    const pd = Temporal.PlainDate.from(plainDateStr)
    return (
        deltaDays >= 0 ? pd.add({ days: deltaDays }) : pd.subtract({ days: Math.abs(deltaDays) })
    ).toString()
}

export function getMinutesOfDay(epochMs: number, timeZone?: string): number {
    const zdt = epochToZonedDateTime(epochMs, getTimeZoneId(timeZone))
    return zdt.hour * 60 + zdt.minute
}

export function makeEpochOnSleepDay(
    sleepDayKey: string,
    dayStartHour: number,
    minutesSinceDayStart: number,
    timeZone?: string,
): number {
    const tz = getTimeZoneId(timeZone)
    const { startMs } = getSleepDayBounds(sleepDayKey, dayStartHour, tz)
    const startZdt = epochToZonedDateTime(startMs, tz)
    return startZdt.add({ minutes: Math.round(minutesSinceDayStart) }).epochMilliseconds
}

export function getLocalHour(epochMs: number, timeZone?: string): number {
    return epochToZonedDateTime(epochMs, getTimeZoneId(timeZone)).hour
}
