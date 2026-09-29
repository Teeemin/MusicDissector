import { expect, test } from '@playwright/test'
import { taggedWav } from './fixtures/audio'

test('copy, footer typography and pastel theme remain consistent', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.brand-title')).toHaveText('Music Dissector')
  await expect(page.locator('.brand-subtitle')).toHaveText('음악해체분석기')
  await expect(page.getByRole('heading', { name: '02 재생기' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '04 Dissector' })).toBeVisible()
  for (const text of ['로컬 플레이어', '설정 미리보기', '좋아하는 음악, 나만의 속도로.', 'LOCAL FIRST', 'PRIVATE BY DESIGN']) {
    await expect(page.getByText(text, { exact: false })).toHaveCount(0)
  }
  const credit = page.locator('.workspace-footer > span')
  await expect(credit).toHaveText('Made By KTM - MuDissector')
  await expect(credit).toHaveCSS('font-size', '8px')
  await expect(credit).toHaveCSS('font-weight', '400')
  await expect(credit).toHaveCSS('letter-spacing', '1px')
  const footer = await page.locator('.workspace-footer').boundingBox()
  const creditBox = await credit.boundingBox()
  expect(creditBox!.x + creditBox!.width).toBeCloseTo(footer!.x + footer!.width, 0)
  await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(255, 255, 255)')
  await expect(page.locator('.lyrics-panel')).toHaveCSS('background-color', 'rgb(237, 245, 255)')
  for (const width of [320, 412, 800]) {
    await page.setViewportSize({ width, height: 915 })
    const contact = page.getByText('Contact: mindalpang27@naver.com', { exact: true })
    await expect(contact).toBeVisible()
    const box = await contact.boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(width)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
})

test('mute and multiple solo buttons have distinct persistent active colors', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('음악 파일', { exact: true }).setInputFiles(taggedWav())
  const mute = page.getByRole('button', { name: 'Vocals Mute', exact: true })
  const solos = ['Vocals Solo', 'Guitar Solo'].map(name => page.getByRole('button', { name, exact: true }))
  await expect(mute).toBeEnabled()
  await expect(mute).toHaveCSS('background-color', 'rgb(238, 245, 253)')
  for (const control of [mute, ...solos]) {
    await control.click()
    await expect(control).toHaveAttribute('aria-pressed', 'true')
    await expect(control).toHaveCSS('background-color', 'rgb(3, 90, 166)')
    await expect(control).toHaveCSS('color', 'rgb(255, 255, 255)')
    await control.hover()
    await expect(control).toHaveCSS('background-color', 'rgb(3, 90, 166)')
  }
  for (const solo of solos) await expect(solo).toHaveCSS('background-color', 'rgb(3, 90, 166)')
  await mute.click()
  await page.locator('.brand-title').hover()
  await expect(mute).toHaveCSS('background-color', 'rgb(238, 245, 253)')
  await expect(mute).toHaveAttribute('aria-pressed', 'false')
})

test('buttons press without moving layout and reduced motion disables animation', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('음악 파일', { exact: true }).setInputFiles(taggedWav({ lyrics: '가사 내용' }))
  await expect(page.getByRole('button', { name: '재생', exact: true })).toBeEnabled()
  for (const button of await page.locator('button:visible').all()) {
    await expect(button).toHaveCSS('transition-property', 'transform, background-color, color, border-color')
  }
  for (const name of ['재생', '10초 앞으로', 'Vocals Mute', 'Vocal Only', '가사']) {
    const button = page.getByRole('button', { name, exact: true })
    await button.scrollIntoViewIfNeeded()
    const before = await button.evaluate(element => [element.offsetLeft, element.offsetTop, element.offsetWidth, element.offsetHeight])
    await button.hover()
    await page.mouse.down()
    await expect(button).toHaveCSS('transform', 'matrix(0.97, 0, 0, 0.97, 0, 0)')
    expect(await button.evaluate(element => [element.offsetLeft, element.offsetTop, element.offsetWidth, element.offsetHeight])).toEqual(before)
    // Release away from the button: inspect the press effect without invoking its action.
    await page.mouse.move(0, 0)
    await page.mouse.up()
    await expect(button).toHaveCSS('transform', 'none')
  }
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const toggle = page.getByRole('button', { name: '가사', exact: true })
  await toggle.hover(); await page.mouse.down()
  await expect(toggle).toHaveCSS('transform', 'none')
  await expect(toggle).toHaveCSS('transition-duration', '0s')
  await expect(page.locator('.lyrics-collapse')).toHaveCSS('transition-duration', '0s')
  await page.mouse.up()
})
