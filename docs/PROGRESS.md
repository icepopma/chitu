# 赤兔 (Chitu) 进度记录

## 已完成的步骤

- [x] **第 1 步：调通 GLM-5 API** ✅ 测试通过
- [x] **第 2 步：Tool 系统 (exec 工具 + Registry)** ✅ 测试通过
- [x] **第 3 步：Agent Loop** ✅ 测试通过
  - 核心 while 循环：LLM → tool_calls → 执行 → 循环
  - 简单任务 2 轮完成，多步任务 2 轮完成
  - 1176 / 1008 tokens
- [x] **第 4 步：文件工具 (read/write/edit)** ✅ 测试通过
  - Agent 自主完成：创建目录 → 写文件 → 编辑文件 → 读取验证
  - 2 轮循环，1690 tokens

## 当前步骤

- [ ] **第 5 步：Thread/Turn/Item**
- [ ] **第 6 步：WebSocket 服务器**
- [ ] **第 7 步：前端**
- [ ] **第 8 步：上下文压缩**

## 里程碑记录

### 2026-04-04：Agent 自主运行能力达成 🎉

**完成了什么**：Agent 能自主接收任务、循环执行工具、直到任务完成。

**怎么完成的**：
- Agent Loop (agent/loop.ts) 实现 while 循环
- 4 个核心工具：exec, read_file, write_file, edit_file
- Tool Registry 模式让工具可扩展

**遇到的问题**：
1. API endpoint 路径错误 → 改为 coding endpoint
2. .env 文件不自动加载 → 安装 dotenv
3. tsconfig 缺少 "types": ["node"] → process.env 报红
