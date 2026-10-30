// Screenshots of the first-run flow with GitHub's API mocked (no token needed), and a check of the
// token error paths. Usage: start `npx vite preview --host 127.0.0.1 --port 4391`, then
//   node scripts/onboarding-shots.mjs [outDir]      (default: docs/)
import { chromium } from '@playwright/test'

const out = process.argv[2] ?? 'docs'
const URL = process.env.URL ?? 'http://127.0.0.1:4391/MountainOfTasks/'
const b = await chromium.launch()
const shot = (p, name) => p.screenshot({ path: `${out}/onboarding-${name}.png`, fullPage: true })

for (const [vw, tag] of [[{ width: 1280, height: 900 }, 'desktop'], [{ width: 390, height: 844 }, 'phone']]) {
  const ctx = await b.newContext({ viewport: vw, deviceScaleFactor: 2 })
  const p = await ctx.newPage()
  const errs = []
  p.on('pageerror', (e) => errs.push(e.message))
  await p.route('https://api.github.com/user/repos**', (route) => {
    const auth = route.request().headers().authorization ?? ''
    if (auth.includes('bad')) return route.fulfill({ status: 401, body: '{}' })
    if (auth.includes('none')) return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ full_name: 'alice/mountain-of-tasks-data', name: 'mountain-of-tasks-data' }]) })
  })
  await ctx.route('https://github.com/**', (r) => r.fulfill({ status: 200, body: 'github' }))

  await p.goto(URL)
  await shot(p, `${tag}-1-welcome`)
  await p.getByRole('button', { name: /Sync with GitHub/ }).click()
  await shot(p, `${tag}-2-repo`)
  await p.getByRole('button', { name: 'I already have it' }).click()
  await shot(p, `${tag}-3-token`)
  await p.getByRole('button', { name: 'I copied it' }).click()

  await p.getByLabel('Personal access token').fill('github_pat_bad')
  await p.keyboard.press('Enter')
  await p.getByRole('alert').waitFor()
  console.log(tag, 'bad token  ->', await p.getByRole('alert').innerText())

  await p.getByLabel('Personal access token').fill('github_pat_none')
  await p.keyboard.press('Enter')
  await p.getByText(/see any repository yet/).waitFor()
  await shot(p, `${tag}-4-fix-access`)
  console.log(tag, 'no access  ->', (await p.getByRole('alert').innerText()).split('\n')[0])

  await p.getByLabel('Personal access token').fill('github_pat_good_123')
  await p.keyboard.press('Enter')
  await p.getByText('Connected to alice/mountain-of-tasks-data').waitFor()
  await shot(p, `${tag}-5-pin`)
  console.log(tag, 'good token -> PIN step; page errors:', errs.length ? errs : 'none')
  await ctx.close()
}
await b.close()
