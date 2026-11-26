import { useCallback, useEffect, useState } from 'react'
import { epochToZonedDateTime, getTimeZoneId } from './temporal.ts'

const LOCATION_KEY = 'sleep-tracker-27:location'
const LOCATION_EVENT = 'sleep-27:location-changed'
const DEG_TO_RAD = Math.PI / 180
const RAD_TO_DEG = 180 / Math.PI
const SUNRISE_ZENITH_DEG = 90.833

const CONIFER_CO_COORDS = {
    latitude: 39.5211,
    longitude: -105.3053,
} as const

export interface GeoLocation {
    latitude: number
    longitude: number
    source: 'device' | 'default'
    updatedAt: number
}

export interface SunTimes {
    sunriseMs: number
    sunsetMs: number
    sunriseMinuteOfDay: number
    sunsetMinuteOfDay: number
}

const getDefaultLocation = (): GeoLocation => ({
    latitude: CONIFER_CO_COORDS.latitude,
    longitude: CONIFER_CO_COORDS.longitude,
    source: 'default',
    updatedAt: Date.now(),
})

export const readSavedLocation = (): GeoLocation => {
    try {
        const raw = localStorage.getItem(LOCATION_KEY)
        if (!raw) return getDefaultLocation()
        const parsed = JSON.parse(raw) as Partial<GeoLocation>
        if (
            typeof parsed.latitude === 'number' &&
            typeof parsed.longitude === 'number' &&
            Number.isFinite(parsed.latitude) &&
            Number.isFinite(parsed.longitude)
        ) {
            return {
                latitude: parsed.latitude,
                longitude: parsed.longitude,
                source: 'device',
                updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
            }
        }
    } catch {
        // Fall through to default location
    }
    return getDefaultLocation()
}

const writeSavedLocation = (location: GeoLocation | null): void => {
    try {
        if (location) {
            localStorage.setItem(LOCATION_KEY, JSON.stringify(location))
        } else {
            localStorage.removeItem(LOCATION_KEY)
        }
        window.dispatchEvent(new Event(LOCATION_EVENT))
    } catch {
        // Ignore storage quota errors
    }
}

// NOAA solar sunrise/sunset equations (accurate to ~1 minute offline).
export const calculateSunTimes = (
    epochMs: number,
    latitude: number,
    longitude: number,
    timeZone = getTimeZoneId(),
): SunTimes => {
    const zdt = epochToZonedDateTime(epochMs, timeZone)
    const utcMidnightMs = Date.UTC(zdt.year, zdt.month - 1, zdt.day, 12, 0, 0)
    const julianDay = utcMidnightMs / 86_400_000 + 2440587.5
    const jc = (julianDay - 2451545) / 36525

    const geomMeanLongSun = (280.46646 + jc * (36000.76983 + jc * 0.0003032)) % 360
    const geomMeanAnomSun = 357.52911 + jc * (35999.05029 - 0.0001537 * jc)
    const eccentEarthOrbit = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc)

    const anomRad = geomMeanAnomSun * DEG_TO_RAD
    const sunEqOfCtr =
        Math.sin(anomRad) * (1.914602 - jc * (0.004817 + 0.000014 * jc)) +
        Math.sin(2 * anomRad) * (0.019993 - 0.000101 * jc) +
        Math.sin(3 * anomRad) * 0.000289

    const sunTrueLong = geomMeanLongSun + sunEqOfCtr
    const sunAppLong =
        sunTrueLong - 0.00569 - 0.00478 * Math.sin((125.04 - 1934.136 * jc) * DEG_TO_RAD)

    const meanObliqEcliptic =
        23 + (26 + (21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 60) / 60
    const obliqCorr = meanObliqEcliptic + 0.00256 * Math.cos((125.04 - 1934.136 * jc) * DEG_TO_RAD)

    const sunDeclin = Math.asin(
        Math.sin(obliqCorr * DEG_TO_RAD) * Math.sin(sunAppLong * DEG_TO_RAD),
    )

    const varY = Math.tan((obliqCorr / 2) * DEG_TO_RAD) ** 2
    const longRad = geomMeanLongSun * DEG_TO_RAD
    const eqOfTimeMin =
        4 *
        RAD_TO_DEG *
        (varY * Math.sin(2 * longRad) -
            2 * eccentEarthOrbit * Math.sin(anomRad) +
            4 * eccentEarthOrbit * varY * Math.sin(anomRad) * Math.cos(2 * longRad) -
            0.5 * varY * varY * Math.sin(4 * longRad) -
            1.25 * eccentEarthOrbit * eccentEarthOrbit * Math.sin(2 * anomRad))

    const latRad = latitude * DEG_TO_RAD
    const cosHa =
        Math.cos(SUNRISE_ZENITH_DEG * DEG_TO_RAD) / (Math.cos(latRad) * Math.cos(sunDeclin)) -
        Math.tan(latRad) * Math.tan(sunDeclin)
    const clampedCosHa = Math.max(-1, Math.min(1, cosHa))
    const haDeg = Math.acos(clampedCosHa) * RAD_TO_DEG

    const solarNoonUtcMin = 720 - 4 * longitude - eqOfTimeMin
    const sunriseUtcMin = solarNoonUtcMin - haDeg * 4
    const sunsetUtcMin = solarNoonUtcMin + haDeg * 4

    const dayStartUtcMs = Date.UTC(zdt.year, zdt.month - 1, zdt.day, 0, 0, 0)
    const sunriseMs = Math.round(dayStartUtcMs + sunriseUtcMin * 60_000)
    const sunsetMs = Math.round(dayStartUtcMs + sunsetUtcMin * 60_000)

    const sunriseZdt = epochToZonedDateTime(sunriseMs, timeZone)
    const sunsetZdt = epochToZonedDateTime(sunsetMs, timeZone)

    return {
        sunriseMs,
        sunsetMs,
        sunriseMinuteOfDay: sunriseZdt.hour * 60 + sunriseZdt.minute,
        sunsetMinuteOfDay: sunsetZdt.hour * 60 + sunsetZdt.minute,
    }
}

export const requestDeviceLocation = (): Promise<GeoLocation> =>
    new Promise((resolve, reject) => {
        if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
            reject(new Error('Geolocation is not supported in this browser.'))
            return
        }

        navigator.geolocation.getCurrentPosition(
            (position) => {
                resolve({
                    latitude: Number(position.coords.latitude.toFixed(4)),
                    longitude: Number(position.coords.longitude.toFixed(4)),
                    source: 'device',
                    updatedAt: Date.now(),
                })
            },
            (err) => {
                reject(new Error(err.message || 'Could not determine device location.'))
            },
            {
                enableHighAccuracy: false,
                timeout: 10_000,
                maximumAge: 300_000,
            },
        )
    })

export interface SunLocationState {
    location: GeoLocation
    sunTimes: SunTimes
    timeZone: string
    busy: boolean
    updateFromDevice: () => Promise<GeoLocation>
    resetToDefault: () => void
}

export const useSunLocation = (): SunLocationState => {
    const [location, setLocation] = useState<GeoLocation>(() => readSavedLocation())
    const [busy, setBusy] = useState(false)
    const timeZone = getTimeZoneId()

    useEffect(() => {
        const handleSync = () => {
            setLocation(readSavedLocation())
        }
        window.addEventListener(LOCATION_EVENT, handleSync)
        return () => {
            window.removeEventListener(LOCATION_EVENT, handleSync)
        }
    }, [])

    const updateFromDevice = useCallback(async (): Promise<GeoLocation> => {
        setBusy(true)
        try {
            const next = await requestDeviceLocation()
            writeSavedLocation(next)
            setLocation(next)
            return next
        } finally {
            setBusy(false)
        }
    }, [])

    const resetToDefault = useCallback(() => {
        writeSavedLocation(null)
        setLocation(getDefaultLocation())
    }, [])

    const sunTimes = calculateSunTimes(Date.now(), location.latitude, location.longitude, timeZone)

    return {
        location,
        sunTimes,
        timeZone,
        busy,
        updateFromDevice,
        resetToDefault,
    }
}
