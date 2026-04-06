/**
 * Tool 接口 — 所有工具都要实现这个接口
 *
 * 学习重点：
 * - 一个 Tool 有两部分：定义（给 LLM 看的）+ 执行（我们自己跑的）
 * - 定义用 JSON Schema 描述参数，让 LLM 知道怎么调用
 * - execute 拿到参数，执行操作，返回字符串结果
 */

/** 工具执行结果 */
export interface ToolResult {
  content: string      // 结果文本
  isError?: boolean    // 是否出错
  exitCode?: number    // 退出码（exec 工具专用，0=成功，非0=失败）
}

/** 工具接口 — 所有工具必须实现 */
export interface Tool {
  /** 工具名字（LLM 调用时用这个名字） */
  name: string

  /** 工具描述（告诉 LLM 这个工具能干什么） */
  description: string

  /** 参数的 JSON Schema（告诉 LLM 需要传什么参数） */
  parameters: Record<string, unknown>

  /** 执行工具 */
  execute(args: Record<string, unknown>): Promise<ToolResult>
}

/**
 * 把 Tool 转换成 GLM function calling 格式
 * GLM 需要的格式是 { type: "function", function: { name, description, parameters } }
 */
export function toolToDefinition(tool: Tool) {
  return {
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }
}
