export type SleepEventType = 'asleep' | 'awake'

export interface SleepEvent {
    id: string
    type: SleepEventType
    timestamp: number
    comment?: string
    createdBy?: string
    updatedAt: number
}

export type SegmentSource = 'real' | 'interpolated'

export type SegmentKind = 'nap' | 'night-sleep' | 'wake-window' | 'night-wake'

export interface SleepSegment {
    id: string
    state: SleepEventType
    startMs: number
    endMs: number
    durationMin: number
    source: SegmentSource
    interpolationReason?: string
    inferredBoundaryType?: SleepEventType
    inferredBoundaryMs?: number
    kind: SegmentKind
    napIndex?: number
    startEventId?: string
    endEventId?: string
    comment?: string
    isOngoing?: boolean
}

export type ThemePreference = 'dark' | 'system' | 'light'

export interface BabySettings {
    babyName: string
    birthDate: string // YYYY-MM-DD (Temporal.PlainDate)
    adjustedBirthDate?: string // Optional YYYY-MM-DD for preterm adjusted age
    timeZone?: string // Optional IANA zone override (defaults to device local zone)
    dayStartHour: number // Default 7 (07:00)
    nightStartHour: number // Default 19 (19:00)
    includeInterpolatedInStats: boolean
    theme: ThemePreference
    isDemoMode?: boolean
}

export interface BabyAgeInfo {
    birthPlainDateStr: string
    effectiveBirthDateStr: string
    referenceDateStr: string
    totalDays: number
    weeks: number
    monthsApprox: number
    isPreArrival: boolean
    daysUntilDue: number
    displayLabel: string
}

export interface DaySummary {
    sleepDayKey: string // YYYY-MM-DD of dayStartHour anchor
    dayStartMs: number
    dayEndMs: number
    naps: SleepSegment[]
    napCount: number
    napDurationsByIndex: Record<number, number> // 1-indexed nap durations (minutes)
    nightSleeps: SleepSegment[]
    nightWakes: SleepSegment[]
    wakeWindows: SleepSegment[]
    totalDaySleepMin: number
    totalNightSleepMin: number
    total24hSleepMin: number
    totalAwakeMin: number
    nightWakeCount: number
    longestNightStretchMin: number
    bedtimeMs: number | null
    bedtimeMinOfSleepDay: number | null // minutes elapsed since dayStartHour
    morningWakeMs: number | null
    preBedWakeWindowMin: number | null
    avgDaytimeWakeWindowMin: number | null
    realCoveragePct: number
    interpolatedCount: number
    hasRealData: boolean
}

export interface RangeSummary {
    daysCount: number
    daysWithData: number
    daysWithRealData: number
    avgNapCount: number | null
    napAvgMin: {
        1: number | null
        2: number | null
        3: number | null
        4: number | null
    }
    avgNightWakes: number | null
    avgLongestNightStretchMin: number | null
    avgNightSleepMin: number | null
    avgDayNapMin: number | null
    avgTotalSleepMin: number | null
    avgPreBedWakeWindowMin: number | null
    avgDaytimeWakeWindowMin: number | null
    preBedMultiplier: number | null
    realCoveragePct: number
    interpolatedSegmentCount: number
}

export type InsightSeverity = 'action' | 'watch' | 'good' | 'milestone'

export interface PlsInsight {
    id: string
    severity: InsightSeverity
    title: string
    detail: string
    chapterRef: string
    metricBadge?: string
}
