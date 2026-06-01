# Short Drama Segment Textbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade AI 短剧片段文本框 so each video segment prompt contains a scene setup plus 2-5 storyboard shots, with editable per-shot duration selectors from 2-10 seconds.

**Architecture:** Keep the existing episode editor layout and keep `ShortDramaSegment` as the video generation unit. Add shared prompt duration helpers in `@aigc/types`, use them from the API parser and frontend editor, and update the AI segment-generation prompt to produce the agreed text shape. The frontend will render compact shot-duration controls inside the existing segment editor area without removing the bottom segment carousel.

**Tech Stack:** TypeScript, Next.js 14 App Router, React 18, Fastify 4, pnpm 10, existing `@aigc/types` package.

---

## File Structure

- Modify `packages/types/src/short-drama.ts`
  - Add shot duration constants.
  - Add prompt parsing, duration summing, and duration replacement helpers.
- Modify `packages/types/src/short-drama.test.ts`
  - Add direct assertions for the helper behavior.
- Modify `apps/api/src/routes/short-drama/post-generate-segments.ts`
  - Update AI prompt contract.
  - Validate and normalize segment prompt durations.
  - Stop requiring unsupported `cameraNote/actionNote/dialogueOrSubtitle` top-level fields.
- Modify `apps/web/src/components/short-drama/segment-prompt-editor.tsx`
  - Extract shot durations from the current prompt.
  - Render 2-10 second selectors for detected shots.
  - Replace the relevant duration in the text and notify parent with updated refs.
- Modify `apps/web/src/components/short-drama/segment-list.tsx`
  - Recalculate `durationSeconds` from prompt when prompt changes.
  - Keep existing card layout and bottom segment carousel.
- Optional inspect-only files:
  - `apps/web/src/components/picture-book/storyboard-mention-editor.tsx`
  - Read only if the editor callback behavior is unclear.

## Implementation Notes

- Do not touch page-level layout in `EpisodeEditor`.
- Do not remove `SegmentList` bottom carousel.
- Do not add `Shot.videoUrl`, `Shot.status`, or shot-level generation APIs.
- Do not add runtime compatibility mapping for old dirty data.
- Use pnpm only.
- The worktree already contains unrelated modified files. Do not revert or format unrelated changes.

---

### Task 1: Shared Shot Duration Helpers

**Files:**
- Modify: `packages/types/src/short-drama.ts`
- Modify: `packages/types/src/short-drama.test.ts`

- [ ] **Step 1: Add failing helper tests**

Add the new imports near the existing imports in `packages/types/src/short-drama.test.ts`:

```ts
  SHORT_DRAMA_SHOT_DURATION_SECONDS,
  calculateShortDramaSegmentDuration,
  extractShortDramaShotDurations,
  updateShortDramaShotDuration,
```

Add these assertions after the existing duration guard assertions:

```ts
assert.deepEqual(SHORT_DRAMA_SHOT_DURATION_SECONDS, [2, 3, 4, 5, 6, 7, 8, 9, 10])

const structuredPrompt = [
  '本片段场景设定在：@旧教室，白天，自然光。',
  '',
  '分镜1 · 4s：远景，固定机位，拍摄空教室。',
  '',
  '分镜2 · 5s：中景，@林微 整理旧物。',
  '',
  '分镜3 · 6s：近景，@林微 挂断电话。',
].join('\n')

assert.deepEqual(extractShortDramaShotDurations(structuredPrompt), [
  { shotNumber: 1, durationSeconds: 4 },
  { shotNumber: 2, durationSeconds: 5 },
  { shotNumber: 3, durationSeconds: 6 },
])
assert.equal(calculateShortDramaSegmentDuration(structuredPrompt, 4), 15)
assert.equal(calculateShortDramaSegmentDuration('没有分镜时长', 4), 4)
assert.equal(
  updateShortDramaShotDuration(structuredPrompt, 2, 8).includes('分镜2 · 8s：中景'),
  true
)
assert.equal(updateShortDramaShotDuration(structuredPrompt, 2, 1), structuredPrompt)
```

- [ ] **Step 2: Run the type build to verify failure**

Run:

```bash
pnpm --filter @aigc/types build
```

Expected: FAIL because the new constants/functions are not exported from `short-drama.ts`.

- [ ] **Step 3: Add constants and helpers**

In `packages/types/src/short-drama.ts`, add the constant near the existing short drama constants:

```ts
export const SHORT_DRAMA_SHOT_DURATION_SECONDS = [2, 3, 4, 5, 6, 7, 8, 9, 10] as const
```

Add the helper interface near the existing interfaces:

```ts
export interface ShortDramaShotDuration {
  shotNumber: number
  durationSeconds: number
}
```

Add these helpers near the existing helper functions:

```ts
const SHORT_DRAMA_SHOT_DURATION_PATTERN = /分镜\s*(\d+)\s*[·.\-:：]?\s*(\d{1,2})\s*s/gi

export function isShortDramaShotDurationSeconds(value: number): boolean {
  return (SHORT_DRAMA_SHOT_DURATION_SECONDS as readonly number[]).includes(value)
}

export function extractShortDramaShotDurations(prompt: string): ShortDramaShotDuration[] {
  const shots: ShortDramaShotDuration[] = []
  const seen = new Set<number>()

  for (const match of prompt.matchAll(SHORT_DRAMA_SHOT_DURATION_PATTERN)) {
    const shotNumber = Number(match[1])
    const durationSeconds = Number(match[2])
    if (
      Number.isInteger(shotNumber) &&
      shotNumber > 0 &&
      isShortDramaShotDurationSeconds(durationSeconds) &&
      !seen.has(shotNumber)
    ) {
      shots.push({ shotNumber, durationSeconds })
      seen.add(shotNumber)
    }
  }

  return shots
}

export function calculateShortDramaSegmentDuration(prompt: string, fallbackSeconds: number): number {
  const total = extractShortDramaShotDurations(prompt).reduce(
    (sum, shot) => sum + shot.durationSeconds,
    0
  )

  return total > 0 ? total : fallbackSeconds
}

export function updateShortDramaShotDuration(
  prompt: string,
  shotNumber: number,
  nextDurationSeconds: number
): string {
  if (!isShortDramaShotDurationSeconds(nextDurationSeconds)) {
    return prompt
  }

  let updated = false
  return prompt.replace(SHORT_DRAMA_SHOT_DURATION_PATTERN, (fullMatch, rawShotNumber) => {
    if (updated || Number(rawShotNumber) !== shotNumber) {
      return fullMatch
    }

    updated = true
    return fullMatch.replace(/\d{1,2}\s*s/i, `${nextDurationSeconds}s`)
  })
}
```

- [ ] **Step 4: Run the type build**

Run:

```bash
pnpm --filter @aigc/types build
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/types/src/short-drama.ts packages/types/src/short-drama.test.ts
git commit -m "feat: add short drama shot duration helpers"
```

---

### Task 2: API Segment Generation Prompt Contract

**Files:**
- Modify: `apps/api/src/routes/short-drama/post-generate-segments.ts`

- [ ] **Step 1: Import duration helpers**

Modify the import from `@aigc/types` in `apps/api/src/routes/short-drama/post-generate-segments.ts`:

```ts
import {
  SHORT_DRAMA_DEFAULT_DURATION_SECONDS,
  calculateShortDramaSegmentDuration,
} from '@aigc/types'
```

- [ ] **Step 2: Replace the AI system prompt contract**

Replace the current `REDACTED` array with:

```ts
const REDACTED = [
  '你是专业短剧分镜师。请根据剧本摘要、分集梗概和素材，为该集生成详细的片段脚本。',
  '只输出 JSON 数组，每个元素包含 title、prompt、mentionNames、durationSeconds 字段，不要输出 markdown。',
  '片段是视频生成的最小单位；分镜只写入片段 prompt 内，不要为分镜生成独立视频字段。',
  '每个片段 prompt 必须包含：第一段“本片段场景设定在：...”，后续 2-5 个“分镜N · Xs：...”描述。',
  '每个分镜时长 X 必须为 2-10 秒；durationSeconds 必须等于本片段所有分镜时长之和。',
  '当镜头出现某个角色或场景时，必须在 prompt 中直接写对应的 @素材名，例如 @祁同伟、@汉东政法大学校园。',
  'mentionNames 必须填写本片段实际引用的素材名称，不带 @，且只能使用可用素材列表中的名称。',
  '不要虚构素材名称；没有引用素材时 mentionNames 返回空数组。',
].join('\n')
```

- [ ] **Step 3: Replace the user prompt segment field instructions**

In the `userPrompt`, replace the section beginning with `请生成该集的分镜脚本。剧情较复杂时可生成` through the last bullet with:

```ts
请生成该集的片段脚本。每集可根据剧情生成多个片段，每个片段是一次视频生成单位。每个片段包含：
- title: 片段标题
- prompt: 完整片段文本，第一段写“本片段场景设定在：...”，后续写 2-5 个“分镜N · Xs：...”描述；出现素材时必须使用 @素材名
- mentionNames: 提及的素材名称列表，只能从可用素材中选择，名称不带 @
- durationSeconds: 片段总时长，必须等于 prompt 中所有分镜时长之和

每个分镜时长必须在 2-10 秒之间。分镜不是视频生成单位，不要输出分镜 videoUrl、status 或单独任务字段。`
```

- [ ] **Step 4: Relax parser validation to the supported fields**

Replace the current required-field validation block:

```ts
if (
  typeof seg.title !== 'string' ||
  typeof seg.prompt !== 'string' ||
  !Array.isArray(seg.mentionNames) ||
  typeof seg.durationSeconds !== 'number' ||
  typeof seg.cameraNote !== 'string' ||
  typeof seg.actionNote !== 'string' ||
  typeof seg.dialogueOrSubtitle !== 'string'
) {
```

with:

```ts
if (
  typeof seg.title !== 'string' ||
  typeof seg.prompt !== 'string' ||
  !Array.isArray(seg.mentionNames) ||
  typeof seg.durationSeconds !== 'number'
) {
```

- [ ] **Step 5: Store prompt directly and calculate duration from shot lines**

Delete the `enrichedPrompt` block that merges `cameraNote/actionNote/dialogueOrSubtitle`.

Before pushing each parsed segment, add:

```ts
const prompt = seg.prompt.trim()
const fallbackDuration =
  typeof seg.durationSeconds === 'number' && seg.durationSeconds > 0
    ? seg.durationSeconds
    : SHORT_DRAMA_DEFAULT_DURATION_SECONDS
const durationSeconds = calculateShortDramaSegmentDuration(prompt, fallbackDuration)
```

Then update `parsedSegments.push` so `prompt` and `durationSeconds` are:

```ts
prompt,
durationSeconds,
```

- [ ] **Step 6: Run API build**

Run:

```bash
pnpm --filter @aigc/api build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/short-drama/post-generate-segments.ts
git commit -m "feat: generate structured short drama segment prompts"
```

---

### Task 3: Frontend Shot Duration Controls

**Files:**
- Modify: `apps/web/src/components/short-drama/segment-prompt-editor.tsx`
- Modify: `apps/web/src/components/short-drama/segment-list.tsx`

- [ ] **Step 1: Import helpers in the prompt editor**

Change the import in `apps/web/src/components/short-drama/segment-prompt-editor.tsx` to:

```ts
import type { ShortDramaSegment, ShortDramaAsset, ShortDramaMentionRef } from '@aigc/types'
import {
  SHORT_DRAMA_SHOT_DURATION_SECONDS,
  extractShortDramaShotDurations,
  updateShortDramaShotDuration,
} from '@aigc/types'
```

- [ ] **Step 2: Add shot duration extraction and update handler**

Inside `SegmentPromptEditor`, after `handlePromptChange`, add:

```ts
const shotDurations = extractShortDramaShotDurations(segment.prompt)

const handleShotDurationChange = (shotNumber: number, durationSeconds: number) => {
  const nextPrompt = updateShortDramaShotDuration(segment.prompt, shotNumber, durationSeconds)
  if (nextPrompt === segment.prompt) return
  handlePromptChange(nextPrompt)
}
```

- [ ] **Step 3: Render compact duration selectors below the existing text editor**

After `StoryboardMentionEditor`, add:

```tsx
{shotDurations.length > 0 && (
  <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-background/40 p-2">
    <span className="text-xs text-muted-foreground">分镜时长</span>
    {shotDurations.map(shot => (
      <label
        key={shot.shotNumber}
        className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-xs"
      >
        <span>分镜{shot.shotNumber}</span>
        <select
          value={shot.durationSeconds}
          onChange={event => handleShotDurationChange(shot.shotNumber, Number(event.target.value))}
          disabled={disabled}
          className="bg-transparent text-xs outline-none"
        >
          {SHORT_DRAMA_SHOT_DURATION_SECONDS.map(seconds => (
            <option key={seconds} value={seconds}>
              {seconds}s
            </option>
          ))}
        </select>
      </label>
    ))}
  </div>
)}
```

- [ ] **Step 4: Recalculate segment duration when prompt changes**

In `apps/web/src/components/short-drama/segment-list.tsx`, add the helper import:

```ts
import { calculateShortDramaSegmentDuration } from '@aigc/types'
```

If there is already an `@aigc/types` import, merge it into:

```ts
import {
  calculateShortDramaSegmentDuration,
  type ShortDramaSegment,
  type ShortDramaAsset,
  type ShortDramaMentionRef,
} from '@aigc/types'
```

Replace the `onPromptChange` callback:

```tsx
onPromptChange={prompt => onSegmentUpdate(selectedSafeIndex, { ...selectedSegment, prompt })}
```

with:

```tsx
onPromptChange={prompt =>
  onSegmentUpdate(selectedSafeIndex, {
    ...selectedSegment,
    prompt,
    durationSeconds: calculateShortDramaSegmentDuration(prompt, selectedSegment.durationSeconds),
  })
}
```

Replace the `onPromptAndMentionRefsChange` callback:

```tsx
onPromptAndMentionRefsChange={(prompt: string, refs: ShortDramaMentionRef[]) =>
  onSegmentUpdate(selectedSafeIndex, { ...selectedSegment, prompt, mentionRefs: refs })
}
```

with:

```tsx
onPromptAndMentionRefsChange={(prompt: string, refs: ShortDramaMentionRef[]) =>
  onSegmentUpdate(selectedSafeIndex, {
    ...selectedSegment,
    prompt,
    mentionRefs: refs,
    durationSeconds: calculateShortDramaSegmentDuration(prompt, selectedSegment.durationSeconds),
  })
}
```

- [ ] **Step 5: Run web build**

Run:

```bash
pnpm --filter @aigc/web build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/short-drama/segment-prompt-editor.tsx apps/web/src/components/short-drama/segment-list.tsx
git commit -m "feat: edit short drama shot durations"
```

---

### Task 4: Final Verification

**Files:**
- Verify only. No planned source edits.

- [ ] **Step 1: Run shared types build**

```bash
pnpm --filter @aigc/types build
```

Expected: PASS.

- [ ] **Step 2: Run API build**

```bash
pnpm --filter @aigc/api build
```

Expected: PASS.

- [ ] **Step 3: Run web build**

```bash
pnpm --filter @aigc/web build
```

Expected: PASS.

- [ ] **Step 4: Confirm no unintended layout files changed**

Run:

```bash
git diff --stat HEAD
```

Expected: The implementation diff should be limited to:

```text
packages/types/src/short-drama.ts
packages/types/src/short-drama.test.ts
apps/api/src/routes/short-drama/post-generate-segments.ts
apps/web/src/components/short-drama/segment-prompt-editor.tsx
apps/web/src/components/short-drama/segment-list.tsx
```

Existing unrelated dirty files may still appear in `git status`; do not revert them.

---

## Self-Review

- Spec coverage: the plan preserves layout, preserves the bottom carousel, keeps segment-level video generation, updates prompt format, uses `@` extraction, supports 2-5 shots, supports 2-10 second shot duration changes, and avoids runtime dirty-data compatibility.
- Placeholder scan: no `TBD`, `TODO`, or vague “handle edge cases” instructions remain.
- Type consistency: helper names are defined in Task 1 before API and web usage in Tasks 2 and 3.
