import type { SleepEventType } from '#src/types.ts'

export const MINUTES_PER_DAY = 1440
export const MIN_EVENT_GAP_MIN = 15
export const SNAP_STEP_MIN = 5

export type ScheduleAnchor = 'morning-wake' | 'bedtime'

export type ScheduleEventKind =
    | 'morning-wake'
    | 'bedtime'
    | 'nap-start'
    | 'nap-end'
    | 'night-wake-start'
    | 'night-wake-end'

export interface ScheduleEvent {
    id: string
    type: SleepEventType
    minuteOfDay: number
    anchor?: ScheduleAnchor
}

export interface ClassifiedScheduleEvent {
    event: ScheduleEvent
    kind: ScheduleEventKind
    label: string
    durationMinutes: number
    removable: boolean
    removeLabel: 'Remove sleep' | null
    isPairStart: boolean
}

export interface ScheduleWedgeInfo {
    startEvent: ScheduleEvent
    endEvent: ScheduleEvent
    name: string
    state: SleepEventType
    durationMinutes: number
    removable: boolean
    removeLabel: 'Remove sleep' | null
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

// Default 24-hour schedule (2-nap day):
// 07:00 wake -> 09:30 nap 1 -> 11:00 wake -> 14:00 nap 2 -> 15:30 wake -> 19:30 bedtime
export const PLACEHOLDER_SCHEDULE_EVENTS: readonly ScheduleEvent[] = [
    { id: 'evt-wake-morning', type: 'awake', minuteOfDay: 7 * 60, anchor: 'morning-wake' },
    { id: 'evt-nap-1-start', type: 'asleep', minuteOfDay: 9 * 60 + 30 },
    { id: 'evt-nap-1-end', type: 'awake', minuteOfDay: 11 * 60 },
    { id: 'evt-nap-2-start', type: 'asleep', minuteOfDay: 14 * 60 },
    { id: 'evt-nap-2-end', type: 'awake', minuteOfDay: 15 * 60 + 30 },
    { id: 'evt-bedtime', type: 'asleep', minuteOfDay: 19 * 60 + 30, anchor: 'bedtime' },
]

export const normalizeMinuteOfDay = (minuteOfDay: number): number =>
    ((Math.round(minuteOfDay) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY

export const snapMinuteOfDay = (minuteOfDay: number, step: number = SNAP_STEP_MIN): number =>
    normalizeMinuteOfDay(Math.round(minuteOfDay / step) * step)

export const formatMinuteOfDay12h = (minuteOfDay: number): string => {
    const normalized = normalizeMinuteOfDay(minuteOfDay)
    const hour24 = Math.floor(normalized / 60)
    const minute = String(normalized % 60).padStart(2, '0')
    const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12
    const period = hour24 >= 12 ? 'PM' : 'AM'
    return `${hour12}:${minute} ${period}`
}

export const formatMinuteOfDay24h = (minuteOfDay: number): string => {
    const normalized = normalizeMinuteOfDay(minuteOfDay)
    const hour24 = String(Math.floor(normalized / 60)).padStart(2, '0')
    const minute = String(normalized % 60).padStart(2, '0')
    return `${hour24}:${minute}`
}

export const parseTime24hToMinute = (value: string): number | null => {
    const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
    if (!match) return null
    const hours = Number(match[1])
    const minutes = Number(match[2])
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null
    return hours * 60 + minutes
}

export const sortScheduleEvents = (events: readonly ScheduleEvent[]): ScheduleEvent[] =>
    [...events].sort((a, b) => a.minuteOfDay - b.minuteOfDay)

export const buildScheduleWedges = (events: readonly ScheduleEvent[]): ScheduleWedge[] => {
    if (events.length === 0) return []

    const sorted = sortScheduleEvents(events)

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

    const sorted = sortScheduleEvents(events)
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

const resolveAnchorIds = (
    sorted: readonly ScheduleEvent[],
): { morningWakeId: string | null; bedtimeId: string | null } => {
    const explicitWake = sorted.find((e) => e.anchor === 'morning-wake')
    const explicitBed = sorted.find((e) => e.anchor === 'bedtime')

    const awakeEvents = sorted.filter((e) => e.type === 'awake')
    const asleepEvents = sorted.filter((e) => e.type === 'asleep')

    // Fallback for legacy stored events without explicit anchors:
    // morning wake = first awake at/after 5:00 AM; bedtime = last asleep at/after 5:00 PM.
    const morningWake =
        explicitWake ?? awakeEvents.find((e) => e.minuteOfDay >= 5 * 60) ?? awakeEvents[0] ?? null
    const eveningSleeps = asleepEvents.filter((e) => e.minuteOfDay >= 17 * 60)
    const bedtime =
        explicitBed ??
        eveningSleeps[eveningSleeps.length - 1] ??
        asleepEvents[asleepEvents.length - 1] ??
        null

    return {
        morningWakeId: morningWake?.id ?? null,
        bedtimeId: bedtime?.id ?? null,
    }
}

/**
 * Classifies all schedule events in chronological sleep-day order starting from Morning Wake.
 * Events in the daytime arc (Morning Wake -> Bedtime) are naps; events in the nighttime arc
 * (Bedtime -> Morning Wake, wrapping midnight) are night wakes.
 */
export const classifyScheduleEvents = (
    events: readonly ScheduleEvent[],
): ClassifiedScheduleEvent[] => {
    const sorted = sortScheduleEvents(events)
    const n = sorted.length
    if (n === 0) return []

    const { morningWakeId, bedtimeId } = resolveAnchorIds(sorted)
    const startIdx = Math.max(
        0,
        sorted.findIndex((e) => e.id === morningWakeId),
    )

    // Rotate the sorted ring so Morning Wake is index 0.
    const ordered: ScheduleEvent[] = []
    for (let offset = 0; offset < n; offset += 1) {
        const evt = sorted[(startIdx + offset) % n]
        if (evt) ordered.push(evt)
    }

    const bedtimeOrderedIdx = ordered.findIndex((e) => e.id === bedtimeId)
    const sleepWindowCount = ordered.filter((e) => e.type === 'asleep').length
    const canRemoveSleep = sleepWindowCount > 1
    const nightWakeStartCount = ordered.filter(
        (e, idx) => bedtimeOrderedIdx !== -1 && idx > bedtimeOrderedIdx && e.type === 'awake',
    ).length

    let napIndex = 0
    let nightWakeIndex = 0

    return ordered.map((event, idx) => {
        const next = ordered[(idx + 1) % n]
        const rawDur = next
            ? (next.minuteOfDay - event.minuteOfDay + MINUTES_PER_DAY) % MINUTES_PER_DAY
            : MINUTES_PER_DAY
        const durationMinutes = rawDur === 0 ? MINUTES_PER_DAY : rawDur
        const isSleepStart = event.type === 'asleep'
        const removable = isSleepStart && canRemoveSleep
        const removeLabel: 'Remove sleep' | null = removable ? 'Remove sleep' : null

        if (event.id === morningWakeId) {
            return {
                event,
                kind: 'morning-wake',
                label: 'Morning Wake',
                durationMinutes,
                removable,
                removeLabel,
                isPairStart: isSleepStart,
            }
        }

        if (event.id === bedtimeId) {
            return {
                event,
                kind: 'bedtime',
                label: 'Bedtime',
                durationMinutes,
                removable,
                removeLabel,
                isPairStart: isSleepStart,
            }
        }

        const isNightPhase = bedtimeOrderedIdx !== -1 && idx > bedtimeOrderedIdx

        if (!isNightPhase) {
            if (event.type === 'asleep') {
                napIndex += 1
                return {
                    event,
                    kind: 'nap-start',
                    label: `Nap ${napIndex} Start`,
                    durationMinutes,
                    removable,
                    removeLabel,
                    isPairStart: true,
                }
            }
            const labelNum = Math.max(1, napIndex)
            return {
                event,
                kind: 'nap-end',
                label: `Nap ${labelNum} Wake`,
                durationMinutes,
                removable: false,
                removeLabel: null,
                isPairStart: false,
            }
        }

        if (event.type === 'awake') {
            nightWakeIndex += 1
            const suffix = nightWakeStartCount > 1 ? ` ${nightWakeIndex}` : ''
            return {
                event,
                kind: 'night-wake-start',
                label: `Night Wake${suffix}`,
                durationMinutes,
                removable: false,
                removeLabel: null,
                isPairStart: false,
            }
        }

        const suffix = nightWakeStartCount > 1 ? ` ${Math.max(1, nightWakeIndex)}` : ''
        return {
            event,
            kind: 'night-wake-end',
            label: `Back to Sleep${suffix}`,
            durationMinutes,
            removable,
            removeLabel,
            isPairStart: true,
        }
    })
}

export const getClassifiedScheduleEvent = (
    eventId: string,
    events: readonly ScheduleEvent[],
): ClassifiedScheduleEvent | null =>
    classifyScheduleEvents(events).find((item) => item.event.id === eventId) ?? null

export const getScheduleWedgeInfo = (
    startEventId: string,
    events: readonly ScheduleEvent[],
): ScheduleWedgeInfo | null => {
    const classified = classifyScheduleEvents(events)
    const index = classified.findIndex((item) => item.event.id === startEventId)
    const startItem = classified[index]
    const endItem = classified[(index + 1) % classified.length]
    if (index === -1 || !startItem || !endItem) return null

    const napCount = classified.filter((item) => item.kind === 'nap-start').length
    let name: string
    switch (startItem.kind) {
        case 'morning-wake':
            name = napCount > 0 ? 'Wake Window 1' : 'Daytime Awake'
            break
        case 'nap-start':
            name = startItem.label.replace(/ Start$/, '')
            break
        case 'nap-end': {
            const napNum = Number(startItem.label.match(/\d+/)?.[0] ?? 1)
            name = `Wake Window ${napNum + 1}`
            break
        }
        case 'bedtime':
        case 'night-wake-end':
            name = 'Night Sleep'
            break
        case 'night-wake-start':
            name = startItem.label
            break
    }

    return {
        startEvent: startItem.event,
        endEvent: endItem.event,
        name,
        state: startItem.event.type,
        durationMinutes: startItem.durationMinutes,
        removable: startItem.removable && startItem.isPairStart,
        removeLabel: startItem.isPairStart ? startItem.removeLabel : null,
    }
}

/**
 * Clamps a candidate minute for `eventId` so it stays at least `minGap` minutes away from
 * its immediate predecessor and successor on the 24-hour ring (preventing handle crossing).
 */
export const clampEventMinute = (
    events: readonly ScheduleEvent[],
    eventId: string,
    candidateMinute: number,
    minGap: number = MIN_EVENT_GAP_MIN,
): number => {
    const normalized = normalizeMinuteOfDay(candidateMinute)
    if (events.length <= 1) return normalized

    const sorted = sortScheduleEvents(events)
    const index = sorted.findIndex((e) => e.id === eventId)
    if (index === -1) return normalized

    const prev = sorted[(index - 1 + sorted.length) % sorted.length]
    const next = sorted[(index + 1) % sorted.length]
    if (!prev || !next) return normalized

    const span = (next.minuteOfDay - prev.minuteOfDay + MINUTES_PER_DAY) % MINUTES_PER_DAY
    const effectiveSpan = span === 0 ? MINUTES_PER_DAY : span
    const gap = Math.min(minGap, Math.floor(effectiveSpan / 2))
    const relCandidate = (normalized - prev.minuteOfDay + MINUTES_PER_DAY) % MINUTES_PER_DAY

    if (relCandidate >= gap && relCandidate <= effectiveSpan - gap) {
        return normalized
    }

    const distToLow = Math.min(
        (relCandidate - gap + MINUTES_PER_DAY) % MINUTES_PER_DAY,
        (gap - relCandidate + MINUTES_PER_DAY) % MINUTES_PER_DAY,
    )
    const high = effectiveSpan - gap
    const distToHigh = Math.min(
        (relCandidate - high + MINUTES_PER_DAY) % MINUTES_PER_DAY,
        (high - relCandidate + MINUTES_PER_DAY) % MINUTES_PER_DAY,
    )

    const clampedRel = distToLow <= distToHigh ? gap : high
    return normalizeMinuteOfDay(prev.minuteOfDay + clampedRel)
}

/**
 * Moves a wedge (start event + following end event) to `candidateStartMinute` while preserving
 * its exact duration and staying at least `minGap` minutes away from outer neighbors.
 */
export const moveWedgeEvents = (
    events: readonly ScheduleEvent[],
    startEventId: string,
    candidateStartMinute: number,
    minGap: number = MIN_EVENT_GAP_MIN,
): ScheduleEvent[] => {
    const sorted = sortScheduleEvents(events)
    const n = sorted.length
    if (n < 2) return [...sorted]

    const startIdx = sorted.findIndex((e) => e.id === startEventId)
    if (startIdx === -1) return [...sorted]

    const endIdx = (startIdx + 1) % n
    const startEvent = sorted[startIdx]
    const endEvent = sorted[endIdx]
    if (!startEvent || !endEvent) return [...sorted]

    const duration =
        (endEvent.minuteOfDay - startEvent.minuteOfDay + MINUTES_PER_DAY) % MINUTES_PER_DAY
    const normalizedCandidate = normalizeMinuteOfDay(candidateStartMinute)

    let clampedStart = normalizedCandidate
    if (n > 2) {
        const prevOuter = sorted[(startIdx - 1 + n) % n]
        const nextOuter = sorted[(startIdx + 2) % n]
        if (prevOuter && nextOuter) {
            const rawOuterSpan =
                (nextOuter.minuteOfDay - prevOuter.minuteOfDay + MINUTES_PER_DAY) % MINUTES_PER_DAY
            const outerSpan = rawOuterSpan === 0 ? MINUTES_PER_DAY : rawOuterSpan
            const minRel = Math.min(minGap, Math.floor((outerSpan - duration) / 2))
            const maxRel = Math.max(minRel, outerSpan - minRel - duration)
            const relCandidate =
                (normalizedCandidate - prevOuter.minuteOfDay + MINUTES_PER_DAY) % MINUTES_PER_DAY

            if (relCandidate < minRel || relCandidate > maxRel) {
                const distToLow = Math.min(
                    (relCandidate - minRel + MINUTES_PER_DAY) % MINUTES_PER_DAY,
                    (minRel - relCandidate + MINUTES_PER_DAY) % MINUTES_PER_DAY,
                )
                const distToHigh = Math.min(
                    (relCandidate - maxRel + MINUTES_PER_DAY) % MINUTES_PER_DAY,
                    (maxRel - relCandidate + MINUTES_PER_DAY) % MINUTES_PER_DAY,
                )
                clampedStart = normalizeMinuteOfDay(
                    prevOuter.minuteOfDay + (distToLow <= distToHigh ? minRel : maxRel),
                )
            }
        }
    }

    const clampedEnd = normalizeMinuteOfDay(clampedStart + duration)
    return sortScheduleEvents(
        sorted.map((event) => {
            if (event.id === startEvent.id) return { ...event, minuteOfDay: clampedStart }
            if (event.id === endEvent.id) return { ...event, minuteOfDay: clampedEnd }
            return event
        }),
    )
}

export const addSleepWindowPair = (events: readonly ScheduleEvent[]): ScheduleEvent[] => {
    const awakeWedges = buildScheduleWedges(events).filter((wedge) => wedge.state === 'awake')
    if (awakeWedges.length === 0) return sortScheduleEvents(events)

    const longest = awakeWedges.reduce((best, current) =>
        current.endMin - current.startMin > best.endMin - best.startMin ? current : best,
    )
    const longestDuration = longest.endMin - longest.startMin
    if (longestDuration < MIN_EVENT_GAP_MIN * 3) return sortScheduleEvents(events)

    const sleepDuration = Math.min(60, Math.max(MIN_EVENT_GAP_MIN, Math.floor(longestDuration / 3)))
    const sleepStart = snapMinuteOfDay(longest.startMin + (longestDuration - sleepDuration) / 2)
    const sleepEnd = snapMinuteOfDay(sleepStart + sleepDuration)
    const stamp = Date.now().toString(36)

    return sortScheduleEvents([
        ...events,
        { id: `evt-sleep-${stamp}-start`, type: 'asleep', minuteOfDay: sleepStart },
        { id: `evt-sleep-${stamp}-end`, type: 'awake', minuteOfDay: sleepEnd },
    ])
}

export const removeSleepWindowPair = (
    events: readonly ScheduleEvent[],
    startEventId: string,
): ScheduleEvent[] => {
    const sorted = sortScheduleEvents(events)
    const sleepCount = sorted.filter((event) => event.type === 'asleep').length
    if (sleepCount <= 1) return sorted

    const startIndex = sorted.findIndex((event) => event.id === startEventId)
    const startEvent = sorted[startIndex]
    if (startIndex === -1 || !startEvent || startEvent.type !== 'asleep') return sorted

    const endEvent = sorted[(startIndex + 1) % sorted.length]
    const removeIds = new Set<string>([startEvent.id])
    if (endEvent && endEvent.type === 'awake') {
        removeIds.add(endEvent.id)
    }

    return sortScheduleEvents(sorted.filter((event) => !removeIds.has(event.id)))
}
