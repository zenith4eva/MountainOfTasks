import { test, expect } from '@playwright/test'

test('load, add card, drag, reload persists', async ({ page }) => {
  page.on('dialog', (d) => d.accept('Smoke board'))
  await page.goto('./')
  await page.getByRole('button', { name: 'Use on this device only, without sync' }).click()
  await page.getByRole('button', { name: 'Create a board' }).click()

  const todo = page.locator('section[aria-label="To do"]')
  const doing = page.locator('section[aria-label="Doing"]')
  await todo.getByRole('button', { name: 'Add a card' }).click()
  await todo.getByPlaceholder('Card title').fill('Climb the first ridge')
  await todo.getByPlaceholder('Card title').press('Enter')
  await todo.getByPlaceholder('Card title').press('Escape')
  const card = todo.getByText('Climb the first ridge')
  await expect(card).toBeVisible()

  // dnd-kit needs real pointer movement past its 6px activation distance
  const from = await card.boundingBox()
  const to = await doing.boundingBox()
  await page.mouse.move(from!.x + 20, from!.y + 10)
  await page.mouse.down()
  await page.mouse.move(from!.x + 40, from!.y + 20, { steps: 5 })
  await page.mouse.move(to!.x + to!.width / 2, to!.y + 60, { steps: 15 })
  await page.mouse.up()
  await expect(doing.getByText('Climb the first ridge')).toBeVisible()

  await page.reload()
  await expect(page.locator('section[aria-label="Doing"]').getByText('Climb the first ridge')).toBeVisible()
  await expect(page.locator('section[aria-label="To do"]').getByText('Climb the first ridge')).toHaveCount(0)
})

test('keys typed right after Ctrl+K reach the palette', async ({ page }) => {
  page.on('dialog', (d) => d.accept('Smoke board'))
  await page.goto('./')
  await page.getByRole('button', { name: 'Use on this device only, without sync' }).click()
  await page.getByRole('button', { name: 'Create a board' }).click()
  await page.keyboard.press('Control+k')
  await page.keyboard.type('theme')
  await expect(page.getByRole('dialog').getByRole('textbox')).toHaveValue('theme')
})
