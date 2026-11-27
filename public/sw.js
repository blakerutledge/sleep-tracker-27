const CACHE_NAME = 'sleep-27-shell-v7'
const APP_SHELL_URLS = [
    '/',
    '/manifest.webmanifest',
    '/icon.svg',
    '/icon-192.png',
    '/icon-512.png',
    '/apple-touch-icon.png',
    '/quicksand-400-latin.woff2',
    '/quicksand-600-latin.woff2',
]

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches
            .open(CACHE_NAME)
            .then((cache) => cache.addAll(APP_SHELL_URLS))
            .then(() => self.skipWaiting()),
    )
})

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((keys) =>
                Promise.all(
                    keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
                ),
            )
            .then(() => self.clients.claim()),
    )
})

self.addEventListener('fetch', (event) => {
    const { request } = event
    if (request.method !== 'GET') return

    const url = new URL(request.url)
    if (url.origin !== self.location.origin) return

    if (url.pathname === '/version.json') {
        event.respondWith(fetch(request, { cache: 'no-store' }))
        return
    }

    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request, { cache: 'no-cache' })
                .then((response) => {
                    if (response.ok) {
                        const copy = response.clone()
                        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
                    }
                    return response
                })
                .catch(() => caches.match(request).then((cached) => cached ?? caches.match('/'))),
        )
        return
    }

    event.respondWith(
        caches.match(request).then((cached) => {
            const networkFetch = fetch(request)
                .then((response) => {
                    if (response.ok) {
                        const copy = response.clone()
                        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
                    }
                    return response
                })
                .catch(() => cached)

            return cached ?? networkFetch
        }),
    )
})

const showAlarmNotification = (payload) => {
    const title =
        typeof payload?.title === 'string' && payload.title ? payload.title : 'Sleep Alarm'
    const body = typeof payload?.body === 'string' ? payload.body : ''
    const tag = typeof payload?.tag === 'string' && payload.tag ? payload.tag : 'sleep-27-alarm'
    const url = typeof payload?.url === 'string' && payload.url ? payload.url : '/today'

    return self.registration.showNotification(title, {
        ...(body ? { body } : {}),
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag,
        renotify: true,
        requireInteraction: true,
        data: {
            url,
            alarmId: typeof payload?.alarmId === 'string' ? payload.alarmId : undefined,
        },
    })
}

self.addEventListener('push', (event) => {
    let payload = {}
    if (event.data) {
        try {
            payload = event.data.json()
        } catch {
            payload = { body: event.data.text() }
        }
    }
    event.waitUntil(showAlarmNotification(payload))
})

self.addEventListener('message', (event) => {
    if (event.data?.type === 'SHOW_ALARM_NOTIFICATION') {
        event.waitUntil(showAlarmNotification(event.data.payload))
    }
})

self.addEventListener('notificationclick', (event) => {
    event.notification.close()
    const targetUrl =
        typeof event.notification.data?.url === 'string' ? event.notification.data.url : '/today'

    event.waitUntil(
        self.clients
            .matchAll({ type: 'window', includeUncontrolled: true })
            .then(async (windowClients) => {
                for (const client of windowClients) {
                    if (client.url.startsWith(self.location.origin) && 'focus' in client) {
                        client.postMessage({ type: 'NAVIGATE', url: targetUrl })
                        return client.focus()
                    }
                }
                if (self.clients.openWindow) {
                    return self.clients.openWindow(targetUrl)
                }
                return undefined
            }),
    )
})
