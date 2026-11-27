import gsap from 'gsap'
import { memo, useCallback, useEffect, useId, useRef, useState } from 'react'
import type { ChildProfile } from '#src/lib/childrenStore.ts'
import { PAGES, type PageId } from '#src/pages/pages.ts'
import styles from './NavMenu.module.scss'

const SNAP_DURATION_SEC = 0.3
const EDGE_SWIPE_PX = 36
const SWIPE_LOCK_PX = 8
const SNAP_VELOCITY_PX_MS = 0.35

interface NavMenuProps {
    activePage: PageId
    hasUnsavedSchedule?: boolean
    childrenList?: readonly ChildProfile[]
    activeChildId?: string
    onSelectChild?: (childId: string) => void
    onSelectPage: (pageId: PageId) => void
}

interface SwipeGesture {
    mode: 'open' | 'close'
    startX: number
    startY: number
    lastX: number
    lastTime: number
    velocityX: number
    locked: boolean
    progress: number
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value))

export const NavMenu = memo(
    ({
        activePage,
        hasUnsavedSchedule = false,
        childrenList = [],
        activeChildId,
        onSelectChild,
        onSelectPage,
    }: NavMenuProps) => {
        const [isOpen, setIsOpen] = useState(false)
        const [isVisible, setIsVisible] = useState(false)

        const drawerRef = useRef<HTMLDivElement | null>(null)
        const buttonRef = useRef<HTMLButtonElement | null>(null)
        const barTopRef = useRef<HTMLSpanElement | null>(null)
        const barMidRef = useRef<HTMLSpanElement | null>(null)
        const barBotRef = useRef<HTMLSpanElement | null>(null)

        const timelineRef = useRef<gsap.core.Timeline | null>(null)
        const snapTweenRef = useRef<gsap.core.Tween | null>(null)
        const isOpenRef = useRef(false)
        const gestureRef = useRef<SwipeGesture | null>(null)
        const drawerId = useId()

        isOpenRef.current = isOpen

        const killSnapTween = useCallback(() => {
            snapTweenRef.current?.kill()
            snapTweenRef.current = null
        }, [])

        const animateTo = useCallback(
            (targetOpen: boolean) => {
                const tl = timelineRef.current
                if (!tl) return

                killSnapTween()
                const targetProgress = targetOpen ? 1 : 0
                const distance = Math.abs(targetProgress - tl.progress())

                if (targetOpen) {
                    setIsVisible(true)
                }
                setIsOpen(targetOpen)

                if (distance < 0.001) {
                    tl.progress(targetProgress)
                    if (!targetOpen) {
                        setIsVisible(false)
                    }
                    return
                }

                const duration = Math.max(0.14, SNAP_DURATION_SEC * distance)
                snapTweenRef.current = gsap.to(tl, {
                    progress: targetProgress,
                    duration,
                    ease: 'power3.out',
                    onComplete: () => {
                        snapTweenRef.current = null
                        if (!targetOpen) {
                            setIsVisible(false)
                        }
                    },
                })
            },
            [killSnapTween],
        )

        const toggleMenu = useCallback(() => {
            animateTo(!isOpenRef.current)
        }, [animateTo])

        const closeMenu = useCallback(() => {
            animateTo(false)
        }, [animateTo])

        useEffect(() => {
            const drawer = drawerRef.current
            const button = buttonRef.current
            const barTop = barTopRef.current
            const barMid = barMidRef.current
            const barBot = barBotRef.current
            if (!drawer || !button || !barTop || !barMid || !barBot) return

            const buildTimeline = (initialProgress: number): gsap.core.Timeline => {
                const computed = window.getComputedStyle(button)
                const leftPx = Number.parseFloat(computed.left) || 24
                const widthPx = button.offsetWidth || 44
                const viewportW = Math.max(1, window.innerWidth)
                const travelPx = Math.max(0, viewportW - 2 * leftPx - widthPx)
                // Start sliding/morphing once the drawer's right edge passes the hamburger by `leftPx`,
                // matching the X's inset from the right edge of the viewport when fully open.
                const startAt = Math.min(0.95, (2 * leftPx + widthPx) / viewportW)
                const slideDur = Math.max(0.05, 1 - startAt)
                const halfDur = slideDur / 2

                const tl = gsap.timeline({ paused: true })
                tl.fromTo(
                    drawer,
                    { xPercent: -100 },
                    { xPercent: 0, duration: 1, ease: 'none', force3D: true },
                    0,
                )
                    .fromTo(
                        button,
                        { x: 0 },
                        { x: travelPx, duration: slideDur, ease: 'none', force3D: true },
                        startAt,
                    )
                    .fromTo(
                        barTop,
                        { y: -7, rotation: 0 },
                        { y: 0, duration: halfDur, ease: 'none', force3D: true },
                        startAt,
                    )
                    .fromTo(
                        barBot,
                        { y: 7, rotation: 0 },
                        { y: 0, duration: halfDur, ease: 'none', force3D: true },
                        startAt,
                    )
                    .fromTo(
                        barMid,
                        { opacity: 1 },
                        { opacity: 0, duration: 0.001, ease: 'none' },
                        startAt + halfDur,
                    )
                    .to(
                        barTop,
                        { rotation: 45, duration: halfDur, ease: 'none', force3D: true },
                        startAt + halfDur,
                    )
                    .to(
                        barBot,
                        { rotation: -45, duration: halfDur, ease: 'none', force3D: true },
                        startAt + halfDur,
                    )

                tl.progress(initialProgress)
                return tl
            }

            timelineRef.current = buildTimeline(0)

            const handleResize = () => {
                const currentProgress = timelineRef.current?.progress() ?? 0
                killSnapTween()
                timelineRef.current?.kill()
                timelineRef.current = buildTimeline(currentProgress)
            }
            window.addEventListener('resize', handleResize)

            return () => {
                window.removeEventListener('resize', handleResize)
                killSnapTween()
                timelineRef.current?.kill()
                timelineRef.current = null
            }
        }, [killSnapTween])

        useEffect(() => {
            const handleKeyDown = (event: KeyboardEvent) => {
                if (event.key === 'Escape' && isOpenRef.current) {
                    closeMenu()
                }
            }
            window.addEventListener('keydown', handleKeyDown)
            return () => {
                window.removeEventListener('keydown', handleKeyDown)
            }
        }, [closeMenu])

        useEffect(() => {
            const handleTouchStart = (event: TouchEvent) => {
                if (event.touches.length !== 1) return
                const touch = event.touches[0]
                if (!touch) return

                const open = isOpenRef.current
                if (!open && touch.clientX > EDGE_SWIPE_PX) return
                // Avoid stealing touches from left-edge radial handles (e.g. 6-7 AM) in Schedule mode.
                if (
                    !open &&
                    touch.clientX > 14 &&
                    event.target instanceof Element &&
                    event.target.closest('[data-mode="schedule"]') !== null
                ) {
                    return
                }

                if (!open && !(event.target instanceof Element && event.target.closest('button'))) {
                    event.preventDefault()
                }

                gestureRef.current = {
                    mode: open ? 'close' : 'open',
                    startX: touch.clientX,
                    startY: touch.clientY,
                    lastX: touch.clientX,
                    lastTime: performance.now(),
                    velocityX: 0,
                    locked: false,
                    progress: timelineRef.current?.progress() ?? (open ? 1 : 0),
                }
            }

            const handleTouchMove = (event: TouchEvent) => {
                const gesture = gestureRef.current
                const tl = timelineRef.current
                if (!gesture || !tl || event.touches.length !== 1) return
                const touch = event.touches[0]
                if (!touch) return

                const dx = touch.clientX - gesture.startX
                const dy = touch.clientY - gesture.startY

                if (!gesture.locked) {
                    const absX = Math.abs(dx)
                    const absY = Math.abs(dy)
                    if (absX < SWIPE_LOCK_PX && absY < SWIPE_LOCK_PX) return

                    const wrongDirection =
                        (gesture.mode === 'open' && dx <= 0) ||
                        (gesture.mode === 'close' && dx >= 0)
                    if (absY > absX || wrongDirection) {
                        gestureRef.current = null
                        return
                    }

                    gesture.locked = true
                    killSnapTween()
                    setIsVisible(true)
                }

                event.preventDefault()

                const now = performance.now()
                const dt = Math.max(1, now - gesture.lastTime)
                gesture.velocityX = (touch.clientX - gesture.lastX) / dt
                gesture.lastX = touch.clientX
                gesture.lastTime = now

                const width = Math.max(1, window.innerWidth)
                const progress =
                    gesture.mode === 'open' ? clamp01(dx / width) : clamp01(1 + dx / width)
                gesture.progress = progress
                tl.progress(progress)
            }

            const handleTouchEnd = () => {
                const gesture = gestureRef.current
                gestureRef.current = null
                if (!gesture?.locked) return

                const shouldOpen =
                    gesture.mode === 'open'
                        ? gesture.progress > 0.25 || gesture.velocityX > SNAP_VELOCITY_PX_MS
                        : gesture.progress > 0.75 && gesture.velocityX > -SNAP_VELOCITY_PX_MS

                animateTo(shouldOpen)
            }

            window.addEventListener('touchstart', handleTouchStart, { passive: false })
            window.addEventListener('touchmove', handleTouchMove, { passive: false })
            window.addEventListener('touchend', handleTouchEnd, { passive: true })
            window.addEventListener('touchcancel', handleTouchEnd, { passive: true })

            return () => {
                window.removeEventListener('touchstart', handleTouchStart)
                window.removeEventListener('touchmove', handleTouchMove)
                window.removeEventListener('touchend', handleTouchEnd)
                window.removeEventListener('touchcancel', handleTouchEnd)
            }
        }, [animateTo, killSnapTween])

        const handleSelect = (pageId: PageId) => {
            onSelectPage(pageId)
            closeMenu()
        }

        return (
            <div data-nav-open={isVisible}>
                <div
                    ref={drawerRef}
                    id={drawerId}
                    role='dialog'
                    aria-modal={isOpen}
                    aria-label='Navigation'
                    aria-hidden={!isVisible}
                    data-visible={isVisible}
                    className={styles.drawer}>
                    <span className={styles.drawerTitle}>Heaps of Sleeps</span>
                    {childrenList.length >= 2 && onSelectChild && (
                        <div className={styles.childSwitcher} role='tablist' aria-label='Children'>
                            {childrenList.map((child) => (
                                <button
                                    key={child.id}
                                    type='button'
                                    role='tab'
                                    aria-selected={child.id === activeChildId}
                                    tabIndex={isOpen ? 0 : -1}
                                    className={styles.childChip}
                                    onClick={() => onSelectChild(child.id)}>
                                    {child.name}
                                </button>
                            ))}
                        </div>
                    )}
                    <nav aria-label='Pages' className={styles.navList}>
                        {PAGES.map((page) => {
                            const showDirtyPencil = page.id === 'schedule' && hasUnsavedSchedule
                            return (
                                <button
                                    key={page.id}
                                    type='button'
                                    className={styles.navButton}
                                    tabIndex={isOpen ? 0 : -1}
                                    aria-current={page.id === activePage ? 'page' : undefined}
                                    aria-label={
                                        showDirtyPencil
                                            ? `${page.label} (unsaved changes)`
                                            : undefined
                                    }
                                    onClick={() => handleSelect(page.id)}>
                                    {page.label}
                                    {showDirtyPencil && (
                                        <svg
                                            className={styles.dirtyIcon}
                                            width='22'
                                            height='22'
                                            viewBox='0 0 24 24'
                                            fill='none'
                                            aria-hidden='true'>
                                            <path
                                                d='M16.862 3.487a2.1 2.1 0 0 1 2.97 2.97L8.25 18.04 4 19l.96-4.25L16.862 3.487Z'
                                                stroke='currentColor'
                                                strokeWidth='2'
                                                strokeLinecap='round'
                                                strokeLinejoin='round'
                                            />
                                        </svg>
                                    )}
                                </button>
                            )
                        })}
                    </nav>
                </div>

                <button
                    ref={buttonRef}
                    type='button'
                    className={styles.menuButton}
                    onClick={toggleMenu}
                    aria-label={isOpen ? 'Close navigation menu' : 'Open navigation menu'}
                    aria-expanded={isOpen}
                    aria-controls={drawerId}>
                    <span className={styles.hamburgerIcon} aria-hidden='true'>
                        <span ref={barTopRef} className={styles.bar} />
                        <span ref={barMidRef} className={styles.bar} />
                        <span ref={barBotRef} className={styles.bar} />
                    </span>
                </button>
            </div>
        )
    },
)
