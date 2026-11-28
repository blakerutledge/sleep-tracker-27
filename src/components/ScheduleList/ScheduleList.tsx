import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AwakeIcon, SleepIcon } from '#src/components/DialKey/index.tsx'
import {
    buildScheduleListItems,
    formatMinuteOfDay24h,
    MINUTES_PER_DAY,
    parseTime24hToMinute,
    type ScheduleEvent,
    type ScheduleListItem,
} from '#src/data/schedule.ts'
import { formatMinutesHuman } from '#src/lib/temporal.ts'
import styles from './ScheduleList.module.scss'

const PX_PER_MINUTE = 1
const TIMELINE_TOP_PAD = 36
const TIMELINE_BOTTOM_PAD = 36
const TIMELINE_GUTTER_WIDTH = 34
const TIMELINE_LINE_X = 11
const MIN_ITEM_GAP_PX = 10

const ESTIMATED_HEIGHTS: Record<ScheduleListItem['kind'], number> = {
    anchor: 68,
    window: 132,
    span: 38,
}

interface PositionedItem {
    item: ScheduleListItem
    dotY: number
    top: number
    centerY: number
    height: number
}

const computeTimelineLayout = (
    items: readonly ScheduleListItem[],
    measuredHeights: Readonly<Record<string, number>>,
): { positioned: PositionedItem[]; totalHeight: number } => {
    const timelineBottom = TIMELINE_TOP_PAD + MINUTES_PER_DAY * PX_PER_MINUTE
    const positioned: PositionedItem[] = []
    let cursorBottom = 0

    for (const item of items) {
        const midMin = (item.startOffsetMin + item.endOffsetMin) / 2
        const dotY = TIMELINE_TOP_PAD + midMin * PX_PER_MINUTE
        const height = measuredHeights[item.id] ?? ESTIMATED_HEIGHTS[item.kind]
        const idealTop = dotY - height / 2
        const top = Math.max(idealTop, cursorBottom)
        positioned.push({
            item,
            dotY,
            top,
            centerY: top + height / 2,
            height,
        })
        cursorBottom = top + height + MIN_ITEM_GAP_PX
    }

    const lastBottom =
        positioned.length > 0
            ? (positioned[positioned.length - 1]?.top ?? 0) +
              (positioned[positioned.length - 1]?.height ?? 0)
            : 0
    const totalHeight = Math.max(timelineBottom + TIMELINE_BOTTOM_PAD, lastBottom + 16)
    return { positioned, totalHeight }
}

interface ScheduleListProps {
    events: readonly ScheduleEvent[]
    hasActionBar?: boolean
    onChangeMinute: (eventId: string, minuteOfDay: number) => void
    onRequestRemoveWindow: (startEventId: string, name: string) => void
}

export const ScheduleList = ({
    events,
    hasActionBar = false,
    onChangeMinute,
    onRequestRemoveWindow,
}: ScheduleListProps) => {
    const items = useMemo(() => buildScheduleListItems(events), [events])
    const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map())
    const [measuredHeights, setMeasuredHeights] = useState<Record<string, number>>({})

    useLayoutEffect(() => {
        const next: Record<string, number> = {}
        let changed = false
        for (const item of items) {
            const el = itemRefs.current.get(item.id)
            if (!el) continue
            const h = Math.round(el.getBoundingClientRect().height)
            if (h > 0) {
                next[item.id] = h
                if (measuredHeights[item.id] !== h) {
                    changed = true
                }
            }
        }
        if (changed) {
            setMeasuredHeights(next)
        }
    }, [items, measuredHeights])

    const { positioned, totalHeight } = useMemo(
        () => computeTimelineLayout(items, measuredHeights),
        [items, measuredHeights],
    )

    const timelineSegments = useMemo(() => items.filter((item) => item.kind !== 'anchor'), [items])

    const handleTimeChange = (eventId: string, raw: string) => {
        const parsed = parseTime24hToMinute(raw)
        if (parsed !== null) {
            onChangeMinute(eventId, parsed)
        }
    }

    return (
        <div className={styles.scrollBody} data-has-action-bar={hasActionBar}>
            <div className={styles.timelineStage} style={{ blockSize: `${totalHeight}px` }}>
                <svg
                    className={styles.timelineSvg}
                    width={TIMELINE_GUTTER_WIDTH}
                    height={totalHeight}
                    viewBox={`0 0 ${TIMELINE_GUTTER_WIDTH} ${totalHeight}`}
                    fill='none'
                    aria-hidden='true'>
                    {timelineSegments.map((seg) => {
                        const y1 = TIMELINE_TOP_PAD + seg.startOffsetMin * PX_PER_MINUTE
                        const y2 = TIMELINE_TOP_PAD + seg.endOffsetMin * PX_PER_MINUTE
                        return (
                            <line
                                key={`${seg.id}-rail`}
                                x1={TIMELINE_LINE_X}
                                y1={y1}
                                x2={TIMELINE_LINE_X}
                                y2={y2}
                                className={styles.railSegment}
                                data-state={seg.state}
                            />
                        )
                    })}

                    {positioned.map(({ item, dotY, centerY }) => {
                        const isStraight = Math.abs(dotY - centerY) < 1
                        const midX = (TIMELINE_LINE_X + TIMELINE_GUTTER_WIDTH) / 2
                        const d = isStraight
                            ? `M ${TIMELINE_LINE_X} ${dotY} L ${TIMELINE_GUTTER_WIDTH} ${dotY}`
                            : `M ${TIMELINE_LINE_X} ${dotY} C ${midX} ${dotY}, ${midX} ${centerY}, ${TIMELINE_GUTTER_WIDTH} ${centerY}`
                        const isGhost = item.kind === 'anchor' && Boolean(item.isGhost)
                        return (
                            <g
                                key={`${item.id}-node`}
                                className={styles.timelineNode}
                                data-state={item.state}
                                data-ghost={isGhost || undefined}>
                                <path d={d} className={styles.connectorLine} />
                                <circle
                                    cx={TIMELINE_LINE_X}
                                    cy={dotY}
                                    r={item.kind === 'span' ? 4 : 5}
                                    className={styles.timelineDot}
                                    data-state={item.state}
                                />
                            </g>
                        )
                    })}
                </svg>

                {positioned.map(({ item, top }) => {
                    const StateIcon = item.state === 'asleep' ? SleepIcon : AwakeIcon

                    return (
                        <div
                            key={item.id}
                            ref={(el) => {
                                if (el) {
                                    itemRefs.current.set(item.id, el)
                                } else {
                                    itemRefs.current.delete(item.id)
                                }
                            }}
                            className={styles.timelineItem}
                            style={{ top: `${top}px` }}>
                            {item.kind === 'span' ? (
                                <div className={styles.spanTrack} data-state={item.state}>
                                    <div className={styles.spanCard} data-state={item.state}>
                                        <div className={styles.spanLabelGroup}>
                                            <span
                                                className={styles.iconSwatch}
                                                data-state={item.state}
                                                aria-hidden='true'>
                                                <StateIcon className={styles.stateIcon} />
                                            </span>
                                            <span className={styles.spanLabel}>{item.label}</span>
                                        </div>
                                        <span className={styles.spanDuration}>
                                            {formatMinutesHuman(item.durationMinutes)}
                                        </span>
                                    </div>
                                </div>
                            ) : item.kind === 'anchor' ? (
                                <section
                                    className={styles.card}
                                    data-state={item.state}
                                    data-ghost={item.isGhost || undefined}
                                    aria-hidden={item.isGhost || undefined}
                                    aria-label={item.isGhost ? undefined : item.label}>
                                    <div className={styles.anchorRow}>
                                        <div className={styles.labelGroup}>
                                            <span
                                                className={styles.iconSwatch}
                                                data-state={item.state}
                                                aria-hidden='true'>
                                                <StateIcon className={styles.stateIcon} />
                                            </span>
                                            <span className={styles.eventLabel}>{item.label}</span>
                                        </div>

                                        <input
                                            type='time'
                                            className={`${styles.timeInput} ${styles.anchorTimeInput}`}
                                            aria-label={`${item.label} time`}
                                            readOnly={item.isGhost}
                                            tabIndex={item.isGhost ? -1 : undefined}
                                            value={formatMinuteOfDay24h(item.event.minuteOfDay)}
                                            onChange={(e) => {
                                                if (item.isGhost) return
                                                handleTimeChange(item.event.id, e.target.value)
                                            }}
                                        />
                                    </div>
                                </section>
                            ) : (
                                <section
                                    className={styles.card}
                                    data-state={item.state}
                                    aria-label={item.label}>
                                    <div className={styles.rowHeader}>
                                        <div className={styles.labelGroup}>
                                            <span
                                                className={styles.iconSwatch}
                                                data-state={item.state}
                                                aria-hidden='true'>
                                                <StateIcon className={styles.stateIcon} />
                                            </span>
                                            <span className={styles.eventLabel}>{item.label}</span>
                                        </div>

                                        <span className={styles.duration}>
                                            {formatMinutesHuman(item.durationMinutes)}
                                        </span>

                                        <div className={styles.headerEnd}>
                                            {item.removable && (
                                                <button
                                                    type='button'
                                                    className={styles.deleteButton}
                                                    aria-label={
                                                        item.removeLabel ?? `Remove ${item.label}`
                                                    }
                                                    title={
                                                        item.removeLabel ?? `Remove ${item.label}`
                                                    }
                                                    onClick={() =>
                                                        onRequestRemoveWindow(item.id, item.label)
                                                    }>
                                                    <svg
                                                        width='16'
                                                        height='16'
                                                        viewBox='0 0 24 24'
                                                        fill='none'
                                                        aria-hidden='true'>
                                                        <path
                                                            d='M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14ZM10 11v6M14 11v6'
                                                            stroke='currentColor'
                                                            strokeWidth='2'
                                                            strokeLinecap='round'
                                                            strokeLinejoin='round'
                                                        />
                                                    </svg>
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    <div className={styles.timeGrid}>
                                        <label className={styles.timeField}>
                                            <span className={styles.timeLabel}>Start</span>
                                            <input
                                                type='time'
                                                className={styles.timeInput}
                                                aria-label={`${item.label} start`}
                                                value={formatMinuteOfDay24h(
                                                    item.startEvent.minuteOfDay,
                                                )}
                                                onChange={(e) =>
                                                    handleTimeChange(
                                                        item.startEvent.id,
                                                        e.target.value,
                                                    )
                                                }
                                            />
                                        </label>

                                        <label className={styles.timeField}>
                                            <span className={styles.timeLabel}>End</span>
                                            <input
                                                type='time'
                                                className={styles.timeInput}
                                                aria-label={`${item.label} end`}
                                                value={formatMinuteOfDay24h(
                                                    item.endEvent.minuteOfDay,
                                                )}
                                                onChange={(e) =>
                                                    handleTimeChange(
                                                        item.endEvent.id,
                                                        e.target.value,
                                                    )
                                                }
                                            />
                                        </label>
                                    </div>
                                </section>
                            )}
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
