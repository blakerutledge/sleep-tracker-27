import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

const isV1Route = /^\/v1(?:\/|$)/.test(window.location.pathname)

const bootstrap = async () => {
    if (typeof Reflect.get(globalThis, 'Temporal') === 'undefined') {
        const mod = await import('temporal-polyfill')
        Reflect.set(globalThis, 'Temporal', mod.Temporal)
    }

    if (typeof HTMLElement !== 'undefined' && !Object.hasOwn(HTMLElement.prototype, 'focusGroup')) {
        const { polyfillBodyAndObserve } = await import('@microsoft/focusgroup-polyfill')
        polyfillBodyAndObserve()
    }

    const rootEl = document.getElementById('root')
    if (!rootEl) throw new Error('Missing #root container')

    const { default: RootComponent } = isV1Route
        ? await import('./AppV1.tsx')
        : await import('./App.tsx')

    createRoot(rootEl).render(
        <StrictMode>
            <RootComponent />
        </StrictMode>,
    )
}

bootstrap()
