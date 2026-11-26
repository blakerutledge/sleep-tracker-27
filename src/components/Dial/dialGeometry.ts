import { Geometry, Shader } from 'pixi.js'
import { MINUTES_PER_DAY, type ScheduleWedge } from '#src/data/schedule.ts'

export const DIAL_CANVAS_SIZE = 1120
export const DIAL_DISC_RADIUS = 380
export const DIAL_ICON_RADIUS = DIAL_DISC_RADIUS + 76
export const DIAL_RAY_END_RADIUS = DIAL_DISC_RADIUS + 34

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
out float vStriped;

void main() {
    vLocal = aLocal;
    vStriped = aStriped;
    mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
    gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
}
`

const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 vLocal;
in float vStriped;

uniform float uSunriseMin;
uniform float uSunsetMin;

out vec4 fragColor;

void main() {
    float dist = length(vLocal);
    float aa = max(fwidth(dist), 0.002);

    float alpha = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, dist);
    if (alpha <= 0.001) discard;

    float angle = atan(vLocal.y, vLocal.x);
    float minOfDay = mod(((angle + 1.5707963268) / 6.2831853072) * 1440.0 + 720.0, 1440.0);
    float isDay = uSunriseMin <= uSunsetMin
        ? step(uSunriseMin, minOfDay) * step(minOfDay, uSunsetMin)
        : max(step(uSunriseMin, minOfDay), step(minOfDay, uSunsetMin));

    vec3 nightColor = vec3(0.165, 0.184, 0.329); // #2a2f54
    vec3 dayColor = vec3(0.553, 0.753, 0.949);   // #8DC0F2
    vec3 wedgeColor = mix(nightColor, dayColor, isDay);

    vec3 baseColor = wedgeColor;
    if (vStriped > 0.5) {
        float diag = (vLocal.x + vLocal.y) * 18.0;
        float fw = max(fwidth(diag), 0.01);
        float wave = abs(fract(diag) - 0.5);
        float stripe = smoothstep(0.25 - fw, 0.25 + fw, wave);
        vec3 nightGap = vec3(0.078, 0.082, 0.149); // #141526
        vec3 dayGap = dayColor * 0.78;
        vec3 gapColor = mix(nightGap, dayGap, isDay);
        baseColor = mix(gapColor, wedgeColor, stripe);
    }

    float shade = mix(0.94, 1.03, smoothstep(0.0, 1.0, dist));
    vec3 color = baseColor * shade;

    float rim = smoothstep(1.0 - aa * 3.5, 1.0 - aa * 0.5, dist);
    color = mix(color, vec3(1.0, 0.976, 0.902), rim * 0.14);

    fragColor = vec4(color * alpha, alpha);
}
`

/** Maps minute of day so 12:00 PM (720) is at top (-PI/2) and 12:00 AM (0/1440) is at bottom (+PI/2). */
export const minuteToDialAngle = (minuteOfDay: number): number =>
    ((minuteOfDay - NOON_MINUTE) / MINUTES_PER_DAY) * Math.PI * 2 - Math.PI / 2

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
