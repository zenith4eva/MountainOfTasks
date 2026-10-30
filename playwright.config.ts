import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  use: { baseURL: 'http://localhost:4173/MountainOfTasks/' },
  webServer: { command: 'npx vite preview --port 4173 --strictPort', url: 'http://localhost:4173/MountainOfTasks/', reuseExistingServer: true },
})
