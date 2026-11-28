import { Geometry, Shader } from 'pixi.js'
import { MINUTES_PER_DAY, type ScheduleWedge } from '#src/data/schedule.ts'
import { DIAL_COLORS, hexToGlslVec3 } from '#src/styles/palette.ts'

export const DIAL_CANVAS_SIZE = 1120
export const DIAL_DISC_RADIUS = 420
export const DIAL_RING_INNER_RATIO = 0.26
export const DIAL_RING_OUTER_RATIO = 0.82
export const DIAL_RING_INNER_RADIUS = Math.round(DIAL_DISC_RADIUS * DIAL_RING_INNER_RATIO)
export const DIAL_RING_OUTER_RADIUS = Math.round(DIAL_DISC_RADIUS * DIAL_RING_OUTER_RATIO)
export const DIAL_SUN_DISC_OUTER_RATIO = 0.23
export const DIAL_SUN_DISC_INNER_RATIO = 0.0
const DIAL_AXIS_ICON_RATIO = 0.08
export const DIAL_AXIS_ICON_RADIUS = Math.round(DIAL_DISC_RADIUS * DIAL_AXIS_ICON_RATIO)
export const DIAL_AXIS_ICON_SIZE = 40
export const DIAL_HANDLE_RING_OFFSET = 45
export const DIAL_HANDLE_RING_RADIUS = DIAL_RING_OUTER_RADIUS + DIAL_HANDLE_RING_OFFSET
export const DIAL_HANDLE_RADIUS = 22
export const DIAL_ANCHOR_RADIUS = DIAL_HANDLE_RADIUS
export const DIAL_HANDLE_ICON_SIZE = 39
export const DIAL_HANDLE_STROKE_WIDTH = 3
export const DIAL_HANDLE_SELECTED_STROKE_WIDTH = 4
export const DIAL_HANDLE_SELECTED_RING_GAP = 7
export const DIAL_HANDLE_SELECTED_RING_RADIUS =
    DIAL_HANDLE_RADIUS +
    DIAL_HANDLE_STROKE_WIDTH * 0.5 +
    DIAL_HANDLE_SELECTED_RING_GAP +
    DIAL_HANDLE_SELECTED_STROKE_WIDTH * 0.5
export const DIAL_WEDGE_STROKE_WIDTH = 5

const NOON_MINUTE = 720
// Fragment shader computes exact polar radius/angle per pixel, so 6-degree chords stay well within
// the 2px radial pad while halving vertex/index buffer rebuild cost during drag.
const MAX_RADIANS_PER_SEGMENT = (6 * Math.PI) / 180
const NIGHT_WAKE_STRIPE_PERIOD_PX = 21
const RING_MESH_PAD_PX = 2
const RING_MESH_INNER_RATIO = Math.max(
    0.05,
    DIAL_RING_INNER_RATIO - RING_MESH_PAD_PX / DIAL_DISC_RADIUS,
)
const RING_MESH_OUTER_RATIO = DIAL_RING_OUTER_RATIO + RING_MESH_PAD_PX / DIAL_DISC_RADIUS
const SUN_MESH_EXTENT_RATIO = DIAL_SUN_DISC_OUTER_RATIO + 0.02

const glslFloat = (value: number): string => value.toFixed(4)

const VERTEX_SHADER = `#version 300 es
precision highp float;

in vec2 aPosition;
in vec2 aLocal;
in float aWedgeKind;
in float aStartAngle;
in float aSweep;
in float aPrevSelected;
in float aSelected;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;

out vec2 vLocal;
out vec2 vScreenPos;
out float vWedgeKind;
out float vStartAngle;
out float vSweep;
out float vPrevSelected;
out float vSelected;

void main() {
    vLocal = aLocal;
    vWedgeKind = aWedgeKind;
    vStartAngle = aStartAngle;
    vSweep = aSweep;
    vPrevSelected = aPrevSelected;
    vSelected = aSelected;
    vec2 worldPos = (uWorldTransformMatrix * uTransformMatrix * vec3(aPosition, 1.0)).xy;
    vScreenPos = worldPos;
    gl_Position = vec4((uProjectionMatrix * vec3(worldPos, 1.0)).xy, 0.0, 1.0);
}
`

const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 vLocal;
in vec2 vScreenPos;
in float vWedgeKind;
in float vStartAngle;
in float vSweep;
in float vPrevSelected;
in float vSelected;

uniform float uSunriseMin;
uniform float uSunsetMin;
uniform float uSelectionProgress;
uniform float uDimProgress;

out vec4 fragColor;

void main() {
    float dist = length(vLocal);
    float distPx = dist * ${glslFloat(DIAL_DISC_RADIUS)};
    float aa = max(fwidth(dist), 0.002);
    float aaPx = max(fwidth(distPx), 0.8);

    // Center sun disc (aWedgeKind < -0.5)
    if (vWedgeKind < -0.5) {
        float sunOuterRatio = ${glslFloat(DIAL_SUN_DISC_OUTER_RATIO)};
        float sunInnerRatio = ${glslFloat(DIAL_SUN_DISC_INNER_RATIO)};
        float sunInnerMask = sunInnerRatio > 0.0001
            ? smoothstep(sunInnerRatio - aa, sunInnerRatio + aa, dist)
            : 1.0;
        float sunAlpha =
            (1.0 - smoothstep(sunOuterRatio - aa, sunOuterRatio + aa, dist)) * sunInnerMask;
        if (sunAlpha <= 0.001) discard;

        float angle = atan(vLocal.y, vLocal.x);
        float minOfDay = mod(((angle + 1.5707963268) / 6.2831853072) * 1440.0 + 720.0, 1440.0);
        float isDay = uSunriseMin <= uSunsetMin
            ? step(uSunriseMin, minOfDay) * step(minOfDay, uSunsetMin)
            : max(step(uSunriseMin, minOfDay), step(minOfDay, uSunsetMin));
        vec3 sunColor = mix(
            ${hexToGlslVec3(DIAL_COLORS.sunDiscNight.color)},
            ${hexToGlslVec3(DIAL_COLORS.sunDiscDay.color)},
            isDay
        );
        float sunOpacity = mix(
            ${glslFloat(DIAL_COLORS.sunDiscNight.alpha)},
            ${glslFloat(DIAL_COLORS.sunDiscDay.alpha)},
            isDay
        );
        float finalSunAlpha = sunAlpha * sunOpacity;
        if (finalSunAlpha <= 0.001) discard;
        fragColor = vec4(sunColor * finalSunAlpha, finalSunAlpha);
        return;
    }

    float innerPx = ${glslFloat(DIAL_RING_INNER_RADIUS)};
    float outerPx = ${glslFloat(DIAL_RING_OUTER_RADIUS)};
    float strokeW = ${glslFloat(DIAL_WEDGE_STROKE_WIDTH)};

    float ringMask =
        smoothstep(innerPx - aaPx, innerPx + aaPx, distPx) *
        (1.0 - smoothstep(outerPx - aaPx, outerPx + aaPx, distPx));
    if (ringMask <= 0.001) discard;

    float fragAngle = atan(vLocal.y, vLocal.x);
    float halfSweep = vSweep * 0.5;
    float midAngle = vStartAngle + halfSweep;
    float offsetFromMid = mod(fragAngle - midAngle + 3.1415926536, 6.2831853072) - 3.1415926536;
    float startEdgePx = max(0.0, offsetFromMid + halfSweep) * distPx;
    float endEdgePx = max(0.0, halfSweep - offsetFromMid) * distPx;

    float radialT = clamp(
        (distPx - innerPx) / max(1.0, outerPx - innerPx),
        0.0,
        1.0
    );
    float sel = mix(vPrevSelected, vSelected, uSelectionProgress);
    float dimFactor = mix(1.0, ${glslFloat(DIAL_COLORS.unselectedAlphaScale)}, (1.0 - sel) * uDimProgress);

    vec3 fillInnerColor;
    vec3 fillOuterColor;
    float fillInnerA;
    float fillOuterA;
    vec3 strokeInnerColor;
    vec3 strokeOuterColor;
    float strokeInnerA;
    float strokeOuterA;
    // Wedge kinds: 0 = Day Wake, 1 = Night Sleep, 2 = Night Wake (striped), 3 = Day Nap (striped)
    bool isStriped = vWedgeKind > 1.5;

    if (vWedgeKind < 0.5) {
        fillInnerColor = ${hexToGlslVec3(DIAL_COLORS.awakeWedge.fillInnerColor)};
        fillOuterColor = ${hexToGlslVec3(DIAL_COLORS.awakeWedge.fillOuterColor)};
        fillInnerA = mix(
            ${glslFloat(DIAL_COLORS.awakeWedge.fillInnerAlpha)},
            ${glslFloat(DIAL_COLORS.awakeWedge.selectedFillInnerAlpha)},
            sel
        );
        fillOuterA = mix(
            ${glslFloat(DIAL_COLORS.awakeWedge.fillOuterAlpha)},
            ${glslFloat(DIAL_COLORS.awakeWedge.selectedFillOuterAlpha)},
            sel
        );
        strokeInnerColor = ${hexToGlslVec3(DIAL_COLORS.awakeWedge.strokeInnerColor)};
        strokeOuterColor = ${hexToGlslVec3(DIAL_COLORS.awakeWedge.strokeOuterColor)};
        strokeInnerA = mix(
            ${glslFloat(DIAL_COLORS.awakeWedge.strokeInnerAlpha)},
            ${glslFloat(DIAL_COLORS.awakeWedge.selectedStrokeInnerAlpha)},
            sel
        );
        strokeOuterA = mix(
            ${glslFloat(DIAL_COLORS.awakeWedge.strokeOuterAlpha)},
            ${glslFloat(DIAL_COLORS.awakeWedge.selectedStrokeOuterAlpha)},
            sel
        );
    } else if (vWedgeKind < 1.5) {
        fillInnerColor = ${hexToGlslVec3(DIAL_COLORS.sleepWedge.fillInnerColor)};
        fillOuterColor = ${hexToGlslVec3(DIAL_COLORS.sleepWedge.fillOuterColor)};
        fillInnerA = mix(
            ${glslFloat(DIAL_COLORS.sleepWedge.fillInnerAlpha)},
            ${glslFloat(DIAL_COLORS.sleepWedge.selectedFillInnerAlpha)},
            sel
        );
        fillOuterA = mix(
            ${glslFloat(DIAL_COLORS.sleepWedge.fillOuterAlpha)},
            ${glslFloat(DIAL_COLORS.sleepWedge.selectedFillOuterAlpha)},
            sel
        );
        strokeInnerColor = ${hexToGlslVec3(DIAL_COLORS.sleepWedge.strokeInnerColor)};
        strokeOuterColor = ${hexToGlslVec3(DIAL_COLORS.sleepWedge.strokeOuterColor)};
        strokeInnerA = mix(
            ${glslFloat(DIAL_COLORS.sleepWedge.strokeInnerAlpha)},
            ${glslFloat(DIAL_COLORS.sleepWedge.selectedStrokeInnerAlpha)},
            sel
        );
        strokeOuterA = mix(
            ${glslFloat(DIAL_COLORS.sleepWedge.strokeOuterAlpha)},
            ${glslFloat(DIAL_COLORS.sleepWedge.selectedStrokeOuterAlpha)},
            sel
        );
    } else if (vWedgeKind < 2.5) {
        fillInnerColor = ${hexToGlslVec3(DIAL_COLORS.nightWakeWedge.fillInnerColor)};
        fillOuterColor = ${hexToGlslVec3(DIAL_COLORS.nightWakeWedge.fillOuterColor)};
        fillInnerA = mix(
            ${glslFloat(DIAL_COLORS.nightWakeWedge.fillInnerAlpha)},
            ${glslFloat(DIAL_COLORS.nightWakeWedge.selectedFillInnerAlpha)},
            sel
        );
        fillOuterA = mix(
            ${glslFloat(DIAL_COLORS.nightWakeWedge.fillOuterAlpha)},
            ${glslFloat(DIAL_COLORS.nightWakeWedge.selectedFillOuterAlpha)},
            sel
        );
        strokeInnerColor = ${hexToGlslVec3(DIAL_COLORS.nightWakeWedge.strokeInnerColor)};
        strokeOuterColor = ${hexToGlslVec3(DIAL_COLORS.nightWakeWedge.strokeOuterColor)};
        strokeInnerA = mix(
            ${glslFloat(DIAL_COLORS.nightWakeWedge.strokeInnerAlpha)},
            ${glslFloat(DIAL_COLORS.nightWakeWedge.selectedStrokeInnerAlpha)},
            sel
        );
        strokeOuterA = mix(
            ${glslFloat(DIAL_COLORS.nightWakeWedge.strokeOuterAlpha)},
            ${glslFloat(DIAL_COLORS.nightWakeWedge.selectedStrokeOuterAlpha)},
            sel
        );
    } else {
        fillInnerColor = ${hexToGlslVec3(DIAL_COLORS.napWedge.fillInnerColor)};
        fillOuterColor = ${hexToGlslVec3(DIAL_COLORS.napWedge.fillOuterColor)};
        fillInnerA = mix(
            ${glslFloat(DIAL_COLORS.napWedge.fillInnerAlpha)},
            ${glslFloat(DIAL_COLORS.napWedge.selectedFillInnerAlpha)},
            sel
        );
        fillOuterA = mix(
            ${glslFloat(DIAL_COLORS.napWedge.fillOuterAlpha)},
            ${glslFloat(DIAL_COLORS.napWedge.selectedFillOuterAlpha)},
            sel
        );
        strokeInnerColor = ${hexToGlslVec3(DIAL_COLORS.napWedge.strokeInnerColor)};
        strokeOuterColor = ${hexToGlslVec3(DIAL_COLORS.napWedge.strokeOuterColor)};
        strokeInnerA = mix(
            ${glslFloat(DIAL_COLORS.napWedge.strokeInnerAlpha)},
            ${glslFloat(DIAL_COLORS.napWedge.selectedStrokeInnerAlpha)},
            sel
        );
        strokeOuterA = mix(
            ${glslFloat(DIAL_COLORS.napWedge.strokeOuterAlpha)},
            ${glslFloat(DIAL_COLORS.napWedge.selectedStrokeOuterAlpha)},
            sel
        );
    }

    vec3 fillColor = mix(fillInnerColor, fillOuterColor, radialT);
    vec3 strokeColor = mix(strokeInnerColor, strokeOuterColor, radialT);
    float fillOpacity = mix(fillInnerA, fillOuterA, radialT);
    if (isStriped) {
        float diag = (vScreenPos.x + vScreenPos.y) / ${glslFloat(NIGHT_WAKE_STRIPE_PERIOD_PX)};
        float fw = max(fwidth(diag), 0.02);
        float wave = abs(fract(diag) - 0.5);
        float stripeMask = 1.0 - smoothstep(0.2 - fw, 0.2 + fw, wave);
        fillOpacity *= stripeMask;
    }

    // Uniform inset stroke around all 4 wedge edges.
    float innerArcMask = 1.0 - smoothstep(strokeW - aaPx, strokeW + aaPx, distPx - innerPx);
    float outerArcMask = 1.0 - smoothstep(strokeW - aaPx, strokeW + aaPx, outerPx - distPx);
    float startLineMask = 1.0 - smoothstep(strokeW - aaPx, strokeW + aaPx, startEdgePx);
    float endLineMask = 1.0 - smoothstep(strokeW - aaPx, strokeW + aaPx, endEdgePx);
    float strokeMask = max(max(innerArcMask, outerArcMask), max(startLineMask, endLineMask));
    float strokeOpacity = mix(strokeInnerA, strokeOuterA, radialT);

    float fA = ringMask * (1.0 - strokeMask) * fillOpacity * dimFactor;
    float sA = ringMask * strokeMask * strokeOpacity * dimFactor;
    float finalAlpha = sA + fA;
    if (finalAlpha <= 0.001) discard;

    vec3 premultColor = strokeColor * sA + fillColor * fA;
    fragColor = vec4(premultColor, finalAlpha);
}
`

/** Maps minute of day so 12:00 PM (720) is at top (-PI/2) and 12:00 AM (0/1440) is at bottom (+PI/2). */
export const minuteToDialAngle = (minuteOfDay: number): number =>
    ((minuteOfDay - NOON_MINUTE) / MINUTES_PER_DAY) * Math.PI * 2 - Math.PI / 2

/** Inverse of `minuteToDialAngle`, mapping a rotor-local angle in radians back to [0, 1440). */
export const dialAngleToMinute = (angleRad: number): number => {
    const raw = ((angleRad + Math.PI / 2) / (Math.PI * 2)) * MINUTES_PER_DAY + NOON_MINUTE
    return ((raw % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
}

export const createDialShader = (sunriseMin: number, sunsetMin: number): Shader =>
    Shader.from({
        gl: {
            vertex: VERTEX_SHADER,
            fragment: FRAGMENT_SHADER,
        },
        resources: {
            sunUniforms: {
                uSunriseMin: { value: sunriseMin, type: 'f32' },
                uSunsetMin: { value: sunsetMin, type: 'f32' },
            },
            selectionUniforms: {
                uSelectionProgress: { value: 0, type: 'f32' },
                uDimProgress: { value: 0, type: 'f32' },
            },
        },
    })

export const buildDialGeometry = (
    wedges: readonly ScheduleWedge[],
    radius: number = DIAL_DISC_RADIUS,
    selectedWedgeId: string | null = null,
    prevSelectedWedgeId: string | null = null,
): Geometry => {
    const positions: number[] = []
    const locals: number[] = []
    const wedgeKinds: number[] = []
    const startAngles: number[] = []
    const sweeps: number[] = []
    const prevSelectedValues: number[] = []
    const selectedValues: number[] = []
    const indices: number[] = []

    let vertexCount = 0

    // Center sun disc quad (drawn first, independent of the annular wedge ring).
    const sunQuad: ReadonlyArray<readonly [number, number]> = [
        [-SUN_MESH_EXTENT_RATIO, -SUN_MESH_EXTENT_RATIO],
        [SUN_MESH_EXTENT_RATIO, -SUN_MESH_EXTENT_RATIO],
        [SUN_MESH_EXTENT_RATIO, SUN_MESH_EXTENT_RATIO],
        [-SUN_MESH_EXTENT_RATIO, SUN_MESH_EXTENT_RATIO],
    ]
    for (const [lx, ly] of sunQuad) {
        positions.push(lx * radius, ly * radius)
        locals.push(lx, ly)
        wedgeKinds.push(-1)
        startAngles.push(0)
        sweeps.push(0)
        prevSelectedValues.push(0)
        selectedValues.push(0)
    }
    indices.push(
        vertexCount,
        vertexCount + 1,
        vertexCount + 2,
        vertexCount,
        vertexCount + 2,
        vertexCount + 3,
    )
    vertexCount += 4

    for (const wedge of wedges) {
        const startAngle = minuteToDialAngle(wedge.startMin)
        const sweep = ((wedge.endMin - wedge.startMin) / MINUTES_PER_DAY) * Math.PI * 2
        if (sweep <= 0) continue

        const wedgeKind = wedge.isNightWake ? 2 : wedge.isNap ? 3 : wedge.state === 'asleep' ? 1 : 0
        const prevSelected = wedge.selectionId === prevSelectedWedgeId ? 1 : 0
        const selected = wedge.selectionId === selectedWedgeId ? 1 : 0

        const steps = Math.max(1, Math.ceil(sweep / MAX_RADIANS_PER_SEGMENT))
        for (let step = 0; step <= steps; step += 1) {
            const angle = startAngle + (sweep * step) / steps
            const cos = Math.cos(angle)
            const sin = Math.sin(angle)

            positions.push(
                cos * radius * RING_MESH_INNER_RATIO,
                sin * radius * RING_MESH_INNER_RATIO,
                cos * radius * RING_MESH_OUTER_RATIO,
                sin * radius * RING_MESH_OUTER_RATIO,
            )
            locals.push(
                cos * RING_MESH_INNER_RATIO,
                sin * RING_MESH_INNER_RATIO,
                cos * RING_MESH_OUTER_RATIO,
                sin * RING_MESH_OUTER_RATIO,
            )
            wedgeKinds.push(wedgeKind, wedgeKind)
            startAngles.push(startAngle, startAngle)
            sweeps.push(sweep, sweep)
            prevSelectedValues.push(prevSelected, prevSelected)
            selectedValues.push(selected, selected)

            const innerIdx = vertexCount
            const outerIdx = vertexCount + 1
            vertexCount += 2

            if (step > 0) {
                indices.push(innerIdx - 2, outerIdx - 2, outerIdx, innerIdx - 2, outerIdx, innerIdx)
            }
        }
    }

    return new Geometry({
        attributes: {
            aPosition: { buffer: new Float32Array(positions), size: 2 },
            aLocal: { buffer: new Float32Array(locals), size: 2 },
            aWedgeKind: { buffer: new Float32Array(wedgeKinds), size: 1 },
            aStartAngle: { buffer: new Float32Array(startAngles), size: 1 },
            aSweep: { buffer: new Float32Array(sweeps), size: 1 },
            aPrevSelected: { buffer: new Float32Array(prevSelectedValues), size: 1 },
            aSelected: { buffer: new Float32Array(selectedValues), size: 1 },
        },
        indexBuffer: new Uint32Array(indices),
    })
}
