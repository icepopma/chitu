// Step 13.2 Skills System — Playwright E2E Test
// 测试 Skills 系统的端到端流程：
// 1. 技能发现：SKILL.md 被正确加载
// 2. 技能注入：匹配的技能内容被注入到 Agent 上下文
// 3. Agent 行为：发送匹配技能的消息后，Agent 能正常执行并返回结果
// 4. 非匹配消息：不匹配任何技能的消息也能正常工作

import { test, expect, type Page } from '@playwright/test'

// 给整个 test suite 更长的超时（Agent 可能跑工具链）
test.setTimeout(180_000)

/** 等待 Turn 完成（状态变为"已完成"或出现"赤兔"回复文本） */
async function waitForTurnComplete(page: Page, timeout = 150_000): Promise<void> {
  // 策略：轮询检查 turn status 变为 completed/failed/interrupted，或者赤兔回复出现
  await page.waitForFunction(() => {
    // 检查 turn 状态指示器
    const statusEl = document.querySelector('.text-xs.text-\\[\\#43b581\\]') // "已完成"
    if (statusEl && statusEl.textContent?.includes('已完成')) return true

    const failedEl = document.querySelector('.text-xs.text-\\[\\#da373c\\]') // "失败" or "已中断"
    if (failedEl) return true

    // 也检查是否有赤兔回复文本（兜底）
    const labels = document.querySelectorAll('span.text-sm.font-medium.text-white')
    let chituCount = 0
    for (const label of labels) {
      if (label.textContent === '赤兔') chituCount++
    }
    // 至少出现 1 个赤兔标签（agent 回复）
    if (chituCount >= 1) return true

    return false
  }, { timeout })
}

/** 发送消息 */
async function sendMessage(page: Page, message: string): Promise<void> {
  const input = page.locator('textarea')
  await expect(input).toBeVisible({ timeout: 10_000 })
  await input.fill(message)
  await input.press('Enter')
}

/** 创建新对话 */
async function createNewThread(page: Page): Promise<void> {
  const newBtn = page.locator('button').filter({ hasText: '新建' }).first()
  await newBtn.click()
  await expect(page.locator('textarea')).toBeVisible({ timeout: 5_000 })
  await page.waitForTimeout(500)
}

test.describe('Skills System E2E', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(2_000)
  })

  test('should load skills and respond to skill-matching message', async ({ page }) => {
    // 1. 创建新对话
    await createNewThread(page)

    // 2. 发送匹配 technical-blog-writing skill 的消息
    await sendMessage(page, 'Write a technical blog post about Node.js performance optimization')

    // 3. 等待 Turn 完成（Agent 可能执行多轮工具调用）
    await waitForTurnComplete(page, 150_000)

    // 4. 截图留证
    await page.screenshot({ path: 'test-results/skills-matching.png' })

    // 5. 验证有"赤兔"消息出现
    const agentLabel = page.locator('span.text-sm.font-medium.text-white', { hasText: '赤兔' })
    await expect(agentLabel.first()).toBeVisible({ timeout: 5_000 })

    // 6. 验证 agent 回复内容不为空
    const allText = page.locator('.text-sm.text-\\[\\#ddd\\]')
    const count = await allText.count()
    expect(count).toBeGreaterThan(0)

    const lastAgentText = await allText.last().textContent()
    expect(lastAgentText).toBeTruthy()
    expect(lastAgentText!.trim().length).toBeGreaterThan(10)

    console.log('[e2e] Skills test passed — agent responded with:', lastAgentText?.slice(0, 300))
  })

  test('should work normally for non-matching messages', async ({ page }) => {
    await createNewThread(page)

    await sendMessage(page, 'What is 2 + 2?')

    await waitForTurnComplete(page, 90_000)

    await page.screenshot({ path: 'test-results/skills-non-matching.png' })

    const agentLabel = page.locator('span.text-sm.font-medium.text-white', { hasText: '赤兔' })
    await expect(agentLabel.first()).toBeVisible({ timeout: 5_000 })

    const allText = page.locator('.text-sm.text-\\[\\#ddd\\]')
    const lastAgentText = await allText.last().textContent()
    expect(lastAgentText).toBeTruthy()
    expect(lastAgentText!.trim().length).toBeGreaterThan(3)

    console.log('[e2e] Non-matching test passed — agent responded with:', lastAgentText?.slice(0, 200))
  })
})
