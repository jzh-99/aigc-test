# 灵感页图片弹窗 + 做同款 功能设计

## 概述

在灵感页（首页「发现」标签区域），点击图片卡片后弹出大图预览弹窗，展示标题、prompt 描述文字和「做同款」按钮。点击「做同款」跳转到创作页图片页签，自动带入提示词并选择「超能图片2」模型。

## 需求范围

- 点击灵感图片 → 弹窗展示大图 + 描述 + 「做同款」按钮
- 数据源保持现有静态 `inspirationItems`
- 「做同款」跳转到 `/generation?mode=image&prompt=xxx&model=gpt-image-2`
- 创作页从 URL query 参数读取 prompt 和 model 写入 store

## 架构设计

### 数据流

```
灵感页点击图片卡片
  → selectedItem state 设置
  → InspirationLightbox 弹窗打开
  → 展示大图 + 标题 + description（prompt）
  → 用户点击「做同款」按钮
  → 关闭弹窗
  → router.push('/generation?mode=image&prompt={encoded}&model=gpt-image-2')

创作页加载
  → searchParams 读取 prompt、model
  → useGenerationStore.setPrompt(prompt)
  → useGenerationStore.setModelType(model)
  → router.replace 清除 URL 参数（避免刷新重复设置）
  → GenerationPanel 从 store 读取，自动填入提示词和模型
```

### 参数传递方案：URL Query 参数

选择 URL query 参数而非 Zustand store 直设，原因：
- URL 可分享、可书签，刷新不丢失
- 与现有 `?mode=image` 模式一致
- prompt 不在 Zustand persist 列表中，刷新会丢失

## 组件设计

### 1. 新建：InspirationLightbox 弹窗组件

**文件：** `apps/web/src/components/dashboard/inspiration-lightbox.tsx`

**接口：**

```tsx
interface InspirationLightboxProps {
  item: InspirationItem | null
  open: boolean
  onOpenChange: (open: boolean) => void
}
```

**UI 规格：**
- 使用 Radix UI `Dialog` 组件
- 深色半透明遮罩背景
- 弹窗内容区：大图居中展示（max-height 限制，保持纵横比）
- 底部区域：标题 + prompt 描述文字（最多显示 4 行，超出截断）
- 右下角「做同款」按钮（紫色主色调，与现有 UI 风格一致）
- 点击遮罩或 ESC 关闭

**「做同款」按钮行为：**
1. 关闭弹窗
2. 使用 `next/navigation` 的 `useRouter` 跳转
3. URL: `/generation?mode=image&prompt=${encodeURIComponent(item.description)}&model=gpt-image-2`

### 2. 修改：InspirationContent 组件

**文件：** `apps/web/src/components/dashboard/inspiration-content.tsx`

**改动：**
- 新增 `selectedItem` state：`useState<InspirationItem | null>(null)`
- 为每个 `<article>` 卡片添加 `onClick` 处理：设置 `selectedItem`
- 底部渲染 `<InspirationLightbox item={selectedItem} open={!!selectedItem} onOpenChange={...} />`
- 卡片添加 `cursor-pointer` 样式

### 3. 修改：Generation Page 参数接收

**文件：** `apps/web/src/app/(dashboard)/generation/page.tsx`

**改动：**
- 从 `searchParams` 额外读取 `prompt` 和 `model` 参数
- 使用 `useEffect` 在组件加载时检测并写入 store：
  ```tsx
  useEffect(() => {
    const p = searchParams.get('prompt')
    const m = searchParams.get('model')
    if (p) setPrompt(p)
    if (m) setModelType(m)
    // 清除 URL 参数
    if (p || m) router.replace('/generation?mode=image', { scroll: false })
  }, [])
  ```

## 不涉及的改动

- 不修改 `InspirationItem` 数据结构
- 不新增后端 API
- 不修改 `useGenerationStore` 的 persist 配置
- 不修改 `GenerationPanel` 的 tab 切换逻辑

## 风险与注意事项

- prompt 可能很长（100-200 字），URL 编码后需要确保浏览器和 Next.js 都能正确处理
- `router.replace` 清除参数后，浏览器后退不会回到带参数的 URL
- 弹窗内大图需要 `loading="lazy"` 避免首次加载阻塞
