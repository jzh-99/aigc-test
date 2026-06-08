import {
  Clapperboard,
  ImageIcon,
  type LucideIcon,
} from "lucide-react";

export interface CreativeEntryAction {
  label: string;
  href: string;
}

export interface CreativeEntryCard {
  title: string;
  description: string;
  kicker: string;
  icon: LucideIcon;
  accent: string;
  actions: CreativeEntryAction[];
}

export interface InspirationItem {
  id: string;
  title: string;
  category: string;
  description: string;
  heightClass: string;
  toneClass: string;
  tags: string[];
}

export const creativeEntryCards: CreativeEntryCard[] = [
  {
    title: "AI 生图",
    kicker: "Wan 2.7-Image Pro 全新上线",
    description: "专业画质 · 组图生成",
    icon: ImageIcon,
    accent: "from-primary/70 via-primary/25 to-secondary/30",
    actions: [{ label: "开始生图", href: "/generation?mode=image" }],
  },
  {
    title: "AI 视频",
    kicker: "快乐小马 即刻出发",
    description: "视听合一 · 极致细节",
    icon: Clapperboard,
    accent: "from-secondary/60 via-primary/20 to-primary/50",
    actions: [
      { label: "快速生成", href: "/generation?mode=video" },
      { label: "视频工坊", href: "/video-studio" },
    ],
  },
];

export const inspirationItems: InspirationItem[] = [
  {
    id: "city-neon-rain",
    title: "虹光蝶影",
    category: "发现",
    description: "高反差黑底、虹彩光束与透明翅翼形成视觉冲击。",
    heightClass: "h-[23rem]",
    toneClass: "from-[#05041a] via-primary/30 to-secondary/60",
    tags: ["MJ 美学", "光谱", "生图"],
  },
  {
    id: "soft-product-poster",
    title: "遗迹天井",
    category: "MJ 美学",
    description: "巨型建筑与暖色岩壁构成纵深空间。",
    heightClass: "h-[25rem]",
    toneClass: "from-secondary/80 via-[#7c4f2a] to-[#102c2e]",
    tags: ["建筑", "概念", "场景"],
  },
  {
    id: "fantasy-greenhouse",
    title: "玻璃宇航员",
    category: "视频",
    description: "半透明材质与黑色舞台，适合生成音乐短片镜头。",
    heightClass: "h-[24rem]",
    toneClass: "from-black via-primary/30 to-[#d7e8ff]",
    tags: ["角色", "透明", "短片"],
  },
  {
    id: "avatar-closeup",
    title: "粒子侧脸",
    category: "短片",
    description: "脸部轮廓被粒子光带扫过，带有强烈运动感。",
    heightClass: "h-[22rem]",
    toneClass: "from-[#051824] via-primary/40 to-secondary/70",
    tags: ["人像", "粒子", "动态"],
  },
  {
    id: "travel-reel-frame",
    title: "云上宫殿",
    category: "发现",
    description: "柔白纱幔与宏大内景形成幻想建筑氛围。",
    heightClass: "h-[25rem]",
    toneClass: "from-[#d8c7aa] via-[#f4eee2] to-primary/30",
    tags: ["空间", "幻想", "氛围"],
  },
  {
    id: "fashion-editorial",
    title: "潮汐光鱼",
    category: "MJ 美学",
    description: "蓝绿色深海背景中漂浮发光生物。",
    heightClass: "h-[21rem]",
    toneClass: "from-[#022f3f] via-primary/50 to-[#f0a85f]",
    tags: ["海洋", "光感", "奇幻"],
  },
  {
    id: "canvas-moodboard",
    title: "透明机械花",
    category: "视频",
    description: "玻璃、金属与光斑组合成可延展的运动素材。",
    heightClass: "h-[23rem]",
    toneClass: "from-[#101019] via-primary/30 to-[#f7dac2]",
    tags: ["机械", "材质", "动态"],
  },
  {
    id: "miniature-food",
    title: "沙丘回廊",
    category: "短片",
    description: "暖金建筑与人物剪影，适合做电影级转场。",
    heightClass: "h-[24rem]",
    toneClass: "from-secondary/80 via-[#b88a55] to-[#142b36]",
    tags: ["电影感", "建筑", "镜头"],
  },
];
