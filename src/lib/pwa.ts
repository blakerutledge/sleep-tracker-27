import { useCallback, useEffect, useRef, useState } from 'react'
import type { PushSubscriptionRecord } from '#src/types.ts'

interface BeforeInstallPromptEvent extends Event {
    prompt: () => Promise<void>
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

interface NavigatorWithInstall extends Navigator {
    install?: () => Promise<void>
    standalone?: boolean
}

export interface AlarmNotificationPayload {
    title: string
    body: string
    tag?: string
    url?: string
    alarmId?: string
}

export interface InstallPromptState {
    canInstall: boolean
    isStandalone: boolean
    isIos: boolean
    isInstalling: boolean
    statusMessage: string | null
    triggerInstall: () => Promise<void>
}

const supportsWebInstallApi = (): boolean =>
    typeof Navigator !== 'undefined' &&
    typeof (Navigator.prototype as NavigatorWithInstall).install === 'function'

export const isStandaloneDisplayMode = (): boolean => {
    if (typeof window === 'undefined') return false
    const nav = window.navigator as NavigatorWithInstall
    return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true
}

export const isIosDevice = (): boolean => {
    if (typeof navigator === 'undefined') return false
    const ua = navigator.userAgent
    return (
        /iPad|iPhone|iPod/.test(ua) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    )
}

export const getVapidPublicKey = (): string | null => {
    const key = import.meta.env.VITE_VAPID_PUBLIC_KEY
    return typeof key === 'string' && key.trim().length > 0 ? key.trim() : null
}

export const isPushSupported = (): boolean =>
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window

export const disablePinchZoom = (): void => {
    if (typeof document === 'undefined') return

    const preventGesture = (event: Event) => {
        event.preventDefault()
    }
    const preventMultiTouch = (event: TouchEvent) => {
        if (event.touches.length > 1) {
            event.preventDefault()
        }
    }

    document.addEventListener('gesturestart', preventGesture, { passive: false })
    document.addEventListener('gesturechange', preventGesture, { passive: false })
    document.addEventListener('gestureend', preventGesture, { passive: false })
    document.addEventListener('touchmove', preventMultiTouch, { passive: false })
}

export const registerServiceWorker = async (): Promise<ServiceWorkerRegistration | null> => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
        return null
    }
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            registration.update().catch(() => undefined)
        }
    })
    return registration
}

export const reloadPwaApp = async (): Promise<void> => {
    try {
        if ('serviceWorker' in navigator) {
            const registration = await navigator.serviceWorker.getRegistration('/')
            if (registration) {
                await registration.update()
            }
        }
        if ('caches' in window) {
            const keys = await caches.keys()
            await Promise.all(keys.map((key) => caches.delete(key)))
        }
    } finally {
        window.location.reload()
    }
}

const getServiceWorkerRegistration = async (): Promise<ServiceWorkerRegistration> => {
    if (!('serviceWorker' in navigator)) {
        throw new Error('Service workers are not supported in this browser.')
    }
    const existing = await navigator.serviceWorker.getRegistration('/')
    if (existing) {
        return navigator.serviceWorker.ready
    }
    await registerServiceWorker()
    return navigator.serviceWorker.ready
}

const urlBase64ToUint8Array = (base64String: string): Uint8Array<ArrayBuffer> => {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
    const base64 = (base64String + padding).replaceAll('-', '+').replaceAll('_', '/')
    const raw = window.atob(base64)
    const buffer = new ArrayBuffer(raw.length)
    const output = new Uint8Array(buffer)
    for (let i = 0; i < raw.length; i += 1) {
        output[i] = raw.charCodeAt(i)
    }
    return output
}

export const hashPushEndpoint = async (endpoint: string): Promise<string> => {
    const encoded = new TextEncoder().encode(endpoint)
    const digest = await crypto.subtle.digest('SHA-256', encoded)
    return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('')
        .slice(0, 32)
}

const serializeSubscription = async (
    subscription: PushSubscription,
): Promise<PushSubscriptionRecord> => {
    const json = subscription.toJSON()
    const p256dh = json.keys?.p256dh
    const authKey = json.keys?.auth
    if (!json.endpoint || !p256dh || !authKey) {
        throw new Error('Push subscription is missing encryption keys.')
    }
    return {
        id: await hashPushEndpoint(json.endpoint),
        endpoint: json.endpoint,
        keys: {
            p256dh,
            auth: authKey,
        },
        userAgent: navigator.userAgent,
        updatedAt: Date.now(),
    }
}

export const getCurrentPushSubscription = async (): Promise<PushSubscriptionRecord | null> => {
    if (!isPushSupported()) return null
    const registration = await navigator.serviceWorker.getRegistration('/')
    if (!registration) return null
    const existing = await registration.pushManager.getSubscription()
    if (!existing) return null
    return serializeSubscription(existing)
}

export const subscribeToWebPush = async (): Promise<{
    permission: NotificationPermission
    subscription: PushSubscriptionRecord | null
}> => {
    if (!isPushSupported()) {
        throw new Error('Push notifications are not supported in this browser.')
    }

    const permission = await Notification.requestPermission()
    if (permission !== 'granted') {
        return { permission, subscription: null }
    }

    const registration = await getServiceWorkerRegistration()
    const existing = await registration.pushManager.getSubscription()
    if (existing) {
        return { permission, subscription: await serializeSubscription(existing) }
    }

    const vapidPublicKey = getVapidPublicKey()
    if (!vapidPublicKey) {
        return { permission, subscription: null }
    }

    const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    })

    return { permission, subscription: await serializeSubscription(subscription) }
}

export const unsubscribeFromWebPush = async (): Promise<string | null> => {
    if (!isPushSupported()) return null
    const registration = await navigator.serviceWorker.getRegistration('/')
    if (!registration) return null
    const existing = await registration.pushManager.getSubscription()
    if (!existing) return null
    const id = await hashPushEndpoint(existing.endpoint)
    await existing.unsubscribe()
    return id
}

export const showLocalAlarmNotification = async (
    payload: AlarmNotificationPayload,
): Promise<boolean> => {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
        return false
    }

    if ('serviceWorker' in navigator) {
        const registration = await getServiceWorkerRegistration()
        if (registration.active) {
            registration.active.postMessage({
                type: 'SHOW_ALARM_NOTIFICATION',
                payload,
            })
            return true
        }
        await registration.showNotification(payload.title, {
            body: payload.body,
            icon: '/icon-192.png',
            badge: '/icon-192.png',
            tag: payload.tag ?? 'sleep-27-alarm',
            data: { url: payload.url ?? '/', alarmId: payload.alarmId },
        })
        return true
    }

    new Notification(payload.title, {
        body: payload.body,
        icon: '/icon-192.png',
        tag: payload.tag ?? 'sleep-27-alarm',
    })
    return true
}

export const APP_REVISION: string =
    typeof import.meta.env.VITE_APP_REVISION === 'string' &&
    import.meta.env.VITE_APP_REVISION.length > 0
        ? import.meta.env.VITE_APP_REVISION
        : 'dev'

export interface AppVersionState {
    currentRevision: string
    latestRevision: string | null
    updateAvailable: boolean
    checking: boolean
    checkForUpdate: () => Promise<void>
}

export const useAppVersion = (): AppVersionState => {
    const [latestRevision, setLatestRevision] = useState<string | null>(null)
    const [checking, setChecking] = useState(false)

    const checkForUpdate = useCallback(async () => {
        setChecking(true)
        try {
            const response = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
            if (!response.ok) return
            const data = (await response.json()) as { revision?: unknown }
            if (typeof data.revision === 'string' && data.revision.length > 0) {
                setLatestRevision(data.revision)
            }
        } catch {
            // Ignore offline errors
        } finally {
            setChecking(false)
        }
    }, [])

    useEffect(() => {
        checkForUpdate()
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                checkForUpdate()
            }
        }
        document.addEventListener('visibilitychange', handleVisibilityChange)
        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange)
        }
    }, [checkForUpdate])

    const updateAvailable =
        latestRevision !== null &&
        APP_REVISION !== 'dev' &&
        latestRevision !== 'dev' &&
        latestRevision !== APP_REVISION

    return {
        currentRevision: APP_REVISION,
        latestRevision,
        updateAvailable,
        checking,
        checkForUpdate,
    }
}

export const useInstallPrompt = (): InstallPromptState => {
    const [isStandalone, setIsStandalone] = useState<boolean>(() => isStandaloneDisplayMode())
    const [hasDeferredPrompt, setHasDeferredPrompt] = useState(false)
    const [isInstalling, setIsInstalling] = useState(false)
    const [statusMessage, setStatusMessage] = useState<string | null>(null)
    const deferredPromptRef = useRef<BeforeInstallPromptEvent | null>(null)
    const webInstallSupported = supportsWebInstallApi()

    useEffect(() => {
        const mediaQuery = window.matchMedia('(display-mode: standalone)')
        const handleDisplayChange = () => {
            setIsStandalone(isStandaloneDisplayMode())
        }
        const handleBeforeInstallPrompt = (event: Event) => {
            event.preventDefault()
            deferredPromptRef.current = event as BeforeInstallPromptEvent
            if (!webInstallSupported) {
                setHasDeferredPrompt(true)
            }
        }
        const handleAppInstalled = () => {
            deferredPromptRef.current = null
            setHasDeferredPrompt(false)
            setIsStandalone(true)
            setStatusMessage('App installed.')
        }

        mediaQuery.addEventListener('change', handleDisplayChange)
        window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
        window.addEventListener('appinstalled', handleAppInstalled)

        return () => {
            mediaQuery.removeEventListener('change', handleDisplayChange)
            window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
            window.removeEventListener('appinstalled', handleAppInstalled)
        }
    }, [webInstallSupported])

    const triggerInstall = useCallback(async () => {
        if (isInstalling) return
        setIsInstalling(true)
        setStatusMessage(null)

        try {
            const nav = navigator as NavigatorWithInstall
            if (webInstallSupported && typeof nav.install === 'function') {
                await nav.install()
                setStatusMessage('App installed or opened.')
            } else if (deferredPromptRef.current) {
                const promptEvent = deferredPromptRef.current
                deferredPromptRef.current = null
                await promptEvent.prompt()
                const { outcome } = await promptEvent.userChoice
                setStatusMessage(
                    outcome === 'accepted' ? 'App installed.' : 'Installation canceled.',
                )
                if (!deferredPromptRef.current) {
                    setHasDeferredPrompt(false)
                }
            }
        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') {
                setStatusMessage('Installation was canceled.')
            } else {
                setStatusMessage('Installation could not start.')
                console.error(error)
            }
        } finally {
            setIsInstalling(false)
        }
    }, [isInstalling, webInstallSupported])

    const canInstall = !isStandalone && (webInstallSupported || hasDeferredPrompt)

    return {
        canInstall,
        isStandalone,
        isIos: isIosDevice(),
        isInstalling,
        statusMessage,
        triggerInstall,
    }
}
