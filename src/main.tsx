import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import { LangGate } from './components/LangGate'
import { loadLang, resolveLang } from './i18n'
import { getKv } from './lib/db'
import { LEGACY_REPO, setDataRepo } from './lib/github'
import './lib/install'
import './index.css'

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1 } } })

let saved: string | null = null
try { saved = localStorage.getItem('lang') } catch { /* private mode */ }

// Load the dictionary first so the app never flashes English.
// Language and data repo first: no flash of English, and sync never starts against the wrong repo.
Promise.all([
  loadLang(resolveLang(saved)),
  getKv('repo', LEGACY_REPO).then(setDataRepo).catch(() => {}),
]).finally(() => {
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
