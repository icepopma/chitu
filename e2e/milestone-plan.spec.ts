import { test, expect, type Page } from '@playwright/test'
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'

test.setTimeout(180_000)

const PLANS_CONTENT = `# Implementation Plan

## Verification Checklist
- [ ] M1: Test Feature
- [ ] M2: Another Feature

## M1: Test Feature
- **Scope**: A test milestone for E2E testing
- **Key Files**: \`test.txt\`
- **Acceptance Criteria**:
  - A file is created
  - Content is correct
- **Verification Commands**: \`cat test.txt\`
- **Status**: pending

## M2: Another Feature
- **Scope**: Second milestone
- **Key Files**: \`test2.txt\`
- **Acceptance Criteria**:
  - Another file is created
- **Verification Commands**: \`cat test2.txt\`
- **Status**: pending
`

async function waitForTurnComplete(page: Page, timeout = 150_000): Promise<void> {
  await page.waitForFunction(() => {
    const statusEl = document.querySelector('.text-xs.text-\\[\\#43b581\\]')
    if (statusEl && statusEl.textContent?.includes('已完成')) return true
    const failedEl = document.querySelector('.text-xs.text-\\[\\#da373c\\]')
    if (failedEl) return true
    const labels = document.querySelectorAll('span.text-sm.font-medium.text-white')
    let chituCount = 0
    for (const label of labels) {
      if (label.textContent === '赤兔') chituCount++
    }
    if (chituCount >= 1) return true
    return false
  }, { timeout })
}

async function sendMessage(page: Page, message: string): Promise<void> {
  const input = page.locator('textarea')
  await expect(input).toBeVisible({ timeout: 10_000 })
  await input.fill(message)
  await input.press('Enter')
}

async function createNewThread(page: Page): Promise<void> {
  const newBtn = page.locator('button').filter({ hasText: '新建' }).first()
  await newBtn.click()
  await expect(page.locator('textarea')).toBeVisible({ timeout: 5_000 })
  await page.waitForTimeout(500)
}

test.describe('Milestone Plan E2E', () => {

  test.beforeEach(async ({ page }) => {
    writeFileSync('plans.md', PLANS_CONTENT, 'utf-8')
    await page.goto('/')
    await page.waitForTimeout(2_000)
  })

  test.afterEach(async () => {
    if (existsSync('plans.md')) rmSync('plans.md')
  })

  test('should read milestone plan', async ({ page }) => {
    await createNewThread(page)
    await sendMessage(page, '用 milestone_plan 工具的 read 命令读取项目的里程碑计划，告诉我有哪些里程碑。')

    await waitForTurnComplete(page, 150_000)

    const body = await page.locator('.flex-1.overflow-y-auto').first().textContent({ timeout: 5_000 })
    expect(body).toBeTruthy()
    console.log('[E2E] milestone_plan read response:', body?.slice(0, 200))

    await page.screenshot({ path: 'e2e/screenshots/milestone-read.png' })
  })

  test('should get next milestone', async ({ page }) => {
    await createNewThread(page)
    await sendMessage(page, '用 milestone_plan 工具的 next 命令查看下一个待完成的里程碑是什么，然后告诉我。')

    await waitForTurnComplete(page, 150_000)

    const body = await page.locator('.flex-1.overflow-y-auto').first().textContent({ timeout: 5_000 })
    expect(body).toBeTruthy()
    console.log('[E2E] milestone_plan next response:', body?.slice(0, 200))

    await page.screenshot({ path: 'e2e/screenshots/milestone-next.png' })
  })
})
