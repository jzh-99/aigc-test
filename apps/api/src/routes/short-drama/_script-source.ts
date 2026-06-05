import mammoth from 'mammoth'
import {
  SHORT_DRAMA_ORIGINAL_SCRIPT_MAX_CHARS,
  type ShortDramaState,
} from '@aigc/types'

export function normalizeShortDramaOriginalScript(input: string): string {
  const normalized = input.replace(/\r\n?/g, '\n').trim()
  if (!normalized) {
    throw new Error('原始剧本不能为空')
  }
  if (normalized.length > SHORT_DRAMA_ORIGINAL_SCRIPT_MAX_CHARS) {
    throw new Error(`原始剧本不能超过 ${SHORT_DRAMA_ORIGINAL_SCRIPT_MAX_CHARS} 字`)
  }
  return normalized
}

export function parseShortDramaTxtScriptBuffer(buffer: Buffer): string {
  return normalizeShortDramaOriginalScript(buffer.toString('utf8'))
}

export async function parseShortDramaDocxScriptBuffer(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer })
  return normalizeShortDramaOriginalScript(result.value)
}

export function getShortDramaSummarySourceText(state: ShortDramaState): {
  label: '用户创意' | '原始剧本'
  text: string
} {
  if (state.script.source === 'upload') {
    return {
      label: '原始剧本',
      text: normalizeShortDramaOriginalScript(state.script.originalScript),
    }
  }

  const prompt = state.script.originalPrompt.trim()
  if (!prompt) {
    throw new Error('缺少原始创意')
  }
  return { label: '用户创意', text: prompt }
}

export function buildShortDramaScriptSummaryPrompts(state: ShortDramaState): {
  systemPrompt: string
  userPrompt: string
} {
  const source = getShortDramaSummarySourceText(state)
  const isUploadedScript = source.label === '原始剧本'
  const systemPrompt = [
    '你是专业短剧编剧、导演和系列剧开发策划，熟悉短剧平台叙事节奏、制作可行性和视听表达。',
    isUploadedScript
      ? '请从用户提供的原始剧本中提炼适合连续短剧制作的中文结构化剧集设定，保留原剧本的核心人物、事件、关系、冲突和结局，不要凭空改写成另一个故事。'
      : '请根据用户创意生成适合连续短剧制作的中文结构化剧集设定，既要有强情节爽点，也要能指导导演、摄影、妆造、布景、灯光等岗位进入后续创作。',
    '只输出 JSON 对象，字段为 title 和 summary，不要输出 markdown、代码块或额外解释。',
    'summary 必须是可直接展示给用户的纯文本，使用清晰的中文小标题和换行分段。',
    'summary 必须包含：集数、故事类型、目标受众、核心梗、一句话故事、人物小传、故事梗概、导演阐述、影像风格、妆造方向、核心场景与布景、灯光气质。',
    '人物小传需要覆盖主要角色，每个角色包含：角色类型、视觉形象、核心标签、身份背景、成长经历、性格特点、角色关系、成长弧线。',
    '人物小传中的“视觉形象”必须能直接指导角色定妆照：年龄段、性别、体型、脸型五官、肤色、发型、服装年代感、妆容状态和不可漂移的识别点都要写清楚。',
    '导演阐述需要说明表演风格、情绪节奏和每阶段观众期待；影像风格需要说明镜头倾向、色彩、构图和运动方式。',
    '妆造方向需要说明主要角色的服装、发型、妆面和身份变化；核心场景与布景需要说明地点质感、关键道具和可重复使用的主场景。',
    '核心场景与布景必须能指导场景概念图：场景类型、空间结构、陈设布置、年代还原、色彩基调、关键道具位置和可复用机位都要明确。',
    '灯光气质需要说明日夜、冷暖、明暗反差、光线来源、人物面部受光方向和情绪用途，避免只写“高级感、电影感”等空泛词。',
    `项目选择的视觉风格是“${state.settings.style}”，必须把它转译成具体的摄影、灯光、布景、妆造、表演和剪辑节奏要求，供后续素材图、片段脚本、视频生成继续引用。`,
    '内容要具体、可执行，避免空泛评价；角色关系可以使用“起点 -> [事件] -> 变化”的链路表达。',
  ].join('\n')

  const modeRequirements = isUploadedScript
    ? [
        '- 必须从原始剧本中提炼，不要新增原剧本没有支撑的主线、人物身份或关键事件。',
        '- 如果原始剧本已有分集结构，请按原结构归纳；如果没有明确分集，请根据项目集数整理为连续短剧结构。',
        '- 故事梗概要覆盖原始剧本的主线推进、关键反转、人物关系变化和结尾走向。',
      ].join('\n')
    : [
        '- 不要照抄示例中的具体人物，除非用户创意本身已经明确提到。',
      ].join('\n')

  const userPrompt = `${source.label}：${source.text}\n\n项目设置：\n- 集数：${state.settings.episodeCount}\n- 视觉风格：${state.settings.style}\n- 画面比例：${state.settings.aspectRatio}\n\n请生成剧本摘要，返回 JSON：\n{\n  "title": "短剧名",\n  "summary": "集数\\n${state.settings.episodeCount}\\n故事类型\\n现实权谋+重生改命+校园青春\\n目标受众\\n男频 / 大众\\n核心梗\\n...\\n一句话故事\\n...\\n人物小传\\n角色名\\n角色类型：...\\n视觉形象：...\\n核心标签：...\\n身份背景：...\\n成长经历：...\\n性格特点：...\\n角色关系：...\\n成长弧线：...\\n故事梗概\\n...\\n导演阐述\\n...\\n影像风格\\n...\\n妆造方向\\n...\\n核心场景与布景\\n...\\n灯光气质\\n..."\n}\n\n要求：\n- summary 按上述结构输出，不要只写 200-500 字短概要。\n- 人物小传至少包含主角和 3-5 个关键配角。\n- 故事梗概要说明世界背景、主线冲突、关系变化、阶段性胜利和后续钩子。\n- 导演阐述要能指导表演和节奏，影像风格要能指导摄影，妆造/布景/灯光要能指导后续素材与片段脚本生成。\n- 请按专业制作圣经写法输出：编剧视角负责冲突和爽点，导演视角负责表演和节奏，摄影视角负责景别/机位/运动，美术视角负责空间和道具，妆造视角负责角色阶段识别，灯光视角负责光源/色温/明暗反差。\n- 所有专业描述必须落到可见画面，不要使用“氛围高级、质感拉满、情绪到位”这类不可执行短语。\n${modeRequirements}`

  return { systemPrompt, userPrompt }
}
