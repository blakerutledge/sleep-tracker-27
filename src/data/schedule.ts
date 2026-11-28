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

export type RemoveWindowLabel = 'Remove nap' | 'Remove night wake'

export interface ClassifiedScheduleEvent {
    event: ScheduleEvent
    kind: ScheduleEventKind
    label: string
    durationMinutes: number
    removable: boolean
    removeLabel: RemoveWindowLabel | null
    isPairStart: boolean
}

export interface ScheduleWedgeInfo {
    startEvent: ScheduleEvent
    endEvent: ScheduleEvent
    startLabel: string
    endLabel: string
    name: string
    state: SleepEventType
    durationMinutes: number
    segmentLabel?: string
    segmentDurations?: number[]
    secondarySegmentLabel?: string
    secondarySegmentDurations?: number[]
    removable: boolean
    removeLabel: RemoveWindowLabel | null
}

export interface ScheduleWedge {
    id: string
    selectionId: string
    state: SleepEventType
    startMin: number
    endMin: number
    isNap: boolean
    isNightWake: boolean
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
    const classified = classifyScheduleEvents(sorted)
    const { morningWakeId, bedtimeId } = resolveAnchorIds(sorted)
    const napStartIds = new Set(
        classified.filter((item) => item.kind === 'nap-start').map((item) => item.event.id),
    )
    const nightWakeStartIds = new Set(
        classified.filter((item) => item.kind === 'night-wake-start').map((item) => item.event.id),
    )
    const dayAwakeIds = new Set(
        classified
            .filter((item) => item.kind === 'morning-wake' || item.kind === 'nap-end')
            .map((item) => item.event.id),
    )
    const nightSleepIds = new Set(
        classified
            .filter((item) => item.kind === 'bedtime' || item.kind === 'night-wake-end')
            .map((item) => item.event.id),
    )

    return sorted.map((event, index) => {
        const next = sorted[(index + 1) % sorted.length]
        const isNap = napStartIds.has(event.id)
        const isNightWake = nightWakeStartIds.has(event.id)
        const selectionId =
            morningWakeId && dayAwakeIds.has(event.id)
                ? morningWakeId
                : bedtimeId && nightSleepIds.has(event.id)
                  ? bedtimeId
                  : event.id
        if (!next) {
            return {
                id: event.id,
                selectionId,
                state: event.type,
                startMin: event.minuteOfDay,
                endMin: event.minuteOfDay + MINUTES_PER_DAY,
                isNap,
                isNightWake,
            }
        }
        const endMin =
            index === sorted.length - 1 ? next.minuteOfDay + MINUTES_PER_DAY : next.minuteOfDay

        return {
            id: event.id,
            selectionId,
            state: event.type,
            startMin: event.minuteOfDay,
            endMin,
            isNap,
            isNightWake,
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
): { morningWakeId: string | null; bedtimeId: string | null } => ({
    morningWakeId: sorted.find((e) => e.anchor === 'morning-wake')?.id ?? null,
    bedtimeId: sorted.find((e) => e.anchor === 'bedtime')?.id ?? null,
})

/**
 * One-time migration for legacy saved schedules that predate explicit `anchor` variants.
 * Stamps `bedtime` and `morning-wake` onto the start/end of the longest sleep window only
 * when missing, so anchors are never dynamically recomputed during normal editing.
 */
export const ensureScheduleAnchors = (events: readonly ScheduleEvent[]): ScheduleEvent[] => {
    const sorted = sortScheduleEvents(events)
    const hasWake = sorted.some((e) => e.anchor === 'morning-wake')
    const hasBed = sorted.some((e) => e.anchor === 'bedtime')
    if (hasWake && hasBed) return sorted

    const n = sorted.length
    let longestSleepIdx = -1
    let longestSleepDur = -1
    for (let i = 0; i < n; i += 1) {
        const event = sorted[i]
        const next = sorted[(i + 1) % n]
        if (!event || !next || event.type !== 'asleep') continue
        const rawDur = (next.minuteOfDay - event.minuteOfDay + MINUTES_PER_DAY) % MINUTES_PER_DAY
        const dur = rawDur === 0 ? MINUTES_PER_DAY : rawDur
        if (dur > longestSleepDur) {
            longestSleepDur = dur
            longestSleepIdx = i
        }
    }

    const derivedBedId = longestSleepIdx !== -1 ? (sorted[longestSleepIdx]?.id ?? null) : null
    const derivedWakeId =
        longestSleepIdx !== -1 ? (sorted[(longestSleepIdx + 1) % n]?.id ?? null) : null

    return sorted.map((event) => {
        if (!hasBed && event.id === derivedBedId) {
            return { ...event, anchor: 'bedtime' as const }
        }
        if (!hasWake && event.id === derivedWakeId) {
            return { ...event, anchor: 'morning-wake' as const }
        }
        return event
    })
}

export const getAnchorEventIds = (
    events: readonly ScheduleEvent[],
): { morningWakeId: string | null; bedtimeId: string | null } =>
    resolveAnchorIds(sortScheduleEvents(events))

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
        const removeLabel: 'Remove nap' | null = removable ? 'Remove nap' : null

        if (event.id === morningWakeId) {
            return {
                event,
                kind: 'morning-wake',
                label: 'Morning Wake',
                durationMinutes,
                removable: false,
                removeLabel: null,
                isPairStart: false,
            }
        }

        if (event.id === bedtimeId) {
            return {
                event,
                kind: 'bedtime',
                label: 'Bedtime',
                durationMinutes,
                removable: false,
                removeLabel: null,
                isPairStart: false,
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
                removable: true,
                removeLabel: 'Remove night wake',
                isPairStart: true,
            }
        }

        const suffix = nightWakeStartCount > 1 ? ` ${Math.max(1, nightWakeIndex)}` : ''
        return {
            event,
            kind: 'night-wake-end',
            label: `Back to Sleep${suffix}`,
            durationMinutes,
            removable: false,
            removeLabel: null,
            isPairStart: false,
        }
    })
}

export const getScheduleWedgeInfo = (
    startEventId: string,
    events: readonly ScheduleEvent[],
): ScheduleWedgeInfo | null => {
    const classified = classifyScheduleEvents(events)
    const index = classified.findIndex((item) => item.event.id === startEventId)
    const startItem = classified[index]
    const endItem = classified[(index + 1) % classified.length]
    if (index === -1 || !startItem || !endItem) return null

    if (startItem.kind === 'morning-wake' || startItem.kind === 'nap-end') {
        const morningWakeItem = classified.find((item) => item.kind === 'morning-wake') ?? startItem
        const bedtimeItem = classified.find((item) => item.kind === 'bedtime') ?? endItem
        const dayWakeSegments = classified.filter(
            (item) => item.kind === 'morning-wake' || item.kind === 'nap-end',
        )
        const napSegments = classified.filter((item) => item.kind === 'nap-start')
        const segmentDurations = dayWakeSegments.map((item) => item.durationMinutes)
        const secondarySegmentDurations = napSegments.map((item) => item.durationMinutes)
        const totalAwakeMinutes = segmentDurations.reduce((sum, minutes) => sum + minutes, 0)
        return {
            startEvent: morningWakeItem.event,
            endEvent: bedtimeItem.event,
            startLabel: 'Wake Time',
            endLabel: 'Bed Time',
            name: 'Day',
            state: 'awake',
            durationMinutes: totalAwakeMinutes,
            segmentLabel: 'Wake',
            segmentDurations,
            secondarySegmentLabel: 'Sleep',
            secondarySegmentDurations,
            removable: false,
            removeLabel: null,
        }
    }

    if (startItem.kind === 'bedtime' || startItem.kind === 'night-wake-end') {
        const bedtimeItem = classified.find((item) => item.kind === 'bedtime') ?? startItem
        const morningWakeItem = classified.find((item) => item.kind === 'morning-wake') ?? endItem
        const nightSleepSegments = classified.filter(
            (item) => item.kind === 'bedtime' || item.kind === 'night-wake-end',
        )
        const nightWakeSegments = classified.filter((item) => item.kind === 'night-wake-start')
        const segmentDurations = nightSleepSegments.map((item) => item.durationMinutes)
        const secondarySegmentDurations = nightWakeSegments.map((item) => item.durationMinutes)
        const totalSleepMinutes = segmentDurations.reduce((sum, minutes) => sum + minutes, 0)
        return {
            startEvent: morningWakeItem.event,
            endEvent: bedtimeItem.event,
            startLabel: 'Wake Time',
            endLabel: 'Bed Time',
            name: 'Night',
            state: 'asleep',
            durationMinutes: totalSleepMinutes,
            segmentLabel: 'Sleep',
            segmentDurations,
            secondarySegmentLabel: 'Wake',
            secondarySegmentDurations,
            removable: false,
            removeLabel: null,
        }
    }

    const name =
        startItem.kind === 'nap-start' ? startItem.label.replace(/ Start$/, '') : startItem.label

    return {
        startEvent: startItem.event,
        endEvent: endItem.event,
        startLabel: 'Start',
        endLabel: 'End',
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

export interface AddScheduleWindowResult {
    events: ScheduleEvent[]
    addedStartEventId: string | null
}

export const addSleepWindowPair = (events: readonly ScheduleEvent[]): AddScheduleWindowResult => {
    const awakeWedges = buildScheduleWedges(events).filter(
        (wedge) => wedge.state === 'awake' && !wedge.isNightWake,
    )
    if (awakeWedges.length === 0) {
        return { events: sortScheduleEvents(events), addedStartEventId: null }
    }

    const longest = awakeWedges.reduce((best, current) =>
        current.endMin - current.startMin > best.endMin - best.startMin ? current : best,
    )
    const longestDuration = longest.endMin - longest.startMin
    if (longestDuration < MIN_EVENT_GAP_MIN * 3) {
        return { events: sortScheduleEvents(events), addedStartEventId: null }
    }

    const sleepDuration = Math.min(60, Math.max(MIN_EVENT_GAP_MIN, Math.floor(longestDuration / 3)))
    const sleepStart = snapMinuteOfDay(longest.startMin + (longestDuration - sleepDuration) / 2)
    const sleepEnd = snapMinuteOfDay(sleepStart + sleepDuration)
    const stamp = Date.now().toString(36)
    const startId = `evt-sleep-${stamp}-start`

    return {
        events: sortScheduleEvents([
            ...events,
            { id: startId, type: 'asleep', minuteOfDay: sleepStart },
            { id: `evt-sleep-${stamp}-end`, type: 'awake', minuteOfDay: sleepEnd },
        ]),
        addedStartEventId: startId,
    }
}

export const addNightWakePair = (events: readonly ScheduleEvent[]): AddScheduleWindowResult => {
    const anchored = ensureScheduleAnchors(events)
    const classified = classifyScheduleEvents(anchored)
    const nightSleeps = classified.filter(
        (item) => item.kind === 'bedtime' || item.kind === 'night-wake-end',
    )
    const candidates =
        nightSleeps.length > 0
            ? nightSleeps
            : classified.filter((item) => item.event.type === 'asleep')
    if (candidates.length === 0) {
        return { events: anchored, addedStartEventId: null }
    }

    const longest = candidates.reduce((best, current) =>
        current.durationMinutes > best.durationMinutes ? current : best,
    )
    if (longest.durationMinutes < MIN_EVENT_GAP_MIN * 3) {
        return { events: anchored, addedStartEventId: null }
    }

    const wakeDuration = Math.min(
        30,
        Math.max(MIN_EVENT_GAP_MIN, Math.floor(longest.durationMinutes / 4)),
    )
    const wakeStart = snapMinuteOfDay(
        longest.event.minuteOfDay + (longest.durationMinutes - wakeDuration) / 2,
    )
    const wakeEnd = snapMinuteOfDay(wakeStart + wakeDuration)
    const stamp = Date.now().toString(36)
    const startId = `evt-night-wake-${stamp}-start`

    return {
        events: sortScheduleEvents([
            ...anchored,
            { id: startId, type: 'awake', minuteOfDay: wakeStart },
            { id: `evt-night-wake-${stamp}-end`, type: 'asleep', minuteOfDay: wakeEnd },
        ]),
        addedStartEventId: startId,
    }
}

export const removeSleepWindowPair = (
    events: readonly ScheduleEvent[],
    startEventId: string,
): ScheduleEvent[] => {
    const sorted = sortScheduleEvents(events)
    const startIndex = sorted.findIndex((event) => event.id === startEventId)
    const startEvent = sorted[startIndex]
    if (startIndex === -1 || !startEvent) return sorted

    if (startEvent.type === 'asleep') {
        const sleepCount = sorted.filter((event) => event.type === 'asleep').length
        if (sleepCount <= 1) return sorted

        const endEvent = sorted[(startIndex + 1) % sorted.length]
        const removeIds = new Set<string>([startEvent.id])
        if (endEvent && endEvent.type === 'awake') {
            removeIds.add(endEvent.id)
        }
        return sortScheduleEvents(sorted.filter((event) => !removeIds.has(event.id)))
    }

    // Removing a night wake removes the awake start event and its following return-to-sleep event.
    const endEvent = sorted[(startIndex + 1) % sorted.length]
    const removeIds = new Set<string>([startEvent.id])
    if (endEvent && endEvent.type === 'asleep' && endEvent.anchor !== 'bedtime') {
        removeIds.add(endEvent.id)
    }
    return sortScheduleEvents(sorted.filter((event) => !removeIds.has(event.id)))
}
