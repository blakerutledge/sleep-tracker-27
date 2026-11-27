import { useCallback, useEffect, useState } from 'react'

const DEV_MODE_STORAGE_KEY = 'sleep-tracker-27:dev-mode'
const DEV_MODE_EVENT = 'sleep-27:dev-mode-changed'

export const MIN_DEV_SPEED = 1
export const MAX_DEV_SPEED = 1440

export interface DevModeSettings {
    enabled: boolean
    speedMultiplier: number
    manualDialInToday: boolean
}

const DEFAULT_DEV_MODE: DevModeSettings = {
    enabled: false,
    speedMultiplier: MIN_DEV_SPEED,
    manualDialInToday: false,
}

const clampSpeed = (value: number): number =>
    Math.round(Math.max(MIN_DEV_SPEED, Math.min(MAX_DEV_SPEED, value)))

export const readDevModeSettings = (): DevModeSettings => {
    try {
        const raw = localStorage.getItem(DEV_MODE_STORAGE_KEY)
        if (!raw) return DEFAULT_DEV_MODE
        const parsed = JSON.parse(raw) as Partial<DevModeSettings>
        return {
            enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : false,
            speedMultiplier:
                typeof parsed.speedMultiplier === 'number' &&
                Number.isFinite(parsed.speedMultiplier)
                    ? clampSpeed(parsed.speedMultiplier)
                    : MIN_DEV_SPEED,
            manualDialInToday:
                typeof parsed.manualDialInToday === 'boolean' ? parsed.manualDialInToday : false,
        }
    } catch {
        return DEFAULT_DEV_MODE
    }
}

const writeDevModeSettings = (next: DevModeSettings): void => {
    try {
        localStorage.setItem(DEV_MODE_STORAGE_KEY, JSON.stringify(next))
        window.dispatchEvent(new Event(DEV_MODE_EVENT))
    } catch {
        // Ignore storage quota errors
    }
}

export interface DevModeState {
    settings: DevModeSettings
    setEnabled: (enabled: boolean) => void
    setSpeedMultiplier: (speedMultiplier: number) => void
    setManualDialInToday: (manualDialInToday: boolean) => void
}

export const useDevMode = (): DevModeState => {
    const [settings, setSettings] = useState<DevModeSettings>(() => readDevModeSettings())

    useEffect(() => {
        const handleSync = () => {
            setSettings(readDevModeSettings())
        }
        window.addEventListener(DEV_MODE_EVENT, handleSync)
        return () => {
            window.removeEventListener(DEV_MODE_EVENT, handleSync)
        }
    }, [])

    const update = useCallback((patch: Partial<DevModeSettings>) => {
        const prev = readDevModeSettings()
        const next: DevModeSettings = {
            ...prev,
            ...patch,
            speedMultiplier:
                patch.speedMultiplier !== undefined
                    ? clampSpeed(patch.speedMultiplier)
                    : prev.speedMultiplier,
        }
        setSettings(next)
        writeDevModeSettings(next)
    }, [])

    const setEnabled = useCallback((enabled: boolean) => update({ enabled }), [update])
    const setSpeedMultiplier = useCallback(
        (speedMultiplier: number) => update({ speedMultiplier }),
        [update],
    )
    const setManualDialInToday = useCallback(
        (manualDialInToday: boolean) => update({ manualDialInToday }),
        [update],
    )

    return {
        settings,
        setEnabled,
        setSpeedMultiplier,
        setManualDialInToday,
    }
}
