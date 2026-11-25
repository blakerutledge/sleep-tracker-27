import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './styles/app.css';

async function bootstrap() {
  if (typeof (globalThis as { Temporal?: unknown }).Temporal === 'undefined') {
    const mod = await import('temporal-polyfill');
    (globalThis as { Temporal?: unknown }).Temporal = mod.Temporal;
  }

  if (typeof HTMLElement !== 'undefined' && !Object.hasOwn(HTMLElement.prototype, 'focusGroup')) {
    const { polyfillBodyAndObserve } = await import('@microsoft/focusgroup-polyfill');
    polyfillBodyAndObserve();
  }

  const rootEl = document.getElementById('root');
  if (!rootEl) throw new Error('Missing #root container');

  createRoot(rootEl).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

bootstrap();
