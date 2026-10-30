import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import { LangGate } from './components/LangGate'
import { loadLang, resolveLang } from './i18n'
import './index.css'

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1 } } })

let saved: string | null = null
try { saved = localStorage.getItem('lang') } catch { /* private mode */ }

// Load the dictionary first so the app never flashes English.
loadLang(resolveLang(saved)).finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <LangGate>
          <App />
        </LangGate>
      </QueryClientProvider>
    </StrictMode>,
  )
})
