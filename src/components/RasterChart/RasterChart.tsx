import { formatClockTime, formatMinutesHuman, formatShortDate } from '#src/lib/temporal.ts'
import type { BabySettings, DaySummary, SleepSegment } from '#src/types.ts'
import styles from './RasterChart.module.scss'

interface RasterChartProps {
    days: readonly DaySummary[]
    allSegments: readonly SleepSegment[]
    settings: BabySettings
    onSelectSegment: (seg: SleepSegment) => void
}

const TOTAL_DAY_MIN = 24 * 60

const formatHourTick = (hour24: number): string => {
    const h = ((hour24 % 24) + 24) % 24
    if (h === 0) return '12a'
    if (h === 12) return '12p'
    return h < 12 ? `${h}a` : `${h - 12}p`
}

export const RasterChart = ({ days, allSegments, settings, onSelectSegment }: RasterChartProps) => {
    const labelW = 60
    const chartW = 600
    const totalW = labelW + chartW + 10
    const rowH = days.length > 14 ? 22 : days.length > 7 ? 26 : 34
    const rowGap = 6
    const topPad = 26
    const svgH = topPad + days.length * (rowH + rowGap) + 12

    const nightOffsetMin = ((settings.nightStartHour - settings.dayStartHour + 24) % 24) * 60
    const nightX = labelW + (nightOffsetMin / TOTAL_DAY_MIN) * chartW

    const hourTicks = [0, 3, 6, 9, 12, 15, 18, 21, 24]

    return (
        <div className={styles.chartScroll}>
            <svg
                viewBox={`0 0 ${totalW} ${svgH}`}
                role='img'
                aria-label='24-hour sleep and wake raster chart'
                style={{ width: '100%', minWidth: '460px', height: 'auto', display: 'block' }}>
                <defs>
                    <pattern
                        id='mono-hatch'
                        width='8'
                        height='8'
                        patternTransform='rotate(45 0 0)'
                        patternUnits='userSpaceOnUse'>
                        <rect width='8' height='8' fill='#000000' />
                        <line
                            x1='0'
                            y1='0'
                            x2='0'
                            y2='8'
                            stroke='#ffffff'
                            strokeWidth='1.5'
                            strokeOpacity='0.65'
                        />
                    </pattern>
                </defs>

                {/* Nighttime divider line */}
                <line
                    x1={nightX}
                    y1={topPad - 4}
                    x2={nightX}
                    y2={svgH - 8}
                    stroke='#ffffff'
                    strokeWidth='1'
                    strokeOpacity='0.55'
                    strokeDasharray='4 3'
                />
                <text
                    x={nightX + 4}
                    y={topPad - 8}
                    fill='#ffffff'
                    fillOpacity='0.6'
                    fontSize='9'
                    fontWeight='600'>
                    NIGHT
                </text>

                {/* Vertical hour gridlines + top axis labels */}
                {hourTicks.map((offsetHr) => {
                    const x = labelW + (offsetHr / 24) * chartW
                    return (
                        <g key={offsetHr}>
                            <line
                                x1={x}
                                y1={topPad}
                                x2={x}
                                y2={svgH - 8}
                                stroke='#ffffff'
                                strokeOpacity={offsetHr === 0 || offsetHr === 24 ? 0.45 : 0.16}
                                strokeWidth='1'
                                strokeDasharray={
                                    offsetHr === 0 || offsetHr === 24 ? undefined : '2 4'
                                }
                            />
                            <text
                                x={x}
                                y={14}
                                textAnchor={
                                    offsetHr === 24 ? 'end' : offsetHr === 0 ? 'start' : 'middle'
                                }
                                fill='#ffffff'
                                fillOpacity='0.72'
                                fontSize='10.5'
                                fontWeight='600'>
                                {formatHourTick(settings.dayStartHour + offsetHr)}
                            </text>
                        </g>
                    )
                })}

                {/* Daily rows */}
                {days.map((day, rowIdx) => {
                    const y = topPad + rowIdx * (rowH + rowGap)
                    const daySegs = allSegments.filter(
                        (s) => s.endMs > day.dayStartMs && s.startMs < day.dayEndMs,
                    )

                    return (
                        <g key={day.sleepDayKey}>
                            <text
                                x={labelW - 8}
                                y={y + rowH / 2 + 4}
                                textAnchor='end'
                                fill='#ffffff'
                                fillOpacity='0.75'
                                fontSize='10.5'
                                fontWeight='600'>
                                {formatShortDate(day.sleepDayKey)}
                            </text>
                            <rect
                                x={labelW}
                                y={y}
                                width={chartW}
                                height={rowH}
                                fill='#000000'
                                stroke='#ffffff'
                                strokeOpacity='0.24'
                                strokeWidth='1'
                            />

                            {daySegs.map((seg) => {
                                const s = Math.max(seg.startMs, day.dayStartMs)
                                const e = Math.min(seg.endMs, day.dayEndMs)
                                if (e <= s) return null

                                const startOffsetMin = (s - day.dayStartMs) / 60_000
                                const durMin = (e - s) / 60_000
                                const x = labelW + (startOffsetMin / TOTAL_DAY_MIN) * chartW
                                const w = Math.max(3, (durMin / TOTAL_DAY_MIN) * chartW)

                                if (seg.state === 'awake') {
                                    if (seg.kind !== 'night-wake') return null
                                    const tickW = Math.max(4, w)
                                    const midX = x + tickW / 2
                                    return (
                                        <g
                                            key={`${day.sleepDayKey}-${seg.id}`}
                                            onClick={() => onSelectSegment(seg)}
                                            style={{ cursor: 'pointer' }}>
                                            <title>
                                                Night Wake ({seg.source}):{' '}
                                                {formatClockTime(s, settings.timeZone)}–
                                                {formatClockTime(e, settings.timeZone)} (
                                                {formatMinutesHuman(durMin)})
                                            </title>
                                            <rect
                                                x={x}
                                                y={y + 1}
                                                width={tickW}
                                                height={rowH - 2}
                                                fill='#000000'
                                            />
                                            <line
                                                x1={midX}
                                                y1={y + 2}
                                                x2={midX}
                                                y2={y + rowH - 2}
                                                stroke='#ffffff'
                                                strokeWidth='2'
                                                strokeDasharray={
                                                    seg.source === 'interpolated'
                                                        ? '2 2'
                                                        : undefined
                                                }
                                            />
                                        </g>
                                    )
                                }

                                const isNap = seg.kind === 'nap'
                                const isInterp = seg.source === 'interpolated'

                                return (
                                    <g
                                        key={`${day.sleepDayKey}-${seg.id}`}
                                        onClick={() => onSelectSegment(seg)}
                                        style={{ cursor: 'pointer' }}>
                                        <title>
                                            {isNap ? `Nap ${seg.napIndex ?? ''}` : 'Night Sleep'} (
                                            {seg.source}): {formatClockTime(s, settings.timeZone)}–
                                            {formatClockTime(e, settings.timeZone)} (
                                            {formatMinutesHuman(durMin)})
                                            {seg.comment ? ` · ${seg.comment}` : ''}
                                        </title>
                                        <rect
                                            x={x}
                                            y={y + 2}
                                            width={w}
                                            height={rowH - 4}
                                            fill={
                                                isInterp
                                                    ? 'url(#mono-hatch)'
                                                    : isNap
                                                      ? '#000000'
                                                      : '#ffffff'
                                            }
                                            stroke='#ffffff'
                                            strokeWidth={isInterp ? '1.1' : isNap ? '1.5' : '0'}
                                            strokeDasharray={isInterp ? '3 2' : undefined}
                                        />
                                        {isNap && seg.napIndex && w >= 18 && rowH >= 24 ? (
                                            <text
                                                x={x + w / 2}
                                                y={y + rowH / 2 + 3.5}
                                                textAnchor='middle'
                                                fill='#ffffff'
                                                fontSize='9.5'
                                                fontWeight='700'>
                                                N{seg.napIndex}
                                            </text>
                                        ) : null}
                                        {seg.comment ? (
                                            <rect
                                                x={Math.min(x + w - 6, x + 3)}
                                                y={y + 4}
                                                width='4'
                                                height='4'
                                                fill={isNap || isInterp ? '#ffffff' : '#000000'}
                                            />
                                        ) : null}
                                    </g>
                                )
                            })}
                        </g>
                    )
                })}
            </svg>
        </div>
    )
}
