import '@fontsource-variable/inter';
import './styles/tokens.css';
import './styles/app.css';
import * as RTooltip from '@radix-ui/react-tooltip';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { ApiFailure } from './api';
import { App } from './App';
import { ToastProvider } from './components/toast';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, err) => !(err instanceof ApiFailure && err.status >= 400 && err.status < 500) && count < 2,
      refetchOnWindowFocus: true,
      staleTime: 5_000,
    },
  },
});

// Service worker jen v produkci (instalace jako aplikace, offline stránka)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <RTooltip.Provider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </RTooltip.Provider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
