import { Geometry, Shader } from 'pixi.js'
import { MINUTES_PER_DAY, type ScheduleWedge } from '#src/data/schedule.ts'

export const DIAL_CANVAS_SIZE = 1120
export const DIAL_DISC_RADIUS = 380
export const DIAL_INNER_RATIO = 0.56
export const DIAL_INNER_RADIUS = Math.round(DIAL_DISC_RADIUS * DIAL_INNER_RATIO)
export const DIAL_SUN_RING_OUTER_RATIO = 0.53
export const DIAL_SUN_RING_INNER_RATIO = 0.48
export const DIAL_SUN_RING_OUTER_RADIUS = Math.round(DIAL_DISC_RADIUS * DIAL_SUN_RING_OUTER_RATIO)
export const DIAL_SUN_RING_INNER_RADIUS = Math.round(DIAL_DISC_RADIUS * DIAL_SUN_RING_INNER_RATIO)
export const DIAL_WEDGE_ICON_RADIUS = Math.round((DIAL_INNER_RADIUS + DIAL_DISC_RADIUS) / 2)
export const DIAL_HANDLE_OFFSET = 76
export const DIAL_HANDLE_RADIUS = DIAL_DISC_RADIUS + DIAL_HANDLE_OFFSET
export const DIAL_BARRIER_ICON_RADIUS = Math.round(DIAL_DISC_RADIUS * 0.36)
export const DIAL_HANDLE_NODE_RADIUS = 36
export const DIAL_HANDLE_HIT_RADIUS = 58

const NOON_MINUTE = 720
const MAX_RADIANS_PER_SEGMENT = (3 * Math.PI) / 180

const VERTEX_SHADER = `#version 300 es
precision highp float;

in vec2 aPosition;
in vec2 aLocal;
in float aStriped;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;

out vec2 vLocal;
out vec2 vScreenDir;
out float vStriped;

void main() {
    vLocal = aLocal;
    vStriped = aStriped;
    vec2 worldPos = (uWorldTransformMatrix * uTransformMatrix * vec3(aPosition, 1.0)).xy;
    vScreenDir = (worldPos - vec2(${DIAL_CANVAS_SIZE / 2}.0)) / ${DIAL_DISC_RADIUS}.0;
    gl_Position = vec4((uProjectionMatrix * vec3(worldPos, 1.0)).xy, 0.0, 1.0);
}
`

const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 vLocal;
in vec2 vScreenDir;
in float vStriped;

uniform float uSunriseMin;
uniform float uSunsetMin;

out vec4 fragColor;

void main() {
    float dist = length(vLocal);
    float aa = max(fwidth(dist), 0.002);
    float innerRatio = ${DIAL_INNER_RATIO};
    float sunOuterRatio = ${DIAL_SUN_RING_OUTER_RATIO};
    float sunInnerRatio = ${DIAL_SUN_RING_INNER_RATIO};

    float mainAlpha =
        (1.0 - smoothstep(1.0 - aa, 1.0 + aa, dist)) *
        smoothstep(innerRatio - aa, innerRatio + aa, dist);
    float sunAlpha =
        (1.0 - smoothstep(sunOuterRatio - aa, sunOuterRatio + aa, dist)) *
        smoothstep(sunInnerRatio - aa, sunInnerRatio + aa, dist);

    float alpha = max(mainAlpha, sunAlpha);
    if (alpha <= 0.001) discard;

    // Palette tokens matching src/styles/_colors.scss
    vec3 blue200 = vec3(0.106, 0.110, 0.200);   // #1b1c33
    vec3 blue800 = vec3(0.773, 0.875, 0.941);   // #c5dff0
    vec3 blue900 = vec3(0.863, 0.945, 0.969);   // #dcf1f7
    vec3 purple200 = vec3(0.580, 0.396, 0.529); // #946587
    vec3 purple300 = vec3(0.761, 0.624, 0.745); // #c29fbe
    vec3 yellow300 = vec3(1.000, 0.945, 0.529); // #fff187

    vec3 mainColor = vec3(0.0);
    if (mainAlpha > 0.001) {
        float ringT = smoothstep(innerRatio, 1.0, dist);
        vec3 baseColor = mix(blue800, blue900, ringT);
        if (vStriped > 0.5) {
            float diag = (vScreenDir.x + vScreenDir.y) * 18.0;
            float fw = max(fwidth(diag), 0.01);
            float wave = abs(fract(diag) - 0.5);
            float stripe = smoothstep(0.24 - fw, 0.24 + fw, wave);
            baseColor = mix(purple200, purple300, stripe * 0.65);
        }

        float shade = mix(0.95, 1.03, ringT);
        mainColor = baseColor * shade;

        float outerRim = smoothstep(1.0 - aa * 3.5, 1.0 - aa * 0.5, dist);
        float innerRim = 1.0 - smoothstep(innerRatio + aa * 0.5, innerRatio + aa * 3.5, dist);
        mainColor = mix(mainColor, yellow300, max(outerRim, innerRim * 0.65) * 0.18);
    }

    vec3 sunColor = vec3(0.0);
    if (sunAlpha > 0.001) {
        float angle = atan(vLocal.y, vLocal.x);
        float minOfDay = mod(((angle + 1.5707963268) / 6.2831853072) * 1440.0 + 720.0, 1440.0);
        float isDay = uSunriseMin <= uSunsetMin
            ? step(uSunriseMin, minOfDay) * step(minOfDay, uSunsetMin)
            : max(step(uSunriseMin, minOfDay), step(minOfDay, uSunsetMin));
        sunColor = mix(blue200, blue800, isDay);
    }

    vec3 premultColor = mainColor * mainAlpha + sunColor * sunAlpha;
    fragColor = vec4(premultColor, alpha);
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
        },
    })

export const buildDialGeometry = (
    wedges: readonly ScheduleWedge[],
    radius: number = DIAL_DISC_RADIUS,
): Geometry => {
    const positions: number[] = []
    const locals: number[] = []
    const striped: number[] = []
    const indices: number[] = []

    let vertexCount = 0

    for (const wedge of wedges) {
        const startAngle = minuteToDialAngle(wedge.startMin)
        const endAngle = minuteToDialAngle(wedge.endMin)
        const sweep = endAngle - startAngle
        if (sweep <= 0) continue

        const segments = Math.max(2, Math.ceil(sweep / MAX_RADIANS_PER_SEGMENT))
        const isStriped = wedge.state === 'asleep' ? 1 : 0

        const centerIndex = vertexCount
        positions.push(0, 0)
        locals.push(0, 0)
        striped.push(isStriped)
        vertexCount += 1

        for (let step = 0; step <= segments; step += 1) {
            const angle = startAngle + (sweep * step) / segments
            const cos = Math.cos(angle)
            const sin = Math.sin(angle)

            positions.push(cos * radius, sin * radius)
            locals.push(cos, sin)
            striped.push(isStriped)

            const currentIndex = vertexCount
            vertexCount += 1

            if (step > 0) {
                indices.push(centerIndex, currentIndex - 1, currentIndex)
            }
        }
    }

    return new Geometry({
        attributes: {
            aPosition: { buffer: new Float32Array(positions), size: 2 },
            aLocal: { buffer: new Float32Array(locals), size: 2 },
            aStriped: { buffer: new Float32Array(striped), size: 1 },
        },
        indexBuffer: new Uint32Array(indices),
    })
}
