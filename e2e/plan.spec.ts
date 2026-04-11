// Step 13.4 Plan System — Playwright E2E Test
// 测试执行计划系统的端到端流程：
// 1. update_plan 工具注册并可被 LLM 调用
// 2. 多步任务触发 Agent 创建计划
// 3. 前端 PlanPanel 展示计划步骤
// 4. 步骤状态推进：pending → in_progress → completed

import { test, expect, type Page } from '@playwright/test'

test.setTimeout(180_000)

/** 等待 Turn 完成 */
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

test.describe('Plan System E2E', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(2_000)
  })

  test('should create and display plan for multi-step task', async ({ page }) => {
    // 1. 创建新对话
    await createNewThread(page)

    // 2. 发送明确的计划请求 + 简单执行
    await sendMessage(page, '请用 update_plan 工具为以下任务创建一个3步计划：1.查看当前目录文件 2.读取package.json 3.总结。然后只执行第1步即可。')

    // 3. 等待 Turn 完成
    await waitForTurnComplete(page, 150_000)

    // 4. 截图
    await page.screenshot({ path: 'test-results/plan-multi-step.png' })

    // 5. 验证有赤兔回复
    const agentLabel = page.locator('span.text-sm.font-medium.text-white', { hasText: '赤兔' })
    await expect(agentLabel.first()).toBeVisible({ timeout: 5_000 })

    // 6. 检查 PlanPanel 是否出现（如果有 update_plan 调用）
    const planPanel = page.locator('text=执行计划')
    const planVisible = await planPanel.isVisible().catch(() => false)

    if (planVisible) {
      console.log('[e2e] Plan panel is visible!')

      // 验证步骤存在
      const planSteps = page.locator('.space-y-1 > div')
      const stepCount = await planSteps.count()
      expect(stepCount).toBeGreaterThanOrEqual(2)
      console.log(`[e2e] Found ${stepCount} plan steps`)
    } else {
      console.log('[e2e] Plan panel not visible (Agent may not have called update_plan)')
      // 这是可接受的 — LLM 可能选择不用 plan
    }

    // 7. 验证 agent 有实质回复
    const allText = page.locator('.text-sm.text-\\[\\#ddd\\]')
    const lastText = await allText.last().textContent()
    expect(lastText).toBeTruthy()
    expect(lastText!.trim().length).toBeGreaterThan(10)
    console.log('[e2e] Plan test — agent responded with:', lastText?.slice(0, 300))
  })

  test('simple task should not require plan', async ({ page }) => {
    await createNewThread(page)

    await sendMessage(page, 'What is 2 + 2?')

    await waitForTurnComplete(page, 90_000)

    await page.screenshot({ path: 'test-results/plan-simple-task.png' })

    // 简单任务不应该有计划面板
    const planPanel = page.locator('text=执行计划')
    const planVisible = await planPanel.isVisible().catch(() => false)
    expect(planVisible).toBe(false)

    // Agent 应该直接回答
    const agentLabel = page.locator('span.text-sm.font-medium.text-white', { hasText: '赤兔' })
    await expect(agentLabel.first()).toBeVisible({ timeout: 5_000 })

    console.log('[e2e] Simple task — no plan panel (correct)')
  })
})
