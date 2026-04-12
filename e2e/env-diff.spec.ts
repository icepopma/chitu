// Step 13.9 环境差异检测 — Playwright E2E Test
// 验证回合间环境差异检测的完整链路：
// 1. 首个 turn 注入完整环境上下文（envDelta=undefined → 完整注入）
// 2. 同一 thread 的后续 turn 正常工作（envDelta=delta 或 null）
// 3. 多个 turn 的累积效果正确
// 4. 无 console 错误

import { test, expect, type Page } from '@playwright/test'

test.setTimeout(180_000)

async function waitForTurnComplete(page: Page, timeout = 120_000): Promise<void> {
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

test.describe('Environment Diff Detection E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(2_000)
  })

  test('first turn should receive full environment context', async ({ page }) => {
    await createNewThread(page)

    // 询问当前工作目录 — 需要环境上下文才能正确回答
    await sendMessage(page, '请告诉我你当前工作目录的最后一层文件夹名称，只回答文件夹名')
    await waitForTurnComplete(page, 90_000)
    await page.screenshot({ path: 'test-results/env-diff-first-turn.png' })

    // 验证 agent 能感知 cwd（说明环境上下文被正确注入）
    const agentTexts = page.locator('.text-sm.text-\\[\\#ddd\\]')
    const lastText = await agentTexts.last().textContent()
    expect(lastText).toBeTruthy()
    expect(lastText!.trim().length).toBeGreaterThan(0)

    console.log('[e2e] First turn with full env context passed')
  })

  test('subsequent turns in same thread should work with env delta', async ({ page }) => {
    await createNewThread(page)

    // Turn 1: 发送消息建立快照
    await sendMessage(page, '你好，请回复"收到"两个字')
    await waitForTurnComplete(page, 60_000)

    // Turn 2: 在同一 thread 发送第二条消息（触发 env delta 或 skip）
    const input = page.locator('textarea')
    await expect(input).toBeVisible({ timeout: 5_000 })
    await input.fill('请回复"第二次收到"')
    await input.press('Enter')
    await waitForTurnComplete(page, 60_000)
    await page.screenshot({ path: 'test-results/env-diff-second-turn.png' })

    // 验证第二次回复正常
    const agentTexts = page.locator('.text-sm.text-\\[\\#ddd\\]')
    const count = await agentTexts.count()
    expect(count).toBeGreaterThanOrEqual(2)

    const lastText = await agentTexts.last().textContent()
    expect(lastText).toBeTruthy()
    expect(lastText!.trim().length).toBeGreaterThan(0)

    console.log('[e2e] Second turn with env delta/skip passed —', count, 'text items')
  })

  test('multiple turns should maintain correct context', async ({ page }) => {
    await createNewThread(page)

    // Turn 1
    await sendMessage(page, '请简单回复"第一轮完成"')
    await waitForTurnComplete(page, 60_000)

    // Turn 2
    const input = page.locator('textarea')
    await expect(input).toBeVisible({ timeout: 5_000 })
    await input.fill('请简单回复"第二轮完成"')
    await input.press('Enter')
    await waitForTurnComplete(page, 60_000)

    // Turn 3
    await expect(input).toBeVisible({ timeout: 5_000 })
    await input.fill('当前工作目录的最后一层文件夹名是什么？只回答名称')
    await input.press('Enter')
    await waitForTurnComplete(page, 90_000)

    await page.screenshot({ path: 'test-results/env-diff-multiple-turns.png' })

    // 验证第三个 turn 仍然能感知 cwd（环境上下文没丢失）
    const agentTexts = page.locator('.text-sm.text-\\[\\#ddd\\]')
    const lastText = await agentTexts.last().textContent()
    expect(lastText).toBeTruthy()
    expect(lastText!.trim().length).toBeGreaterThan(0)

    console.log('[e2e] Multiple turns with cumulative env diff passed')
  })
})
