import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { useAlarmTimers } from '#src/lib/alarms.ts'
import { reloadPwaApp, useAppVersion, useInstallPrompt } from '#src/lib/pwa.ts'
import { useSunLocation } from '#src/lib/sun.ts'
import { epochToZonedDateTime } from '#src/lib/temporal.ts'
import styles from './SettingsPage.module.scss'

const FEEDBACK_TIMEOUT_MS = 5000
const DEBUG_NOTIFY_DELAY_SEC = 30

type FeedbackSection = 'push' | 'location' | 'debug'

interface FeedbackMessage {
    section: FeedbackSection
    kind: 'status' | 'error'
    text: string
}

const formatClockTime = (epochMs: number): string => {
    const zdt = epochToZonedDateTime(epochMs)
    const hour12 = zdt.hour % 12 === 0 ? 12 : zdt.hour % 12
    const minute = String(zdt.minute).padStart(2, '0')
    const period = zdt.hour >= 12 ? 'PM' : 'AM'
    return `${hour12}:${minute} ${period}`
}

export const SettingsPage = () => {
    const installPrompt = useInstallPrompt()
    const appVersion = useAppVersion()
    const sunLocation = useSunLocation()
    const {
        authUser,
        authError,
        syncMode,
        push,
        signIn,
        signOut,
        enablePush,
        disablePush,
        addAlarm,
    } = useAlarmTimers()

    const [label, setLabel] = useState('Put down for nap')
    const [feedback, setFeedback] = useState<FeedbackMessage | null>(null)
    const [debugBusy, setDebugBusy] = useState(false)
    const feedbackTimerRef = useRef<number | null>(null)

    const showFeedback = useCallback(
        (section: FeedbackSection, kind: 'status' | 'error', text: string) => {
            if (feedbackTimerRef.current !== null) {
                window.clearTimeout(feedbackTimerRef.current)
            }
            setFeedback({ section, kind, text })
            feedbackTimerRef.current = window.setTimeout(() => {
                setFeedback(null)
                feedbackTimerRef.current = null
            }, FEEDBACK_TIMEOUT_MS)
        },
        [],
    )

    useEffect(() => {
        return () => {
            if (feedbackTimerRef.current !== null) {
                window.clearTimeout(feedbackTimerRef.current)
            }
        }
    }, [])

    useEffect(() => {
        if (push.error) {
            showFeedback('push', 'error', push.error)
        }
    }, [push.error, showFeedback])

    const handleScheduleDebugNotification = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        if (debugBusy) return
        setDebugBusy(true)
        try {
            await addAlarm(label, DEBUG_NOTIFY_DELAY_SEC)
            showFeedback('debug', 'status', 'Notification scheduled in 30s.')
        } catch (err) {
            showFeedback(
                'debug',
                'error',
                err instanceof Error ? err.message : 'Could not schedule notification.',
            )
        } finally {
            setDebugBusy(false)
        }
    }

    const handleUpdateLocation = async () => {
        try {
            await sunLocation.updateFromDevice()
            showFeedback('location', 'status', 'Location updated.')
        } catch (err) {
            showFeedback(
                'location',
                'error',
                err instanceof Error ? err.message : 'Could not update location.',
            )
        }
    }

    const renderFeedback = (section: FeedbackSection) => {
        const active = feedback?.section === section ? feedback : null
        return (
            <div className={styles.feedbackSlot} aria-live='polite'>
                {active && (
                    <p
                        className={active.kind === 'error' ? styles.error : styles.status}
                        role={active.kind === 'error' ? 'alert' : 'status'}>
                        {active.text}
                    </p>
                )}
            </div>
        )
    }

    return (
        <section className={styles.page} aria-label='Settings'>
            <h1 className={styles.title}>Settings</h1>

            <div className={styles.scrollBody}>
                {installPrompt.canInstall && (
                    <div className={styles.card}>
                        <h2 className={styles.cardTitle}>Install App</h2>
                        <p className={styles.hint}>
                            Install Heaps of Sleeps on your device for fullscreen mode and quick
                            access.
                        </p>
                        <button
                            type='button'
                            className={styles.primaryButton}
                            aria-disabled={installPrompt.isInstalling}
                            onClick={installPrompt.triggerInstall}>
                            {installPrompt.isInstalling
                                ? 'Installing...'
                                : 'Install Heaps of Sleeps'}
                        </button>
                        {installPrompt.statusMessage && (
                            <p className={styles.status} role='status'>
                                {installPrompt.statusMessage}
                            </p>
                        )}
                    </div>
                )}

                <div className={styles.card}>
                    <h2 className={styles.cardTitle}>Push Notifications</h2>
                    {push.needsIosInstall ? (
                        <p className={styles.hint}>
                            Step 1: Tap Share in Safari and choose Add to Home Screen, then reopen
                            Heaps of Sleeps from your Home Screen.
                        </p>
                    ) : !push.supported ? (
                        <p className={styles.hint}>
                            Push notifications are not supported in this browser.
                        </p>
                    ) : !authUser ? (
                        <>
                            <p className={styles.hint}>
                                Step 1: Sign in to enable cloud sync and background lock-screen
                                alarms.
                            </p>
                            <div className={styles.buttonRow}>
                                <button
                                    type='button'
                                    className={styles.primaryButton}
                                    onClick={signIn}>
                                    Sign in with Google
                                </button>
                            </div>
                        </>
                    ) : (
                        <>
                            <p className={styles.hint}>
                                {push.isSubscribed
                                    ? 'Background push notifications are active on this device.'
                                    : 'Step 2: Enable notifications so alarms fire even when the app is closed.'}
                            </p>
                            {!push.hasVapidKey && (
                                <p className={styles.subtleHint}>
                                    Set VITE_VAPID_PUBLIC_KEY to enable background Web Push when
                                    locked.
                                </p>
                            )}
                            <div className={styles.buttonRow}>
                                {push.isSubscribed ? (
                                    <button
                                        type='button'
                                        className={styles.secondaryButton}
                                        disabled={push.busy}
                                        onClick={disablePush}>
                                        Disable Push
                                    </button>
                                ) : (
                                    <button
                                        type='button'
                                        className={styles.primaryButton}
                                        disabled={push.busy}
                                        onClick={enablePush}>
                                        {push.busy ? 'Enabling...' : 'Enable Notifications'}
                                    </button>
                                )}
                            </div>
                            <div className={styles.syncRow}>
                                <span className={styles.syncLabel}>
                                    {syncMode === 'cloud'
                                        ? `Signed in: ${authUser.email ?? 'Connected'}`
                                        : 'Local mode'}
                                </span>
                                <button
                                    type='button'
                                    className={styles.linkButton}
                                    onClick={signOut}>
                                    Sign out
                                </button>
                            </div>
                        </>
                    )}
                    {renderFeedback('push')}
                    {authError && (
                        <p className={styles.error} role='alert'>
                            {authError}
                        </p>
                    )}
                </div>

                <div className={styles.card}>
                    <h2 className={styles.cardTitle}>Location &amp; Sun Times</h2>
                    <p className={styles.hint}>
                        Sunrise {formatClockTime(sunLocation.sunTimes.sunriseMs)}
                        {' · '}
                        Sunset {formatClockTime(sunLocation.sunTimes.sunsetMs)}
                    </p>
                    <p className={styles.subtleHint}>
                        {sunLocation.location.source === 'device'
                            ? `Device location (${sunLocation.location.latitude.toFixed(2)}°, ${sunLocation.location.longitude.toFixed(2)}°)`
                            : 'Default location (Conifer, CO)'}
                    </p>
                    <div className={styles.buttonRow}>
                        <button
                            type='button'
                            className={styles.primaryButton}
                            disabled={sunLocation.busy}
                            onClick={handleUpdateLocation}>
                            {sunLocation.busy ? 'Updating...' : 'Update Location'}
                        </button>
                        {sunLocation.location.source === 'device' && (
                            <button
                                type='button'
                                className={styles.secondaryButton}
                                onClick={sunLocation.resetToDefault}>
                                Reset
                            </button>
                        )}
                    </div>
                    {renderFeedback('location')}
                </div>

                <div className={styles.card}>
                    <h2 className={styles.cardTitle}>Debug</h2>
                    <form className={styles.alarmForm} onSubmit={handleScheduleDebugNotification}>
                        <label className={styles.field}>
                            <span className={styles.fieldLabel}>Message</span>
                            <input
                                type='text'
                                className={styles.input}
                                value={label}
                                onChange={(e) => setLabel(e.target.value)}
                                maxLength={80}
                                required
                            />
                        </label>
                        <button type='submit' className={styles.primaryButton} disabled={debugBusy}>
                            {debugBusy ? 'Scheduling...' : 'Notify in 30s'}
                        </button>
                    </form>
                    {renderFeedback('debug')}
                </div>

                <div className={styles.card}>
                    <div className={styles.updateRow}>
                        <div className={styles.updateInfo}>
                            <h2 className={styles.cardTitle}>Update</h2>
                            <span className={styles.subtleHint}>
                                {appVersion.updateAvailable && appVersion.latestRevision
                                    ? `${appVersion.currentRevision} → ${appVersion.latestRevision}`
                                    : appVersion.currentRevision}
                            </span>
                        </div>
                        <button
                            type='button'
                            className={
                                appVersion.updateAvailable
                                    ? styles.updateButton
                                    : styles.secondaryButton
                            }
                            onClick={() => reloadPwaApp()}>
                            {appVersion.updateAvailable ? 'Update' : 'Reload'}
                        </button>
                    </div>
                </div>
            </div>
        </section>
    )
}
