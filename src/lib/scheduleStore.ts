import { onAuthStateChanged, type User } from 'firebase/auth'
import { collection, deleteDoc, doc, onSnapshot, orderBy, query, setDoc } from 'firebase/firestore'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
    addNightWakePair,
    addSleepWindowPair,
    clampEventMinute,
    ensureScheduleAnchors,
    normalizeMinuteOfDay,
    PLACEHOLDER_SCHEDULE_EVENTS,
    removeSleepWindowPair,
    type ScheduleAnchor,
    type ScheduleEvent,
    sortScheduleEvents,
} from '#src/data/schedule.ts'
import type { ChildProfile } from './childrenStore.ts'
import { auth, db, isAllowedEmail } from './firebase.ts'

export interface SavedSchedule {
    id: string
    name: string
    events: ScheduleEvent[]
    updatedAt: number
}

const LEGACY_SCHEDULE_KEY = 'sleep-tracker-27:schedule-events'
const SCHEDULES_EVENT = 'sleep-27:schedules-changed'

const getChildSchedulesKey = (childId: string): string => `sleep-tracker-27:schedules:${childId}`

const isScheduleAnchor = (value: unknown): value is ScheduleAnchor =>
    value === 'morning-wake' || value === 'bedtime'

const parseScheduleEvents = (raw: unknown): ScheduleEvent[] | null => {
    if (!Array.isArray(raw) || raw.length < 2) return null
    const valid = raw
        .filter(
            (item): item is ScheduleEvent =>
                typeof item === 'object' &&
                item !== null &&
                typeof (item as ScheduleEvent).id === 'string' &&
                ((item as ScheduleEvent).type === 'asleep' ||
                    (item as ScheduleEvent).type === 'awake') &&
                typeof (item as ScheduleEvent).minuteOfDay === 'number' &&
                Number.isFinite((item as ScheduleEvent).minuteOfDay),
        )
        .map((item) => ({
            id: item.id,
            type: item.type,
            minuteOfDay: normalizeMinuteOfDay(item.minuteOfDay),
            ...(isScheduleAnchor(item.anchor) ? { anchor: item.anchor } : {}),
        }))
    return valid.length >= 2 ? ensureScheduleAnchors(valid) : null
}

const parseSavedSchedule = (item: unknown): SavedSchedule | null => {
    if (typeof item !== 'object' || item === null) return null
    const raw = item as Partial<SavedSchedule>
    if (typeof raw.id !== 'string' || typeof raw.name !== 'string') return null
    const events = parseScheduleEvents(raw.events)
    if (!events) return null
    return {
        id: raw.id,
        name: raw.name.trim() || 'Default',
        events,
        updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
    }
}

const areEventsEqual = (a: readonly ScheduleEvent[], b: readonly ScheduleEvent[]): boolean =>
    a.length === b.length &&
    a.every(
        (event, idx) =>
            event.id === b[idx]?.id &&
            event.type === b[idx]?.type &&
            event.minuteOfDay === b[idx]?.minuteOfDay &&
            event.anchor === b[idx]?.anchor,
    )

const readLegacyEvents = (): ScheduleEvent[] | null => {
    try {
        const raw = localStorage.getItem(LEGACY_SCHEDULE_KEY)
        if (!raw) return null
        return parseScheduleEvents(JSON.parse(raw))
    } catch {
        return null
    }
}

const createDefaultSchedule = (childId: string): SavedSchedule => ({
    id: 'sched-default',
    name: 'Default',
    events: (childId === 'child-default' ? readLegacyEvents() : null) ?? [
        ...PLACEHOLDER_SCHEDULE_EVENTS,
    ],
    updatedAt: Date.now(),
})

const readLocalSchedules = (childId: string): SavedSchedule[] => {
    try {
        const raw = localStorage.getItem(getChildSchedulesKey(childId))
        if (!raw) return [createDefaultSchedule(childId)]
        const parsed = JSON.parse(raw) as unknown
        if (!Array.isArray(parsed)) return [createDefaultSchedule(childId)]
        const valid = parsed
            .map(parseSavedSchedule)
            .filter((item): item is SavedSchedule => item !== null)
        return valid.length > 0 ? valid : [createDefaultSchedule(childId)]
    } catch {
        return [createDefaultSchedule(childId)]
    }
}

const writeLocalSchedules = (childId: string, schedules: readonly SavedSchedule[]): void => {
    try {
        localStorage.setItem(getChildSchedulesKey(childId), JSON.stringify(schedules))
        window.dispatchEvent(new CustomEvent(SCHEDULES_EVENT, { detail: childId }))
    } catch {
        // Ignore storage quota errors
    }
}

const generateScheduleId = (): string => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `sched-${crypto.randomUUID().slice(0, 8)}`
    }
    return `sched-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

export interface ScheduleStoreState {
    schedules: SavedSchedule[]
    activeSchedule: SavedSchedule
    savedEvents: ScheduleEvent[]
    draftEvents: ScheduleEvent[]
    isDirty: boolean
    syncMode: 'cloud' | 'local'
    updateEventMinute: (eventId: string, candidateMinute: number) => void
    addSleepWindow: () => string | null
    addNightWake: () => string | null
    removeSleepWindow: (startEventId: string) => void
    saveDraft: () => Promise<void>
    saveAsNew: (name: string) => Promise<void>
    loadSchedule: (scheduleId: string) => Promise<void>
    renameSchedule: (scheduleId: string, name: string) => Promise<void>
    deleteSchedule: (scheduleId: string) => Promise<void>
    discardDraft: () => void
}

export const useSchedule = (
    activeChild: ChildProfile,
    setChildActiveScheduleId: (childId: string, scheduleId: string | null) => Promise<void>,
): ScheduleStoreState => {
    const childId = activeChild.id
    const [authUser, setAuthUser] = useState<User | null>(null)
    const [localSchedules, setLocalSchedules] = useState<SavedSchedule[]>(() =>
        readLocalSchedules(childId),
    )
    const [cloudSchedules, setCloudSchedules] = useState<SavedSchedule[] | null>(null)
    const seededChildRef = useRef<string | null>(null)

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            if (user && isAllowedEmail(user.email)) {
                setAuthUser(user)
            } else {
                setAuthUser(null)
                setCloudSchedules(null)
                seededChildRef.current = null
            }
        })
        return unsubscribe
    }, [])

    useEffect(() => {
        setLocalSchedules(readLocalSchedules(childId))
        setCloudSchedules(null)
    }, [childId])

    useEffect(() => {
        const handleSync = (event: Event) => {
            const detail = (event as CustomEvent<string>).detail
            if (!detail || detail === childId) {
                setLocalSchedules(readLocalSchedules(childId))
            }
        }
        window.addEventListener(SCHEDULES_EVENT, handleSync)
        return () => {
            window.removeEventListener(SCHEDULES_EVENT, handleSync)
        }
    }, [childId])

    useEffect(() => {
        if (!authUser) return
        const colRef = collection(db, 'households', 'family', 'children', childId, 'schedules')
        const q = query(colRef, orderBy('updatedAt', 'desc'))
        const unsubscribe = onSnapshot(q, (snapshot) => {
            if (snapshot.empty) {
                if (seededChildRef.current !== childId) {
                    seededChildRef.current = childId
                    const initial = readLocalSchedules(childId)
                    for (const sched of initial) {
                        void setDoc(
                            doc(
                                db,
                                'households',
                                'family',
                                'children',
                                childId,
                                'schedules',
                                sched.id,
                            ),
                            sched,
                        )
                    }
                    if (!activeChild.activeScheduleId && initial[0]) {
                        void setChildActiveScheduleId(childId, initial[0].id)
                    }
                }
                return
            }

            const next = snapshot.docs
                .map((snap) => parseSavedSchedule({ id: snap.id, ...snap.data() }))
                .filter((item): item is SavedSchedule => item !== null)
            if (next.length > 0) {
                setCloudSchedules(next)
                writeLocalSchedules(childId, next)
            }
        })
        return unsubscribe
    }, [activeChild.activeScheduleId, authUser, childId, setChildActiveScheduleId])

    const syncMode: 'cloud' | 'local' = authUser ? 'cloud' : 'local'
    const schedules = useMemo(
        () => (cloudSchedules && cloudSchedules.length > 0 ? cloudSchedules : localSchedules),
        [cloudSchedules, localSchedules],
    )

    const activeSchedule = useMemo(() => {
        const matched = activeChild.activeScheduleId
            ? schedules.find((s) => s.id === activeChild.activeScheduleId)
            : undefined
        return matched ?? schedules[0] ?? createDefaultSchedule(childId)
    }, [activeChild.activeScheduleId, childId, schedules])

    const [draftEvents, setDraftEvents] = useState<ScheduleEvent[]>(() => activeSchedule.events)
    const draftEventsRef = useRef<ScheduleEvent[]>(draftEvents)
    draftEventsRef.current = draftEvents
    const lastActiveKeyRef = useRef<string>(`${childId}:${activeSchedule.id}`)
    const lastSavedRef = useRef<ScheduleEvent[]>(activeSchedule.events)

    useEffect(() => {
        const key = `${childId}:${activeSchedule.id}`
        const switchedSchedule = lastActiveKeyRef.current !== key
        if (switchedSchedule) {
            lastActiveKeyRef.current = key
            lastSavedRef.current = activeSchedule.events
            setDraftEvents(activeSchedule.events)
            return
        }
        // If remote/cloud updated while there are no local edits, stay synced cleanly.
        if (!areEventsEqual(lastSavedRef.current, activeSchedule.events)) {
            const prevSaved = lastSavedRef.current
            lastSavedRef.current = activeSchedule.events
            setDraftEvents((current) =>
                areEventsEqual(current, prevSaved) ? activeSchedule.events : current,
            )
        }
    }, [activeSchedule.events, activeSchedule.id, childId])

    const isDirty = useMemo(
        () => !areEventsEqual(draftEvents, activeSchedule.events),
        [activeSchedule.events, draftEvents],
    )

    const updateEventMinute = useCallback((eventId: string, candidateMinute: number) => {
        setDraftEvents((current) => {
            const target = current.find((event) => event.id === eventId)
            const clamped = clampEventMinute(current, eventId, candidateMinute)
            if (target && target.minuteOfDay === clamped) return current
            return sortScheduleEvents(
                current.map((event) =>
                    event.id === eventId ? { ...event, minuteOfDay: clamped } : event,
                ),
            )
        })
    }, [])

    const addSleepWindow = useCallback((): string | null => {
        const { events, addedStartEventId } = addSleepWindowPair(draftEventsRef.current)
        if (addedStartEventId) {
            draftEventsRef.current = events
            setDraftEvents(events)
        }
        return addedStartEventId
    }, [])

    const addNightWake = useCallback((): string | null => {
        const { events, addedStartEventId } = addNightWakePair(draftEventsRef.current)
        if (addedStartEventId) {
            draftEventsRef.current = events
            setDraftEvents(events)
        }
        return addedStartEventId
    }, [])

    const removeSleepWindow = useCallback((startEventId: string) => {
        setDraftEvents((current) => removeSleepWindowPair(current, startEventId))
    }, [])

    const upsertSchedule = useCallback(
        async (schedule: SavedSchedule) => {
            const current = cloudSchedules ?? readLocalSchedules(childId)
            const exists = current.some((s) => s.id === schedule.id)
            const next = exists
                ? current.map((s) => (s.id === schedule.id ? schedule : s))
                : [schedule, ...current]
            writeLocalSchedules(childId, next)
            setLocalSchedules(next)
            if (authUser) {
                await setDoc(
                    doc(db, 'households', 'family', 'children', childId, 'schedules', schedule.id),
                    schedule,
                )
            }
        },
        [authUser, childId, cloudSchedules],
    )

    const saveDraft = useCallback(async () => {
        const updated: SavedSchedule = {
            ...activeSchedule,
            events: sortScheduleEvents(draftEvents),
            updatedAt: Date.now(),
        }
        lastSavedRef.current = updated.events
        setDraftEvents(updated.events)
        await upsertSchedule(updated)
        if (activeChild.activeScheduleId !== updated.id) {
            await setChildActiveScheduleId(childId, updated.id)
        }
    }, [
        activeChild.activeScheduleId,
        activeSchedule,
        childId,
        draftEvents,
        setChildActiveScheduleId,
        upsertSchedule,
    ])

    const saveAsNew = useCallback(
        async (name: string) => {
            const trimmed = name.trim() || 'Untitled Schedule'
            const created: SavedSchedule = {
                id: generateScheduleId(),
                name: trimmed,
                events: sortScheduleEvents(draftEvents),
                updatedAt: Date.now(),
            }
            await upsertSchedule(created)
            lastActiveKeyRef.current = `${childId}:${created.id}`
            lastSavedRef.current = created.events
            setDraftEvents(created.events)
            await setChildActiveScheduleId(childId, created.id)
        },
        [childId, draftEvents, setChildActiveScheduleId, upsertSchedule],
    )

    const loadSchedule = useCallback(
        async (scheduleId: string) => {
            const target = schedules.find((s) => s.id === scheduleId)
            if (!target) return
            lastActiveKeyRef.current = `${childId}:${target.id}`
            lastSavedRef.current = target.events
            setDraftEvents(target.events)
            await setChildActiveScheduleId(childId, target.id)
        },
        [childId, schedules, setChildActiveScheduleId],
    )

    const renameSchedule = useCallback(
        async (scheduleId: string, name: string) => {
            const target = schedules.find((s) => s.id === scheduleId)
            const trimmed = name.trim()
            if (!target || !trimmed) return
            await upsertSchedule({
                ...target,
                name: trimmed,
                updatedAt: Date.now(),
            })
        },
        [schedules, upsertSchedule],
    )

    const deleteSchedule = useCallback(
        async (scheduleId: string) => {
            if (schedules.length <= 1) return
            const next = schedules.filter((s) => s.id !== scheduleId)
            writeLocalSchedules(childId, next)
            setLocalSchedules(next)
            if (activeSchedule.id === scheduleId && next[0]) {
                lastActiveKeyRef.current = `${childId}:${next[0].id}`
                lastSavedRef.current = next[0].events
                setDraftEvents(next[0].events)
                await setChildActiveScheduleId(childId, next[0].id)
            }
            if (authUser) {
                await deleteDoc(
                    doc(db, 'households', 'family', 'children', childId, 'schedules', scheduleId),
                )
            }
        },
        [activeSchedule.id, authUser, childId, schedules, setChildActiveScheduleId],
    )

    const discardDraft = useCallback(() => {
        setDraftEvents(activeSchedule.events)
    }, [activeSchedule.events])

    return {
        schedules,
        activeSchedule,
        savedEvents: activeSchedule.events,
        draftEvents,
        isDirty,
        syncMode,
        updateEventMinute,
        addSleepWindow,
        addNightWake,
        removeSleepWindow,
        saveDraft,
        saveAsNew,
        loadSchedule,
        renameSchedule,
        deleteSchedule,
        discardDraft,
    }
}
