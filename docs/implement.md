# 赤兔执行手册 (Implementation Runbook)

本文件是赤兔自主运行的执行手册。严格遵循。

## 不可违反的约束

- **不要在一个 milestone 完成后停下来问问题或等待确认。**
- **按 plans.md 中的顺序，逐个完成每个 milestone，直到全部完成并验证通过。**

## 执行规则（严格遵守）

### 1. plans.md 是唯一真相源
- 把 `plans.md` 当作项目的唯一计划文档
- 如果有歧义，做出合理决定并立即用 `milestone_plan decision` 记录到 plans.md
- 不要自行扩大 scope — 只做 milestone 定义范围内的事

### 2. 每个 milestone 的执行流程
```
milestone_plan next       → 获取当前/下一个 milestone
milestone_plan start M<N> → 标记为 in_progress
[实现代码]                 → 按 scope 和 key files 实现
[运行验证]                 → 跑 verification commands
[修复失败]                 → 如果验证失败，立即修复，再验证
milestone_plan complete M<N> → 标记完成（自动 git commit）
```

### 3. 验证要求
- 每个 milestone 完成后**必须**运行它的 `verification commands`
- 验证失败**立即修复**，修完再验证，不要跳到下一个 milestone
- 始终先跑 `npx tsc --noEmit`，这是最基本的类型安全检查
- 如果修复需要超过 3 次尝试，用 `milestone_plan fail` 标记失败并记录原因

### 4. 代码质量
- 保持 diffs 小且可审查，不要把不相关的改动捆在一起
- commit 信息要清晰，引用 milestone 名称
- 不要引入 plans.md scope 外的新功能
- 不要删除或修改已有测试（除非那个测试本身就是错的）

### 5. 文档要求
- 实现 `documentation.md` 并持续更新，让它始终反映项目当前状态
- 每完成一个 milestone，更新 documentation.md 中的状态
- 用 `milestone_plan decision` 记录设计决策及原因
- 用 `milestone_plan note` 记录实现笔记

### 6. Bug 处理
- 发现 bug 时：
  1. 先写一个能复现的测试
  2. 修复 bug
  3. 确认测试通过
  4. 在 plans.md 的当前 milestone 下用 `milestone_plan note` 记录

### 7. 错误恢复
- 如果某个 milestone 实现失败，使用 `git_rollback` 回退到上一个检查点
- 换一个不同的方法重试
- 如果重试 3 次仍然失败，用 `milestone_plan fail` 标记并继续下一个

## 完成标准（全部满足才停止）

- plans.md 中所有 milestones 都标记为 completed 或有合理理由标记为 failed
- `npx tsc --noEmit` 通过（0 errors，排除 vitest 声明）
- `npm test` 通过
- `npm run build` 通过
- `npm run dev` + `cd web-ui && npm run dev` 能正常启动
- documentation.md 准确反映最终状态
- README.md 包含完整的安装、使用、开发说明
- CLAUDE.md 包含所有新模块的架构说明

## 现在开始

读取 `plans.md`，从第一个 pending 的 milestone 开始。不要停止，直到全部完成。
