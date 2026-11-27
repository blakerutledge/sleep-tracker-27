import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { useAlarmTimers } from '#src/lib/alarms.ts'
import {
    CHILD_PRONOUNS_OPTIONS,
    type ChildProfile,
    type ChildPronouns,
    MAX_CHILDREN,
    useChildren,
} from '#src/lib/childrenStore.ts'
import { MAX_DEV_SPEED, MIN_DEV_SPEED, useDevMode } from '#src/lib/devMode.ts'
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
    const devMode = useDevMode()
    const childrenStore = useChildren()
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
    const [editingChildId, setEditingChildId] = useState<string | 'new' | null>(null)
    const [childName, setChildName] = useState('')
    const [childPronouns, setChildPronouns] = useState<ChildPronouns>('they/them')
    const [childBirthDate, setChildBirthDate] = useState('2027-01-01')
    const [childBusy, setChildBusy] = useState(false)
    const feedbackTimerRef = useRef<number | null>(null)

    const startEditChild = (child: ChildProfile) => {
        setEditingChildId(child.id)
        setChildName(child.name)
        setChildPronouns(child.pronouns)
        setChildBirthDate(child.birthDate)
    }

    const startAddChild = () => {
        setEditingChildId('new')
        setChildName('')
        setChildPronouns('they/them')
        setChildBirthDate('2027-01-01')
    }

    const handleSaveChild = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        if (childBusy || !childName.trim()) return
        setChildBusy(true)
        try {
            if (editingChildId === 'new') {
                await childrenStore.addChild({
                    name: childName,
                    pronouns: childPronouns,
                    birthDate: childBirthDate,
                })
            } else if (editingChildId) {
                await childrenStore.updateChild(editingChildId, {
                    name: childName,
                    pronouns: childPronouns,
                    birthDate: childBirthDate,
                })
            }
            setEditingChildId(null)
        } finally {
            setChildBusy(false)
        }
    }

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
                    <div className={styles.toggleRow}>
                        <div className={styles.updateInfo}>
                            <h2 className={styles.cardTitle}>Children</h2>
                            <span className={styles.subtleHint}>
                                {childrenStore.children.length} of {MAX_CHILDREN} · Schedules are
                                saved per child
                            </span>
                        </div>
                        {childrenStore.children.length < MAX_CHILDREN &&
                            editingChildId !== 'new' && (
                                <button
                                    type='button'
                                    className={styles.secondaryButton}
                                    onClick={startAddChild}>
                                    + Add
                                </button>
                            )}
                    </div>

                    <div className={styles.childList}>
                        {childrenStore.children.map((child) => {
                            const isActive = child.id === childrenStore.activeChildId
                            return (
                                <div
                                    key={child.id}
                                    className={styles.childRow}
                                    data-active={isActive}>
                                    <button
                                        type='button'
                                        className={styles.childMain}
                                        onClick={() => childrenStore.setActiveChildId(child.id)}>
                                        <span className={styles.childName}>{child.name}</span>
                                        <span className={styles.subtleHint}>
                                            {child.pronouns} · {child.birthDate}
                                        </span>
                                    </button>
                                    <div className={styles.childActions}>
                                        {isActive && (
                                            <span className={styles.activeChildBadge}>Active</span>
                                        )}
                                        <button
                                            type='button'
                                            className={styles.linkButton}
                                            onClick={() => startEditChild(child)}>
                                            Edit
                                        </button>
                                        {childrenStore.children.length > 1 && (
                                            <button
                                                type='button'
                                                className={styles.dangerLinkButton}
                                                onClick={() =>
                                                    void childrenStore.deleteChild(child.id)
                                                }>
                                                Remove
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )
                        })}
                    </div>

                    {editingChildId !== null && (
                        <form className={styles.childForm} onSubmit={handleSaveChild}>
                            <label className={styles.field}>
                                <span className={styles.fieldLabel}>Name</span>
                                <input
                                    type='text'
                                    className={styles.input}
                                    value={childName}
                                    onChange={(e) => setChildName(e.target.value)}
                                    maxLength={40}
                                    placeholder='Child name'
                                    required
                                />
                            </label>

                            <div className={styles.childFormRow}>
                                <label className={styles.field}>
                                    <span className={styles.fieldLabel}>Pronouns</span>
                                    <select
                                        className={styles.input}
                                        value={childPronouns}
                                        onChange={(e) =>
                                            setChildPronouns(e.target.value as ChildPronouns)
                                        }>
                                        {CHILD_PRONOUNS_OPTIONS.map((option) => (
                                            <option key={option} value={option}>
                                                {option}
                                            </option>
                                        ))}
                                    </select>
                                </label>

                                <label className={styles.field}>
                                    <span className={styles.fieldLabel}>Birthday</span>
                                    <input
                                        type='date'
                                        className={styles.dateInput}
                                        value={childBirthDate}
                                        onChange={(e) => setChildBirthDate(e.target.value)}
                                        required
                                    />
                                </label>
                            </div>

                            <div className={styles.buttonRow}>
                                <button
                                    type='submit'
                                    className={styles.primaryButton}
                                    disabled={childBusy || !childName.trim()}>
                                    {editingChildId === 'new' ? 'Add Child' : 'Save Child'}
                                </button>
                                <button
                                    type='button'
                                    className={styles.secondaryButton}
                                    onClick={() => setEditingChildId(null)}>
                                    Cancel
                                </button>
                            </div>
                        </form>
                    )}
                </div>

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
                    <div className={styles.toggleRow}>
                        <div className={styles.updateInfo}>
                            <h2 className={styles.cardTitle}>Dev Mode</h2>
                            <span className={styles.subtleHint}>
                                Time simulation and dial overrides
                            </span>
                        </div>
                        <button
                            type='button'
                            role='switch'
                            aria-checked={devMode.settings.enabled}
                            aria-label='Enable Dev Mode'
                            className={styles.switch}
                            onClick={() => devMode.setEnabled(!devMode.settings.enabled)}>
                            <span className={styles.switchThumb} />
                        </button>
                    </div>

                    {devMode.settings.enabled && (
                        <>
                            <label className={styles.sliderField}>
                                <span className={styles.sliderHeader}>
                                    <span className={styles.fieldLabel}>Speed</span>
                                    <span className={styles.sliderValue}>
                                        {devMode.settings.speedMultiplier}x
                                    </span>
                                </span>
                                <input
                                    type='range'
                                    className={styles.slider}
                                    min={MIN_DEV_SPEED}
                                    max={MAX_DEV_SPEED}
                                    step={1}
                                    value={devMode.settings.speedMultiplier}
                                    onChange={(e) =>
                                        devMode.setSpeedMultiplier(Number(e.target.value))
                                    }
                                />
                                <span className={styles.sliderScale}>
                                    <span>1x</span>
                                    <span>1440x (24h / min)</span>
                                </span>
                            </label>

                            <div className={styles.toggleRow}>
                                <div className={styles.updateInfo}>
                                    <span className={styles.toggleLabel}>Turn dial in Today</span>
                                    <span className={styles.subtleHint}>
                                        Drag the dial in Today view to adjust time manually
                                    </span>
                                </div>
                                <button
                                    type='button'
                                    role='switch'
                                    aria-checked={devMode.settings.manualDialInToday}
                                    aria-label='Allow turning dial in Today mode'
                                    className={styles.switch}
                                    onClick={() =>
                                        devMode.setManualDialInToday(
                                            !devMode.settings.manualDialInToday,
                                        )
                                    }>
                                    <span className={styles.switchThumb} />
                                </button>
                            </div>
                        </>
                    )}
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
