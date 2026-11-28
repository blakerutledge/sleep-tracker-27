import gsap from 'gsap'
import {
    Application,
    Container,
    type Geometry,
    Graphics,
    Mesh,
    type Shader,
    Sprite,
    Texture,
} from 'pixi.js'
import {
    memo,
    type PointerEvent as ReactPointerEvent,
    type Ref,
    useCallback,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from 'react'
import {
    buildScheduleWedges,
    classifyScheduleEvents,
    getAnchorEventIds,
    getScheduleWedgeInfo,
    MINUTES_PER_DAY,
    normalizeMinuteOfDay,
    PLACEHOLDER_SCHEDULE_EVENTS,
    type ScheduleEvent,
    type ScheduleWedge,
    SNAP_STEP_MIN,
    sortScheduleEvents,
} from '#src/data/schedule.ts'
import { useDevMode } from '#src/lib/devMode.ts'
import { useSunLocation } from '#src/lib/sun.ts'
import { epochToZonedDateTime } from '#src/lib/temporal.ts'
import type { PageId } from '#src/pages/pages.ts'
import { DIAL_COLORS, hexToNumber, PALETTE } from '#src/styles/palette.ts'
import styles from './Dial.module.scss'
import {
    buildDialGeometry,
    createDialShader,
    DIAL_ANCHOR_RADIUS,
    DIAL_AXIS_ICON_RADIUS,
    DIAL_AXIS_ICON_SIZE,
    DIAL_DISC_RADIUS,
    DIAL_HANDLE_ICON_SIZE,
    DIAL_HANDLE_RADIUS,
    DIAL_HANDLE_RING_RADIUS,
    DIAL_HANDLE_SELECTED_RING_RADIUS,
    DIAL_HANDLE_SELECTED_STROKE_WIDTH,
    DIAL_HANDLE_STROKE_WIDTH,
    DIAL_RING_INNER_RADIUS,
    DIAL_RING_OUTER_RADIUS,
    dialAngleToMinute,
    minuteToDialAngle,
} from './dialGeometry.ts'

type DialMode = 'today' | 'schedule' | 'hidden'

export interface DialHandle {
    scrubTo: (progress: number) => void
    animateTo: (target: DialMode, durationSec?: number) => void
}

interface DialProps {
    ref?: Ref<DialHandle>
    activePage: PageId
    hidden?: boolean
    events?: readonly ScheduleEvent[]
    selectedWedgeId?: string | null
    selectedHandleId?: string | null
    onMinuteChange?: (minuteOfDay: number) => void
    onSelectWedge?: (startEventId: string | null, initialHandleId?: string | null) => void
    onSelectHandle?: (eventId: string | null) => void
    onChangeEventMinute?: (eventId: string, minuteOfDay: number) => void
    onMoveWedge?: (
        startEventId: string,
        endEventId: string,
        baseStartMin: number,
        baseEndMin: number,
        deltaMin: number,
    ) => void
    onDragEventIdsChange?: (eventIds: readonly string[]) => void
}

interface AxisIcons {
    sun: Sprite
    moon: Sprite
}

interface TodayIconSlot {
    container: Container
    disc: Graphics
    icon: Sprite
}

interface TodayIconSlots {
    prev: TodayIconSlot
    current: TodayIconSlot
    upcoming: TodayIconSlot
}

interface TodayIconSwapState {
    outgoingState: ScheduleWedge['state']
    outgoingStartAngle: number
    outgoingEndAngle: number
    incomingStartAngle: number
    incomingStartScale: number
    incomingStartAlpha: number
    progress: number
}

interface TodayIconTextures {
    awake: Texture
    asleep: Texture
}

interface LayoutMetrics {
    vw: number
    vh: number
    dialSize: number
    todayCenterX: number
    todayCenterY: number
    todayScale: number
    scheduleCenterX: number
    scheduleCenterY: number
    scheduleDiameter: number
    scheduleScale: number
}

interface HandleNodeEntry {
    eventId: string
    container: Container
    selectionRing: Graphics
    icon: Sprite | null
    cos: number
    sin: number
    idleAlpha: number
}

interface DragState {
    pointerId: number
    startX: number
    startY: number
    horizontalOnly: boolean
    locked: boolean
    moved: boolean
    centerX: number
    centerY: number
    lastAngle: number
    lastTime: number
    velocityRadPerMs: number
}

interface ScheduleInteractionState {
    pointerId: number
    startX: number
    startY: number
    hitWedgeSelectionId: string | null
    dragKind: 'none' | 'handle' | 'wedge'
    eventIds: readonly string[]
    baseMinutes: readonly number[]
    lastAngle: number
    accumulatedAngleRad: number
    lastAppliedDeltaMin: number
    moved: boolean
}

const NOON_MINUTE = 720
const TODAY_SCALE = 3.0
const TODAY_Y_RATIO = 0.47
const SCHEDULE_Y_RATIO = 0.45
const SCHEDULE_WIDTH_RATIO = 0.96
const SCHEDULE_MAX_HEIGHT_RATIO = 0.68
const MIN_DIAL_SIZE_PX = 448
const MAX_DIAL_SIZE_PX = 672
const DIAL_SIZE_VW_RATIO = 1.18
const ICON_RASTER_SIZE = 192
const TRANSITION_DURATION_SEC = 0.9
export const DIAL_FADE_DURATION_MS = 220
const HIDDEN_DURATION_SEC = DIAL_FADE_DURATION_MS / 1000

const NOON_SUN_ICON_COLOR = hexToNumber(DIAL_COLORS.noonSunIcon)
const MIDNIGHT_MOON_ICON_COLOR = hexToNumber(DIAL_COLORS.midnightMoonIcon)
const WAKE_HANDLE_COLOR = hexToNumber(DIAL_COLORS.wakeHandle)
const SLEEP_HANDLE_COLOR = hexToNumber(DIAL_COLORS.sleepHandle)
const SELECTED_HANDLE_RING_COLOR = hexToNumber(DIAL_COLORS.selectedHandleRing)
const MORNING_WAKE_ANCHOR_FILL = hexToNumber(DIAL_COLORS.morningWakeAnchor.fillColor)
const MORNING_WAKE_ANCHOR_ICON = hexToNumber(DIAL_COLORS.morningWakeAnchor.iconColor)
const BEDTIME_ANCHOR_FILL = hexToNumber(DIAL_COLORS.bedtimeAnchor.fillColor)
const BEDTIME_ANCHOR_ICON = hexToNumber(DIAL_COLORS.bedtimeAnchor.iconColor)
const TODAY_AWAKE_ICON_COLOR = hexToNumber(PALETTE.blue700)
const TODAY_ASLEEP_ICON_COLOR = hexToNumber(PALETTE.purple200)
const TODAY_ICON_FG_COLOR = hexToNumber(PALETTE.blue100)

const EDGE_SWIPE_GUARD_PX = 36
const SWIPE_LOCK_PX = 8
const TAP_SLOP_PX = 10
const HANDLE_SLIDE_OFFSET = 28
const HANDLE_HIT_RADIUS = DIAL_HANDLE_RADIUS + 20
const DIAL_DRAG_SENSITIVITY = 0.35
const MOMENTUM_DAMPING_PER_MS = 0.009
const MOMENTUM_STOP_RAD_PER_MS = 0.00004
const MAX_VELOCITY_RAD_PER_MS = 0.012
const TODAY_ICON_Y_RATIO = 0.26
const TODAY_ICON_LEAD_MINUTES = 45
const TODAY_ICON_SWAP_DURATION_SEC = 0.78
const TODAY_ICON_MIN_SEP_FACTOR = 1.0
const TODAY_ICON_APPROACH_EXTRA_ANGLE = 0.14
const TODAY_ICON_EDGE_SCALE = 0.55
const TODAY_ICON_READY_SCALE = 0.68
const TODAY_ICON_READY_ALPHA = 0.4
const TODAY_ICON_BADGE_UNIT_SIZE = 100
const TODAY_ICON_GLYPH_RATIO = 0.92

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value))

const clamp = (value: number, min: number, max: number): number =>
    Math.max(min, Math.min(max, value))

const getDialMode = (activePage: PageId, hidden: boolean): DialMode => {
    if (hidden) return 'hidden'
    if (activePage === 'today' || activePage === 'schedule') {
        return activePage
    }
    return 'hidden'
}

const getCurrentMinuteOfDay = (epochMs: number): number => {
    const zdt = epochToZonedDateTime(epochMs)
    return zdt.hour * 60 + zdt.minute + zdt.second / 60
}

const getTodayRotationRad = (minuteOfDay: number): number =>
    -((minuteOfDay - NOON_MINUTE) / MINUTES_PER_DAY) * Math.PI * 2

const rotationRadToFractionalMinute = (rad: number): number => {
    const raw = NOON_MINUTE - (rad / (Math.PI * 2)) * MINUTES_PER_DAY
    return ((raw % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
}

const rotationRadToMinuteOfDay = (rad: number): number =>
    Math.floor(rotationRadToFractionalMinute(rad)) % MINUTES_PER_DAY

const shortestAngleDelta = (from: number, to: number): number => {
    const tau = Math.PI * 2
    return ((((to - from + Math.PI) % tau) + tau) % tau) - Math.PI
}

const getViewportResolution = (): number => Math.min(window.devicePixelRatio || 1, 2)

const isMinuteInWedge = (minute: number, wedge: ScheduleWedge): boolean =>
    wedge.endMin > MINUTES_PER_DAY
        ? minute >= wedge.startMin || minute < wedge.endMin - MINUTES_PER_DAY
        : minute >= wedge.startMin && minute < wedge.endMin

const loadTintedSvgTexture = async (url: string): Promise<Texture> => {
    const response = await fetch(url)
    const rawSvg = await response.text()
    // Strip opaque white background rects exported by Figma and recolor black strokes/fills to
    // white so Pixi Sprite.tint can apply theme colors cleanly.
    const cleanedSvg = rawSvg
        .replace(/<rect\b[^>]*width="100"[^>]*height="100"[^>]*fill="white"[^>]*\/>/g, '')
        .replaceAll('stroke="black"', 'stroke="white"')
        .replaceAll('fill="black"', 'fill="white"')

    const blob = new Blob([cleanedSvg], { type: 'image/svg+xml;charset=utf-8' })
    const objectUrl = URL.createObjectURL(blob)
    try {
        const img = new Image()
        img.decoding = 'async'
        await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve()
            img.onerror = () => reject(new Error(`Failed to load icon ${url}`))
            img.src = objectUrl
        })
        const aspect = img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : 1
        const canvas = document.createElement('canvas')
        canvas.height = ICON_RASTER_SIZE
        canvas.width = Math.max(1, Math.round(ICON_RASTER_SIZE * aspect))
        const ctx = canvas.getContext('2d')
        if (!ctx) return Texture.from(img)
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        return Texture.from(canvas)
    } finally {
        URL.revokeObjectURL(objectUrl)
    }
}

const createIconSprite = (texture: Texture, targetHeight: number, tint: number): Sprite => {
    const sprite = new Sprite(texture)
    sprite.anchor.set(0.5)
    const scale = texture.height > 0 ? targetHeight / texture.height : 1
    sprite.scale.set(scale)
    sprite.tint = tint
    return sprite
}

const clientToRotorLocal = (
    clientX: number,
    clientY: number,
    dialRoot: Container,
    rotationRad: number,
): { x: number; y: number } => {
    const scale = Math.max(0.0001, dialRoot.scale.x)
    const dx = (clientX - dialRoot.x) / scale
    const dy = (clientY - dialRoot.y) / scale
    const cos = Math.cos(-rotationRad)
    const sin = Math.sin(-rotationRad)
    return {
        x: dx * cos - dy * sin,
        y: dx * sin + dy * cos,
    }
}

export const Dial = memo(
    ({
        ref,
        activePage,
        hidden = false,
        events = PLACEHOLDER_SCHEDULE_EVENTS,
        selectedWedgeId = null,
        selectedHandleId = null,
        onMinuteChange,
        onSelectWedge,
        onSelectHandle,
        onChangeEventMinute,
        onMoveWedge,
        onDragEventIdsChange,
    }: DialProps) => {
        const layerRef = useRef<HTMLDivElement | null>(null)
        const hitAreaRef = useRef<HTMLDivElement | null>(null)
        const hostRef = useRef<HTMLDivElement | null>(null)
        const appRef = useRef<Application | null>(null)
        const dialRootRef = useRef<Container | null>(null)
        const rotorRef = useRef<Container | null>(null)
        const wedgeMeshRef = useRef<Mesh<Geometry, Shader> | null>(null)
        const axisIconsRef = useRef<AxisIcons | null>(null)
        const handlesLayerRef = useRef<Container | null>(null)
        const handleNodesRef = useRef<Map<string, HandleNodeEntry>>(new Map())
        const anchorsLayerRef = useRef<Container | null>(null)
        const anchorNodesRef = useRef<Map<string, HandleNodeEntry>>(new Map())
        const anchorIdsRef = useRef<{ morningWakeId: string | null; bedtimeId: string | null }>({
            morningWakeId: null,
            bedtimeId: null,
        })
        const handleTexturesRef = useRef<{ up: Texture; down: Texture } | null>(null)
        const todayIconsLayerRef = useRef<Container | null>(null)
        const todayIconSlotsRef = useRef<TodayIconSlots | null>(null)
        const todayIconTexturesRef = useRef<TodayIconTextures | null>(null)
        const lastTodayWedgeRef = useRef<{
            id: string
            state: ScheduleWedge['state']
        } | null>(null)
        const todaySwapStateRef = useRef<TodayIconSwapState | null>(null)
        const todaySwapTweenRef = useRef<gsap.core.Tween | null>(null)
        const renderRafRef = useRef<number | null>(null)
        const layoutCacheRef = useRef<LayoutMetrics | null>(null)

        const currentRotationRef = useRef<number>(0)
        const progressStateRef = useRef<{ value: number }>({
            value: getDialMode(activePage, hidden) === 'schedule' ? 1 : 0,
        })
        const transitionTweenRef = useRef<gsap.core.Tween | null>(null)
        const hideTweenRef = useRef<gsap.core.Tween | null>(null)
        const selectionTweenRef = useRef<gsap.core.Animation | null>(null)
        const selectionStateRef = useRef<{
            selection: number
            dim: number
            handleProgress: number
        }>({
            selection: selectedWedgeId ? 1 : 0,
            dim: selectedWedgeId ? 1 : 0,
            handleProgress: selectedWedgeId ? 1 : 0,
        })
        const activeVisualWedgeIdRef = useRef<string | null>(selectedWedgeId)
        const prevVisualWedgeIdRef = useRef<string | null>(null)
        const momentumRafRef = useRef<number | null>(null)
        const dragRef = useRef<DragState | null>(null)
        const scheduleInteractionRef = useRef<ScheduleInteractionState | null>(null)
        const manualControlRef = useRef<boolean>(false)
        const scrubbingRef = useRef<boolean>(false)
        const lastEmittedMinuteRef = useRef<number | null>(null)

        const [isDragging, setIsDragging] = useState(false)
        // Single source of truth for live/simulated time (never overwritten on re-render).
        const currentMinuteRef = useRef<number>(getCurrentMinuteOfDay(Date.now()))

        const { settings: devMode } = useDevMode()
        const devModeRef = useRef(devMode)
        devModeRef.current = devMode

        const { sunTimes } = useSunLocation()
        const sunTimesRef = useRef(sunTimes)
        sunTimesRef.current = sunTimes

        const onMinuteChangeRef = useRef(onMinuteChange)
        onMinuteChangeRef.current = onMinuteChange

        const onSelectWedgeRef = useRef(onSelectWedge)
        onSelectWedgeRef.current = onSelectWedge

        const onSelectHandleRef = useRef(onSelectHandle)
        onSelectHandleRef.current = onSelectHandle

        const selectedHandleIdRef = useRef(selectedHandleId)
        selectedHandleIdRef.current = selectedHandleId

        const onChangeEventMinuteRef = useRef(onChangeEventMinute)
        onChangeEventMinuteRef.current = onChangeEventMinute

        const onMoveWedgeRef = useRef(onMoveWedge)
        onMoveWedgeRef.current = onMoveWedge

        const onDragEventIdsChangeRef = useRef(onDragEventIdsChange)
        onDragEventIdsChangeRef.current = onDragEventIdsChange

        const eventsRef = useRef(events)
        eventsRef.current = events

        const selectedWedgeIdRef = useRef(selectedWedgeId)
        selectedWedgeIdRef.current = selectedWedgeId

        const wedges = useMemo(() => buildScheduleWedges(events), [events])
        const wedgesRef = useRef(wedges)
        wedgesRef.current = wedges

        const mode = getDialMode(activePage, hidden)
        const modeRef = useRef(mode)
        modeRef.current = mode

        const isDialInteractive =
            mode === 'schedule' ||
            (mode === 'today' && devMode.enabled && devMode.manualDialInToday)
        const isDialInteractiveRef = useRef(isDialInteractive)
        isDialInteractiveRef.current = isDialInteractive

        const emitMinuteForRad = useCallback((rad: number) => {
            const min = rotationRadToMinuteOfDay(rad)
            if (lastEmittedMinuteRef.current !== min) {
                lastEmittedMinuteRef.current = min
                onMinuteChangeRef.current?.(min)
            }
        }, [])

        const renderNow = useCallback(() => {
            if (renderRafRef.current !== null) {
                window.cancelAnimationFrame(renderRafRef.current)
                renderRafRef.current = null
            }
            appRef.current?.render()
        }, [])

        const requestRender = useCallback(() => {
            if (renderRafRef.current !== null) return
            renderRafRef.current = window.requestAnimationFrame(() => {
                renderRafRef.current = null
                appRef.current?.render()
            })
        }, [])

        const syncUprightIcons = useCallback((rad: number) => {
            const axisIcons = axisIconsRef.current
            if (axisIcons) {
                axisIcons.sun.rotation = -rad
                axisIcons.moon.rotation = -rad
            }
            for (const entry of handleNodesRef.current.values()) {
                if (entry.icon) entry.icon.rotation = -rad
            }
            for (const entry of anchorNodesRef.current.values()) {
                if (entry.icon) entry.icon.rotation = -rad
            }
        }, [])

        const syncHitAreaLayout = useCallback((metrics: LayoutMetrics, nextMode: DialMode) => {
            const hitArea = hitAreaRef.current
            if (!hitArea) return
            if (nextMode === 'schedule') {
                hitArea.style.left = `${metrics.scheduleCenterX - metrics.scheduleDiameter / 2}px`
                hitArea.style.top = `${metrics.scheduleCenterY - metrics.scheduleDiameter / 2}px`
                hitArea.style.width = `${metrics.scheduleDiameter}px`
                hitArea.style.height = `${metrics.scheduleDiameter}px`
                return
            }
            if (nextMode === 'today') {
                const top = Math.max(0, metrics.vh * TODAY_Y_RATIO)
                hitArea.style.left = '0px'
                hitArea.style.top = `${top}px`
                hitArea.style.width = `${metrics.vw}px`
                hitArea.style.height = `${Math.max(0, metrics.vh - top)}px`
                return
            }
            hitArea.style.width = '0px'
            hitArea.style.height = '0px'
        }, [])

        const measureLayoutMetrics = useCallback((): LayoutMetrics => {
            const layer = layerRef.current
            const vw = layer?.clientWidth || window.innerWidth
            const vh = layer?.clientHeight || window.innerHeight
            const dialSize = clamp(vw * DIAL_SIZE_VW_RATIO, MIN_DIAL_SIZE_PX, MAX_DIAL_SIZE_PX)
            const todayDiameter = dialSize * TODAY_SCALE
            const todayCenterX = vw / 2
            const todayCenterY = vh * TODAY_Y_RATIO + todayDiameter / 2
            const todayScale = todayDiameter / (DIAL_DISC_RADIUS * 2)
            const scheduleCenterX = vw / 2
            const scheduleCenterY = vh * SCHEDULE_Y_RATIO
            const scheduleDiameter = Math.min(
                vw * SCHEDULE_WIDTH_RATIO,
                vh * SCHEDULE_MAX_HEIGHT_RATIO,
            )
            const scheduleScale = scheduleDiameter / (DIAL_DISC_RADIUS * 2)
            const metrics: LayoutMetrics = {
                vw,
                vh,
                dialSize,
                todayCenterX,
                todayCenterY,
                todayScale,
                scheduleCenterX,
                scheduleCenterY,
                scheduleDiameter,
                scheduleScale,
            }
            layoutCacheRef.current = metrics
            syncHitAreaLayout(metrics, modeRef.current)
            return metrics
        }, [syncHitAreaLayout])

        const getLayoutMetrics = useCallback(
            () => layoutCacheRef.current ?? measureLayoutMetrics(),
            [measureLayoutMetrics],
        )

        const resetTodayIconSwap = useCallback(() => {
            todaySwapTweenRef.current?.kill()
            todaySwapTweenRef.current = null
            todaySwapStateRef.current = null
            lastTodayWedgeRef.current = null
            const slots = todayIconSlotsRef.current
            if (slots) {
                slots.prev.container.visible = false
            }
        }, [])

        const syncTodayIcons = useCallback(() => {
            const layer = todayIconsLayerRef.current
            const slots = todayIconSlotsRef.current
            const textures = todayIconTexturesRef.current
            const dialRoot = dialRootRef.current
            if (!layer || !slots || !textures || !dialRoot) return

            const todayAlpha = clamp01(1 - progressStateRef.current.value / 0.35) * dialRoot.alpha
            const activeWedges = wedgesRef.current
            if (todayAlpha <= 0.001 || activeWedges.length === 0) {
                layer.visible = false
                if (todayAlpha <= 0.001) {
                    resetTodayIconSwap()
                }
                return
            }

            const isTransitioning =
                progressStateRef.current.value > 0.001 ||
                transitionTweenRef.current !== null ||
                scrubbingRef.current
            const nowMin = isTransitioning
                ? currentMinuteRef.current
                : rotationRadToFractionalMinute(currentRotationRef.current)
            const foundIdx = activeWedges.findIndex((wedge) => isMinuteInWedge(nowMin, wedge))
            const currIdx = foundIdx === -1 ? 0 : foundIdx
            const currWedge = activeWedges[currIdx]
            if (!currWedge) {
                layer.visible = false
                return
            }

            layer.visible = true
            layer.alpha = todayAlpha

            const { vh, todayCenterX, todayCenterY, todayScale } = getLayoutMetrics()
            const badgeSizePx = 72
            const outerRingPx = DIAL_RING_OUTER_RADIUS * todayScale
            const arcRadiusPx = Math.max(
                outerRingPx + badgeSizePx * 0.5,
                todayCenterY - vh * TODAY_ICON_Y_RATIO,
            )
            const minSepAngle = (badgeSizePx * TODAY_ICON_MIN_SEP_FACTOR) / Math.max(1, arcRadiusPx)

            const configureSlot = (
                slot: TodayIconSlot,
                state: ScheduleWedge['state'],
                angle: number,
                scaleMultiplier: number,
                alpha: number,
            ) => {
                if (alpha <= 0.001) {
                    slot.container.visible = false
                    return
                }
                const tex = state === 'awake' ? textures.awake : textures.asleep
                if (slot.icon.texture !== tex) {
                    slot.icon.texture = tex
                }
                const glyphScale =
                    tex.height > 0
                        ? (TODAY_ICON_BADGE_UNIT_SIZE * TODAY_ICON_GLYPH_RATIO) / tex.height
                        : 1
                slot.icon.scale.set(glyphScale)
                slot.disc.tint =
                    state === 'awake' ? TODAY_AWAKE_ICON_COLOR : TODAY_ASLEEP_ICON_COLOR
                slot.container.scale.set(
                    (badgeSizePx / TODAY_ICON_BADGE_UNIT_SIZE) * scaleMultiplier,
                )
                slot.container.position.set(
                    todayCenterX + Math.sin(angle) * arcRadiusPx,
                    todayCenterY - Math.cos(angle) * arcRadiusPx,
                )
                slot.container.alpha = alpha
                slot.container.visible = true
            }

            if (activeWedges.length === 1) {
                configureSlot(slots.current, currWedge.state, 0, 1, 1)
                slots.upcoming.container.visible = false
                slots.prev.container.visible = false
                return
            }

            const nextWedge = activeWedges[(currIdx + 1) % activeWedges.length] ?? currWedge
            const prevWedge =
                activeWedges[(currIdx - 1 + activeWedges.length) % activeWedges.length] ?? currWedge
            const minutesUntilNext =
                (nextWedge.startMin - nowMin + MINUTES_PER_DAY) % MINUTES_PER_DAY

            const prevTracked = lastTodayWedgeRef.current
            if (!isTransitioning && prevTracked && prevTracked.id !== currWedge.id) {
                todaySwapTweenRef.current?.kill()
                const isForward = prevWedge.id === prevTracked.id
                const dir = isForward ? 1 : -1
                const swapState: TodayIconSwapState = {
                    outgoingState: prevTracked.state,
                    outgoingStartAngle: 0,
                    outgoingEndAngle: -dir * (minSepAngle * 1.35),
                    incomingStartAngle: dir * minSepAngle,
                    incomingStartScale: TODAY_ICON_READY_SCALE,
                    incomingStartAlpha: TODAY_ICON_READY_ALPHA,
                    progress: 0,
                }
                todaySwapStateRef.current = swapState
                todaySwapTweenRef.current = gsap.to(swapState, {
                    progress: 1,
                    duration: TODAY_ICON_SWAP_DURATION_SEC,
                    ease: 'power3.inOut',
                    onUpdate: () => {
                        syncTodayIcons()
                        renderNow()
                    },
                    onComplete: () => {
                        todaySwapTweenRef.current = null
                        todaySwapStateRef.current = null
                        syncTodayIcons()
                        renderNow()
                    },
                })
            }

            if (!isTransitioning) {
                lastTodayWedgeRef.current = {
                    id: currWedge.id,
                    state: currWedge.state,
                }
            }

            const swapState = todaySwapStateRef.current
            const isSwapping = Boolean(swapState && swapState.progress < 0.999)
            if (isSwapping && swapState) {
                const t = swapState.progress
                const incomingAngle = swapState.incomingStartAngle * (1 - t)
                const incomingScale =
                    swapState.incomingStartScale + (1 - swapState.incomingStartScale) * t
                const incomingAlpha =
                    swapState.incomingStartAlpha + (1 - swapState.incomingStartAlpha) * t
                configureSlot(
                    slots.current,
                    currWedge.state,
                    incomingAngle,
                    incomingScale,
                    incomingAlpha,
                )

                const outgoingAngle =
                    swapState.outgoingStartAngle +
                    (swapState.outgoingEndAngle - swapState.outgoingStartAngle) * t
                const outgoingScale = 1 - (1 - TODAY_ICON_EDGE_SCALE) * t
                const outgoingAlpha = 1 - t
                configureSlot(
                    slots.prev,
                    swapState.outgoingState,
                    outgoingAngle,
                    outgoingScale,
                    outgoingAlpha,
                )
                slots.upcoming.container.visible = false
                return
            }

            configureSlot(slots.current, currWedge.state, 0, 1, 1)
            slots.prev.container.visible = false

            const enterProgress = clamp01(1 - minutesUntilNext / TODAY_ICON_LEAD_MINUTES)
            if (enterProgress > 0.001) {
                const upcomingAngle =
                    minSepAngle + (1 - enterProgress) * TODAY_ICON_APPROACH_EXTRA_ANGLE
                const upScale =
                    TODAY_ICON_EDGE_SCALE +
                    (TODAY_ICON_READY_SCALE - TODAY_ICON_EDGE_SCALE) * enterProgress
                const upAlpha = TODAY_ICON_READY_ALPHA * enterProgress
                configureSlot(slots.upcoming, nextWedge.state, upcomingAngle, upScale, upAlpha)
            } else {
                slots.upcoming.container.visible = false
            }
        }, [getLayoutMetrics, renderNow, resetTodayIconSwap])

        const applyRotationAndRender = useCallback(
            (rad: number, emitFromRotation = false, immediate = false) => {
                currentRotationRef.current = rad
                const rotor = rotorRef.current
                if (rotor) {
                    rotor.rotation = rad
                }
                syncUprightIcons(rad)
                syncTodayIcons()
                if (immediate) {
                    renderNow()
                } else {
                    requestRender()
                }
                if (emitFromRotation) {
                    emitMinuteForRad(rad)
                }
            },
            [emitMinuteForRad, renderNow, requestRender, syncTodayIcons, syncUprightIcons],
        )

        const syncSelectedHandleRings = useCallback(() => {
            const activeHandleId = selectedHandleIdRef.current
            for (const entry of handleNodesRef.current.values()) {
                entry.selectionRing.visible = entry.eventId === activeHandleId
            }
            for (const entry of anchorNodesRef.current.values()) {
                entry.selectionRing.visible = entry.eventId === activeHandleId
            }
        }, [])

        const syncHandlePositions = useCallback(() => {
            const liveRadius =
                DIAL_HANDLE_RING_RADIUS -
                (1 - clamp01(selectionStateRef.current.handleProgress)) * HANDLE_SLIDE_OFFSET
            for (const entry of handleNodesRef.current.values()) {
                entry.container.position.set(entry.cos * liveRadius, entry.sin * liveRadius)
            }
        }, [])

        const syncAnchorAlphas = useCallback(() => {
            const { morningWakeId, bedtimeId } = anchorIdsRef.current
            const sel = clamp01(selectionStateRef.current.selection)
            const dim = clamp01(selectionStateRef.current.dim)
            const dimScale = DIAL_COLORS.unselectedAlphaScale
            const prevWedgeId = prevVisualWedgeIdRef.current
            const activeWedgeId = activeVisualWedgeIdRef.current

            // Both permanent anchors highlight at full opacity when Day Wake or Night Sleep is selected.
            const isHalfSelected = (wedgeId: string | null): number =>
                wedgeId !== null && (wedgeId === bedtimeId || wedgeId === morningWakeId) ? 1 : 0
            const prevHalfSelected = isHalfSelected(prevWedgeId)
            const currHalfSelected = isHalfSelected(activeWedgeId)
            const highlight = prevHalfSelected + (currHalfSelected - prevHalfSelected) * sel

            for (const entry of anchorNodesRef.current.values()) {
                const nonHighlightedAlpha = entry.idleAlpha * (1 - (1 - dimScale) * dim)
                entry.container.alpha = nonHighlightedAlpha + (1 - nonHighlightedAlpha) * highlight
            }
        }, [])

        const rebuildHandles = useCallback(() => {
            const layer = handlesLayerRef.current
            const textures = handleTexturesRef.current
            if (!layer) return

            const activeWedgeId = activeVisualWedgeIdRef.current
            const currentRad = currentRotationRef.current
            const existingNodes = handleNodesRef.current
            const activeIds = new Set<string>()

            const visibleEvents: ScheduleEvent[] = []
            if (activeWedgeId) {
                const classified = classifyScheduleEvents(eventsRef.current)
                const startIdx = classified.findIndex((item) => item.event.id === activeWedgeId)
                const startItem = classified[startIdx]
                // Only naps and night wakes show transient handles (Day Wake and Night Sleep use
                // the permanent Bedtime and Morning Wake anchors).
                if (
                    startItem &&
                    (startItem.kind === 'nap-start' || startItem.kind === 'night-wake-start')
                ) {
                    const endItem = classified[(startIdx + 1) % classified.length]
                    visibleEvents.push(startItem.event)
                    if (endItem && endItem.event.id !== startItem.event.id) {
                        visibleEvents.push(endItem.event)
                    }
                }
            }

            for (const event of visibleEvents) {
                activeIds.add(event.id)
                const angle = minuteToDialAngle(event.minuteOfDay)
                const cos = Math.cos(angle)
                const sin = Math.sin(angle)
                const existing = existingNodes.get(event.id)
                if (existing) {
                    existing.cos = cos
                    existing.sin = sin
                    if (existing.icon) {
                        existing.icon.rotation = -currentRad
                    }
                    continue
                }

                const handleColor = event.type === 'awake' ? WAKE_HANDLE_COLOR : SLEEP_HANDLE_COLOR
                const container = new Container()
                const selectionRing = new Graphics()
                    .circle(0, 0, DIAL_HANDLE_SELECTED_RING_RADIUS)
                    .stroke({
                        width: DIAL_HANDLE_SELECTED_STROKE_WIDTH,
                        color: SELECTED_HANDLE_RING_COLOR,
                    })
                selectionRing.visible = event.id === selectedHandleIdRef.current
                container.addChild(selectionRing)

                const ring = new Graphics()
                    .circle(0, 0, DIAL_HANDLE_RADIUS)
                    .stroke({ width: DIAL_HANDLE_STROKE_WIDTH, color: handleColor })
                container.addChild(ring)

                let icon: Sprite | null = null
                if (textures) {
                    const tex = event.type === 'awake' ? textures.up : textures.down
                    icon = createIconSprite(tex, DIAL_HANDLE_ICON_SIZE, handleColor)
                    icon.rotation = -currentRad
                    container.addChild(icon)
                }

                layer.addChild(container)
                existingNodes.set(event.id, {
                    eventId: event.id,
                    container,
                    selectionRing,
                    icon,
                    cos,
                    sin,
                    idleAlpha: 1,
                })
            }

            for (const [id, entry] of existingNodes) {
                if (!activeIds.has(id)) {
                    layer.removeChild(entry.container)
                    entry.container.destroy({ children: true })
                    existingNodes.delete(id)
                }
            }

            syncHandlePositions()
            requestRender()
        }, [requestRender, syncHandlePositions])

        const rebuildAnchors = useCallback(() => {
            const layer = anchorsLayerRef.current
            const textures = handleTexturesRef.current
            if (!layer) return

            const sorted = sortScheduleEvents(eventsRef.current)
            const { morningWakeId, bedtimeId } = getAnchorEventIds(sorted)
            anchorIdsRef.current = { morningWakeId, bedtimeId }
            const currentRad = currentRotationRef.current
            const existingNodes = anchorNodesRef.current
            const activeIds = new Set<string>()

            const anchorSpecs = [
                {
                    id: morningWakeId,
                    fillColor: MORNING_WAKE_ANCHOR_FILL,
                    iconTint: MORNING_WAKE_ANCHOR_ICON,
                    idleAlpha: DIAL_COLORS.morningWakeAnchor.idleAlpha,
                    tex: textures?.up ?? null,
                },
                {
                    id: bedtimeId,
                    fillColor: BEDTIME_ANCHOR_FILL,
                    iconTint: BEDTIME_ANCHOR_ICON,
                    idleAlpha: DIAL_COLORS.bedtimeAnchor.idleAlpha,
                    tex: textures?.down ?? null,
                },
            ]

            for (const spec of anchorSpecs) {
                if (!spec.id) continue
                const event = sorted.find((item) => item.id === spec.id)
                if (!event) continue

                activeIds.add(event.id)
                const angle = minuteToDialAngle(event.minuteOfDay)
                const cos = Math.cos(angle)
                const sin = Math.sin(angle)
                const existing = existingNodes.get(event.id)
                if (existing) {
                    existing.cos = cos
                    existing.sin = sin
                    existing.container.position.set(
                        cos * DIAL_HANDLE_RING_RADIUS,
                        sin * DIAL_HANDLE_RING_RADIUS,
                    )
                    if (existing.icon) {
                        existing.icon.rotation = -currentRad
                    } else if (spec.tex) {
                        const icon = createIconSprite(
                            spec.tex,
                            DIAL_HANDLE_ICON_SIZE,
                            spec.iconTint,
                        )
                        icon.rotation = -currentRad
                        existing.container.addChild(icon)
                        existing.icon = icon
                    }
                    continue
                }

                const container = new Container()
                container.position.set(cos * DIAL_HANDLE_RING_RADIUS, sin * DIAL_HANDLE_RING_RADIUS)

                const selectionRing = new Graphics()
                    .circle(0, 0, DIAL_HANDLE_SELECTED_RING_RADIUS)
                    .stroke({
                        width: DIAL_HANDLE_SELECTED_STROKE_WIDTH,
                        color: SELECTED_HANDLE_RING_COLOR,
                    })
                selectionRing.visible = event.id === selectedHandleIdRef.current
                container.addChild(selectionRing)

                const disc = new Graphics()
                    .circle(0, 0, DIAL_ANCHOR_RADIUS)
                    .fill({ color: spec.fillColor })
                container.addChild(disc)

                let icon: Sprite | null = null
                if (spec.tex) {
                    icon = createIconSprite(spec.tex, DIAL_HANDLE_ICON_SIZE, spec.iconTint)
                    icon.rotation = -currentRad
                    container.addChild(icon)
                }

                layer.addChild(container)
                existingNodes.set(event.id, {
                    eventId: event.id,
                    container,
                    selectionRing,
                    icon,
                    cos,
                    sin,
                    idleAlpha: spec.idleAlpha,
                })
            }

            for (const [id, entry] of existingNodes) {
                if (!activeIds.has(id)) {
                    layer.removeChild(entry.container)
                    entry.container.destroy({ children: true })
                    existingNodes.delete(id)
                }
            }

            syncAnchorAlphas()
            requestRender()
        }, [requestRender, syncAnchorAlphas])

        const applySelectionVisuals = useCallback(
            (immediate = false) => {
                const sel = clamp01(selectionStateRef.current.selection)
                const dim = clamp01(selectionStateRef.current.dim)
                const handleProgress = clamp01(selectionStateRef.current.handleProgress)
                const uniforms = wedgeMeshRef.current?.shader?.resources?.selectionUniforms as
                    | { uniforms: { uSelectionProgress: number; uDimProgress: number } }
                    | undefined
                if (uniforms) {
                    uniforms.uniforms.uSelectionProgress = sel
                    uniforms.uniforms.uDimProgress = dim
                }
                const scheduleOverlayAlpha = clamp01((progressStateRef.current.value - 0.35) / 0.65)
                if (handlesLayerRef.current) {
                    handlesLayerRef.current.alpha = scheduleOverlayAlpha * handleProgress
                }
                if (anchorsLayerRef.current) {
                    anchorsLayerRef.current.alpha = scheduleOverlayAlpha
                }
                syncHandlePositions()
                syncAnchorAlphas()
                if (immediate) {
                    renderNow()
                } else {
                    requestRender()
                }
            },
            [renderNow, requestRender, syncAnchorAlphas, syncHandlePositions],
        )

        const rebuildWedgeMesh = useCallback(
            (
                nextWedges: readonly ScheduleWedge[],
                wedgeId: string | null,
                prevWedgeId: string | null = null,
            ) => {
                const mesh = wedgeMeshRef.current
                if (!mesh) return
                const prevGeometry = mesh.geometry
                mesh.geometry = buildDialGeometry(
                    nextWedges,
                    DIAL_DISC_RADIUS,
                    wedgeId,
                    prevWedgeId,
                )
                prevGeometry.destroy()
            },
            [],
        )

        const applyProgress = useCallback(
            (
                progress: number,
                syncRotation: boolean,
                preserveOpacity = false,
                immediate = false,
            ) => {
                const p = clamp01(progress)
                progressStateRef.current.value = p
                const dialRoot = dialRootRef.current
                if (dialRoot) {
                    const {
                        todayCenterX,
                        todayCenterY,
                        todayScale,
                        scheduleCenterX,
                        scheduleCenterY,
                        scheduleScale,
                    } = getLayoutMetrics()
                    const x = todayCenterX + (scheduleCenterX - todayCenterX) * p
                    const y = todayCenterY + (scheduleCenterY - todayCenterY) * p
                    const scale = todayScale + (scheduleScale - todayScale) * p
                    dialRoot.position.set(x, y)
                    dialRoot.scale.set(scale)
                    if (!preserveOpacity) {
                        dialRoot.alpha = 1
                    }
                }
                const scheduleOverlayAlpha = clamp01((p - 0.35) / 0.65)
                if (handlesLayerRef.current) {
                    handlesLayerRef.current.alpha =
                        scheduleOverlayAlpha * selectionStateRef.current.handleProgress
                }
                if (anchorsLayerRef.current) {
                    anchorsLayerRef.current.alpha = scheduleOverlayAlpha
                }
                if (syncRotation) {
                    const todayRad = getTodayRotationRad(currentMinuteRef.current)
                    const delta = shortestAngleDelta(todayRad, 0)
                    applyRotationAndRender(todayRad + delta * p, false, immediate)
                } else {
                    syncTodayIcons()
                    if (immediate) {
                        renderNow()
                    } else {
                        requestRender()
                    }
                }
            },
            [applyRotationAndRender, getLayoutMetrics, renderNow, requestRender, syncTodayIcons],
        )

        const killAnimations = useCallback(() => {
            transitionTweenRef.current?.kill()
            transitionTweenRef.current = null
            hideTweenRef.current?.kill()
            hideTweenRef.current = null
            resetTodayIconSwap()
            if (momentumRafRef.current !== null) {
                window.cancelAnimationFrame(momentumRafRef.current)
                momentumRafRef.current = null
            }
        }, [resetTodayIconSwap])

        const animateTo = useCallback(
            (target: DialMode, durationSec?: number) => {
                killAnimations()
                scrubbingRef.current = false
                const dialRoot = dialRootRef.current
                if (!dialRoot) return

                if (target === 'hidden') {
                    hideTweenRef.current = gsap.to(dialRoot, {
                        alpha: 0,
                        duration: durationSec ?? HIDDEN_DURATION_SEC,
                        ease: 'power2.out',
                        onUpdate: () => {
                            syncTodayIcons()
                            renderNow()
                        },
                        onComplete: () => {
                            hideTweenRef.current = null
                            syncTodayIcons()
                            renderNow()
                        },
                    })
                    return
                }

                const targetProgress = target === 'schedule' ? 1 : 0

                // Returning from hidden: snap layout in place and fade in cleanly without sliding.
                if (dialRoot.alpha < 0.05) {
                    applyProgress(targetProgress, true, true, true)
                    hideTweenRef.current = gsap.to(dialRoot, {
                        alpha: 1,
                        duration: durationSec ?? HIDDEN_DURATION_SEC,
                        ease: 'power2.out',
                        onUpdate: () => {
                            syncTodayIcons()
                            renderNow()
                        },
                        onComplete: () => {
                            hideTweenRef.current = null
                            syncTodayIcons()
                            renderNow()
                        },
                    })
                    return
                }

                const startProgress = progressStateRef.current.value
                const distance = Math.abs(targetProgress - startProgress)
                const duration =
                    durationSec ??
                    Math.max(0.25, TRANSITION_DURATION_SEC * Math.max(0.35, distance))

                const startRad = currentRotationRef.current
                const getTargetRad = () =>
                    target === 'schedule' ? 0 : getTodayRotationRad(currentMinuteRef.current)
                const tweenState = { t: 0 }

                transitionTweenRef.current = gsap.to(tweenState, {
                    t: 1,
                    duration,
                    ease: 'power3.out',
                    onUpdate: () => {
                        const p = startProgress + (targetProgress - startProgress) * tweenState.t
                        const liveTargetRad = getTargetRad()
                        const rad =
                            startRad + shortestAngleDelta(startRad, liveTargetRad) * tweenState.t
                        currentRotationRef.current = rad
                        if (rotorRef.current) {
                            rotorRef.current.rotation = rad
                        }
                        syncUprightIcons(rad)
                        applyProgress(p, false, false, true)
                    },
                    onComplete: () => {
                        transitionTweenRef.current = null
                        const finalRad = getTargetRad()
                        currentRotationRef.current = finalRad
                        if (rotorRef.current) {
                            rotorRef.current.rotation = finalRad
                        }
                        syncUprightIcons(finalRad)
                        applyProgress(targetProgress, false, false, true)
                    },
                })
            },
            [applyProgress, killAnimations, renderNow, syncTodayIcons, syncUprightIcons],
        )

        useImperativeHandle(
            ref,
            () => ({
                scrubTo: (progress: number) => {
                    killAnimations()
                    scrubbingRef.current = true
                    applyProgress(progress, false, false, true)
                },
                animateTo,
            }),
            [animateTo, applyProgress, killAnimations],
        )

        useEffect(() => {
            const syncNow = (nowMin: number) => {
                currentMinuteRef.current = nowMin
                if (
                    modeRef.current === 'today' &&
                    !scrubbingRef.current &&
                    !transitionTweenRef.current
                ) {
                    applyRotationAndRender(getTodayRotationRad(nowMin), true)
                } else {
                    const wholeMin = Math.floor(nowMin) % MINUTES_PER_DAY
                    if (lastEmittedMinuteRef.current !== wholeMin) {
                        lastEmittedMinuteRef.current = wholeMin
                        onMinuteChangeRef.current?.(wholeMin)
                    }
                }
            }

            if (!devMode.enabled) {
                const syncRealTime = () => {
                    syncNow(getCurrentMinuteOfDay(Date.now()))
                }

                let timeoutId: number | null = null
                const scheduleNextTick = () => {
                    const now = Date.now()
                    syncRealTime()
                    const msUntilNextSecond = 1000 - (now % 1000)
                    timeoutId = window.setTimeout(scheduleNextTick, msUntilNextSecond)
                }

                const handleVisibilityChange = () => {
                    if (document.visibilityState === 'visible') {
                        if (timeoutId !== null) window.clearTimeout(timeoutId)
                        scheduleNextTick()
                    }
                }

                syncRealTime()
                const now = Date.now()
                timeoutId = window.setTimeout(scheduleNextTick, 1000 - (now % 1000))
                document.addEventListener('visibilitychange', handleVisibilityChange)

                return () => {
                    if (timeoutId !== null) window.clearTimeout(timeoutId)
                    document.removeEventListener('visibilitychange', handleVisibilityChange)
                }
            }

            let rafId: number | null = null
            let lastTime = performance.now()

            const tick = (now: number) => {
                const dtMs = Math.min(100, Math.max(0, now - lastTime))
                lastTime = now

                if (!dragRef.current && momentumRafRef.current === null) {
                    const nextMin =
                        (currentMinuteRef.current + (dtMs / 60_000) * devMode.speedMultiplier) %
                        MINUTES_PER_DAY
                    syncNow(nextMin)
                }

                rafId = window.requestAnimationFrame(tick)
            }

            rafId = window.requestAnimationFrame(tick)
            return () => {
                if (rafId !== null) window.cancelAnimationFrame(rafId)
            }
        }, [devMode.enabled, devMode.speedMultiplier, applyRotationAndRender])

        useEffect(() => {
            const host = hostRef.current
            if (!host) return

            let cancelled = false
            let initialized = false
            const app = new Application()
            const loadedTextures: Texture[] = []

            const init = async () => {
                const metrics = measureLayoutMetrics()
                await app.init({
                    width: metrics.vw,
                    height: metrics.vh,
                    backgroundAlpha: 0,
                    antialias: true,
                    autoDensity: true,
                    autoStart: false,
                    resolution: getViewportResolution(),
                    preference: 'webgl',
                    powerPreference: 'high-performance',
                })

                if (cancelled) {
                    app.destroy(true, { children: true })
                    return
                }

                initialized = true
                appRef.current = app
                host.appendChild(app.canvas)

                const dialRoot = new Container()
                dialRootRef.current = dialRoot

                const rotor = new Container()
                rotorRef.current = rotor

                const geometry = buildDialGeometry(
                    wedgesRef.current,
                    DIAL_DISC_RADIUS,
                    selectedWedgeIdRef.current,
                )
                const shader = createDialShader(
                    sunTimesRef.current.sunriseMinuteOfDay,
                    sunTimesRef.current.sunsetMinuteOfDay,
                )
                const wedgeMesh = new Mesh({ geometry, shader })
                wedgeMeshRef.current = wedgeMesh

                const handlesLayer = new Container()
                handlesLayerRef.current = handlesLayer

                const anchorsLayer = new Container()
                anchorsLayerRef.current = anchorsLayer

                rotor.addChild(wedgeMesh, handlesLayer, anchorsLayer)
                dialRoot.addChild(rotor)

                const todayIconsLayer = new Container()
                todayIconsLayer.visible = false
                todayIconsLayerRef.current = todayIconsLayer

                app.stage.addChild(dialRoot, todayIconsLayer)

                if (modeRef.current === 'hidden') {
                    dialRoot.position.set(metrics.todayCenterX, metrics.todayCenterY)
                    dialRoot.scale.set(metrics.todayScale)
                    dialRoot.alpha = 0
                } else {
                    applyProgress(modeRef.current === 'schedule' ? 1 : 0, true, false, true)
                }

                const [sunTex, moonTex, upTex, downTex, awakeTex, asleepTex] = await Promise.all([
                    loadTintedSvgTexture('/icons/sun.svg'),
                    loadTintedSvgTexture('/icons/moon.svg'),
                    loadTintedSvgTexture('/icons/up.svg'),
                    loadTintedSvgTexture('/icons/down.svg'),
                    loadTintedSvgTexture('/icons/awake.svg'),
                    loadTintedSvgTexture('/icons/asleep.svg'),
                ])

                if (cancelled) {
                    for (const tex of [sunTex, moonTex, upTex, downTex, awakeTex, asleepTex]) {
                        tex.destroy(true)
                    }
                    return
                }

                loadedTextures.push(sunTex, moonTex, upTex, downTex, awakeTex, asleepTex)
                handleTexturesRef.current = { up: upTex, down: downTex }
                todayIconTexturesRef.current = { awake: awakeTex, asleep: asleepTex }

                const makeTodaySlot = (): TodayIconSlot => {
                    const container = new Container()
                    container.visible = false
                    const disc = new Graphics()
                        .circle(0, 0, TODAY_ICON_BADGE_UNIT_SIZE / 2)
                        .fill({ color: 0xffffff })
                    const icon = new Sprite(awakeTex)
                    icon.anchor.set(0.5)
                    icon.tint = TODAY_ICON_FG_COLOR
                    container.addChild(disc, icon)
                    return { container, disc, icon }
                }
                const todaySlots: TodayIconSlots = {
                    prev: makeTodaySlot(),
                    current: makeTodaySlot(),
                    upcoming: makeTodaySlot(),
                }
                todayIconSlotsRef.current = todaySlots
                todayIconsLayer.addChild(
                    todaySlots.prev.container,
                    todaySlots.upcoming.container,
                    todaySlots.current.container,
                )

                const axisIcons: AxisIcons = {
                    sun: createIconSprite(sunTex, DIAL_AXIS_ICON_SIZE, NOON_SUN_ICON_COLOR),
                    moon: createIconSprite(moonTex, DIAL_AXIS_ICON_SIZE, MIDNIGHT_MOON_ICON_COLOR),
                }
                axisIcons.sun.position.set(0, -DIAL_AXIS_ICON_RADIUS)
                axisIcons.moon.position.set(0, DIAL_AXIS_ICON_RADIUS)
                axisIconsRef.current = axisIcons

                rotor.addChildAt(axisIcons.sun, 1)
                rotor.addChildAt(axisIcons.moon, 2)

                rebuildHandles()
                rebuildAnchors()
                applySelectionVisuals()
                applyRotationAndRender(currentRotationRef.current, false, true)
            }

            init()

            const handleResize = () => {
                const metrics = measureLayoutMetrics()
                const currentApp = appRef.current
                if (currentApp) {
                    const nextResolution = getViewportResolution()
                    currentApp.renderer.resize(metrics.vw, metrics.vh, nextResolution)
                }
                if (modeRef.current !== 'hidden') {
                    applyProgress(progressStateRef.current.value, false, false, true)
                } else {
                    renderNow()
                }
            }
            window.addEventListener('resize', handleResize)

            return () => {
                cancelled = true
                window.removeEventListener('resize', handleResize)
                if (renderRafRef.current !== null) {
                    window.cancelAnimationFrame(renderRafRef.current)
                    renderRafRef.current = null
                }
                killAnimations()
                selectionTweenRef.current?.kill()
                selectionTweenRef.current = null
                todaySwapTweenRef.current?.kill()
                todaySwapTweenRef.current = null
                todaySwapStateRef.current = null
                lastTodayWedgeRef.current = null
                wedgeMeshRef.current = null
                axisIconsRef.current = null
                handlesLayerRef.current = null
                handleNodesRef.current.clear()
                anchorsLayerRef.current = null
                anchorNodesRef.current.clear()
                handleTexturesRef.current = null
                todayIconsLayerRef.current = null
                todayIconSlotsRef.current = null
                todayIconTexturesRef.current = null
                dialRootRef.current = null
                rotorRef.current = null
                appRef.current = null
                for (const tex of loadedTextures) {
                    tex.destroy(true)
                }
                if (initialized) {
                    app.destroy(true, { children: true })
                }
            }
        }, [
            applyProgress,
            applyRotationAndRender,
            applySelectionVisuals,
            killAnimations,
            measureLayoutMetrics,
            rebuildAnchors,
            rebuildHandles,
            renderNow,
        ])

        useEffect(() => {
            const app = appRef.current
            if (!app || !wedgeMeshRef.current) return

            rebuildWedgeMesh(wedges, activeVisualWedgeIdRef.current)
            rebuildHandles()
            rebuildAnchors()
            syncTodayIcons()
            requestRender()
        }, [
            wedges,
            rebuildAnchors,
            rebuildHandles,
            rebuildWedgeMesh,
            requestRender,
            syncTodayIcons,
        ])

        useEffect(() => {
            selectionTweenRef.current?.kill()
            selectionTweenRef.current = null

            if (selectedWedgeId !== null) {
                const prevWedgeId = activeVisualWedgeIdRef.current
                const switchedWedge = prevWedgeId !== null && prevWedgeId !== selectedWedgeId

                if (switchedWedge) {
                    prevVisualWedgeIdRef.current = prevWedgeId
                    if (wedgeMeshRef.current) {
                        rebuildWedgeMesh(wedgesRef.current, selectedWedgeId, prevWedgeId)
                    }
                    selectionStateRef.current.selection = 0
                    selectionStateRef.current.dim = 1
                    applySelectionVisuals()

                    const tl = gsap.timeline({
                        onUpdate: applySelectionVisuals,
                        onComplete: () => {
                            selectionTweenRef.current = null
                            prevVisualWedgeIdRef.current = null
                            activeVisualWedgeIdRef.current = selectedWedgeId
                            if (wedgeMeshRef.current) {
                                rebuildWedgeMesh(wedgesRef.current, selectedWedgeId, null)
                            }
                            selectionStateRef.current.selection = 1
                            selectionStateRef.current.dim = 1
                            selectionStateRef.current.handleProgress = 1
                            applySelectionVisuals()
                        },
                    })
                    tl.to(
                        selectionStateRef.current,
                        {
                            selection: 1,
                            duration: 0.24,
                            ease: 'power2.out',
                        },
                        0,
                    )
                    tl.to(
                        selectionStateRef.current,
                        {
                            handleProgress: 0,
                            duration: 0.11,
                            ease: 'power2.in',
                        },
                        0,
                    )
                    tl.call(
                        () => {
                            activeVisualWedgeIdRef.current = selectedWedgeId
                            rebuildHandles()
                        },
                        undefined,
                        0.11,
                    )
                    tl.to(
                        selectionStateRef.current,
                        {
                            handleProgress: 1,
                            duration: 0.16,
                            ease: 'power2.out',
                        },
                        0.11,
                    )
                    selectionTweenRef.current = tl
                    return
                }

                prevVisualWedgeIdRef.current = null
                activeVisualWedgeIdRef.current = selectedWedgeId
                if (wedgeMeshRef.current) {
                    rebuildWedgeMesh(wedgesRef.current, selectedWedgeId, null)
                }
                rebuildHandles()

                selectionTweenRef.current = gsap.to(selectionStateRef.current, {
                    selection: 1,
                    dim: 1,
                    handleProgress: 1,
                    duration: 0.24,
                    ease: 'power2.out',
                    onUpdate: applySelectionVisuals,
                    onComplete: () => {
                        selectionTweenRef.current = null
                        applySelectionVisuals()
                    },
                })
                return
            }

            if (activeVisualWedgeIdRef.current === null) {
                selectionStateRef.current.selection = 0
                selectionStateRef.current.dim = 0
                selectionStateRef.current.handleProgress = 0
                applySelectionVisuals()
                return
            }

            selectionTweenRef.current = gsap.to(selectionStateRef.current, {
                selection: 0,
                dim: 0,
                handleProgress: 0,
                duration: 0.2,
                ease: 'power2.inOut',
                onUpdate: applySelectionVisuals,
                onComplete: () => {
                    selectionTweenRef.current = null
                    prevVisualWedgeIdRef.current = null
                    activeVisualWedgeIdRef.current = null
                    if (wedgeMeshRef.current) {
                        rebuildWedgeMesh(wedgesRef.current, null, null)
                    }
                    rebuildHandles()
                    applySelectionVisuals()
                },
            })
        }, [selectedWedgeId, applySelectionVisuals, rebuildHandles, rebuildWedgeMesh])

        useEffect(() => {
            syncSelectedHandleRings()
            requestRender()
        }, [selectedHandleId, requestRender, syncSelectedHandleRings])

        useEffect(() => {
            const app = appRef.current
            const mesh = wedgeMeshRef.current
            if (!app || !mesh) return

            const sunUniforms = mesh.shader?.resources?.sunUniforms as
                | { uniforms: { uSunriseMin: number; uSunsetMin: number } }
                | undefined
            if (sunUniforms) {
                sunUniforms.uniforms.uSunriseMin = sunTimes.sunriseMinuteOfDay
                sunUniforms.uniforms.uSunsetMin = sunTimes.sunsetMinuteOfDay
            }
            app.render()
        }, [sunTimes.sunriseMinuteOfDay, sunTimes.sunsetMinuteOfDay])

        useEffect(() => {
            manualControlRef.current = false
            syncHitAreaLayout(getLayoutMetrics(), mode)
            animateTo(mode)
        }, [mode, animateTo, getLayoutMetrics, syncHitAreaLayout])

        const findHitHandle = (
            clientX: number,
            clientY: number,
            dialRoot: Container,
        ): ScheduleEvent | null => {
            const activeSelectedId = selectedWedgeIdRef.current
            const local = clientToRotorLocal(clientX, clientY, dialRoot, currentRotationRef.current)
            const candidates: HandleNodeEntry[] = activeSelectedId
                ? [...handleNodesRef.current.values()]
                : []
            const { morningWakeId, bedtimeId } = anchorIdsRef.current
            if (
                activeSelectedId === null ||
                activeSelectedId === morningWakeId ||
                activeSelectedId === bedtimeId
            ) {
                candidates.push(...anchorNodesRef.current.values())
            }

            let bestId: string | null = null
            let bestDist = HANDLE_HIT_RADIUS
            for (const entry of candidates) {
                const d = Math.hypot(local.x - entry.container.x, local.y - entry.container.y)
                if (d <= bestDist) {
                    bestDist = d
                    bestId = entry.eventId
                }
            }
            if (!bestId) return null
            return eventsRef.current.find((event) => event.id === bestId) ?? null
        }

        const findHitWedge = (
            clientX: number,
            clientY: number,
            dialRoot: Container,
        ): ScheduleWedge | null => {
            const local = clientToRotorLocal(clientX, clientY, dialRoot, currentRotationRef.current)
            const dist = Math.hypot(local.x, local.y)
            if (dist < DIAL_RING_INNER_RADIUS || dist > DIAL_RING_OUTER_RADIUS) return null

            const minute = dialAngleToMinute(Math.atan2(local.y, local.x))
            for (const wedge of wedgesRef.current) {
                if (isMinuteInWedge(minute, wedge)) return wedge
            }
            return null
        }

        const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
            if (!isDialInteractiveRef.current) return

            const dialRoot = dialRootRef.current
            const hitArea = hitAreaRef.current
            if (!dialRoot || !hitArea) return

            if (modeRef.current === 'schedule') {
                const local = clientToRotorLocal(
                    event.clientX,
                    event.clientY,
                    dialRoot,
                    currentRotationRef.current,
                )
                const pointerAngle = Math.atan2(local.y, local.x)
                const activeSelectedId = selectedWedgeIdRef.current
                const hitHandle = findHitHandle(event.clientX, event.clientY, dialRoot)

                // Check handles before the left-edge swipe guard so 6-7 AM anchors remain interactive.
                if (hitHandle) {
                    scheduleInteractionRef.current = {
                        pointerId: event.pointerId,
                        startX: event.clientX,
                        startY: event.clientY,
                        hitWedgeSelectionId: activeSelectedId ?? hitHandle.id,
                        dragKind: activeSelectedId ? 'handle' : 'none',
                        eventIds: [hitHandle.id],
                        baseMinutes: [hitHandle.minuteOfDay],
                        lastAngle: pointerAngle,
                        accumulatedAngleRad: 0,
                        lastAppliedDeltaMin: 0,
                        moved: false,
                    }
                    return
                }

                if (event.pointerType === 'touch' && event.clientX <= EDGE_SWIPE_GUARD_PX) return

                const hitWedge = findHitWedge(event.clientX, event.clientY, dialRoot)
                const { morningWakeId, bedtimeId } = anchorIdsRef.current
                const isCumulativeHalf =
                    activeSelectedId === morningWakeId || activeSelectedId === bedtimeId
                if (
                    hitWedge &&
                    activeSelectedId &&
                    !isCumulativeHalf &&
                    hitWedge.selectionId === activeSelectedId
                ) {
                    const info = getScheduleWedgeInfo(activeSelectedId, eventsRef.current)
                    if (info) {
                        scheduleInteractionRef.current = {
                            pointerId: event.pointerId,
                            startX: event.clientX,
                            startY: event.clientY,
                            hitWedgeSelectionId: hitWedge.selectionId,
                            dragKind: 'wedge',
                            eventIds: [info.startEvent.id, info.endEvent.id],
                            baseMinutes: [info.startEvent.minuteOfDay, info.endEvent.minuteOfDay],
                            lastAngle: pointerAngle,
                            accumulatedAngleRad: 0,
                            lastAppliedDeltaMin: 0,
                            moved: false,
                        }
                        return
                    }
                }

                scheduleInteractionRef.current = {
                    pointerId: event.pointerId,
                    startX: event.clientX,
                    startY: event.clientY,
                    hitWedgeSelectionId: hitWedge?.selectionId ?? null,
                    dragKind: 'none',
                    eventIds: [],
                    baseMinutes: [],
                    lastAngle: pointerAngle,
                    accumulatedAngleRad: 0,
                    lastAppliedDeltaMin: 0,
                    moved: false,
                }
                return
            }

            if (event.pointerType === 'touch' && event.clientX <= EDGE_SWIPE_GUARD_PX) return

            const centerX = dialRoot.x
            const centerY = dialRoot.y
            const visualDiameter = DIAL_DISC_RADIUS * 2 * dialRoot.scale.x
            const dist = Math.hypot(event.clientX - centerX, event.clientY - centerY)
            if (dist > visualDiameter * 0.72) return

            const horizontalOnly = modeRef.current === 'today'
            if (!horizontalOnly) {
                killAnimations()
                manualControlRef.current = true
                setIsDragging(true)
                hitArea.setPointerCapture(event.pointerId)
            }

            dragRef.current = {
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                horizontalOnly,
                locked: !horizontalOnly,
                moved: false,
                centerX,
                centerY,
                lastAngle: Math.atan2(event.clientY - centerY, event.clientX - centerX),
                lastTime: performance.now(),
                velocityRadPerMs: 0,
            }
        }

        const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
            const interaction = scheduleInteractionRef.current
            if (interaction && interaction.pointerId === event.pointerId) {
                if (interaction.dragKind === 'none') {
                    const movedDist = Math.hypot(
                        event.clientX - interaction.startX,
                        event.clientY - interaction.startY,
                    )
                    if (movedDist > TAP_SLOP_PX) {
                        scheduleInteractionRef.current = null
                    }
                    return
                }

                const dialRoot = dialRootRef.current
                const hitArea = hitAreaRef.current
                if (!dialRoot || !hitArea) return
                const local = clientToRotorLocal(
                    event.clientX,
                    event.clientY,
                    dialRoot,
                    currentRotationRef.current,
                )
                const angle = Math.atan2(local.y, local.x)

                if (!interaction.moved) {
                    const movedDist = Math.hypot(
                        event.clientX - interaction.startX,
                        event.clientY - interaction.startY,
                    )
                    if (movedDist < SWIPE_LOCK_PX) return
                    interaction.moved = true
                    interaction.lastAngle = angle
                    setIsDragging(true)
                    hitArea.setPointerCapture(event.pointerId)
                    onDragEventIdsChangeRef.current?.(interaction.eventIds)
                    onSelectHandleRef.current?.(
                        interaction.dragKind === 'handle'
                            ? (interaction.eventIds[0] ?? null)
                            : null,
                    )
                    return
                }

                const deltaAngle = shortestAngleDelta(interaction.lastAngle, angle)
                interaction.lastAngle = angle
                interaction.accumulatedAngleRad += deltaAngle

                const rawDeltaMin =
                    (interaction.accumulatedAngleRad / (Math.PI * 2)) *
                    MINUTES_PER_DAY *
                    DIAL_DRAG_SENSITIVITY
                const snappedDeltaMin = Math.round(rawDeltaMin / SNAP_STEP_MIN) * SNAP_STEP_MIN
                if (snappedDeltaMin === interaction.lastAppliedDeltaMin) return
                interaction.lastAppliedDeltaMin = snappedDeltaMin

                if (interaction.dragKind === 'handle') {
                    const eventId = interaction.eventIds[0]
                    const baseMin = interaction.baseMinutes[0]
                    if (eventId !== undefined && baseMin !== undefined) {
                        onChangeEventMinuteRef.current?.(
                            eventId,
                            normalizeMinuteOfDay(baseMin + snappedDeltaMin),
                        )
                    }
                } else {
                    const startId = interaction.eventIds[0]
                    const endId = interaction.eventIds[1]
                    const baseStart = interaction.baseMinutes[0]
                    const baseEnd = interaction.baseMinutes[1]
                    if (
                        startId !== undefined &&
                        endId !== undefined &&
                        baseStart !== undefined &&
                        baseEnd !== undefined
                    ) {
                        onMoveWedgeRef.current?.(
                            startId,
                            endId,
                            baseStart,
                            baseEnd,
                            snappedDeltaMin,
                        )
                    }
                }
                return
            }

            const drag = dragRef.current
            if (!drag || drag.pointerId !== event.pointerId) return

            if (!drag.locked) {
                const absX = Math.abs(event.clientX - drag.startX)
                const absY = Math.abs(event.clientY - drag.startY)
                if (absX < SWIPE_LOCK_PX && absY < SWIPE_LOCK_PX) return

                if (drag.horizontalOnly && absY >= absX) {
                    dragRef.current = null
                    return
                }

                drag.locked = true
                drag.lastAngle = Math.atan2(
                    event.clientY - drag.centerY,
                    event.clientX - drag.centerX,
                )
                drag.lastTime = performance.now()
                killAnimations()
                manualControlRef.current = true
                setIsDragging(true)
                hitAreaRef.current?.setPointerCapture(event.pointerId)
                return
            }

            if (!drag.moved) {
                if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) >= 5) {
                    drag.moved = true
                }
            }

            const angle = Math.atan2(event.clientY - drag.centerY, event.clientX - drag.centerX)
            const delta = shortestAngleDelta(drag.lastAngle, angle)
            const now = performance.now()
            const dt = Math.max(1, now - drag.lastTime)
            const instantVelocity = Math.max(
                -MAX_VELOCITY_RAD_PER_MS,
                Math.min(MAX_VELOCITY_RAD_PER_MS, delta / dt),
            )

            drag.velocityRadPerMs = drag.velocityRadPerMs * 0.55 + instantVelocity * 0.45
            drag.lastAngle = angle
            drag.lastTime = now

            const nextRad = currentRotationRef.current + delta
            if (modeRef.current === 'today' && devModeRef.current.enabled) {
                currentMinuteRef.current = rotationRadToFractionalMinute(nextRad)
            }
            applyRotationAndRender(nextRad, modeRef.current === 'today', true)
        }

        const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
            const interaction = scheduleInteractionRef.current
            if (interaction && interaction.pointerId === event.pointerId) {
                scheduleInteractionRef.current = null
                if (interaction.moved) {
                    setIsDragging(false)
                    const hitArea = hitAreaRef.current
                    if (hitArea?.hasPointerCapture(event.pointerId)) {
                        hitArea.releasePointerCapture(event.pointerId)
                    }
                    onDragEventIdsChangeRef.current?.([])
                    return
                }
                if (event.type === 'pointerup') {
                    if (interaction.dragKind === 'handle') {
                        const handleId = interaction.eventIds[0] ?? null
                        if (handleId) {
                            onSelectHandleRef.current?.(
                                selectedHandleIdRef.current === handleId ? null : handleId,
                            )
                        }
                        return
                    }
                    if (interaction.hitWedgeSelectionId) {
                        const tappedAnchorId = interaction.eventIds[0] ?? null
                        if (tappedAnchorId && selectedWedgeIdRef.current === null) {
                            onSelectWedgeRef.current?.(
                                interaction.hitWedgeSelectionId,
                                tappedAnchorId,
                            )
                            return
                        }
                        const nextWedge =
                            selectedWedgeIdRef.current === interaction.hitWedgeSelectionId
                                ? null
                                : interaction.hitWedgeSelectionId
                        onSelectWedgeRef.current?.(nextWedge)
                    } else if (selectedWedgeIdRef.current) {
                        onSelectWedgeRef.current?.(null)
                    }
                }
                return
            }

            const drag = dragRef.current
            if (!drag || drag.pointerId !== event.pointerId) return

            dragRef.current = null
            if (!drag.locked) return

            setIsDragging(false)

            const hitArea = hitAreaRef.current
            if (hitArea?.hasPointerCapture(event.pointerId)) {
                hitArea.releasePointerCapture(event.pointerId)
            }

            let velocity = drag.velocityRadPerMs
            if (Math.abs(velocity) < MOMENTUM_STOP_RAD_PER_MS) return

            let lastTime = performance.now()
            const coast = (now: number) => {
                const dt = Math.min(32, Math.max(1, now - lastTime))
                lastTime = now
                velocity *= Math.exp(-dt * MOMENTUM_DAMPING_PER_MS)

                if (Math.abs(velocity) < MOMENTUM_STOP_RAD_PER_MS) {
                    momentumRafRef.current = null
                    return
                }

                const nextRad = currentRotationRef.current + velocity * dt
                if (modeRef.current === 'today' && devModeRef.current.enabled) {
                    currentMinuteRef.current = rotationRadToFractionalMinute(nextRad)
                }
                applyRotationAndRender(nextRad, modeRef.current === 'today', true)
                momentumRafRef.current = window.requestAnimationFrame(coast)
            }

            momentumRafRef.current = window.requestAnimationFrame(coast)
        }

        return (
            <div ref={layerRef} className={styles.layer} aria-hidden='true'>
                <div ref={hostRef} className={styles.stage} />
                <div
                    ref={hitAreaRef}
                    className={styles.hitArea}
                    data-mode={mode}
                    data-dragging={isDragging}
                    data-dial-interactive={isDialInteractive}
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerUp}
                />
            </div>
        )
    },
)
