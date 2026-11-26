import { useCallback, useEffect, useRef, useState } from 'react'
import styles from './App.module.scss'
import { Dial, type DialHandle } from './components/Dial/index.tsx'
import { NavMenu } from './components/NavMenu/index.tsx'
import { isStandaloneDisplayMode } from './lib/pwa.ts'
import { epochToZonedDateTime } from './lib/temporal.ts'
import { HistoryPage } from './pages/HistoryPage/index.tsx'
import { NotesPage } from './pages/NotesPage/index.tsx'
import { getPagePath, type PageId, resolvePageId } from './pages/pages.ts'
import { SchedulePage } from './pages/SchedulePage/index.tsx'
import { SettingsPage } from './pages/SettingsPage/index.tsx'
import { TodayPage } from './pages/TodayPage/index.tsx'
import './styles/globals.scss'

const EDGE_SWIPE_GUARD_PX = 36
const SWIPE_LOCK_PX = 8
const SWIPE_COMMIT_THRESHOLD = 0.18
const SWIPE_COMMIT_VELOCITY_PX_MS = 0.45

interface VerticalSwipe {
    originPage: 'today' | 'schedule'
    startX: number
    startY: number
    lastY: number
    lastTime: number
    velocityY: number
    locked: boolean
    progress: number
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value))

const getNowMinuteOfDay = (): number => {
    const zdt = epochToZonedDateTime(Date.now())
    return zdt.hour * 60 + zdt.minute
}

const resolveInitialPage = (): PageId => {
    // Installed PWAs always reopen to /today on cold launch (e.g., after force-close).
    if (isStandaloneDisplayMode()) {
        if (window.location.pathname !== '/today') {
            window.history.replaceState(null, '', '/today')
        }
        return 'today'
    }
    return resolvePageId(window.location.pathname)
}

const App = () => {
    const [activePage, setActivePage] = useState<PageId>(resolveInitialPage)
    const [dialMinuteOfDay, setDialMinuteOfDay] = useState<number>(() => getNowMinuteOfDay())
    const dialRef = useRef<DialHandle | null>(null)
    const activePageRef = useRef<PageId>(activePage)
    activePageRef.current = activePage

    useEffect(() => {
        const handlePopState = () => {
            setActivePage(resolvePageId(window.location.pathname))
        }
        window.addEventListener('popstate', handlePopState)
        return () => {
            window.removeEventListener('popstate', handlePopState)
        }
    }, [])

    const handleSelectPage = useCallback((pageId: PageId) => {
        const targetPath = getPagePath(pageId)
        if (window.location.pathname !== targetPath) {
            window.history.replaceState(null, '', targetPath)
        }
        setActivePage(pageId)
    }, [])

    useEffect(() => {
        if (!('serviceWorker' in navigator)) return
        const handleSwMessage = (event: MessageEvent) => {
            const data = event.data as { type?: string; url?: string } | null
            if (data?.type === 'NAVIGATE' && typeof data.url === 'string') {
                handleSelectPage(resolvePageId(data.url))
            }
        }
        navigator.serviceWorker.addEventListener('message', handleSwMessage)
        return () => {
            navigator.serviceWorker.removeEventListener('message', handleSwMessage)
        }
    }, [handleSelectPage])

    useEffect(() => {
        let swipe: VerticalSwipe | null = null

        const handleTouchStart = (event: TouchEvent) => {
            if (event.touches.length !== 1) return
            if (document.querySelector('[data-nav-open="true"]') !== null) return

            const touch = event.touches[0]
            if (!touch || touch.clientX <= EDGE_SWIPE_GUARD_PX) return

            const page = activePageRef.current
            if (
                page === 'schedule' &&
                event.target instanceof Element &&
                event.target.closest('[data-dial-interactive="true"]') !== null
            ) {
                swipe = null
                return
            }

            const height = window.innerHeight
            if (page === 'today' && touch.clientY >= height * 0.6) {
                swipe = {
                    originPage: 'today',
                    startX: touch.clientX,
                    startY: touch.clientY,
                    lastY: touch.clientY,
                    lastTime: performance.now(),
                    velocityY: 0,
                    locked: false,
                    progress: 0,
                }
            } else if (page === 'schedule' && touch.clientY <= height * 0.25) {
                swipe = {
                    originPage: 'schedule',
                    startX: touch.clientX,
                    startY: touch.clientY,
                    lastY: touch.clientY,
                    lastTime: performance.now(),
                    velocityY: 0,
                    locked: false,
                    progress: 1,
                }
            } else {
                swipe = null
            }
        }

        const handleTouchMove = (event: TouchEvent) => {
            if (!swipe || event.touches.length !== 1) return
            if (document.querySelector('[data-dial-interactive="true"][data-dragging="true"]')) {
                swipe = null
                return
            }

            const touch = event.touches[0]
            if (!touch) return

            const dx = touch.clientX - swipe.startX
            const dy = touch.clientY - swipe.startY

            if (!swipe.locked) {
                const absX = Math.abs(dx)
                const absY = Math.abs(dy)
                if (absX < SWIPE_LOCK_PX && absY < SWIPE_LOCK_PX) return

                const wrongDirection =
                    (swipe.originPage === 'today' && dy >= 0) ||
                    (swipe.originPage === 'schedule' && dy <= 0)
                if (absX > absY || wrongDirection) {
                    swipe = null
                    return
                }
                swipe.locked = true
            }

            const now = performance.now()
            const dt = Math.max(1, now - swipe.lastTime)
            swipe.velocityY = (touch.clientY - swipe.lastY) / dt
            swipe.lastY = touch.clientY
            swipe.lastTime = now

            const travelSpan = Math.max(180, window.innerHeight * 0.38)
            const progress =
                swipe.originPage === 'today'
                    ? clamp01(-dy / travelSpan)
                    : clamp01(1 - dy / travelSpan)
            swipe.progress = progress
            dialRef.current?.scrubTo(progress)

            const deltaProgress = swipe.originPage === 'today' ? progress : 1 - progress
            if (deltaProgress >= SWIPE_COMMIT_THRESHOLD) {
                const nextPage = swipe.originPage === 'today' ? 'schedule' : 'today'
                swipe = null
                handleSelectPage(nextPage)
            }
        }

        const handleTouchEnd = () => {
            const active = swipe
            swipe = null
            if (!active?.locked) return

            if (active.originPage === 'today') {
                if (active.velocityY < -SWIPE_COMMIT_VELOCITY_PX_MS) {
                    handleSelectPage('schedule')
                } else {
                    dialRef.current?.animateTo('today', 0.35)
                }
            } else if (active.velocityY > SWIPE_COMMIT_VELOCITY_PX_MS) {
                handleSelectPage('today')
            } else {
                dialRef.current?.animateTo('schedule', 0.35)
            }
        }

        window.addEventListener('touchstart', handleTouchStart, { passive: true })
        window.addEventListener('touchmove', handleTouchMove, { passive: true })
        window.addEventListener('touchend', handleTouchEnd, { passive: true })
        window.addEventListener('touchcancel', handleTouchEnd, { passive: true })

        return () => {
            window.removeEventListener('touchstart', handleTouchStart)
            window.removeEventListener('touchmove', handleTouchMove)
            window.removeEventListener('touchend', handleTouchEnd)
            window.removeEventListener('touchcancel', handleTouchEnd)
        }
    }, [handleSelectPage])

    const renderPage = () => {
        switch (activePage) {
            case 'today':
                return <TodayPage minuteOfDay={dialMinuteOfDay} />
            case 'schedule':
                return <SchedulePage minuteOfDay={dialMinuteOfDay} />
            case 'history':
                return <HistoryPage />
            case 'notes':
                return <NotesPage />
            case 'settings':
                return <SettingsPage />
        }
    }

    return (
        <div className={styles.app}>
            <Dial ref={dialRef} activePage={activePage} onMinuteChange={setDialMinuteOfDay} />
            <NavMenu activePage={activePage} onSelectPage={handleSelectPage} />
            <main className={styles.main}>{renderPage()}</main>
        </div>
    )
}

export default App
