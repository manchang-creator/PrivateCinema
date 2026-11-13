// ==================== 封面色板 ====================
// 参考 cezzu 的 CoverColorPalette：整页底色由「当前主推内容」的封面色相驱动，
// 后续的玻璃表面都是白色透明叠色，所以只需要给出一个色相 h。
// 关键约束：所有大面积底色（整页环境光 / Hero / 详情弹层）的色相都收进一个窄的
// 冷色区间（蓝—靛），避免随着轮播/标题散列在粉、绿、黄之间乱跳，造成「配色不协调」。

import type { CSSProperties } from 'react'

export function hueOf(seed: string): number {
  let hue = 200
  for (const ch of seed) hue = (hue * 31 + (ch.codePointAt(0) ?? 0)) % 360
  // 偏冷紫的基准，避免落到刺眼的黄绿区
  return (hue + 210) % 360
}

/**
 * 把标题散列出的色相收进一个窄的冷色区间（默认 214°–260°，蓝到靛）。
 * 这样即便 Hero 每 6.5s 轮播换片，整屏色温也只在很小的范围里微动，不会忽然变粉变绿。
 */
function coolHue(seed: string, lo = 214, span = 46): number {
  return lo + (hueOf(seed) % span)
}

/** 整页环境光：克制的冷调辉光，低饱和、低透明，深浅主题都靠它统一基调。 */
export function ambientVars(seed: string): CSSProperties {
  const h = coolHue(seed)
  return {
    '--glow-1': `hsla(${h}, 44%, 44%, 0.30)`,
    '--glow-2': `hsla(${(h + 16) % 360}, 42%, 32%, 0.24)`,
    '--glow-3': `hsla(${(h + 332) % 360}, 40%, 18%, 0.34)`,
    '--hue': String(h),
  } as CSSProperties
}

/** 无海报时的封面渐变（monogram 底），色相同样收进冷色区间，整体不跑荧光色。 */
export function posterGradient(seed: string): CSSProperties {
  const h = coolHue(seed, 206, 76)
  return {
    background: `linear-gradient(150deg, hsl(${h}, 40%, 40%) 0%, hsl(${(h + 30) % 360}, 42%, 23%) 46%, hsl(${(h + 302) % 360}, 38%, 12%) 100%)`,
  }
}

/**
 * 详情弹层的主题化底色：只下发色相变量，具体渐变交给 CSS 按当前主题（深/浅）生成。
 * 早前这里直接返回一段深色渐变，会以内联样式盖掉浅色主题的浅底，
 * 结果「深底 + 深字」把简介和选集全糊住，看不清。改用变量后深浅两套都能自适应。
 */
export function backdropGradient(seed: string): CSSProperties {
  const h = coolHue(seed)
  return {
    '--detail-hue': String(h),
    '--detail-hue-2': String((h + 40) % 360),
  } as CSSProperties
}
