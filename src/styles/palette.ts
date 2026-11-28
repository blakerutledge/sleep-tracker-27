// Palette tokens matching src/styles/_colors.scss
export const PALETTE = {
    white: '#ffffff',
    blue100: '#0a101c',
    blue200: '#1b1c33',
    blue300: '#2b2941',
    blue700: '#a1c4e8',
    blue800: '#c5dff0',
    blue900: '#dcf1f7',
    yellow100: '#eeaa2c',
    yellow200: '#f8cb4e',
    yellow300: '#fff187',
    purple100: '#854c76',
    purple200: '#946587',
    purple300: '#c29fbe',
} as const

// Single source of truth for dial wedges (radial fill & stroke gradients), sun disc, handles, anchors, and key
export const DIAL_COLORS = {
    awakeWedge: {
        fillInnerColor: PALETTE.blue700,
        fillOuterColor: PALETTE.blue800,
        fillInnerAlpha: 0.7,
        fillOuterAlpha: 0.2,
        selectedFillInnerAlpha: 0.7,
        selectedFillOuterAlpha: 0.2,
        strokeInnerColor: PALETTE.blue700,
        strokeOuterColor: PALETTE.blue800,
        strokeInnerAlpha: 0.9,
        strokeOuterAlpha: 0.4,
        selectedStrokeInnerAlpha: 0.9,
        selectedStrokeOuterAlpha: 0.4,
    },
    sleepWedge: {
        fillInnerColor: PALETTE.purple100,
        fillOuterColor: PALETTE.purple200,
        fillInnerAlpha: 0.7,
        fillOuterAlpha: 0.2,
        selectedFillInnerAlpha: 0.7,
        selectedFillOuterAlpha: 0.2,
        strokeInnerColor: PALETTE.purple100,
        strokeOuterColor: PALETTE.purple200,
        strokeInnerAlpha: 0.9,
        strokeOuterAlpha: 0.4,
        selectedStrokeInnerAlpha: 0.9,
        selectedStrokeOuterAlpha: 0.4,
    },
    napWedge: {
        fillInnerColor: PALETTE.purple100,
        fillOuterColor: PALETTE.purple200,
        fillInnerAlpha: 0.7,
        fillOuterAlpha: 0.2,
        selectedFillInnerAlpha: 0.7,
        selectedFillOuterAlpha: 0.2,
        strokeInnerColor: PALETTE.purple100,
        strokeOuterColor: PALETTE.purple200,
        strokeInnerAlpha: 0.9,
        strokeOuterAlpha: 0.4,
        selectedStrokeInnerAlpha: 0.9,
        selectedStrokeOuterAlpha: 0.4,
    },
    nightWakeWedge: {
        fillInnerColor: PALETTE.blue700,
        fillOuterColor: PALETTE.blue800,
        fillInnerAlpha: 0.7,
        fillOuterAlpha: 0.2,
        selectedFillInnerAlpha: 0.7,
        selectedFillOuterAlpha: 0.2,
        strokeInnerColor: PALETTE.blue700,
        strokeOuterColor: PALETTE.blue800,
        strokeInnerAlpha: 0.9,
        strokeOuterAlpha: 0.4,
        selectedStrokeInnerAlpha: 0.9,
        selectedStrokeOuterAlpha: 0.4,
    },
    unselectedAlphaScale: 0.2,
    sunDiscDay: {
        color: PALETTE.blue700,
        alpha: 0.2,
    },
    sunDiscNight: {
        color: PALETTE.blue300,
        alpha: 0.0,
    },
    noonSunIcon: PALETTE.blue700,
    midnightMoonIcon: PALETTE.blue700,
    wakeHandle: PALETTE.blue700,
    sleepHandle: PALETTE.purple200,
    selectedHandleRing: PALETTE.yellow200,
    morningWakeAnchor: {
        fillColor: PALETTE.blue700,
        iconColor: PALETTE.blue100,
        idleAlpha: 0.65,
    },
    bedtimeAnchor: {
        fillColor: PALETTE.purple100,
        iconColor: PALETTE.blue100,
        idleAlpha: 0.65,
    },
    keyIcon: PALETTE.blue100,
} as const

const parseHexRgb = (hex: string): [number, number, number] => {
    const match = /^#([0-9a-fA-F]{6})$/.exec(hex)
    if (!match?.[1]) {
        throw new Error(`Invalid 6-digit hex color: ${hex}`)
    }
    const value = Number.parseInt(match[1], 16)
    return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]
}

export const hexToNumber = (hex: string): number => {
    const [r, g, b] = parseHexRgb(hex)
    return (r << 16) | (g << 8) | b
}

export const hexToGlslVec3 = (hex: string): string => {
    const [r, g, b] = parseHexRgb(hex)
    return `vec3(${(r / 255).toFixed(4)}, ${(g / 255).toFixed(4)}, ${(b / 255).toFixed(4)})`
}
