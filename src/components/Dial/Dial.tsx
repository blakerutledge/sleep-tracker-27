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
    type CSSProperties,
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
    MINUTES_PER_DAY,
    PLACEHOLDER_SCHEDULE_EVENTS,
    type ScheduleEvent,
    type ScheduleWedge,
    sortScheduleEvents,
} from '#src/data/schedule.ts'
import { useDevMode } from '#src/lib/devMode.ts'
import { useSunLocation } from '#src/lib/sun.ts'
import { epochToZonedDateTime } from '#src/lib/temporal.ts'
import type { PageId } from '#src/pages/pages.ts'
import { DIAL_COLORS, hexToNumber } from '#src/styles/palette.ts'
import styles from './Dial.module.scss'
import {
    buildDialGeometry,
    createDialShader,
    DIAL_ANCHOR_RADIUS,
    DIAL_AXIS_ICON_RADIUS,
    DIAL_AXIS_ICON_SIZE,
    DIAL_CANVAS_SIZE,
    DIAL_DISC_RADIUS,
    DIAL_HANDLE_ICON_SIZE,
    DIAL_HANDLE_RADIUS,
    DIAL_HANDLE_RING_RADIUS,
    DIAL_HANDLE_STROKE_WIDTH,
    DIAL_RING_INNER_RADIUS,
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
    onMinuteChange?: (minuteOfDay: number) => void
    onSelectWedge?: (startEventId: string | null) => void
}

interface AxisIcons {
    sun: Sprite
    moon: Sprite
}

interface HandleNodeEntry {
    eventId: string
    container: Container
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

interface ScheduleTapState {
    pointerId: number
    startX: number
    startY: number
    wedgeId: string | null
}

const NOON_MINUTE = 720
const TODAY_SCALE = 2.0
const TODAY_Y_RATIO = 0.72
const SCHEDULE_WIDTH_RATIO = 0.96
const SCHEDULE_MAX_HEIGHT_RATIO = 0.68
const MAX_CANVAS_BACKING_PX = 2048
const ICON_RASTER_SIZE = 256
const TRANSITION_DURATION_SEC = 0.9
export const DIAL_FADE_DURATION_MS = 220
const HIDDEN_DURATION_SEC = DIAL_FADE_DURATION_MS / 1000

const NOON_SUN_ICON_COLOR = hexToNumber(DIAL_COLORS.noonSunIcon)
const MIDNIGHT_MOON_ICON_COLOR = hexToNumber(DIAL_COLORS.midnightMoonIcon)
const WAKE_HANDLE_COLOR = hexToNumber(DIAL_COLORS.wakeHandle)
const SLEEP_HANDLE_COLOR = hexToNumber(DIAL_COLORS.sleepHandle)
const MORNING_WAKE_ANCHOR_FILL = hexToNumber(DIAL_COLORS.morningWakeAnchor.fillColor)
const MORNING_WAKE_ANCHOR_ICON = hexToNumber(DIAL_COLORS.morningWakeAnchor.iconColor)
const BEDTIME_ANCHOR_FILL = hexToNumber(DIAL_COLORS.bedtimeAnchor.fillColor)
const BEDTIME_ANCHOR_ICON = hexToNumber(DIAL_COLORS.bedtimeAnchor.iconColor)

const EDGE_SWIPE_GUARD_PX = 36
const SWIPE_LOCK_PX = 8
const TAP_SLOP_PX = 10
const HANDLE_SLIDE_OFFSET = 28
const MOMENTUM_DAMPING_PER_MS = 0.009
const MOMENTUM_STOP_RAD_PER_MS = 0.00004
const MAX_VELOCITY_RAD_PER_MS = 0.012

const DIAL_ROTOR_STYLE = {
    '--dial-rotor-ratio': DIAL_CANVAS_SIZE / (DIAL_DISC_RADIUS * 2),
} as CSSProperties

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value))

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

const computeCanvasResolution = (dialSize: number): number => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const rotorCssAtToday = dialSize * (DIAL_CANVAS_SIZE / (DIAL_DISC_RADIUS * 2)) * TODAY_SCALE
    const desiredBackingPx = Math.ceil(rotorCssAtToday * dpr)
    const clampedBackingPx = Math.min(
        MAX_CANVAS_BACKING_PX,
        Math.max(DIAL_CANVAS_SIZE, desiredBackingPx),
    )
    return clampedBackingPx / DIAL_CANVAS_SIZE
}

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
    rect: DOMRect,
    rotationRad: number,
): { x: number; y: number } => {
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2
    const canvasPerPx = (DIAL_DISC_RADIUS * 2) / Math.max(1, rect.width)
    const dx = (clientX - centerX) * canvasPerPx
    const dy = (clientY - centerY) * canvasPerPx
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
        onMinuteChange,
        onSelectWedge,
    }: DialProps) => {
        const circleRef = useRef<HTMLDivElement | null>(null)
        const hostRef = useRef<HTMLDivElement | null>(null)
        const appRef = useRef<Application | null>(null)
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
        const renderRafRef = useRef<number | null>(null)
        const layoutCacheRef = useRef<{
            vh: number
            dialSize: number
            todayY: number
            scheduleY: number
            scheduleScale: number
        } | null>(null)

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
        const scheduleTapRef = useRef<ScheduleTapState | null>(null)
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

        const applyRotationAndRender = useCallback(
            (rad: number, emitFromRotation = false) => {
                currentRotationRef.current = rad
                const rotor = rotorRef.current
                if (rotor) {
                    rotor.rotation = rad
                }
                syncUprightIcons(rad)
                requestRender()
                if (emitFromRotation) {
                    emitMinuteForRad(rad)
                }
            },
            [emitMinuteForRad, requestRender, syncUprightIcons],
        )

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

            for (const entry of handleNodesRef.current.values()) {
                layer.removeChild(entry.container)
                entry.container.destroy({ children: true })
            }
            handleNodesRef.current.clear()

            const activeWedgeId = activeVisualWedgeIdRef.current
            const currentRad = currentRotationRef.current

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
                const angle = minuteToDialAngle(event.minuteOfDay)
                const handleColor = event.type === 'awake' ? WAKE_HANDLE_COLOR : SLEEP_HANDLE_COLOR
                const container = new Container()
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
                handleNodesRef.current.set(event.id, {
                    eventId: event.id,
                    container,
                    icon,
                    cos: Math.cos(angle),
                    sin: Math.sin(angle),
                    idleAlpha: 1,
                })
            }

            syncHandlePositions()
            requestRender()
        }, [requestRender, syncHandlePositions])

        const rebuildAnchors = useCallback(() => {
            const layer = anchorsLayerRef.current
            const textures = handleTexturesRef.current
            if (!layer) return

            for (const entry of anchorNodesRef.current.values()) {
                layer.removeChild(entry.container)
                entry.container.destroy({ children: true })
            }
            anchorNodesRef.current.clear()

            const sorted = sortScheduleEvents(eventsRef.current)
            const { morningWakeId, bedtimeId } = getAnchorEventIds(sorted)
            anchorIdsRef.current = { morningWakeId, bedtimeId }
            const currentRad = currentRotationRef.current

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

                const angle = minuteToDialAngle(event.minuteOfDay)
                const cos = Math.cos(angle)
                const sin = Math.sin(angle)
                const container = new Container()
                container.position.set(cos * DIAL_HANDLE_RING_RADIUS, sin * DIAL_HANDLE_RING_RADIUS)

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
                anchorNodesRef.current.set(event.id, {
                    eventId: event.id,
                    container,
                    icon,
                    cos,
                    sin,
                    idleAlpha: spec.idleAlpha,
                })
            }

            syncAnchorAlphas()
            requestRender()
        }, [requestRender, syncAnchorAlphas])

        const measureLayoutMetrics = useCallback(() => {
            const vw = window.innerWidth
            const vh = window.innerHeight
            const dialSize = circleRef.current?.offsetWidth || Math.min(vw * 1.18, 672)
            // With transform-origin: center, top edge sits at y + dialSize * (1 - scale) / 2.
            const todayY = vh * TODAY_Y_RATIO + (dialSize * (TODAY_SCALE - 1)) / 2
            const scheduleY = vh * 0.5 - dialSize / 2
            const scheduleDiameter = Math.min(
                vw * SCHEDULE_WIDTH_RATIO,
                vh * SCHEDULE_MAX_HEIGHT_RATIO,
            )
            const scheduleScale = scheduleDiameter / Math.max(1, dialSize)
            const metrics = { vh, dialSize, todayY, scheduleY, scheduleScale }
            layoutCacheRef.current = metrics
            return metrics
        }, [])

        const getLayoutMetrics = useCallback(
            () => layoutCacheRef.current ?? measureLayoutMetrics(),
            [measureLayoutMetrics],
        )

        const applySelectionVisuals = useCallback(() => {
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
            requestRender()
        }, [requestRender, syncAnchorAlphas, syncHandlePositions])

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
            (progress: number, syncRotation: boolean, preserveOpacity = false) => {
                const p = clamp01(progress)
                progressStateRef.current.value = p
                const circle = circleRef.current
                if (circle) {
                    const { todayY, scheduleY, scheduleScale } = getLayoutMetrics()
                    const y = todayY + (scheduleY - todayY) * p
                    const scale = TODAY_SCALE + (scheduleScale - TODAY_SCALE) * p
                    gsap.set(circle, {
                        xPercent: -50,
                        y,
                        scale,
                        ...(preserveOpacity ? {} : { opacity: 1 }),
                        force3D: true,
                    })
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
                    applyRotationAndRender(todayRad + delta * p, false)
                } else {
                    requestRender()
                }
            },
            [applyRotationAndRender, getLayoutMetrics, requestRender],
        )

        const killAnimations = useCallback(() => {
            transitionTweenRef.current?.kill()
            transitionTweenRef.current = null
            hideTweenRef.current?.kill()
            hideTweenRef.current = null
            if (momentumRafRef.current !== null) {
                window.cancelAnimationFrame(momentumRafRef.current)
                momentumRafRef.current = null
            }
        }, [])

        const animateTo = useCallback(
            (target: DialMode, durationSec?: number) => {
                killAnimations()
                scrubbingRef.current = false
                const circle = circleRef.current
                if (!circle) return

                if (target === 'hidden') {
                    hideTweenRef.current = gsap.to(circle, {
                        opacity: 0,
                        duration: durationSec ?? HIDDEN_DURATION_SEC,
                        ease: 'power2.out',
                        force3D: true,
                    })
                    return
                }

                const targetProgress = target === 'schedule' ? 1 : 0
                const currentOpacity = Number(gsap.getProperty(circle, 'opacity'))

                // Returning from hidden: snap layout in place and fade in cleanly without sliding.
                if (currentOpacity < 0.05) {
                    applyProgress(targetProgress, true, true)
                    hideTweenRef.current = gsap.to(circle, {
                        opacity: 1,
                        duration: durationSec ?? HIDDEN_DURATION_SEC,
                        ease: 'power2.out',
                        force3D: true,
                    })
                    return
                }

                const startProgress = progressStateRef.current.value
                const distance = Math.abs(targetProgress - startProgress)
                const duration =
                    durationSec ??
                    Math.max(0.25, TRANSITION_DURATION_SEC * Math.max(0.35, distance))

                const startRad = currentRotationRef.current
                const targetRad =
                    target === 'schedule' ? 0 : getTodayRotationRad(currentMinuteRef.current)
                const deltaRad = shortestAngleDelta(startRad, targetRad)
                const tweenState = { t: 0 }

                transitionTweenRef.current = gsap.to(tweenState, {
                    t: 1,
                    duration,
                    ease: 'power3.out',
                    onUpdate: () => {
                        const p = startProgress + (targetProgress - startProgress) * tweenState.t
                        applyProgress(p, false)
                        applyRotationAndRender(startRad + deltaRad * tweenState.t, false)
                    },
                    onComplete: () => {
                        transitionTweenRef.current = null
                        applyProgress(targetProgress, false)
                        applyRotationAndRender(targetRad, false)
                    },
                })
            },
            [applyProgress, applyRotationAndRender, killAnimations],
        )

        useImperativeHandle(
            ref,
            () => ({
                scrubTo: (progress: number) => {
                    killAnimations()
                    scrubbingRef.current = true
                    applyProgress(progress, false)
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
                const { dialSize } = measureLayoutMetrics()
                await app.init({
                    width: DIAL_CANVAS_SIZE,
                    height: DIAL_CANVAS_SIZE,
                    backgroundAlpha: 0,
                    antialias: true,
                    autoDensity: false,
                    autoStart: false,
                    resolution: computeCanvasResolution(dialSize),
                    preference: 'webgl',
                })

                if (cancelled) {
                    app.destroy(true, { children: true })
                    return
                }

                initialized = true
                appRef.current = app
                host.appendChild(app.canvas)

                const rotor = new Container()
                rotor.position.set(DIAL_CANVAS_SIZE / 2, DIAL_CANVAS_SIZE / 2)
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
                app.stage.addChild(rotor)

                if (modeRef.current === 'hidden') {
                    const circle = circleRef.current
                    if (circle) {
                        const { todayY } = getLayoutMetrics()
                        gsap.set(circle, {
                            xPercent: -50,
                            y: todayY,
                            scale: TODAY_SCALE,
                            opacity: 0,
                            force3D: true,
                        })
                    }
                } else {
                    applyProgress(modeRef.current === 'schedule' ? 1 : 0, true)
                }

                const [sunTex, moonTex, upTex, downTex] = await Promise.all([
                    loadTintedSvgTexture('/icons/sun.svg'),
                    loadTintedSvgTexture('/icons/moon.svg'),
                    loadTintedSvgTexture('/icons/up.svg'),
                    loadTintedSvgTexture('/icons/down.svg'),
                ])

                if (cancelled) {
                    for (const tex of [sunTex, moonTex, upTex, downTex]) {
                        tex.destroy(true)
                    }
                    return
                }

                loadedTextures.push(sunTex, moonTex, upTex, downTex)
                handleTexturesRef.current = { up: upTex, down: downTex }

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
                applyRotationAndRender(currentRotationRef.current)
            }

            init()

            const handleResize = () => {
                const { dialSize } = measureLayoutMetrics()
                const currentApp = appRef.current
                if (currentApp) {
                    const nextResolution = computeCanvasResolution(dialSize)
                    if (Math.abs(currentApp.renderer.resolution - nextResolution) > 0.05) {
                        currentApp.renderer.resize(
                            DIAL_CANVAS_SIZE,
                            DIAL_CANVAS_SIZE,
                            nextResolution,
                        )
                        requestRender()
                    }
                }
                if (modeRef.current !== 'hidden') {
                    applyProgress(progressStateRef.current.value, false)
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
                wedgeMeshRef.current = null
                axisIconsRef.current = null
                handlesLayerRef.current = null
                handleNodesRef.current.clear()
                anchorsLayerRef.current = null
                anchorNodesRef.current.clear()
                handleTexturesRef.current = null
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
            getLayoutMetrics,
            killAnimations,
            measureLayoutMetrics,
            rebuildAnchors,
            rebuildHandles,
            requestRender,
        ])

        useEffect(() => {
            const app = appRef.current
            if (!app || !wedgeMeshRef.current) return

            rebuildWedgeMesh(wedges, activeVisualWedgeIdRef.current)
            rebuildHandles()
            rebuildAnchors()
            app.render()
        }, [wedges, rebuildAnchors, rebuildHandles, rebuildWedgeMesh])

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
            animateTo(mode)
        }, [mode, animateTo])

        const findHitWedge = (
            clientX: number,
            clientY: number,
            rect: DOMRect,
        ): ScheduleWedge | null => {
            const local = clientToRotorLocal(clientX, clientY, rect, currentRotationRef.current)
            const dist = Math.hypot(local.x, local.y)
            if (dist < DIAL_RING_INNER_RADIUS - 12 || dist > DIAL_DISC_RADIUS + 12) return null

            const minute = dialAngleToMinute(Math.atan2(local.y, local.x))
            for (const wedge of wedgesRef.current) {
                const inWedge =
                    wedge.endMin > MINUTES_PER_DAY
                        ? minute >= wedge.startMin || minute < wedge.endMin - MINUTES_PER_DAY
                        : minute >= wedge.startMin && minute < wedge.endMin
                if (inWedge) return wedge
            }
            return null
        }

        const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
            if (!isDialInteractiveRef.current) return

            const circle = circleRef.current
            if (!circle) return

            const rect = circle.getBoundingClientRect()

            if (modeRef.current === 'schedule') {
                if (event.pointerType === 'touch' && event.clientX <= EDGE_SWIPE_GUARD_PX) return

                const hitWedge = findHitWedge(event.clientX, event.clientY, rect)
                scheduleTapRef.current = {
                    pointerId: event.pointerId,
                    startX: event.clientX,
                    startY: event.clientY,
                    wedgeId: hitWedge?.selectionId ?? null,
                }
                return
            }

            if (event.pointerType === 'touch' && event.clientX <= EDGE_SWIPE_GUARD_PX) return

            const centerX = rect.left + rect.width / 2
            const centerY = rect.top + rect.height / 2
            const dist = Math.hypot(event.clientX - centerX, event.clientY - centerY)
            if (dist > rect.width * 0.72) return

            const horizontalOnly = modeRef.current === 'today'
            if (!horizontalOnly) {
                killAnimations()
                manualControlRef.current = true
                setIsDragging(true)
                circle.setPointerCapture(event.pointerId)
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
            const scheduleTap = scheduleTapRef.current
            if (scheduleTap && scheduleTap.pointerId === event.pointerId) {
                const movedDist = Math.hypot(
                    event.clientX - scheduleTap.startX,
                    event.clientY - scheduleTap.startY,
                )
                if (movedDist > TAP_SLOP_PX) {
                    scheduleTapRef.current = null
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
                circleRef.current?.setPointerCapture(event.pointerId)
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
            applyRotationAndRender(nextRad, modeRef.current === 'today')
        }

        const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
            const scheduleTap = scheduleTapRef.current
            if (scheduleTap && scheduleTap.pointerId === event.pointerId) {
                scheduleTapRef.current = null
                if (event.type === 'pointerup') {
                    if (scheduleTap.wedgeId) {
                        const nextWedge =
                            selectedWedgeIdRef.current === scheduleTap.wedgeId
                                ? null
                                : scheduleTap.wedgeId
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

            const circle = circleRef.current
            if (circle?.hasPointerCapture(event.pointerId)) {
                circle.releasePointerCapture(event.pointerId)
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
                applyRotationAndRender(nextRad, modeRef.current === 'today')
                momentumRafRef.current = window.requestAnimationFrame(coast)
            }

            momentumRafRef.current = window.requestAnimationFrame(coast)
        }

        return (
            <div className={styles.layer} aria-hidden='true'>
                <div
                    ref={circleRef}
                    className={styles.circle}
                    data-mode={mode}
                    data-dragging={isDragging}
                    data-dial-interactive={isDialInteractive}
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerUp}>
                    <div ref={hostRef} className={styles.rotor} style={DIAL_ROTOR_STYLE} />
                </div>
            </div>
        )
    },
)
