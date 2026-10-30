// Regenerates the README screenshots and demo animations in docs/.
//   npm run shots        (needs Python 3 with Pillow for the animated WebPs)
// Runs the app locally in "this device only" mode with a seeded demo board; nothing touches GitHub.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, devices } from '@playwright/test'
import { createServer } from 'vite'

let BASE = ''
const OUT = 'docs'
const FRAMES = mkdtempSync(join(tmpdir(), 'mot-frames-'))
mkdirSync(OUT, { recursive: true })

async function seed(page, deviceName) {
  await page.goto(BASE)
  await page.getByRole('button', { name: 'Use on this device only, without sync' }).click()
  await page.evaluate(async (deviceName) => {
    const a = await import('/MountainOfTasks/src/lib/actions.ts')
    const { replay } = await import('/MountainOfTasks/src/lib/model.ts')
    const { db, setKv } = await import('/MountainOfTasks/src/lib/db.ts')
    const { between } = await import('/MountainOfTasks/src/lib/frac.ts')
    await setKv('device', deviceName)
    const st = async () => replay(await db.events.toArray())
    const bid = await a.createBoard('Summit 2026')
    localStorage.setItem('board', bid)
    let s = await st()
    const [todo, doing, done] = Object.values(s.boards[bid].columns).sort((x, y) => (x.pos < y.pos ? -1 : 1))
    await a.updateColumn(bid, doing.id, { wip: 3 })
    const L = {
      design: await a.createLabel('Design', '#7c5cff'),
      bug: await a.createLabel('Bug', '#e5484d'),
      sync: await a.createLabel('Sync', '#12a594'),
      docs: await a.createLabel('Docs', '#f5a524'),
    }
    const plan = [
      [todo, 'Write onboarding guide', { labels: [L.docs], priority: 'low', due: '2026-11-14' }],
      [todo, 'Keyboard shortcuts cheat sheet', { labels: [L.docs] }],
      [todo, 'Fix due-date timezone drift', { labels: [L.bug], priority: 'high', due: '2026-11-02' }],
      [todo, 'Export board as CSV', { priority: 'med' }],
      [doing, 'Redesign card modal', {
        labels: [L.design], priority: 'high', due: '2026-11-05',
        description: '## Goals\n- Two-column layout on desktop\n- **Checklist** progress in header\n- Inline label picker\n\nSee `CardModal.tsx`.',
        checklist: [
          { id: 'c1', text: 'Sketch layout', done: true },
          { id: 'c2', text: 'Label picker', done: true },
          { id: 'c3', text: 'Mobile sheet', done: false },
          { id: 'c4', text: 'Dark mode pass', done: false },
        ],
      }],
      [doing, 'Retry push on ref race', { labels: [L.sync], priority: 'med' }],
      [done, 'Encrypt token with PIN', { labels: [L.sync] }],
      [done, 'Fractional card ordering', {}],
      [done, 'Installable PWA', { labels: [L.design] }],
    ]
    const last = {}
    for (const [col, title, fields] of plan) {
      last[col.id] = between(last[col.id] ?? null, null)
      await a.addCard(bid, col.id, title, last[col.id])
      s = await st()
      const card = Object.values(s.cards).find((c) => c.title === title)
      if (Object.keys(fields).length) await a.updateCard(card, fields)
      if (title === 'Redesign card modal') await a.addComment(card, 'Moved the checklist above the description, reads better on phone.')
    }
  }, deviceName)
  await page.reload()
  await page.getByText('Redesign card modal').first().waitFor()
}

async function theme(page, t) {
  await page.evaluate(async (t) => {
    const { setKv } = await import('/MountainOfTasks/src/lib/db.ts')
    await setKv('theme', t); localStorage.setItem('theme', t)
  }, t)
  await page.waitForTimeout(400)
}

// Screenshots don't include the OS pointer, so draw one: an arrow on desktop, a touch dot on phone.
const pointer = (touch) => `
  addEventListener('DOMContentLoaded', () => {
    const p = document.createElement('div')
    p.id = 'demo-pointer'
    p.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;display:none;transition:opacity .15s'
    p.innerHTML = ${JSON.stringify(touch
      ? '<div style="width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;background:rgba(120,120,120,.35);border:2px solid rgba(255,255,255,.9)"></div>'
      : '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M3 2l7 19 2.5-7.5L20 11z" fill="#111" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>')}
    document.body.append(p)
    const at = (e) => { p.style.display = 'block'; p.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)' }
    addEventListener('pointermove', at, true)
    addEventListener('pointerdown', (e) => { at(e); p.style.opacity = '1' }, true)
    ${touch ? "addEventListener('pointerup', () => setTimeout(() => { p.style.opacity = '0' }, 150), true); p.style.opacity = '0'" : ''}
  })`

// Screenshots at a steady interval while `fn` runs; the file name carries the timestamp for frame timing.
async function record(page, name, fn) {
  let i = 0, on = true
  const dir = join(FRAMES, name)
  mkdirSync(dir, { recursive: true })
  const loop = (async () => {
    while (on) {
      await page.screenshot({ path: join(dir, `${String(i++).padStart(4, '0')}_${Date.now()}.png`), scale: 'css' })
      await page.waitForTimeout(30)
    }
  })()
  await fn()
  await page.waitForTimeout(700)
  on = false
  await loop
}

async function drag(page, text, target, dy) {
  const from = await page.locator('article').filter({ hasText: text }).first().boundingBox()
  const to = await page.locator(`section[aria-label="${target}"]`).boundingBox()
  await page.mouse.move(from.x + 30, from.y + 15, { steps: 8 })
  await page.mouse.down()
  await page.mouse.move(from.x + 45, from.y + 25, { steps: 4 })
  await page.mouse.move(to.x + to.width / 2, to.y + dy, { steps: 25 })
  await page.waitForTimeout(250)
  await page.mouse.up()
}

async function addCard(page, title) {
  const todo = page.locator('section[aria-label="To do"]')
  await todo.getByRole('button', { name: 'Add a card' }).click()
  await todo.getByPlaceholder('Card title').pressSequentially(title, { delay: 70 })
  await todo.getByPlaceholder('Card title').press('Enter')
  await todo.getByPlaceholder('Card title').press('Escape')
}

const server = await createServer({ server: { port: 5199 }, logLevel: 'warn' }) // takes the next free port if busy
await server.listen()
BASE = server.resolvedUrls.local[0]
const browser = await chromium.launch()
try {
  // Web
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 }, locale: 'en-US' })
    await ctx.addInitScript(pointer(false))
    const page = await ctx.newPage()
    await seed(page, 'Laptop')
    const board = { clip: { x: 0, y: 0, width: 1100, height: 500 } }
    await theme(page, 'light')
    await page.screenshot({ path: `${OUT}/desktop-light.png`, ...board })
    await theme(page, 'dark')
    await page.screenshot({ path: `${OUT}/desktop-dark.png`, ...board })
    await page.getByText('Redesign card modal').first().click()
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUT}/desktop-card.png` })
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    // Type straight after Ctrl+K, as a person would: keys must not be lost while the palette mounts.
    await page.keyboard.press('Control+k')
    await page.keyboard.type('modal')
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${OUT}/desktop-palette.png`, clip: { x: 0, y: 0, width: 1440, height: 420 } })
    await page.keyboard.press('Escape')
    await theme(page, 'light')
    await record(page, 'desktop', async () => {
      await page.waitForTimeout(400)
      await drag(page, 'Fix due-date timezone drift', 'Doing', 140)
      await page.waitForTimeout(600)
      await addCard(page, 'Plan the next climb')
      await page.waitForTimeout(600)
      await drag(page, 'Retry push on ref race', 'Done', 90)
    })
    await ctx.close()
  }

  // Phone
  {
    const ctx = await browser.newContext({ ...devices['iPhone 14'], locale: 'en-US' })
    await ctx.addInitScript(pointer(true))
    const page = await ctx.newPage()
    await seed(page, 'iPhone')
    await theme(page, 'light')
    await page.screenshot({ path: `${OUT}/phone-light.png` })
    await theme(page, 'dark')
    await page.screenshot({ path: `${OUT}/phone-dark.png` })
    await page.getByText('Redesign card modal').first().click()
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUT}/phone-card.png` })
    await page.keyboard.press('Escape')
    await theme(page, 'light')
    await record(page, 'phone', async () => {
      await page.waitForTimeout(400)
      await addCard(page, 'Pack crampons')
      await page.waitForTimeout(500)
      await page.getByText('Write onboarding guide').first().click()
      await page.waitForTimeout(600)
      await page.getByPlaceholder('Add an item').pressSequentially('Screenshots', { delay: 70 })
      await page.getByPlaceholder('Add an item').press('Enter')
      await page.waitForTimeout(400)
      await page.getByRole('checkbox').first().click()
      await page.waitForTimeout(600)
      await page.getByRole('button', { name: 'Close' }).first().click()
      await page.waitForTimeout(500)
      // Swipe through the columns via the dots under the board.
      await page.getByRole('button', { name: 'Doing', exact: true }).click()
      await page.waitForTimeout(900)
      await page.getByRole('button', { name: 'Done', exact: true }).click()
      await page.waitForTimeout(900)
    })
    await ctx.close()
  }
} finally {
  await browser.close()
  await server.close()
}

const py = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3')
execFileSync(py, ['scripts/anim.py', FRAMES, OUT], { stdio: 'inherit' })
rmSync(FRAMES, { recursive: true, force: true })
