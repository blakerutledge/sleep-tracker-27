import { useEffect, useMemo, useState } from 'react'
import styles from './AppV1.module.scss'
import { EntryView } from './components/EntryView/index.tsx'
import { EventEditDialog } from './components/EventEditDialog/index.tsx'
import { GraphsView } from './components/GraphsView/index.tsx'
import { PlaybookView } from './components/PlaybookView/index.tsx'
import { SettingsDialog } from './components/SettingsDialog/index.tsx'
import { buildSleepSegments } from './engine/interpolation.ts'
import { evaluatePlsCoach } from './engine/plsCoach.ts'
import { useSleepStore } from './lib/storage.ts'
import { getBabyAgeInfo } from './lib/temporal.ts'
import './styles/v1Globals.scss'
import type { SleepEvent, SleepSegment } from './types.ts'

type AppView = 'entry' | 'graphs' | 'coach'

export default function AppV1() {
    const store = useSleepStore()
    const [view, setView] = useState<AppView>('entry')
    const [nowMs, setNowMs] = useState(() => Date.now())
    const [settingsOpen, setSettingsOpen] = useState(false)
    const [editingEvent, setEditingEvent] = useState<SleepEvent | null>(null)
    const [inspectingSegment, setInspectingSegment] = useState<SleepSegment | null>(null)

    useEffect(() => {
        const id = window.setInterval(() => setNowMs(Date.now()), 30_000)
        const onVis = () => {
            if (document.visibilityState === 'visible') setNowMs(Date.now())
        }
        document.addEventListener('visibilitychange', onVis)
        return () => {
            window.clearInterval(id)
            document.removeEventListener('visibilitychange', onVis)
        }
    }, [])

    const age = useMemo(() => getBabyAgeInfo(store.settings, nowMs), [store.settings, nowMs])

    const segments = useMemo(
        () => buildSleepSegments(store.events, store.settings, nowMs),
        [store.events, store.settings, nowMs],
    )

    const { insights, optimalSlipBedtimeClock } = useMemo(
        () => evaluatePlsCoach(segments, store.events, store.settings, nowMs),
        [segments, store.events, store.settings, nowMs],
    )

    const alertBadgeCount = useMemo(
        () => insights.filter((i) => i.severity === 'action' || i.severity === 'watch').length,
        [insights],
    )

    const handleSelectSegment = (seg: SleepSegment) => {
        if (seg.source === 'real' && seg.startEventId) {
            const ev = store.events.find((e) => e.id === seg.startEventId) ?? null
            if (ev) {
                setInspectingSegment(null)
                setEditingEvent(ev)
                return
            }
        }
        setEditingEvent(null)
        setInspectingSegment(seg)
    }

    return (
        <div className={styles.appShell}>
            <header className={styles.appHeader}>
                <div className={styles.headerBrand}>
                    <h1 className={styles.brandTitle}>{store.settings.babyName || 'Baby'}</h1>
                    <span className={styles.brandMeta}>
                        {age.displayLabel} ·{' '}
                        {store.syncMode === 'cloud'
                            ? store.isOnline
                                ? 'synced'
                                : 'offline cache'
                            : 'local'}
                        {store.settings.isDemoMode ? ' · demo' : ''}
                    </span>
                </div>

                <div className={styles.headerNavWrap}>
                    <nav className={styles.topNav} aria-label='App sections'>
                        <button
                            type='button'
                            className={styles.navItemBtn}
                            aria-current={view === 'entry' ? 'page' : undefined}
                            onClick={() => setView('entry')}>
                            Log
                        </button>
                        <button
                            type='button'
                            className={styles.navItemBtn}
                            aria-current={view === 'graphs' ? 'page' : undefined}
                            onClick={() => setView('graphs')}>
                            Graphs
                        </button>
                        <button
                            type='button'
                            className={styles.navItemBtn}
                            aria-current={view === 'coach' ? 'page' : undefined}
                            onClick={() => setView('coach')}>
                            {alertBadgeCount > 0 ? `Guide [${alertBadgeCount}]` : 'Guide'}
                        </button>
                    </nav>

                    <button
                        type='button'
                        className='icon-btn'
                        onClick={() => setSettingsOpen(true)}
                        aria-label='Open setup and sync settings'>
                        Setup
                    </button>
                </div>
            </header>

            <main className={styles.appMain}>
                {store.authError ? (
                    <div className='banner' role='alert'>
                        <span>{store.authError}</span>
                    </div>
                ) : null}

                {store.pendingMigrationCount > 0 ? (
                    <div className='banner'>
                        <span>
                            {store.pendingMigrationCount} local logs ready to upload to cloud sync.
                        </span>
                        <div className='chip-row'>
                            <button
                                type='button'
                                className='btn'
                                onClick={store.dismissMigrationBanner}>
                                Later
                            </button>
                            <button
                                type='button'
                                className='btn primary'
                                onClick={store.migrateLocalToCloud}>
                                Upload
                            </button>
                        </div>
                    </div>
                ) : null}

                {view === 'entry' ? (
                    <EntryView
                        events={store.events}
                        segments={segments}
                        settings={store.settings}
                        nowMs={nowMs}
                        onAddEvent={store.addEvent}
                        onDeleteEvent={store.deleteEvent}
                        onSelectEditEvent={(ev) => {
                            setInspectingSegment(null)
                            setEditingEvent(ev)
                        }}
                        onLoadDemo={store.loadDemoData}
                    />
                ) : view === 'graphs' ? (
                    <GraphsView
                        segments={segments}
                        settings={store.settings}
                        nowMs={nowMs}
                        onSelectSegment={handleSelectSegment}
                    />
                ) : (
                    <PlaybookView
                        insights={insights}
                        optimalSlipBedtimeClock={optimalSlipBedtimeClock}
                        settings={store.settings}
                        nowMs={nowMs}
                    />
                )}
            </main>

            <EventEditDialog
                open={editingEvent !== null || inspectingSegment !== null}
                onClose={() => {
                    setEditingEvent(null)
                    setInspectingSegment(null)
                }}
                editingEvent={editingEvent}
                inspectingSegment={inspectingSegment}
                timeZone={store.settings.timeZone}
                onSaveEvent={store.updateEvent}
                onDeleteEvent={store.deleteEvent}
                onMaterializeBoundary={async (t, ts, c) => {
                    await store.addEvent(t, ts, c)
                }}
            />

            <SettingsDialog
                open={settingsOpen}
                onClose={() => setSettingsOpen(false)}
                settings={store.settings}
                authUser={store.authUser}
                syncMode={store.syncMode}
                eventsCount={store.events.length}
                onUpdateSettings={store.updateSettings}
                onSignIn={store.signIn}
                onSignOut={store.signOut}
                onLoadDemo={store.loadDemoData}
                onResetClean={store.resetToCleanSlate}
                onExportJson={store.exportJson}
            />
        </div>
    )
}
