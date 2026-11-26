import { onAuthStateChanged, type User } from 'firebase/auth'
import { collection, deleteDoc, doc, onSnapshot, orderBy, query, setDoc } from 'firebase/firestore'
import { useCallback, useEffect, useState } from 'react'
import type { AlarmTimer } from '#src/types.ts'
import { auth, db, isAllowedEmail, signInWithGoogle, signOutUser } from './firebase.ts'
import {
    getCurrentPushSubscription,
    getVapidPublicKey,
    isIosDevice,
    isPushSupported,
    isStandaloneDisplayMode,
    showLocalAlarmNotification,
    subscribeToWebPush,
    unsubscribeFromWebPush,
} from './pwa.ts'

const ALARMS_KEY = 'sleep-tracker-27:alarms'

export interface PushStatus {
    supported: boolean
    needsIosInstall: boolean
    permission: NotificationPermission | 'unsupported'
    isSubscribed: boolean
    hasVapidKey: boolean
    busy: boolean
    error: string | null
}

export interface AlarmStore {
    alarms: AlarmTimer[]
    authUser: User | null
    authError: string | null
    syncMode: 'cloud' | 'local'
    push: PushStatus
    signIn: () => Promise<void>
    signOut: () => Promise<void>
    enablePush: () => Promise<void>
    disablePush: () => Promise<void>
    addAlarm: (label: string, delaySeconds: number) => Promise<AlarmTimer>
    toggleAlarm: (id: string) => Promise<void>
    deleteAlarm: (id: string) => Promise<void>
    sendTestNotification: () => Promise<boolean>
}

const generateAlarmId = (): string => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID()
    }
    return `alarm-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

const isAlarmTimer = (item: unknown): item is AlarmTimer => {
    if (typeof item !== 'object' || item === null) return false
    const candidate = item as Partial<AlarmTimer>
    return (
        typeof candidate.id === 'string' &&
        typeof candidate.label === 'string' &&
        typeof candidate.fireAt === 'number' &&
        typeof candidate.enabled === 'boolean' &&
        typeof candidate.fired === 'boolean'
    )
}

const readLocalAlarms = (): AlarmTimer[] => {
    try {
        const raw = localStorage.getItem(ALARMS_KEY)
        if (!raw) return []
        const parsed = JSON.parse(raw) as unknown
        if (!Array.isArray(parsed)) return []
        return parsed.filter(isAlarmTimer).sort((a, b) => a.fireAt - b.fireAt)
    } catch {
        return []
    }
}

const writeLocalAlarms = (alarms: AlarmTimer[]): void => {
    try {
        localStorage.setItem(ALARMS_KEY, JSON.stringify(alarms))
    } catch {
        // Ignore storage quota errors
    }
}

export const useAlarmTimers = (): AlarmStore => {
    const [authUser, setAuthUser] = useState<User | null>(null)
    const [authError, setAuthError] = useState<string | null>(null)
    const [localAlarms, setLocalAlarms] = useState<AlarmTimer[]>(() => readLocalAlarms())
    const [cloudAlarms, setCloudAlarms] = useState<AlarmTimer[]>([])
    const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(() =>
        typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
    )
    const [isSubscribed, setIsSubscribed] = useState(false)
    const [pushBusy, setPushBusy] = useState(false)
    const [pushError, setPushError] = useState<string | null>(null)

    const syncMode: 'cloud' | 'local' = authUser ? 'cloud' : 'local'
    const alarms = syncMode === 'cloud' ? cloudAlarms : localAlarms

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, async (user) => {
            if (user) {
                if (!isAllowedEmail(user.email)) {
                    const rejected = user.email ?? 'this account'
                    await signOutUser()
                    setAuthUser(null)
                    setAuthError(`Signed-in account (${rejected}) is not allowlisted.`)
                    return
                }
                setAuthError(null)
                setAuthUser(user)
            } else {
                setAuthUser(null)
            }
        })
        return () => unsub()
    }, [])

    useEffect(() => {
        if (!authUser) {
            setCloudAlarms([])
            return
        }

        const alarmsQuery = query(
            collection(db, 'households/family/alarms'),
            orderBy('fireAt', 'asc'),
        )
        const unsub = onSnapshot(
            alarmsQuery,
            (snap) => {
                const next: AlarmTimer[] = []
                snap.forEach((docSnap) => {
                    const data = docSnap.data() as Partial<AlarmTimer>
                    if (typeof data.label === 'string' && typeof data.fireAt === 'number') {
                        next.push({
                            id: docSnap.id,
                            label: data.label,
                            fireAt: data.fireAt,
                            enabled: data.enabled !== false,
                            fired: data.fired === true,
                            createdAt:
                                typeof data.createdAt === 'number' ? data.createdAt : data.fireAt,
                            updatedAt:
                                typeof data.updatedAt === 'number' ? data.updatedAt : data.fireAt,
                            createdBy:
                                typeof data.createdBy === 'string' ? data.createdBy : undefined,
                        })
                    }
                })
                next.sort((a, b) => a.fireAt - b.fireAt)
                setCloudAlarms(next)
            },
            (err) => {
                setPushError(err.message)
            },
        )

        return () => unsub()
    }, [authUser])

    useEffect(() => {
        let active = true
        const syncExistingSubscription = async () => {
            try {
                const existing = await getCurrentPushSubscription()
                if (!active) return
                setIsSubscribed(existing !== null)
                if (existing && authUser) {
                    await setDoc(
                        doc(db, 'households/family/pushSubscriptions', existing.id),
                        existing,
                    )
                }
            } catch {
                // Ignore read errors on unsupported platforms
            }
        }
        syncExistingSubscription()
        return () => {
            active = false
        }
    }, [authUser])

    const markAlarmFired = useCallback(
        async (alarm: AlarmTimer) => {
            const updated: AlarmTimer = {
                ...alarm,
                fired: true,
                enabled: false,
                updatedAt: Date.now(),
            }
            if (syncMode === 'cloud') {
                await setDoc(doc(db, 'households/family/alarms', alarm.id), updated)
            } else {
                setLocalAlarms((prev) => {
                    const next = prev.map((item) => (item.id === alarm.id ? updated : item))
                    writeLocalAlarms(next)
                    return next
                })
            }
        },
        [syncMode],
    )

    useEffect(() => {
        // When cloud Web Push is active, Cloud Functions is the single source of truth for
        // firing alarms; skip client-side catch-up to prevent duplicate banners on reopen.
        if (syncMode === 'cloud' && isSubscribed) return

        const timeouts: number[] = []

        const fireAlarmLocally = async (alarm: AlarmTimer) => {
            await markAlarmFired(alarm)
            await showLocalAlarmNotification({
                title: alarm.label || 'Sleep Alarm',
                body: '',
                tag: `alarm-${alarm.id}`,
                url: '/today',
                alarmId: alarm.id,
            })
        }

        const schedulePendingAlarms = () => {
            const now = Date.now()
            for (const alarm of alarms) {
                if (!alarm.enabled || alarm.fired) continue
                const delayMs = alarm.fireAt - now
                if (delayMs <= 0) {
                    fireAlarmLocally(alarm)
                    continue
                }
                const timeoutId = window.setTimeout(() => {
                    fireAlarmLocally(alarm)
                }, delayMs)
                timeouts.push(timeoutId)
            }
        }

        schedulePendingAlarms()

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                const now = Date.now()
                for (const alarm of alarms) {
                    if (alarm.enabled && !alarm.fired && alarm.fireAt <= now) {
                        fireAlarmLocally(alarm)
                    }
                }
            }
        }

        document.addEventListener('visibilitychange', handleVisibilityChange)
        return () => {
            for (const id of timeouts) {
                window.clearTimeout(id)
            }
            document.removeEventListener('visibilitychange', handleVisibilityChange)
        }
    }, [alarms, isSubscribed, markAlarmFired, syncMode])

    const signIn = useCallback(async () => {
        setAuthError(null)
        try {
            const res = await signInWithGoogle()
            if (!isAllowedEmail(res.user.email)) {
                const rejected = res.user.email ?? 'this account'
                await signOutUser()
                setAuthError(`Signed-in account (${rejected}) is not allowlisted.`)
            }
        } catch (err) {
            setAuthError(err instanceof Error ? err.message : 'Sign-in was cancelled or blocked.')
        }
    }, [])

    const signOut = useCallback(async () => {
        await signOutUser()
        setAuthError(null)
    }, [])

    const enablePush = useCallback(async () => {
        setPushBusy(true)
        setPushError(null)
        try {
            const result = await subscribeToWebPush()
            setPermission(result.permission)
            if (result.permission !== 'granted') {
                setPushError('Notification permission was denied.')
                return
            }
            if (result.subscription) {
                setIsSubscribed(true)
                if (authUser) {
                    await setDoc(
                        doc(db, 'households/family/pushSubscriptions', result.subscription.id),
                        result.subscription,
                    )
                }
            }
        } catch (err) {
            setPushError(
                err instanceof Error ? err.message : 'Could not enable push notifications.',
            )
        } finally {
            setPushBusy(false)
        }
    }, [authUser])

    const disablePush = useCallback(async () => {
        setPushBusy(true)
        setPushError(null)
        try {
            const removedId = await unsubscribeFromWebPush()
            setIsSubscribed(false)
            if (removedId && authUser) {
                await deleteDoc(doc(db, 'households/family/pushSubscriptions', removedId))
            }
        } catch (err) {
            setPushError(
                err instanceof Error ? err.message : 'Could not disable push notifications.',
            )
        } finally {
            setPushBusy(false)
        }
    }, [authUser])

    const addAlarm = useCallback(
        async (label: string, delaySeconds: number): Promise<AlarmTimer> => {
            const now = Date.now()
            const trimmedLabel = label.trim() || 'Nap timer'
            const alarm: AlarmTimer = {
                id: generateAlarmId(),
                label: trimmedLabel,
                fireAt: now + Math.max(1, delaySeconds) * 1000,
                enabled: true,
                fired: false,
                createdAt: now,
                updatedAt: now,
                ...(authUser?.email ? { createdBy: authUser.email } : {}),
            }

            if (syncMode === 'cloud') {
                await setDoc(doc(db, 'households/family/alarms', alarm.id), alarm)
            } else {
                setLocalAlarms((prev) => {
                    const next = [...prev, alarm].sort((a, b) => a.fireAt - b.fireAt)
                    writeLocalAlarms(next)
                    return next
                })
            }
            return alarm
        },
        [authUser, syncMode],
    )

    const toggleAlarm = useCallback(
        async (id: string) => {
            const existing = alarms.find((item) => item.id === id)
            if (!existing) return
            const nextEnabled = !existing.enabled
            const updated: AlarmTimer = {
                ...existing,
                enabled: nextEnabled,
                fired: nextEnabled ? false : existing.fired,
                updatedAt: Date.now(),
            }
            if (syncMode === 'cloud') {
                await setDoc(doc(db, 'households/family/alarms', id), updated)
            } else {
                setLocalAlarms((prev) => {
                    const next = prev.map((item) => (item.id === id ? updated : item))
                    writeLocalAlarms(next)
                    return next
                })
            }
        },
        [alarms, syncMode],
    )

    const deleteAlarm = useCallback(
        async (id: string) => {
            if (syncMode === 'cloud') {
                await deleteDoc(doc(db, 'households/family/alarms', id))
            } else {
                setLocalAlarms((prev) => {
                    const next = prev.filter((item) => item.id !== id)
                    writeLocalAlarms(next)
                    return next
                })
            }
        },
        [syncMode],
    )

    const sendTestNotification = useCallback(async () => {
        return showLocalAlarmNotification({
            title: 'Alarm notifications are ready',
            body: '',
            tag: 'sleep-27-test',
            url: '/today',
        })
    }, [])

    const needsIosInstall = isIosDevice() && !isStandaloneDisplayMode()

    return {
        alarms,
        authUser,
        authError,
        syncMode,
        push: {
            supported: isPushSupported(),
            needsIosInstall,
            permission,
            isSubscribed,
            hasVapidKey: getVapidPublicKey() !== null,
            busy: pushBusy,
            error: pushError,
        },
        signIn,
        signOut,
        enablePush,
        disablePush,
        addAlarm,
        toggleAlarm,
        deleteAlarm,
        sendTestNotification,
    }
}
