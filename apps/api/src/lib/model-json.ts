type ModelJsonFields = {
  category_references?: unknown
  params_pricing?: unknown
  params_schema?: unknown
}

function parseNestedJson(value: unknown): unknown {
  let current = value

  for (let i = 0; i < 2 && typeof current === 'string'; i++) {
    const trimmed = current.trim()
    if (!trimmed) return current

    try {
      current = JSON.parse(trimmed)
    } catch {
      return current
    }
  }

  return current
}

function normalizeJsonObject(value: unknown): unknown {
  const parsed = parseNestedJson(value)
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
}

function normalizeJsonArray(value: unknown): unknown[] {
  const parsed = parseNestedJson(value)
  if (Array.isArray(parsed)) return parsed

  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>
    if ('resolution' in obj && 'model' in obj && 'unit_price' in obj) {
      return [obj]
    }

    const values = Object.values(obj)
    if (values.every((item) => item && typeof item === 'object')) {
      return values
    }
  }

  return []
}

export function normalizeModelJsonFields<T extends ModelJsonFields>(model: T): T {
  return {
    ...model,
    category_references: normalizeJsonObject(model.category_references),
    params_pricing: normalizeJsonArray(model.params_pricing),
    params_schema: normalizeJsonObject(model.params_schema),
  }
}
