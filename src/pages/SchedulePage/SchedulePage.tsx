import gsap from 'gsap'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { DialKey } from '#src/components/DialKey/index.tsx'
import { ScheduleList } from '#src/components/ScheduleList/index.tsx'
import { SchedulePicker } from '#src/components/SchedulePicker/index.tsx'
import {
    formatMinuteOfDay24h,
    getScheduleWedgeInfo,
    parseTime24hToMinute,
    type ScheduleEvent,
    type ScheduleWedgeInfo,
} from '#src/data/schedule.ts'
import type { SavedSchedule } from '#src/lib/scheduleStore.ts'
import { formatMinutesHuman } from '#src/lib/temporal.ts'
import styles from './SchedulePage.module.scss'

export type ScheduleViewMode = 'dial' | 'list'

interface SchedulePageProps {
    childName: string
    schedules: readonly SavedSchedule[]
    activeSchedule: SavedSchedule
    events: readonly ScheduleEvent[]
    isDirty: boolean
    viewMode: ScheduleViewMode
    displayedViewMode: ScheduleViewMode
    isViewExiting: boolean
    selectedWedgeId: string | null
    onChangeViewMode: (mode: ScheduleViewMode) => void
    onClearSelection: () => void
    onChangeEventMinute: (eventId: string, minuteOfDay: number) => void
    onAddSleepWindow: () => void
    onAddNightWake: () => void
    onRemoveSleepWindow: (startEventId: string) => void
    onSave: () => Promise<void>
    onSaveAsNew: (name: string) => Promise<void>
    onLoadSchedule: (scheduleId: string) => Promise<void>
    onRenameSchedule: (scheduleId: string, name: string) => Promise<void>
    onDeleteSchedule: (scheduleId: string) => Promise<void>
    onDiscard: () => void
}

export const SchedulePage = ({
    childName,
    schedules,
    activeSchedule,
    events,
    isDirty,
    viewMode,
    displayedViewMode,
    isViewExiting,
    selectedWedgeId,
    onChangeViewMode,
    onClearSelection,
    onChangeEventMinute,
    onAddSleepWindow,
    onAddNightWake,
    onRemoveSleepWindow,
    onSave,
    onSaveAsNew,
    onLoadSchedule,
    onRenameSchedule,
    onDeleteSchedule,
    onDiscard,
}: SchedulePageProps) => {
    const [pickerOpen, setPickerOpen] = useState(false)
    const [addMenuOpen, setAddMenuOpen] = useState(false)
    const addFabRef = useRef<HTMLDivElement | null>(null)
    const dialKeyRef = useRef<HTMLUListElement | null>(null)
    const topActionsRef = useRef<HTMLDivElement | null>(null)
    const bottomDockRef = useRef<HTMLDivElement | null>(null)
    const inspectorSlotRef = useRef<HTMLDivElement | null>(null)
    const cardTimelineRef = useRef<gsap.core.Timeline | null>(null)
    const hasMountedCardRef = useRef(false)

    const selectedWedge = useMemo(
        () => (selectedWedgeId ? getScheduleWedgeInfo(selectedWedgeId, events) : null),
        [events, selectedWedgeId],
    )

    const activeCard: ScheduleWedgeInfo | null =
        displayedViewMode === 'dial' && !isViewExiting ? selectedWedge : null

    const hasActiveCard = activeCard !== null
    const activeCardKey = activeCard
        ? `${activeCard.startEvent.id}:${activeCard.startEvent.minuteOfDay}:${activeCard.endEvent.id}:${activeCard.endEvent.minuteOfDay}:${activeCard.name}:${activeCard.durationMinutes}:${activeCard.segmentDurations?.join(',') ?? ''}:${activeCard.secondarySegmentDurations?.join(',') ?? ''}`
        : null
    const [retainedCard, setRetainedCard] = useState<{
        key: string
        card: ScheduleWedgeInfo
    } | null>(null)
    if (activeCard && activeCardKey && retainedCard?.key !== activeCardKey) {
        setRetainedCard({ key: activeCardKey, card: activeCard })
    }

    const displayedCard = activeCard ?? retainedCard?.card ?? null
    const cardExiting = !hasActiveCard && retainedCard !== null

    useLayoutEffect(() => {
        if (!hasMountedCardRef.current) {
            hasMountedCardRef.current = true
            if (!hasActiveCard) return
        }

        cardTimelineRef.current?.kill()
        const slot = inspectorSlotRef.current
        const chromeTargets = [addFabRef.current, dialKeyRef.current].filter(
            (el): el is HTMLDivElement | HTMLUListElement => el !== null,
        )

        const tl = gsap.timeline()
        cardTimelineRef.current = tl

        if (hasActiveCard) {
            if (chromeTargets.length > 0) {
                tl.to(chromeTargets, {
                    opacity: 0,
                    duration: 0.14,
                    ease: 'power2.out',
                })
            }
            if (slot) {
                tl.to(slot, {
                    opacity: 1,
                    duration: 0.2,
                    ease: 'power2.out',
                })
            }
        } else {
            if (slot) {
                tl.to(slot, {
                    opacity: 0,
                    duration: 0.16,
                    ease: 'power2.out',
                    onComplete: () => {
                        setRetainedCard(null)
                    },
                })
            } else {
                setRetainedCard(null)
            }
            if (chromeTargets.length > 0) {
                tl.to(chromeTargets, {
                    opacity: 1,
                    duration: 0.18,
                    ease: 'power2.out',
                })
            }
        }
    }, [hasActiveCard])

    useEffect(
        () => () => {
            cardTimelineRef.current?.kill()
        },
        [],
    )

    useEffect(() => {
        if (hasActiveCard) {
            setAddMenuOpen(false)
        }
    }, [hasActiveCard])

    useEffect(() => {
        if (!addMenuOpen) return
        const handlePointerDown = (event: PointerEvent) => {
            const target = event.target
            if (!(target instanceof Element)) return
            if (addFabRef.current?.contains(target)) return
            setAddMenuOpen(false)
        }
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setAddMenuOpen(false)
            }
        }
        window.addEventListener('pointerdown', handlePointerDown)
        window.addEventListener('keydown', handleKeyDown)
        return () => {
            window.removeEventListener('pointerdown', handlePointerDown)
            window.removeEventListener('keydown', handleKeyDown)
        }
    }, [addMenuOpen])

    useEffect(() => {
        if (!hasActiveCard || pickerOpen) return
        const handlePointerDown = (event: PointerEvent) => {
            const target = event.target
            if (!(target instanceof Element)) return
            if (bottomDockRef.current?.contains(target)) return
            if (addFabRef.current?.contains(target)) return
            if (topActionsRef.current?.contains(target)) return
            if (target.closest('[data-dial-interactive="true"]') !== null) return
            onClearSelection()
        }
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClearSelection()
            }
        }
        window.addEventListener('pointerdown', handlePointerDown)
        window.addEventListener('keydown', handleKeyDown)
        return () => {
            window.removeEventListener('pointerdown', handlePointerDown)
            window.removeEventListener('keydown', handleKeyDown)
        }
    }, [hasActiveCard, onClearSelection, pickerOpen])

    const handleModalTimeChange = (eventId: string, raw: string) => {
        const parsed = parseTime24hToMinute(raw)
        if (parsed !== null) {
            onChangeEventMinute(eventId, parsed)
        }
    }

    return (
        <section className={styles.page} data-view={displayedViewMode} aria-label='Schedule'>
            <header className={styles.header}>
                <h1 className={styles.title}>Schedule</h1>
                <p className={styles.scheduleName}>{activeSchedule.name}</p>
            </header>

            <div ref={topActionsRef} className={styles.topActions}>
                <div className={styles.dirtyActions} data-visible={isDirty} aria-hidden={!isDirty}>
                    <button
                        type='button'
                        className={styles.iconActionButton}
                        aria-label='Discard changes'
                        title='Discard changes'
                        tabIndex={isDirty ? 0 : -1}
                        onClick={onDiscard}>
                        <svg
                            width='16'
                            height='16'
                            viewBox='0 0 24 24'
                            fill='none'
                            aria-hidden='true'>
                            <path
                                d='M3 12a9 9 0 1 0 3-6.7L3 8'
                                stroke='currentColor'
                                strokeWidth='2.1'
                                strokeLinecap='round'
                                strokeLinejoin='round'
                            />
                            <path
                                d='M3 3v5h5'
                                stroke='currentColor'
                                strokeWidth='2.1'
                                strokeLinecap='round'
                                strokeLinejoin='round'
                            />
                        </svg>
                    </button>
                    <button
                        type='button'
                        className={`${styles.iconActionButton} ${styles.saveActionButton}`}
                        aria-label='Save schedule'
                        title='Save schedule'
                        tabIndex={isDirty ? 0 : -1}
                        onClick={() => void onSave()}>
                        <svg
                            width='16'
                            height='16'
                            viewBox='0 0 24 24'
                            fill='none'
                            aria-hidden='true'>
                            <path
                                d='M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z'
                                stroke='currentColor'
                                strokeWidth='2.1'
                                strokeLinecap='round'
                                strokeLinejoin='round'
                            />
                            <path
                                d='M17 21v-7H7v7M7 3v5h8'
                                stroke='currentColor'
                                strokeWidth='2.1'
                                strokeLinecap='round'
                                strokeLinejoin='round'
                            />
                        </svg>
                    </button>
                </div>

                <button
                    type='button'
                    className={styles.iconActionButton}
                    aria-label='Load or manage schedules'
                    title='Load or manage schedules'
                    onClick={() => setPickerOpen(true)}>
                    <svg width='16' height='16' viewBox='0 0 24 24' fill='none' aria-hidden='true'>
                        <path
                            d='M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1M3 7v11a2 2 0 0 0 2 2h13.5a2 2 0 0 0 1.94-1.52l1.5-6A2 2 0 0 0 20 10H6.5a2 2 0 0 0-1.94 1.52L3 18'
                            stroke='currentColor'
                            strokeWidth='2.1'
                            strokeLinecap='round'
                            strokeLinejoin='round'
                        />
                    </svg>
                </button>
            </div>

            <div className={styles.toolbar}>
                <div className={styles.viewToggle} role='tablist' aria-label='Schedule view'>
                    <button
                        type='button'
                        role='tab'
                        aria-selected={viewMode === 'dial'}
                        className={styles.toggleButton}
                        onClick={() => onChangeViewMode('dial')}>
                        Dial
                    </button>
                    <button
                        type='button'
                        role='tab'
                        aria-selected={viewMode === 'list'}
                        className={styles.toggleButton}
                        onClick={() => onChangeViewMode('list')}>
                        List
                    </button>
                </div>
            </div>

            {displayedViewMode === 'dial' && (
                <DialKey ref={dialKeyRef} exiting={isViewExiting} hidden={hasActiveCard} />
            )}

            <div ref={addFabRef} className={styles.addMenuAnchor} data-hidden={hasActiveCard}>
                {addMenuOpen && (
                    <div className={styles.addMenu} role='menu' aria-label='Add schedule window'>
                        <button
                            type='button'
                            role='menuitem'
                            className={styles.addMenuItem}
                            onClick={() => {
                                onAddSleepWindow()
                                setAddMenuOpen(false)
                            }}>
                            Add Nap
                        </button>
                        <button
                            type='button'
                            role='menuitem'
                            className={styles.addMenuItem}
                            onClick={() => {
                                onAddNightWake()
                                setAddMenuOpen(false)
                            }}>
                            Add Night Wake
                        </button>
                    </div>
                )}
                <button
                    type='button'
                    className={styles.addButton}
                    data-open={addMenuOpen}
                    aria-label={addMenuOpen ? 'Close add menu' : 'Add nap or night wake'}
                    aria-expanded={addMenuOpen}
                    aria-haspopup='menu'
                    title='Add nap or night wake'
                    tabIndex={hasActiveCard ? -1 : 0}
                    onClick={() => setAddMenuOpen((open) => !open)}>
                    <svg width='22' height='22' viewBox='0 0 24 24' fill='none' aria-hidden='true'>
                        <path
                            d='M12 5v14M5 12h14'
                            stroke='currentColor'
                            strokeWidth='2.5'
                            strokeLinecap='round'
                        />
                    </svg>
                </button>
            </div>

            {displayedViewMode === 'list' && (
                <div className={styles.listPane} data-exiting={isViewExiting}>
                    <ScheduleList
                        events={events}
                        hasActionBar={false}
                        onChangeMinute={onChangeEventMinute}
                        onRemoveSleepWindow={onRemoveSleepWindow}
                    />
                </div>
            )}

            {displayedCard && (
                <div ref={bottomDockRef} className={styles.bottomDock}>
                    <div
                        ref={inspectorSlotRef}
                        className={styles.inspectorSlot}
                        data-exiting={cardExiting}>
                        <section
                            className={styles.wedgeBar}
                            aria-label={`Edit ${displayedCard.name}`}>
                            <div className={styles.wedgeBarHeader}>
                                <span className={styles.wedgeBarTitle}>{displayedCard.name}</span>
                                <span className={styles.wedgeBarMeta}>
                                    {formatMinutesHuman(displayedCard.durationMinutes)}
                                </span>
                            </div>

                            {displayedCard.segmentDurations && (
                                <div className={styles.wedgeSegmentsGrid}>
                                    <div className={styles.wedgeSegmentColumn}>
                                        {displayedCard.segmentLabel && (
                                            <span className={styles.wedgeSegmentHeading}>
                                                {displayedCard.segmentLabel}
                                            </span>
                                        )}
                                        <ol className={styles.wedgeSegments}>
                                            {displayedCard.segmentDurations.map((minutes, idx) => (
                                                <li
                                                    key={`${displayedCard.name}-seg-${idx + 1}`}
                                                    className={styles.wedgeSegmentItem}>
                                                    <span className={styles.wedgeSegmentIndex}>
                                                        {idx + 1}.
                                                    </span>
                                                    <span>{formatMinutesHuman(minutes)}</span>
                                                </li>
                                            ))}
                                        </ol>
                                    </div>

                                    {displayedCard.secondarySegmentDurations &&
                                        displayedCard.secondarySegmentDurations.length > 0 && (
                                            <div className={styles.wedgeSegmentColumn}>
                                                {displayedCard.secondarySegmentLabel && (
                                                    <span className={styles.wedgeSegmentHeading}>
                                                        {displayedCard.secondarySegmentLabel}
                                                    </span>
                                                )}
                                                <ol className={styles.wedgeSegments}>
                                                    {displayedCard.secondarySegmentDurations.map(
                                                        (minutes, idx) => (
                                                            <li
                                                                key={`${displayedCard.name}-sec-${idx + 1}`}
                                                                className={styles.wedgeSegmentItem}>
                                                                <span
                                                                    className={
                                                                        styles.wedgeSegmentIndex
                                                                    }>
                                                                    {idx + 1}.
                                                                </span>
                                                                <span>
                                                                    {formatMinutesHuman(minutes)}
                                                                </span>
                                                            </li>
                                                        ),
                                                    )}
                                                </ol>
                                            </div>
                                        )}
                                </div>
                            )}

                            <div className={styles.wedgeTimes}>
                                <label className={styles.wedgeTimeField}>
                                    <span className={styles.wedgeTimeLabel}>
                                        {displayedCard.startLabel}
                                    </span>
                                    <input
                                        type='time'
                                        className={styles.wedgeTimeInput}
                                        aria-label={`${displayedCard.name} ${displayedCard.startLabel.toLowerCase()}`}
                                        value={formatMinuteOfDay24h(
                                            displayedCard.startEvent.minuteOfDay,
                                        )}
                                        onChange={(e) =>
                                            handleModalTimeChange(
                                                displayedCard.startEvent.id,
                                                e.target.value,
                                            )
                                        }
                                    />
                                </label>

                                <label className={styles.wedgeTimeField}>
                                    <span className={styles.wedgeTimeLabel}>
                                        {displayedCard.endLabel}
                                    </span>
                                    <input
                                        type='time'
                                        className={styles.wedgeTimeInput}
                                        aria-label={`${displayedCard.name} ${displayedCard.endLabel.toLowerCase()}`}
                                        value={formatMinuteOfDay24h(
                                            displayedCard.endEvent.minuteOfDay,
                                        )}
                                        onChange={(e) =>
                                            handleModalTimeChange(
                                                displayedCard.endEvent.id,
                                                e.target.value,
                                            )
                                        }
                                    />
                                </label>
                            </div>
                        </section>
                    </div>
                </div>
            )}

            <SchedulePicker
                open={pickerOpen}
                childName={childName}
                schedules={schedules}
                activeScheduleId={activeSchedule.id}
                isDirty={isDirty}
                onClose={() => setPickerOpen(false)}
                onLoad={onLoadSchedule}
                onSaveAsNew={onSaveAsNew}
                onRename={onRenameSchedule}
                onDelete={onDeleteSchedule}
            />
        </section>
    )
}
