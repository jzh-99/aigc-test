import {
  Brush,
  Clapperboard,
  ImageIcon,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

export interface CreativeEntryAction {
  label: string;
  href: string;
}

export interface CreativeEntryCard {
  title: string;
  description: string;
  icon: LucideIcon;
  accent: string;
  actions: CreativeEntryAction[];
}

export interface InspirationItem {
  id: string;
  title: string;
  category: string;
  description: string;
  image: string;
  tags: string[];
}

export const creativeEntryCards: CreativeEntryCard[] = [
  {
    title: "AI 生图",
    description: "输入想法，快速生成可继续编辑的视觉素材。",
    icon: ImageIcon,
    accent: "from-cyan-400 to-blue-500",
    actions: [{ label: "开始生图", href: "/generation?mode=image" }],
  },
  {
    title: "AI 视频",
    description: "从提示词或素材出发，生成短视频与动态镜头。",
    icon: Clapperboard,
    accent: "from-rose-400 to-orange-500",
    actions: [
      { label: "快速生成", href: "/generation?mode=video" },
      { label: "视频工坊", href: "/video-studio" },
    ],
  },
  {
    title: "Toby Studio",
    description: "制作数字人内容，统一管理角色与成片素材。",
    icon: Sparkles,
    accent: "from-violet-400 to-fuchsia-500",
    actions: [{ label: "进入 Toby Studio", href: "/toby-studio" }],
  },
  {
    title: "灵动画布",
    description: "在画布中编排图片、视频、文本与创意素材。",
    icon: Brush,
    accent: "from-emerald-400 to-teal-500",
    actions: [{ label: "打开画布", href: "/canvas" }],
  },
];

export const inspirationItems: InspirationItem[] = [
  {
    id: "city-neon-rain",
    title: "霓虹雨巷",
    category: "场景概念",
    description: "湿润街面反射粉蓝灯牌，人物背影穿过细雨。",
    image: "/images/inspirations/city-neon-rain.jpg",
    tags: ["赛博", "夜景", "电影感"],
  },
  {
    id: "soft-product-poster",
    title: "柔光新品海报",
    category: "商业视觉",
    description: "玻璃质感台面、低饱和背景与精致产品主光。",
    image: "/images/inspirations/soft-product-poster.jpg",
    tags: ["产品", "海报", "柔光"],
  },
  {
    id: "fantasy-greenhouse",
    title: "奇想温室",
    category: "插画灵感",
    description: "巨型叶片包围透明穹顶，暖色灯串穿过植物。",
    image: "/images/inspirations/fantasy-greenhouse.jpg",
    tags: ["插画", "自然", "奇幻"],
  },
  {
    id: "avatar-closeup",
    title: "数字人近景",
    category: "角色影像",
    description: "干净棚拍布光，面部细节清晰，适合作为口播封面。",
    image: "/images/inspirations/avatar-closeup.jpg",
    tags: ["数字人", "封面", "棚拍"],
  },
  {
    id: "travel-reel-frame",
    title: "旅行短片定帧",
    category: "视频灵感",
    description: "清晨海岸线与远处车灯，适合生成舒展转场镜头。",
    image: "/images/inspirations/travel-reel-frame.jpg",
    tags: ["旅行", "短片", "转场"],
  },
  {
    id: "fashion-editorial",
    title: "时装大片",
    category: "人像摄影",
    description: "强轮廓光搭配金属背景，呈现杂志封面质感。",
    image: "/images/inspirations/fashion-editorial.jpg",
    tags: ["人像", "时装", "封面"],
  },
  {
    id: "canvas-moodboard",
    title: "品牌情绪板",
    category: "画布素材",
    description: "色卡、字体样张与产品草图组合成统一视觉方向。",
    image: "/images/inspirations/canvas-moodboard.jpg",
    tags: ["品牌", "排版", "素材"],
  },
  {
    id: "miniature-food",
    title: "微缩料理世界",
    category: "创意摄影",
    description: "小比例人物在甜点表面布景，形成有趣空间错觉。",
    image: "/images/inspirations/miniature-food.jpg",
    tags: ["微缩", "美食", "趣味"],
  },
];
