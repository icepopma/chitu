import { test, expect, type Page } from '@playwright/test'
import { writeFileSync, rmSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'

test.setTimeout(180_000)

const PLANS_CONTENT = `# Implementation Plan

## Verification Checklist
- [ ] M1: Create Test File

## M1: Create Test File
- **Scope**: Create a simple test file
- **Key Files**: \`checkpoint-test.txt\`
- **Acceptance Criteria**:
  - File exists with expected content
- **Verification Commands**: \`cat checkpoint-test.txt\`
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

test.describe('Git Checkpoint E2E', () => {

  test.beforeEach(async ({ page }) => {
    writeFileSync('plans.md', PLANS_CONTENT, 'utf-8')
    if (existsSync('checkpoint-test.txt')) rmSync('checkpoint-test.txt')
    await page.goto('/')
    await page.waitForTimeout(2_000)
  })

  test.afterEach(async () => {
    if (existsSync('plans.md')) rmSync('plans.md')
    if (existsSync('checkpoint-test.txt')) rmSync('checkpoint-test.txt')
  })

  test('should create git checkpoint via tool', async ({ page }) => {
    await createNewThread(page)
    await sendMessage(page, '用 exec 工具创建文件 checkpoint-test.txt 写入内容 "hello checkpoint"，然后用 git_checkpoint 工具创建一个 checkpoint，消息写 "added test file"。')

    await waitForTurnComplete(page, 150_000)

    const logOutput = execSync('git log --oneline -3', { encoding: 'utf-8' })
    console.log('[E2E] git log after checkpoint:', logOutput)
    expect(logOutput).toContain('checkpoint')

    await page.screenshot({ path: 'e2e/screenshots/git-checkpoint.png' })
  })

  test('should complete milestone and auto-checkpoint', async ({ page }) => {
    await createNewThread(page)
    await sendMessage(page, '请完成以下操作：1) 用 exec 创建文件 checkpoint-test.txt 写入 "milestone test"。2) 用 milestone_plan 工具的 start 命令开始 M1。3) 用 milestone_plan 的 complete 命令完成 M1。每一步都要确认成功。')

    await waitForTurnComplete(page, 180_000)

    const logOutput = execSync('git log --oneline -3', { encoding: 'utf-8' })
    console.log('[E2E] git log after milestone complete:', logOutput)
    expect(logOutput).toContain('milestone')

    if (existsSync('plans.md')) {
      const planContent = execSync('cat plans.md', { encoding: 'utf-8' })
      expect(planContent).toContain('completed')
    }

    await page.screenshot({ path: 'e2e/screenshots/milestone-auto-checkpoint.png' })
  })
})
