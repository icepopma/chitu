// Step 13.6 分层 AGENTS.md 收集 — Playwright E2E Test
// 验证分层 AGENTS.md 收集的完整链路：
// 1. Agent 能感知项目根目录的 AGENTS.md（向后兼容）
// 2. Agent 能回答关于 AGENTS.md 内容的问题（证明被注入了上下文）

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

test.describe('Hierarchical AGENTS.md E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(2_000)
  })

  test('should load root AGENTS.md and agent can reference project info', async ({ page }) => {
    await createNewThread(page)

    // 问一个只有读了 AGENTS.md 才能回答的问题
    // 赤兔的 AGENTS.md 描述了项目是 "赤兔 (Chitu)" 和 "Codex 对齐"
    await sendMessage(page, 'AGENTS.md 中描述的这个项目叫什么名字？只需要回答项目名字')
    await waitForTurnComplete(page, 90_000)
    await page.screenshot({ path: 'test-results/hierarchical-root-agents.png' })

    const agentTexts = page.locator('.text-sm.text-\\[\\#ddd\\]')
    const lastText = await agentTexts.last().textContent()
    expect(lastText).toBeTruthy()
    // Agent 应该能从 AGENTS.md 中知道项目叫"赤兔"或"Chitu"
    const lower = lastText!.toLowerCase()
    const hasName = lower.includes('赤兔') || lower.includes('chitu')
    expect(hasName).toBeTruthy()

    console.log('[e2e] Root AGENTS.md test passed — agent responded with:', lastText?.slice(0, 200))
  })

  test('should work normally for general questions', async ({ page }) => {
    await createNewThread(page)

    await sendMessage(page, '请简单回复"分层测试通过"五个字')
    await waitForTurnComplete(page, 60_000)

    const agentTexts = page.locator('.text-sm.text-\\[\\#ddd\\]')
    const lastText = await agentTexts.last().textContent()
    expect(lastText).toBeTruthy()
    expect(lastText!.trim().length).toBeGreaterThan(0)

    console.log('[e2e] Normal response test passed')
  })
})
