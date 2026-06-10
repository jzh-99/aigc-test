import {
  Clapperboard,
  ImageIcon,
  Palette,
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
  imageUrl: string;
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
  {
    title: "灵动画布",
    kicker: "自由编排创作节点",
    description: "图像视频 · 灵感串联",
    icon: Palette,
    accent: "from-primary/55 via-secondary/20 to-primary/35",
    actions: [{ label: "进入画布", href: "/canvas" }],
  },
];

export const inspirationItems: InspirationItem[] = [
  {
    id: "neon-jellyfish-city",
    title: "霓虹水母城",
    category: "发现",
    description: "未来城市上空漂浮着巨大的透明水母，触须散发蓝紫色霓虹光，城市高楼被雨水打湿，街道路面倒映霓虹招牌，赛博朋克氛围，电影级构图，8K高清，戏剧化光影。",
    imageUrl: "https://toby-ai-dev.tos-cn-shanghai.volces.com/demos/images/1.jpg",
  },
  {
    id: "mechanical-deer-aurora",
    title: "极光机械鹿",
    category: "发现",
    description: "一只白色机械鹿站在雪山之巅，身体由金属骨架与发光线路组成，远处极光横贯夜空，雪粒在空气中漂浮，科幻自然融合风，超清细节，高级冷色调。",
    imageUrl: "https://toby-ai-dev.tos-cn-shanghai.volces.com/demos/images/2.jpg",
  },
  {
    id: "luminous-sakura-courtyard",
    title: "星光樱庭",
    category: "发现",
    description: "古老东方庭院中，一棵发光的樱花树盛开，花瓣化作星光缓缓飘落，青石路面泛着微光，远处有薄雾与灯笼，梦幻国风，唯美意境，8K高清。",
    imageUrl: "https://toby-ai-dev.tos-cn-shanghai.volces.com/demos/images/3.jpg",
  },
  {
    id: "deep-sea-library",
    title: "深海图书馆",
    category: "发现",
    description: "深海之中，一座被珊瑚包围的未来图书馆静静发光，透明穹顶外有鲸鱼游过，书页悬浮在水中，蓝绿色光影，超现实奇幻场景，电影级质感。",
    imageUrl: "https://toby-ai-dev.tos-cn-shanghai.volces.com/demos/images/4.jpg",
  },
  {
    id: "golden-hourglass-desert",
    title: "金色时间沙漏",
    category: "发现",
    description: "荒漠中央矗立一座巨大的金色时间沙漏，沙粒化作发光星尘流向天空，远处夕阳染红云层，孤独而宏大的超现实场景，8K高清，史诗感构图。",
    imageUrl: "https://toby-ai-dev.tos-cn-shanghai.volces.com/demos/images/5.jpg",
  },
  {
    id: "moon-coffee-astronaut",
    title: "月球咖啡",
    category: "发现",
    description: "宇航员坐在月球表面的小餐桌前喝咖啡，桌上摆着鲜花和甜点，地球悬挂在远处天空，温柔孤独的宇宙氛围，写实科幻风，柔和光影。",
    imageUrl: "https://toby-ai-dev.tos-cn-shanghai.volces.com/demos/images/6.jpg",
  },
  {
    id: "sleeping-white-cat-city",
    title: "城市白猫",
    category: "发现",
    description: "一只巨大的白猫蜷缩在城市楼宇之间沉睡，楼顶灯光像星星一样闪烁，街道车辆如光带流动，奇幻治愈风，夜景微光，高质感细节。",
    imageUrl: "https://toby-ai-dev.tos-cn-shanghai.volces.com/demos/images/7.jpg",
  },
  {
    id: "glass-rose-lab",
    title: "玻璃玫瑰实验室",
    category: "发现",
    description: "未来实验室中，一朵透明玻璃玫瑰在机械装置中央盛开，花瓣内部流动着蓝色能量光，周围有悬浮数据界面，极简科幻，高级产品海报风。",
    imageUrl: "https://toby-ai-dev.tos-cn-shanghai.volces.com/demos/images/8.jpg",
  },
  {
    id: "glowing-door-forest",
    title: "森林秘门",
    category: "发现",
    description: "雨后的森林里，一扇发光的神秘门立在巨树之间，门缝透出金色光芒，地面布满蘑菇和苔藓，空气中漂浮萤火虫，童话奇幻风，细节丰富。",
    imageUrl: "https://toby-ai-dev.tos-cn-shanghai.volces.com/demos/images/9.jpg",
  },
  {
    id: "cloud-train",
    title: "云上列车",
    category: "发现",
    description: "一辆复古红色列车穿行在云层之上，车窗透出温暖灯光，轨道由星光构成，远处是粉紫色晚霞，宫崎骏式梦幻旅行感，高清插画质感。",
    imageUrl: "https://toby-ai-dev.tos-cn-shanghai.volces.com/demos/images/10.jpg",
  },
  {
    id: "future-headphone-ad",
    title: "未来耳机",
    category: "发现",
    description: "黑色背景中，一颗悬浮的未来耳机由水流、金属和光线组成，蓝色电流环绕机身，产品细节清晰，科技广告大片风，8K超清，高级质感。",
    imageUrl: "https://toby-ai-dev.tos-cn-shanghai.volces.com/demos/images/11.jpg",
  },
  {
    id: "sky-whale-city",
    title: "城市鲸影",
    category: "发现",
    description: "巨大的发光鲸鱼从城市天空中缓缓游过，楼宇之间漂浮着云雾与星尘，人群仰望天空，超现实都市奇观，蓝金色调，电影级光影。",
    imageUrl: "https://toby-ai-dev.tos-cn-shanghai.volces.com/demos/images/12.jpg",
  },
  {
    id: "oriental-future-city",
    title: "东方未来城",
    category: "发现",
    description: "中式山水画风的未来城市，传统楼阁与悬浮飞行器结合，云海之间有发光桥梁连接群山，水墨与科幻融合，东方未来主义，宏大构图。",
    imageUrl: "https://toby-ai-dev.tos-cn-shanghai.volces.com/demos/images/13.jpg",
  },
  {
    id: "galaxy-lake-girl",
    title: "银河镜湖",
    category: "发现",
    description: "一位穿银色长裙的少女站在镜面湖中央，湖面倒映出银河，裙摆像星云一样扩散，周围漂浮细小光点，梦幻人像摄影风，唯美高质感。",
    imageUrl: "https://toby-ai-dev.tos-cn-shanghai.volces.com/demos/images/14.jpg",
  },
];
