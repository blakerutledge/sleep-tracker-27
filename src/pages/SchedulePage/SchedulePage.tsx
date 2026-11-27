import { useEffect, useRef, useState } from 'react'
import { DIAL_FADE_DURATION_MS } from '#src/components/Dial/index.tsx'
import { ScheduleList } from '#src/components/ScheduleList/index.tsx'
import { SchedulePicker } from '#src/components/SchedulePicker/index.tsx'
import { TimePickerBar } from '#src/components/TimePickerBar/index.tsx'
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

type InspectorCard =
    | { kind: 'event'; event: ScheduleEvent }
    | { kind: 'wedge'; wedge: ScheduleWedgeInfo }

interface SchedulePageProps {
    childName: string
    schedules: readonly SavedSchedule[]
    activeSchedule: SavedSchedule
    events: readonly ScheduleEvent[]
    isDirty: boolean
    viewMode: ScheduleViewMode
    displayedViewMode: ScheduleViewMode
    isViewExiting: boolean
    selectedEventId: string | null
    selectedWedgeId: string | null
    onChangeViewMode: (mode: ScheduleViewMode) => void
    onClearSelection: () => void
    onChangeEventMinute: (eventId: string, minuteOfDay: number) => void
    onAddSleepWindow: () => void
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
    selectedEventId,
    selectedWedgeId,
    onChangeViewMode,
    onClearSelection,
    onChangeEventMinute,
    onAddSleepWindow,
    onRemoveSleepWindow,
    onSave,
    onSaveAsNew,
    onLoadSchedule,
    onRenameSchedule,
    onDeleteSchedule,
    onDiscard,
}: SchedulePageProps) => {
    const [pickerOpen, setPickerOpen] = useState(false)
    const addFabRef = useRef<HTMLDivElement | null>(null)
    const topActionsRef = useRef<HTMLDivElement | null>(null)
    const bottomDockRef = useRef<HTMLDivElement | null>(null)

    const selectedEvent = selectedEventId
        ? (events.find((event) => event.id === selectedEventId) ?? null)
        : null
    const selectedWedge = selectedWedgeId ? getScheduleWedgeInfo(selectedWedgeId, events) : null

    const activeCard: InspectorCard | null =
        displayedViewMode === 'dial' && !isViewExiting
            ? selectedEvent
                ? { kind: 'event', event: selectedEvent }
                : selectedWedge
                  ? { kind: 'wedge', wedge: selectedWedge }
                  : null
            : null

    const hasActiveCard = activeCard !== null
    const lastCardRef = useRef<InspectorCard | null>(null)
    if (activeCard) {
        lastCardRef.current = activeCard
    }

    const [exitingCard, setExitingCard] = useState<InspectorCard | null>(null)
    const cardExitTimerRef = useRef<number | null>(null)

    useEffect(() => {
        if (cardExitTimerRef.current !== null) {
            window.clearTimeout(cardExitTimerRef.current)
            cardExitTimerRef.current = null
        }

        if (hasActiveCard) {
            setExitingCard(null)
            return
        }

        const prev = lastCardRef.current
        if (prev) {
            setExitingCard(prev)
            cardExitTimerRef.current = window.setTimeout(() => {
                cardExitTimerRef.current = null
                lastCardRef.current = null
                setExitingCard(null)
            }, DIAL_FADE_DURATION_MS)
        }
    }, [hasActiveCard])

    useEffect(
        () => () => {
            if (cardExitTimerRef.current !== null) {
                window.clearTimeout(cardExitTimerRef.current)
            }
        },
        [],
    )

    const displayedCard = activeCard ?? exitingCard
    const cardExiting = !hasActiveCard && exitingCard !== null

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

            <div ref={addFabRef} className={styles.addMenuAnchor} data-hidden={hasActiveCard}>
                <button
                    type='button'
                    className={styles.addButton}
                    aria-label='Add sleep window'
                    title='Add sleep window'
                    tabIndex={hasActiveCard ? -1 : 0}
                    onClick={onAddSleepWindow}>
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
                    <div className={styles.inspectorSlot} data-exiting={cardExiting}>
                        {displayedCard.kind === 'event' ? (
                            <TimePickerBar
                                event={displayedCard.event}
                                events={events}
                                onChangeMinute={onChangeEventMinute}
                            />
                        ) : (
                            <section
                                className={styles.wedgeBar}
                                aria-label={`Edit ${displayedCard.wedge.name}`}>
                                <div className={styles.wedgeBarHeader}>
                                    <div className={styles.wedgeTitleGroup}>
                                        <span className={styles.wedgeBarTitle}>
                                            {displayedCard.wedge.name}
                                        </span>
                                        <span className={styles.wedgeBarMeta}>
                                            {formatMinutesHuman(
                                                displayedCard.wedge.durationMinutes,
                                            )}{' '}
                                            {displayedCard.wedge.state === 'asleep'
                                                ? 'sleep'
                                                : 'awake'}
                                        </span>
                                    </div>
                                    {displayedCard.wedge.removable &&
                                        displayedCard.wedge.removeLabel && (
                                            <button
                                                type='button'
                                                className={styles.wedgeRemoveButton}
                                                onClick={() => {
                                                    onRemoveSleepWindow(
                                                        displayedCard.wedge.startEvent.id,
                                                    )
                                                    onClearSelection()
                                                }}>
                                                {displayedCard.wedge.removeLabel}
                                            </button>
                                        )}
                                </div>

                                <div className={styles.wedgeTimes}>
                                    <input
                                        type='time'
                                        className={styles.wedgeTimeInput}
                                        aria-label={`${displayedCard.wedge.name} start time`}
                                        value={formatMinuteOfDay24h(
                                            displayedCard.wedge.startEvent.minuteOfDay,
                                        )}
                                        onChange={(e) =>
                                            handleModalTimeChange(
                                                displayedCard.wedge.startEvent.id,
                                                e.target.value,
                                            )
                                        }
                                    />

                                    <input
                                        type='time'
                                        className={styles.wedgeTimeInput}
                                        aria-label={`${displayedCard.wedge.name} stop time`}
                                        value={formatMinuteOfDay24h(
                                            displayedCard.wedge.endEvent.minuteOfDay,
                                        )}
                                        onChange={(e) =>
                                            handleModalTimeChange(
                                                displayedCard.wedge.endEvent.id,
                                                e.target.value,
                                            )
                                        }
                                    />
                                </div>
                            </section>
                        )}
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
