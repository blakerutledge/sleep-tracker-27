import type { SleepEventType } from '#src/types.ts'

export const MINUTES_PER_DAY = 1440

export interface ScheduleEvent {
    id: string
    type: SleepEventType
    minuteOfDay: number
}

export interface ScheduleWedge {
    id: string
    state: SleepEventType
    startMin: number
    endMin: number
}

export interface ScheduleStatus {
    nextEventType: SleepEventType
    minutesUntilNext: number
    nextDurationMinutes: number
    nextEventMinuteOfDay: number
    afterNextMinuteOfDay: number
}

// Placeholder 24-hour schedule (2-nap day):
// 07:00 wake -> 09:30 nap 1 -> 11:00 wake -> 14:00 nap 2 -> 15:30 wake -> 19:30 bedtime
export const PLACEHOLDER_SCHEDULE_EVENTS: readonly ScheduleEvent[] = [
    { id: 'evt-wake-morning', type: 'awake', minuteOfDay: 7 * 60 },
    { id: 'evt-nap-1-start', type: 'asleep', minuteOfDay: 9 * 60 + 30 },
    { id: 'evt-nap-1-end', type: 'awake', minuteOfDay: 11 * 60 },
    { id: 'evt-nap-2-start', type: 'asleep', minuteOfDay: 14 * 60 },
    { id: 'evt-nap-2-end', type: 'awake', minuteOfDay: 15 * 60 + 30 },
    { id: 'evt-bedtime', type: 'asleep', minuteOfDay: 19 * 60 + 30 },
]

export const buildScheduleWedges = (events: readonly ScheduleEvent[]): ScheduleWedge[] => {
    if (events.length === 0) return []

    const sorted = [...events].sort((a, b) => a.minuteOfDay - b.minuteOfDay)

    return sorted.map((event, index) => {
        const next = sorted[(index + 1) % sorted.length]
        if (!next) {
            return {
                id: event.id,
                state: event.type,
                startMin: event.minuteOfDay,
                endMin: event.minuteOfDay + MINUTES_PER_DAY,
            }
        }
        const endMin =
            index === sorted.length - 1 ? next.minuteOfDay + MINUTES_PER_DAY : next.minuteOfDay

        return {
            id: event.id,
            state: event.type,
            startMin: event.minuteOfDay,
            endMin,
        }
    })
}

export const getScheduleStatus = (
    minuteOfDay: number,
    events: readonly ScheduleEvent[],
): ScheduleStatus | null => {
    if (events.length === 0) return null

    const sorted = [...events].sort((a, b) => a.minuteOfDay - b.minuteOfDay)
    const foundIndex = sorted.findIndex((event) => event.minuteOfDay > minuteOfDay)
    const nextIndex = foundIndex === -1 ? 0 : foundIndex
    const nextEvent = sorted[nextIndex]
    if (!nextEvent) return null

    const minutesUntilNext =
        foundIndex === -1
            ? nextEvent.minuteOfDay + MINUTES_PER_DAY - minuteOfDay
            : nextEvent.minuteOfDay - minuteOfDay

    const afterNext = sorted[(nextIndex + 1) % sorted.length]
    const rawDuration = afterNext
        ? (afterNext.minuteOfDay - nextEvent.minuteOfDay + MINUTES_PER_DAY) % MINUTES_PER_DAY
        : MINUTES_PER_DAY
    const nextDurationMinutes = rawDuration === 0 ? MINUTES_PER_DAY : rawDuration

    return {
        nextEventType: nextEvent.type,
        minutesUntilNext,
        nextDurationMinutes,
        nextEventMinuteOfDay: nextEvent.minuteOfDay,
        afterNextMinuteOfDay: afterNext ? afterNext.minuteOfDay : nextEvent.minuteOfDay,
    }
}
