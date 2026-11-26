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
    PLACEHOLDER_SCHEDULE_EVENTS,
    type ScheduleEvent,
} from '#src/data/schedule.ts'
import { useSunLocation } from '#src/lib/sun.ts'
import { epochToZonedDateTime } from '#src/lib/temporal.ts'
import type { PageId } from '#src/pages/pages.ts'
import styles from './Dial.module.scss'
import {
    buildDialGeometry,
    createDialShader,
    DIAL_CANVAS_SIZE,
    DIAL_DISC_RADIUS,
    DIAL_ICON_RADIUS,
    DIAL_RAY_END_RADIUS,
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
    events?: readonly ScheduleEvent[]
    onMinuteChange?: (minuteOfDay: number) => void
}

interface DialIcons {
    sun: Sprite
    moon: Sprite
    sunrise: Sprite
    sunset: Sprite
}

interface DragState {
    pointerId: number
    centerX: number
    centerY: number
    lastAngle: number
    lastTime: number
    velocityRadPerMs: number
}

const NOON_MINUTE = 720
const MIDNIGHT_MINUTE = 0
const TODAY_SCALE = 1.4
const TODAY_Y_RATIO = 0.72
const SCHEDULE_SCALE = 0.62
const TRANSITION_DURATION_SEC = 0.9
const HIDDEN_DURATION_SEC = 0.45
const ACCENT_TINT = 0xffc200
const WHITE_TINT = 0xffffff
const EDGE_SWIPE_GUARD_PX = 36
const MOMENTUM_DAMPING_PER_MS = 0.009
const MOMENTUM_STOP_RAD_PER_MS = 0.00004
const MAX_VELOCITY_RAD_PER_MS = 0.012

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value))

const getDialMode = (activePage: PageId): DialMode => {
    if (activePage === 'today' || activePage === 'schedule') {
        return activePage
    }
    return 'hidden'
}

const getCurrentMinuteOfDay = (epochMs: number): number => {
    const zdt = epochToZonedDateTime(epochMs)
    return zdt.hour * 60 + zdt.minute
}

const getTodayRotationRad = (minuteOfDay: number): number =>
    -((minuteOfDay - NOON_MINUTE) / MINUTES_PER_DAY) * Math.PI * 2

const rotationRadToMinuteOfDay = (rad: number): number => {
    const raw = NOON_MINUTE - (rad / (Math.PI * 2)) * MINUTES_PER_DAY
    return ((Math.round(raw) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
}

const shortestAngleDelta = (from: number, to: number): number => {
    const tau = Math.PI * 2
    return ((((to - from + Math.PI) % tau) + tau) % tau) - Math.PI
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
        return Texture.from(img)
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

const drawSunRays = (graphics: Graphics, sunriseMin: number, sunsetMin: number): void => {
    graphics.clear()
    for (const minute of [sunriseMin, sunsetMin]) {
        const angle = minuteToDialAngle(minute)
        graphics
            .moveTo(0, 0)
            .lineTo(Math.cos(angle) * DIAL_RAY_END_RADIUS, Math.sin(angle) * DIAL_RAY_END_RADIUS)
    }
    graphics.stroke({ width: 6, color: WHITE_TINT, alpha: 0.95, cap: 'round' })
}

export const Dial = ({
    ref,
    activePage,
    events = PLACEHOLDER_SCHEDULE_EVENTS,
    onMinuteChange,
}: DialProps) => {
    const circleRef = useRef<HTMLDivElement | null>(null)
    const hostRef = useRef<HTMLDivElement | null>(null)
    const appRef = useRef<Application | null>(null)
    const rotorRef = useRef<Container | null>(null)
    const meshRef = useRef<Mesh<Geometry, Shader> | null>(null)
    const raysRef = useRef<Graphics | null>(null)
    const iconsRef = useRef<DialIcons | null>(null)

    const currentRotationRef = useRef<number>(0)
    const progressStateRef = useRef<{ value: number }>({
        value: getDialMode(activePage) === 'schedule' ? 1 : 0,
    })
    const transitionTweenRef = useRef<gsap.core.Tween | null>(null)
    const hideTweenRef = useRef<gsap.core.Tween | null>(null)
    const momentumRafRef = useRef<number | null>(null)
    const dragRef = useRef<DragState | null>(null)
    const manualControlRef = useRef<boolean>(false)
    const scrubbingRef = useRef<boolean>(false)
    const lastEmittedMinuteRef = useRef<number | null>(null)

    const [isDragging, setIsDragging] = useState(false)
    const [minuteOfDay, setMinuteOfDay] = useState<number>(() => getCurrentMinuteOfDay(Date.now()))
    const minuteOfDayRef = useRef(minuteOfDay)
    minuteOfDayRef.current = minuteOfDay

    const { sunTimes } = useSunLocation()
    const sunTimesRef = useRef(sunTimes)
    sunTimesRef.current = sunTimes

    const onMinuteChangeRef = useRef(onMinuteChange)
    onMinuteChangeRef.current = onMinuteChange

    const wedges = useMemo(() => buildScheduleWedges(events), [events])
    const wedgesRef = useRef(wedges)
    wedgesRef.current = wedges

    const mode = getDialMode(activePage)
    const modeRef = useRef(mode)
    modeRef.current = mode

    const emitMinuteForRad = useCallback((rad: number) => {
        const min = rotationRadToMinuteOfDay(rad)
        if (lastEmittedMinuteRef.current !== min) {
            lastEmittedMinuteRef.current = min
            onMinuteChangeRef.current?.(min)
        }
    }, [])

    const applyRotationAndRender = useCallback(
        (rad: number) => {
            currentRotationRef.current = rad
            const rotor = rotorRef.current
            if (rotor) {
                rotor.rotation = rad
            }
            const icons = iconsRef.current
            if (icons) {
                icons.sun.rotation = -rad
                icons.moon.rotation = -rad
                icons.sunrise.rotation = -rad
                icons.sunset.rotation = -rad
            }
            appRef.current?.render()
            emitMinuteForRad(rad)
        },
        [emitMinuteForRad],
    )

    const getLayoutMetrics = useCallback(() => {
        const vh = window.innerHeight
        const dialSize = circleRef.current?.offsetWidth || Math.min(window.innerWidth * 1.18, 672)
        const todayY = vh * TODAY_Y_RATIO
        const scheduleY = vh * 0.5 - (dialSize * SCHEDULE_SCALE) / 2
        return { vh, todayY, scheduleY }
    }, [])

    const applyProgress = useCallback(
        (progress: number, syncRotation: boolean) => {
            const p = clamp01(progress)
            progressStateRef.current.value = p
            const circle = circleRef.current
            if (circle) {
                const { todayY, scheduleY } = getLayoutMetrics()
                const y = todayY + (scheduleY - todayY) * p
                const scale = TODAY_SCALE + (SCHEDULE_SCALE - TODAY_SCALE) * p
                gsap.set(circle, { xPercent: -50, y, scale, opacity: 1, force3D: true })
            }
            if (syncRotation) {
                const todayRad = getTodayRotationRad(minuteOfDayRef.current)
                const delta = shortestAngleDelta(todayRad, 0)
                applyRotationAndRender(todayRad + delta * p)
            }
        },
        [applyRotationAndRender, getLayoutMetrics],
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
                const { vh } = getLayoutMetrics()
                hideTweenRef.current = gsap.to(circle, {
                    xPercent: -50,
                    y: vh * 1.02,
                    scale: 0.85,
                    opacity: 0,
                    duration: durationSec ?? HIDDEN_DURATION_SEC,
                    ease: 'power3.out',
                    force3D: true,
                })
                return
            }

            const targetProgress = target === 'schedule' ? 1 : 0
            const startProgress = progressStateRef.current.value
            const distance = Math.abs(targetProgress - startProgress)
            const duration =
                durationSec ?? Math.max(0.25, TRANSITION_DURATION_SEC * Math.max(0.35, distance))

            const startRad = currentRotationRef.current
            const targetRad =
                target === 'schedule' ? 0 : getTodayRotationRad(minuteOfDayRef.current)
            const deltaRad = shortestAngleDelta(startRad, targetRad)
            const shouldRotate =
                target === 'today' || (target === 'schedule' && !manualControlRef.current)
            const tweenState = { t: 0 }

            transitionTweenRef.current = gsap.to(tweenState, {
                t: 1,
                duration,
                ease: 'power3.out',
                onUpdate: () => {
                    const p = startProgress + (targetProgress - startProgress) * tweenState.t
                    applyProgress(p, false)
                    if (shouldRotate) {
                        applyRotationAndRender(startRad + deltaRad * tweenState.t)
                    }
                },
                onComplete: () => {
                    transitionTweenRef.current = null
                    applyProgress(targetProgress, false)
                    if (shouldRotate) {
                        applyRotationAndRender(targetRad)
                    }
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
        let timeoutId: number | null = null

        const scheduleNextTick = () => {
            const now = Date.now()
            setMinuteOfDay(getCurrentMinuteOfDay(now))
            const msUntilNextSecond = 1000 - (now % 1000)
            timeoutId = window.setTimeout(scheduleNextTick, msUntilNextSecond)
        }

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                if (timeoutId !== null) window.clearTimeout(timeoutId)
                scheduleNextTick()
            }
        }

        const now = Date.now()
        timeoutId = window.setTimeout(scheduleNextTick, 1000 - (now % 1000))
        document.addEventListener('visibilitychange', handleVisibilityChange)

        return () => {
            if (timeoutId !== null) window.clearTimeout(timeoutId)
            document.removeEventListener('visibilitychange', handleVisibilityChange)
        }
    }, [])

    useEffect(() => {
        const host = hostRef.current
        if (!host) return

        let cancelled = false
        let initialized = false
        const app = new Application()
        const loadedTextures: Texture[] = []

        const init = async () => {
            await app.init({
                width: DIAL_CANVAS_SIZE,
                height: DIAL_CANVAS_SIZE,
                backgroundAlpha: 0,
                antialias: true,
                autoDensity: false,
                autoStart: false,
                resolution: Math.min(window.devicePixelRatio || 1, 2),
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

            rotor.addChild(mesh, rays)
            app.stage.addChild(rotor)

            if (modeRef.current === 'hidden') {
                const circle = circleRef.current
                if (circle) {
                    gsap.set(circle, {
                        xPercent: -50,
                        y: window.innerHeight * 1.02,
                        scale: 0.85,
                        opacity: 0,
                        force3D: true,
                    })
                }
            } else {
                applyProgress(modeRef.current === 'schedule' ? 1 : 0, true)
            }

            const [sunTex, moonTex, sunriseTex, sunsetTex] = await Promise.all([
                loadTintedSvgTexture('/icons/sun.svg'),
                loadTintedSvgTexture('/icons/moon.svg'),
                loadTintedSvgTexture('/icons/sunrise.svg'),
                loadTintedSvgTexture('/icons/sunset.svg'),
            ])

            if (cancelled) {
                for (const tex of [sunTex, moonTex, sunriseTex, sunsetTex]) {
                    tex.destroy(true)
                }
                return
            }

            loadedTextures.push(sunTex, moonTex, sunriseTex, sunsetTex)

            const icons: DialIcons = {
                sun: createIconSprite(sunTex, 68, ACCENT_TINT),
                moon: createIconSprite(moonTex, 56, ACCENT_TINT),
                sunrise: createIconSprite(sunriseTex, 86, ACCENT_TINT),
                sunset: createIconSprite(sunsetTex, 86, ACCENT_TINT),
            }
            iconsRef.current = icons

            positionPolar(icons.sun, minuteToDialAngle(NOON_MINUTE), DIAL_ICON_RADIUS)
            positionPolar(icons.moon, minuteToDialAngle(MIDNIGHT_MINUTE), DIAL_ICON_RADIUS)
            positionPolar(
                icons.sunrise,
                minuteToDialAngle(sunTimesRef.current.sunriseMinuteOfDay),
                DIAL_ICON_RADIUS,
            )
            positionPolar(
                icons.sunset,
                minuteToDialAngle(sunTimesRef.current.sunsetMinuteOfDay),
                DIAL_ICON_RADIUS,
            )

            rotor.addChild(icons.sun, icons.moon, icons.sunrise, icons.sunset)
            applyRotationAndRender(currentRotationRef.current)
        }

        init()

        const handleResize = () => {
            if (modeRef.current !== 'hidden') {
                applyProgress(progressStateRef.current.value, false)
            }
        }
        window.addEventListener('resize', handleResize)

        return () => {
            cancelled = true
            window.removeEventListener('resize', handleResize)
            killAnimations()
            meshRef.current = null
            raysRef.current = null
            iconsRef.current = null
            rotorRef.current = null
            appRef.current = null
            for (const tex of loadedTextures) {
                tex.destroy(true)
            }
            if (initialized) {
                app.destroy(true, { children: true })
            }
        }
    }, [applyProgress, applyRotationAndRender, killAnimations])

    useEffect(() => {
        const mesh = meshRef.current
        const app = appRef.current
        if (!mesh || !app) return

        const prevGeometry = mesh.geometry
        mesh.geometry = buildDialGeometry(wedges, DIAL_DISC_RADIUS)
        prevGeometry.destroy()
        app.render()
    }, [wedges])

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
        const icons = iconsRef.current
        if (icons) {
            positionPolar(
                icons.sunrise,
                minuteToDialAngle(sunTimes.sunriseMinuteOfDay),
                DIAL_ICON_RADIUS,
            )
            positionPolar(
                icons.sunset,
                minuteToDialAngle(sunTimes.sunsetMinuteOfDay),
                DIAL_ICON_RADIUS,
            )
        }
        app.render()
    }, [sunTimes.sunriseMinuteOfDay, sunTimes.sunsetMinuteOfDay])

    useEffect(() => {
        manualControlRef.current = false
        animateTo(mode)
    }, [mode, animateTo])

    useEffect(() => {
        if (mode !== 'today' || scrubbingRef.current || transitionTweenRef.current) return
        applyRotationAndRender(getTodayRotationRad(minuteOfDay))
    }, [minuteOfDay, mode, applyRotationAndRender])

    const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (mode !== 'schedule') return
        if (event.pointerType === 'touch' && event.clientX <= EDGE_SWIPE_GUARD_PX) return

        const circle = circleRef.current
        if (!circle) return

        const rect = circle.getBoundingClientRect()
        const centerX = rect.left + rect.width / 2
        const centerY = rect.top + rect.height / 2
        const dist = Math.hypot(event.clientX - centerX, event.clientY - centerY)
        if (dist > rect.width * 0.65) return

        killAnimations()
        manualControlRef.current = true
        setIsDragging(true)
        circle.setPointerCapture(event.pointerId)

        dragRef.current = {
            pointerId: event.pointerId,
            centerX,
            centerY,
            lastAngle: Math.atan2(event.clientY - centerY, event.clientX - centerX),
            lastTime: performance.now(),
            velocityRadPerMs: 0,
        }
    }

    const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current
        if (!drag || drag.pointerId !== event.pointerId) return

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

        applyRotationAndRender(currentRotationRef.current + delta)
    }

    const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current
        if (!drag || drag.pointerId !== event.pointerId) return

        dragRef.current = null
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

            applyRotationAndRender(currentRotationRef.current + velocity * dt)
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
                data-dial-interactive={mode === 'schedule'}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}>
                <div ref={hostRef} className={styles.rotor} />
            </div>
        </div>
    )
}
