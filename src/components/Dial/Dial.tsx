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
    MINUTES_PER_DAY,
    normalizeMinuteOfDay,
    PLACEHOLDER_SCHEDULE_EVENTS,
    type ScheduleEvent,
    type ScheduleWedge,
    SNAP_STEP_MIN,
    snapMinuteOfDay,
} from '#src/data/schedule.ts'
import { useDevMode } from '#src/lib/devMode.ts'
import { useSunLocation } from '#src/lib/sun.ts'
import { epochToZonedDateTime } from '#src/lib/temporal.ts'
import type { PageId } from '#src/pages/pages.ts'
import styles from './Dial.module.scss'
import {
    buildDialGeometry,
    createDialShader,
    DIAL_BARRIER_ICON_RADIUS,
    DIAL_CANVAS_SIZE,
    DIAL_DISC_RADIUS,
    DIAL_HANDLE_HIT_RADIUS,
    DIAL_HANDLE_NODE_RADIUS,
    DIAL_HANDLE_RADIUS,
    DIAL_INNER_RADIUS,
    DIAL_SUN_RING_INNER_RADIUS,
    DIAL_SUN_RING_OUTER_RADIUS,
    DIAL_WEDGE_ICON_RADIUS,
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
    selectedEventId?: string | null
    selectedWedgeId?: string | null
    onMinuteChange?: (minuteOfDay: number) => void
    onSelectEvent?: (eventId: string | null) => void
    onSelectWedge?: (startEventId: string | null) => void
    onChangeEventMinute?: (eventId: string, minuteOfDay: number) => void
    onMoveWedge?: (startEventId: string, candidateStartMinute: number) => void
}

interface BarrierIcons {
    sunrise: Sprite
    sunset: Sprite
}

interface HandleSpriteEntry {
    eventId: string
    icon: Sprite
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

interface HandleDragState {
    pointerId: number
    eventId: string
    startX: number
    startY: number
    rect: DOMRect
    lastMinute: number | null
    moved: boolean
}

interface WedgeDragState {
    pointerId: number
    startEventId: string
    initialStartMinute: number
    startX: number
    startY: number
    lastAngle: number
    cumulativeRad: number
    rect: DOMRect
    lastTargetStart: number | null
    moved: boolean
}

const NOON_MINUTE = 720
const TODAY_SCALE = 2.0
const TODAY_Y_RATIO = 0.72
const SCHEDULE_SCALE = 0.62
const MAX_CANVAS_BACKING_PX = 2048
const ICON_RASTER_SIZE = 256
const TRANSITION_DURATION_SEC = 0.9
export const DIAL_FADE_DURATION_MS = 220
const HIDDEN_DURATION_SEC = DIAL_FADE_DURATION_MS / 1000

// Palette hex values matching src/styles/_colors.scss
const BLUE_100 = 0x0a101c
const BLUE_200 = 0x1b1c33
const BLUE_900 = 0xdcf1f7
const YELLOW_200 = 0xf8cb4e
const YELLOW_300 = 0xfff187
const PURPLE_100 = 0x854c76

const WEDGE_ICON_MAX_SIZE = 74
const WEDGE_ICON_MIN_SIZE = 26
const WEDGE_ICON_ARC_FILL = 0.68
const WEDGE_ICON_ALPHA = 0.88

const EDGE_SWIPE_GUARD_PX = 36
const SWIPE_LOCK_PX = 8
const HANDLE_DRAG_THRESHOLD_PX = 6
const MOMENTUM_DAMPING_PER_MS = 0.009
const MOMENTUM_STOP_RAD_PER_MS = 0.00004
const MAX_VELOCITY_RAD_PER_MS = 0.012

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

const positionPolar = (sprite: Sprite, angle: number, radius: number): void => {
    sprite.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius)
}

const getWedgeIconTint = (state: ScheduleWedge['state']): number =>
    state === 'awake' ? BLUE_200 : BLUE_900

const drawSunRays = (graphics: Graphics, sunriseMin: number, sunsetMin: number): void => {
    graphics.clear()
    for (const minute of [sunriseMin, sunsetMin]) {
        const angle = minuteToDialAngle(minute)
        const cos = Math.cos(angle)
        const sin = Math.sin(angle)
        graphics
            .moveTo(cos * DIAL_SUN_RING_INNER_RADIUS, sin * DIAL_SUN_RING_INNER_RADIUS)
            .lineTo(cos * DIAL_SUN_RING_OUTER_RADIUS, sin * DIAL_SUN_RING_OUTER_RADIUS)
    }
    graphics.stroke({ width: 3.5, color: YELLOW_200, alpha: 0.85, cap: 'round' })
}

const drawNowMarker = (graphics: Graphics, minuteOfDay: number): void => {
    graphics.clear()
    const angle = minuteToDialAngle(minuteOfDay)
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const perpX = -sin
    const perpY = cos
    const tipR = DIAL_DISC_RADIUS + 4
    const baseR = DIAL_DISC_RADIUS + 20
    graphics
        .moveTo(cos * tipR, sin * tipR)
        .lineTo(cos * baseR + perpX * 10, sin * baseR + perpY * 10)
        .lineTo(cos * baseR - perpX * 10, sin * baseR - perpY * 10)
        .closePath()
        .fill({ color: YELLOW_200, alpha: 0.95 })
}

const positionBarrierIcons = (icons: BarrierIcons, sunriseMin: number, sunsetMin: number): void => {
    positionPolar(icons.sunrise, minuteToDialAngle(sunriseMin), DIAL_BARRIER_ICON_RADIUS)
    positionPolar(icons.sunset, minuteToDialAngle(sunsetMin), DIAL_BARRIER_ICON_RADIUS)
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
        selectedEventId = null,
        selectedWedgeId = null,
        onMinuteChange,
        onSelectEvent,
        onSelectWedge,
        onChangeEventMinute,
        onMoveWedge,
    }: DialProps) => {
        const circleRef = useRef<HTMLDivElement | null>(null)
        const hostRef = useRef<HTMLDivElement | null>(null)
        const appRef = useRef<Application | null>(null)
        const rotorRef = useRef<Container | null>(null)
        const meshRef = useRef<Mesh<Geometry, Shader> | null>(null)
        const raysRef = useRef<Graphics | null>(null)
        const northMarkerRef = useRef<Graphics | null>(null)
        const barrierIconsRef = useRef<BarrierIcons | null>(null)
        const wedgeIconsLayerRef = useRef<Container | null>(null)
        const wedgeSpritesRef = useRef<Map<string, Sprite>>(new Map())
        const wedgeTexturesRef = useRef<{ asleep: Texture; awake: Texture } | null>(null)
        const handlesLayerRef = useRef<Container | null>(null)
        const handleGraphicsRef = useRef<Graphics | null>(null)
        const handleSpritesRef = useRef<Map<string, HandleSpriteEntry>>(new Map())
        const handleTexturesRef = useRef<{ up: Texture; down: Texture } | null>(null)
        const renderRafRef = useRef<number | null>(null)
        const layoutCacheRef = useRef<{
            vh: number
            dialSize: number
            todayY: number
            scheduleY: number
        } | null>(null)

        const currentRotationRef = useRef<number>(0)
        const progressStateRef = useRef<{ value: number }>({
            value: getDialMode(activePage, hidden) === 'schedule' ? 1 : 0,
        })
        const transitionTweenRef = useRef<gsap.core.Tween | null>(null)
        const hideTweenRef = useRef<gsap.core.Tween | null>(null)
        const momentumRafRef = useRef<number | null>(null)
        const dragRef = useRef<DragState | null>(null)
        const handleDragRef = useRef<HandleDragState | null>(null)
        const wedgeDragRef = useRef<WedgeDragState | null>(null)
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

        const onSelectEventRef = useRef(onSelectEvent)
        onSelectEventRef.current = onSelectEvent

        const onSelectWedgeRef = useRef(onSelectWedge)
        onSelectWedgeRef.current = onSelectWedge

        const onChangeEventMinuteRef = useRef(onChangeEventMinute)
        onChangeEventMinuteRef.current = onChangeEventMinute

        const onMoveWedgeRef = useRef(onMoveWedge)
        onMoveWedgeRef.current = onMoveWedge

        const eventsRef = useRef(events)
        eventsRef.current = events

        const selectedEventIdRef = useRef(selectedEventId)
        selectedEventIdRef.current = selectedEventId

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
            const barrierIcons = barrierIconsRef.current
            if (barrierIcons) {
                barrierIcons.sunrise.rotation = -rad
                barrierIcons.sunset.rotation = -rad
            }
            for (const sprite of wedgeSpritesRef.current.values()) {
                sprite.rotation = -rad
            }
            for (const entry of handleSpritesRef.current.values()) {
                entry.icon.rotation = -rad
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

        const rebuildHandles = useCallback(() => {
            const layer = handlesLayerRef.current
            const graphics = handleGraphicsRef.current
            const textures = handleTexturesRef.current
            if (!layer || !graphics) return

            graphics.clear()

            const currentEvents = eventsRef.current
            const activeId = selectedEventIdRef.current
            const currentRad = currentRotationRef.current
            const existingSprites = handleSpritesRef.current
            const activeIds = new Set<string>()

            for (const event of currentEvents) {
                activeIds.add(event.id)
                const isSelected = event.id === activeId
                const angle = minuteToDialAngle(event.minuteOfDay)
                const cos = Math.cos(angle)
                const sin = Math.sin(angle)
                const nodeRadius = isSelected
                    ? DIAL_HANDLE_NODE_RADIUS + 4
                    : DIAL_HANDLE_NODE_RADIUS
                const spokeEnd = DIAL_HANDLE_RADIUS - nodeRadius

                graphics
                    .moveTo(cos * DIAL_INNER_RADIUS, sin * DIAL_INNER_RADIUS)
                    .lineTo(cos * spokeEnd, sin * spokeEnd)
                    .stroke({
                        width: isSelected ? 6 : 3.5,
                        color: isSelected ? YELLOW_200 : YELLOW_300,
                        alpha: isSelected ? 0.95 : 0.42,
                        cap: 'round',
                    })

                const nodeX = cos * DIAL_HANDLE_RADIUS
                const nodeY = sin * DIAL_HANDLE_RADIUS

                const fillColor = isSelected
                    ? YELLOW_200
                    : event.type === 'awake'
                      ? BLUE_900
                      : BLUE_200
                const strokeColor = isSelected
                    ? BLUE_100
                    : event.type === 'awake'
                      ? PURPLE_100
                      : YELLOW_200

                graphics
                    .circle(nodeX, nodeY, nodeRadius)
                    .fill({ color: fillColor })
                    .stroke({ width: isSelected ? 5 : 4, color: strokeColor })

                if (textures) {
                    const tex = event.type === 'awake' ? textures.up : textures.down
                    const iconTint = isSelected
                        ? BLUE_100
                        : event.type === 'awake'
                          ? PURPLE_100
                          : YELLOW_200
                    const iconSize = 56
                    const existing = existingSprites.get(event.id)
                    if (existing) {
                        if (existing.icon.texture !== tex) {
                            existing.icon.texture = tex
                        }
                        const scale = tex.height > 0 ? iconSize / tex.height : 1
                        existing.icon.scale.set(scale)
                        existing.icon.tint = iconTint
                        existing.icon.position.set(nodeX, nodeY)
                        existing.icon.rotation = -currentRad
                    } else {
                        const icon = createIconSprite(tex, iconSize, iconTint)
                        icon.position.set(nodeX, nodeY)
                        icon.rotation = -currentRad
                        layer.addChild(icon)
                        existingSprites.set(event.id, { eventId: event.id, icon })
                    }
                }
            }

            for (const [id, entry] of existingSprites) {
                if (!activeIds.has(id)) {
                    layer.removeChild(entry.icon)
                    entry.icon.destroy()
                    existingSprites.delete(id)
                }
            }

            requestRender()
        }, [requestRender])

        const rebuildWedgeIcons = useCallback(() => {
            const layer = wedgeIconsLayerRef.current
            const textures = wedgeTexturesRef.current
            if (!layer || !textures) return

            const currentWedges = wedgesRef.current
            const currentRad = currentRotationRef.current
            const existingSprites = wedgeSpritesRef.current
            const activeIds = new Set<string>()

            for (const wedge of currentWedges) {
                activeIds.add(wedge.id)
                const sweepMin = wedge.endMin - wedge.startMin
                const midMin = (wedge.startMin + wedge.endMin) / 2
                const midAngle = minuteToDialAngle(midMin)
                const arcLength =
                    (sweepMin / MINUTES_PER_DAY) * Math.PI * 2 * DIAL_WEDGE_ICON_RADIUS
                const iconSize = Math.min(WEDGE_ICON_MAX_SIZE, arcLength * WEDGE_ICON_ARC_FILL)
                const visible = iconSize >= WEDGE_ICON_MIN_SIZE
                const tex = wedge.state === 'asleep' ? textures.asleep : textures.awake
                const tint = getWedgeIconTint(wedge.state)

                const existing = existingSprites.get(wedge.id)
                if (existing) {
                    if (existing.texture !== tex) {
                        existing.texture = tex
                    }
                    const scale = tex.height > 0 ? iconSize / tex.height : 1
                    existing.scale.set(scale)
                    existing.tint = tint
                    existing.alpha = WEDGE_ICON_ALPHA
                    existing.visible = visible
                    positionPolar(existing, midAngle, DIAL_WEDGE_ICON_RADIUS)
                    existing.rotation = -currentRad
                } else {
                    const icon = createIconSprite(tex, iconSize, tint)
                    icon.alpha = WEDGE_ICON_ALPHA
                    icon.visible = visible
                    positionPolar(icon, midAngle, DIAL_WEDGE_ICON_RADIUS)
                    icon.rotation = -currentRad
                    layer.addChild(icon)
                    existingSprites.set(wedge.id, icon)
                }
            }

            for (const [id, sprite] of existingSprites) {
                if (!activeIds.has(id)) {
                    layer.removeChild(sprite)
                    sprite.destroy()
                    existingSprites.delete(id)
                }
            }

            requestRender()
        }, [requestRender])

        const measureLayoutMetrics = useCallback(() => {
            const vh = window.innerHeight
            const dialSize =
                circleRef.current?.offsetWidth || Math.min(window.innerWidth * 1.18, 672)
            // With transform-origin: center, top edge sits at y + dialSize * (1 - scale) / 2.
            const todayY = vh * TODAY_Y_RATIO + (dialSize * (TODAY_SCALE - 1)) / 2
            const scheduleY = vh * 0.5 - dialSize / 2
            const metrics = { vh, dialSize, todayY, scheduleY }
            layoutCacheRef.current = metrics
            return metrics
        }, [])

        const getLayoutMetrics = useCallback(
            () => layoutCacheRef.current ?? measureLayoutMetrics(),
            [measureLayoutMetrics],
        )

        const applyProgress = useCallback(
            (progress: number, syncRotation: boolean, preserveOpacity = false) => {
                const p = clamp01(progress)
                progressStateRef.current.value = p
                const circle = circleRef.current
                if (circle) {
                    const { todayY, scheduleY } = getLayoutMetrics()
                    const y = todayY + (scheduleY - todayY) * p
                    const scale = TODAY_SCALE + (SCHEDULE_SCALE - TODAY_SCALE) * p
                    gsap.set(circle, {
                        xPercent: -50,
                        y,
                        scale,
                        ...(preserveOpacity ? {} : { opacity: 1 }),
                        force3D: true,
                    })
                }
                // Fade schedule-only overlays (radial handles & north marker) in smoothly on Schedule
                const scheduleOverlayAlpha = clamp01((p - 0.35) / 0.65)
                if (handlesLayerRef.current) {
                    handlesLayerRef.current.alpha = scheduleOverlayAlpha
                }
                if (northMarkerRef.current) {
                    northMarkerRef.current.alpha = scheduleOverlayAlpha
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
            [applyProgress, applyRotationAndRender, getLayoutMetrics, killAnimations],
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
                if (northMarkerRef.current) {
                    drawNowMarker(northMarkerRef.current, nowMin)
                }
                if (
                    modeRef.current === 'today' &&
                    !scrubbingRef.current &&
                    !transitionTweenRef.current
                ) {
                    applyRotationAndRender(getTodayRotationRad(nowMin), true)
                } else {
                    if (modeRef.current === 'schedule') {
                        requestRender()
                    }
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

                if (
                    !dragRef.current &&
                    !handleDragRef.current &&
                    !wedgeDragRef.current &&
                    momentumRafRef.current === null
                ) {
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
        }, [devMode.enabled, devMode.speedMultiplier, applyRotationAndRender, requestRender])

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

                const geometry = buildDialGeometry(wedgesRef.current, DIAL_DISC_RADIUS)
                const shader = createDialShader(
                    sunTimesRef.current.sunriseMinuteOfDay,
                    sunTimesRef.current.sunsetMinuteOfDay,
                )
                const mesh = new Mesh({ geometry, shader })
                meshRef.current = mesh

                const rays = new Graphics()
                raysRef.current = rays
                drawSunRays(
                    rays,
                    sunTimesRef.current.sunriseMinuteOfDay,
                    sunTimesRef.current.sunsetMinuteOfDay,
                )

                const wedgeIconsLayer = new Container()
                wedgeIconsLayerRef.current = wedgeIconsLayer

                const handlesLayer = new Container()
                const handleGraphics = new Graphics()
                handlesLayer.addChild(handleGraphics)
                handlesLayerRef.current = handlesLayer
                handleGraphicsRef.current = handleGraphics

                const northMarker = new Graphics()
                drawNowMarker(northMarker, currentMinuteRef.current)
                northMarkerRef.current = northMarker

                rotor.addChild(mesh, rays, wedgeIconsLayer, northMarker, handlesLayer)
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

                const [sunriseTex, sunsetTex, upTex, downTex, asleepTex, awakeTex] =
                    await Promise.all([
                        loadTintedSvgTexture('/icons/sunrise.svg'),
                        loadTintedSvgTexture('/icons/sunset.svg'),
                        loadTintedSvgTexture('/icons/up.svg'),
                        loadTintedSvgTexture('/icons/down.svg'),
                        loadTintedSvgTexture('/icons/asleep.svg'),
                        loadTintedSvgTexture('/icons/awake.svg'),
                    ])

                if (cancelled) {
                    for (const tex of [
                        sunriseTex,
                        sunsetTex,
                        upTex,
                        downTex,
                        asleepTex,
                        awakeTex,
                    ]) {
                        tex.destroy(true)
                    }
                    return
                }

                loadedTextures.push(sunriseTex, sunsetTex, upTex, downTex, asleepTex, awakeTex)
                handleTexturesRef.current = { up: upTex, down: downTex }
                wedgeTexturesRef.current = { asleep: asleepTex, awake: awakeTex }

                const barrierIcons: BarrierIcons = {
                    sunrise: createIconSprite(sunriseTex, 56, YELLOW_200),
                    sunset: createIconSprite(sunsetTex, 56, YELLOW_200),
                }
                barrierIconsRef.current = barrierIcons

                positionBarrierIcons(
                    barrierIcons,
                    sunTimesRef.current.sunriseMinuteOfDay,
                    sunTimesRef.current.sunsetMinuteOfDay,
                )

                // Place barrier icons above rays and below radial handles
                rotor.addChildAt(barrierIcons.sunrise, 2)
                rotor.addChildAt(barrierIcons.sunset, 3)

                rebuildWedgeIcons()
                rebuildHandles()
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
                meshRef.current = null
                raysRef.current = null
                northMarkerRef.current = null
                barrierIconsRef.current = null
                wedgeIconsLayerRef.current = null
                wedgeSpritesRef.current.clear()
                wedgeTexturesRef.current = null
                handlesLayerRef.current = null
                handleGraphicsRef.current = null
                handleSpritesRef.current.clear()
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
            killAnimations,
            measureLayoutMetrics,
            rebuildHandles,
            rebuildWedgeIcons,
            requestRender,
        ])

        useEffect(() => {
            const mesh = meshRef.current
            const app = appRef.current
            if (!mesh || !app) return

            const prevGeometry = mesh.geometry
            mesh.geometry = buildDialGeometry(wedges, DIAL_DISC_RADIUS)
            prevGeometry.destroy()
            rebuildWedgeIcons()
            rebuildHandles()
            app.render()
        }, [wedges, rebuildHandles, rebuildWedgeIcons])

        useEffect(() => {
            rebuildHandles()
        }, [selectedEventId, rebuildHandles])

        useEffect(() => {
            const app = appRef.current
            const rays = raysRef.current
            if (!app || !rays) return

            drawSunRays(rays, sunTimes.sunriseMinuteOfDay, sunTimes.sunsetMinuteOfDay)
            const mesh = meshRef.current
            const sunUniforms = mesh?.shader?.resources?.sunUniforms as
                | { uniforms: { uSunriseMin: number; uSunsetMin: number } }
                | undefined
            if (sunUniforms) {
                sunUniforms.uniforms.uSunriseMin = sunTimes.sunriseMinuteOfDay
                sunUniforms.uniforms.uSunsetMin = sunTimes.sunsetMinuteOfDay
            }
            const barrierIcons = barrierIconsRef.current
            if (barrierIcons) {
                positionBarrierIcons(
                    barrierIcons,
                    sunTimes.sunriseMinuteOfDay,
                    sunTimes.sunsetMinuteOfDay,
                )
            }
            rebuildWedgeIcons()
            app.render()
        }, [sunTimes.sunriseMinuteOfDay, sunTimes.sunsetMinuteOfDay, rebuildWedgeIcons])

        useEffect(() => {
            manualControlRef.current = false
            animateTo(mode)
        }, [mode, animateTo])

        const findHitHandle = (clientX: number, clientY: number, rect: DOMRect): string | null => {
            const local = clientToRotorLocal(clientX, clientY, rect, currentRotationRef.current)
            let bestId: string | null = null
            let bestDist = DIAL_HANDLE_HIT_RADIUS

            for (const event of eventsRef.current) {
                const angle = minuteToDialAngle(event.minuteOfDay)
                const hx = Math.cos(angle) * DIAL_HANDLE_RADIUS
                const hy = Math.sin(angle) * DIAL_HANDLE_RADIUS
                const dist = Math.hypot(local.x - hx, local.y - hy)
                if (dist <= bestDist) {
                    bestDist = dist
                    bestId = event.id
                }
            }
            return bestId
        }

        const findHitWedge = (
            clientX: number,
            clientY: number,
            rect: DOMRect,
        ): ScheduleWedge | null => {
            const local = clientToRotorLocal(clientX, clientY, rect, currentRotationRef.current)
            const dist = Math.hypot(local.x, local.y)
            if (dist < DIAL_INNER_RADIUS - 12 || dist > DIAL_DISC_RADIUS + 12) return null

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

            // In Schedule mode, check handles before edge-swipe guard so left-edge handles
            // (e.g. Morning Wake around 6-7 AM) remain freely draggable on narrow screens.
            if (modeRef.current === 'schedule') {
                const hitEventId = findHitHandle(event.clientX, event.clientY, rect)
                if (hitEventId) {
                    killAnimations()
                    setIsDragging(true)
                    circle.setPointerCapture(event.pointerId)
                    handleDragRef.current = {
                        pointerId: event.pointerId,
                        eventId: hitEventId,
                        startX: event.clientX,
                        startY: event.clientY,
                        rect,
                        lastMinute: null,
                        moved: false,
                    }
                    return
                }

                if (event.pointerType === 'touch' && event.clientX <= EDGE_SWIPE_GUARD_PX) return

                const hitWedge = findHitWedge(event.clientX, event.clientY, rect)
                if (hitWedge) {
                    const local = clientToRotorLocal(
                        event.clientX,
                        event.clientY,
                        rect,
                        currentRotationRef.current,
                    )
                    killAnimations()
                    setIsDragging(true)
                    circle.setPointerCapture(event.pointerId)
                    wedgeDragRef.current = {
                        pointerId: event.pointerId,
                        startEventId: hitWedge.id,
                        initialStartMinute: hitWedge.startMin,
                        startX: event.clientX,
                        startY: event.clientY,
                        lastAngle: Math.atan2(local.y, local.x),
                        cumulativeRad: 0,
                        rect,
                        lastTargetStart: null,
                        moved: false,
                    }
                    return
                }

                // Tapping outside handles and wedges clears selection.
                if (selectedEventIdRef.current) {
                    onSelectEventRef.current?.(null)
                }
                if (selectedWedgeIdRef.current) {
                    onSelectWedgeRef.current?.(null)
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
            const handleDrag = handleDragRef.current
            if (handleDrag && handleDrag.pointerId === event.pointerId) {
                const circle = circleRef.current
                if (!circle) return

                if (!handleDrag.moved) {
                    const movedDist = Math.hypot(
                        event.clientX - handleDrag.startX,
                        event.clientY - handleDrag.startY,
                    )
                    if (movedDist < HANDLE_DRAG_THRESHOLD_PX) return
                    handleDrag.moved = true
                    onSelectEventRef.current?.(handleDrag.eventId)
                }

                const local = clientToRotorLocal(
                    event.clientX,
                    event.clientY,
                    handleDrag.rect,
                    currentRotationRef.current,
                )
                const snappedMinute = snapMinuteOfDay(
                    dialAngleToMinute(Math.atan2(local.y, local.x)),
                )
                if (snappedMinute !== handleDrag.lastMinute) {
                    handleDrag.lastMinute = snappedMinute
                    onChangeEventMinuteRef.current?.(handleDrag.eventId, snappedMinute)
                }
                return
            }

            const wedgeDrag = wedgeDragRef.current
            if (wedgeDrag && wedgeDrag.pointerId === event.pointerId) {
                const local = clientToRotorLocal(
                    event.clientX,
                    event.clientY,
                    wedgeDrag.rect,
                    currentRotationRef.current,
                )
                const angle = Math.atan2(local.y, local.x)
                wedgeDrag.cumulativeRad += shortestAngleDelta(wedgeDrag.lastAngle, angle)
                wedgeDrag.lastAngle = angle

                if (!wedgeDrag.moved) {
                    const movedDist = Math.hypot(
                        event.clientX - wedgeDrag.startX,
                        event.clientY - wedgeDrag.startY,
                    )
                    if (movedDist < HANDLE_DRAG_THRESHOLD_PX) return
                    wedgeDrag.moved = true
                    onSelectEventRef.current?.(null)
                    onSelectWedgeRef.current?.(wedgeDrag.startEventId)
                }

                const rawDeltaMin = (wedgeDrag.cumulativeRad / (Math.PI * 2)) * MINUTES_PER_DAY
                const snappedDeltaMin = Math.round(rawDeltaMin / SNAP_STEP_MIN) * SNAP_STEP_MIN
                const targetStart = normalizeMinuteOfDay(
                    wedgeDrag.initialStartMinute + snappedDeltaMin,
                )
                if (targetStart !== wedgeDrag.lastTargetStart) {
                    wedgeDrag.lastTargetStart = targetStart
                    onMoveWedgeRef.current?.(wedgeDrag.startEventId, targetStart)
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
                if (northMarkerRef.current) {
                    drawNowMarker(northMarkerRef.current, currentMinuteRef.current)
                }
            }
            applyRotationAndRender(nextRad, modeRef.current === 'today')
        }

        const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
            const handleDrag = handleDragRef.current
            if (handleDrag && handleDrag.pointerId === event.pointerId) {
                handleDragRef.current = null
                setIsDragging(false)
                const circle = circleRef.current
                if (circle?.hasPointerCapture(event.pointerId)) {
                    circle.releasePointerCapture(event.pointerId)
                }
                if (!handleDrag.moved) {
                    const nextSelection =
                        selectedEventIdRef.current === handleDrag.eventId
                            ? null
                            : handleDrag.eventId
                    onSelectEventRef.current?.(nextSelection)
                }
                return
            }

            const wedgeDrag = wedgeDragRef.current
            if (wedgeDrag && wedgeDrag.pointerId === event.pointerId) {
                wedgeDragRef.current = null
                setIsDragging(false)
                const circle = circleRef.current
                if (circle?.hasPointerCapture(event.pointerId)) {
                    circle.releasePointerCapture(event.pointerId)
                }
                if (!wedgeDrag.moved) {
                    onSelectEventRef.current?.(null)
                    const nextWedge =
                        selectedWedgeIdRef.current === wedgeDrag.startEventId
                            ? null
                            : wedgeDrag.startEventId
                    onSelectWedgeRef.current?.(nextWedge)
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

            // Quick tap on the dial body in Schedule mode clears handle selection.
            if (!drag.moved && modeRef.current === 'schedule' && selectedEventIdRef.current) {
                onSelectEventRef.current?.(null)
                return
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
                    if (northMarkerRef.current) {
                        drawNowMarker(northMarkerRef.current, currentMinuteRef.current)
                    }
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
                    <div ref={hostRef} className={styles.rotor} />
                </div>
            </div>
        )
    },
)
