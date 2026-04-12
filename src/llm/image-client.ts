/**
 * GLM-Image 图片生成客户端
 *
 * 调用智谱 GLM-Image 模型，从文本生成图片。
 * 文档：https://docs.bigmodel.cn/cn/guide/models/image-generation/glm-image
 */

export interface ImageGenerationRequest {
  prompt: string
  size?: string   // 默认 "1024x1024"，支持 1280x1280, 1568x1056, 1056x1568, 1728x960, 960x1728 等
  model?: string  // 默认 "glm-image"
}

export interface ImageGenerationResponse {
  created: number
  data: Array<{
    url: string
  }>
}

export class ImageClient {
  private apiKey: string
  private endpoint: string

  constructor() {
    this.apiKey = process.env.ZHIPU_API_KEY || ''
    this.endpoint = 'https://open.bigmodel.cn/api/paas/v4/images/generations'
    if (!this.apiKey) throw new Error('需要设置 ZHIPU_API_KEY 环境变量')
  }

  async generate(request: ImageGenerationRequest): Promise<ImageGenerationResponse> {
    const body = {
      model: request.model || 'glm-image',
      prompt: request.prompt,
      size: request.size || '1024x1024',
    }

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`GLM-Image API error ${response.status}: ${text}`)
    }

    return response.json()
  }
}
