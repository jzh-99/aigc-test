export interface AdapterGenerateResult {
  success: boolean
  outputUrl?: string
  errorMessage?: string
  /** 适配器实际发给 AI 服务商的 HTTP 请求体（已脱敏） */
  requestPayload?: Record<string, unknown>
}

export interface ImageGenerationAdapter {
  readonly providerCode: string
  generateImage(params: {
    model: string
    prompt: string
    params: Record<string, unknown>
  }): Promise<AdapterGenerateResult>
}
