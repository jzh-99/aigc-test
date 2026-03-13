export interface AdapterGenerateResult {
  success: boolean
  outputUrl?: string
  errorMessage?: string
}

export interface ImageGenerationAdapter {
  readonly providerCode: string
  generateImage(params: {
    model: string
    prompt: string
    params: Record<string, unknown>
  }): Promise<AdapterGenerateResult>
}
