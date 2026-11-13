// ==================== 封面色板 ====================
// 参考 cezzu 的 CoverColorPalette：整页底色由「当前主推内容」的封面色相驱动，
// 后续的玻璃表面都是白色透明叠色，所以只需要给出一个色相 h。
// 本地片源没有真实海报，按标题稳定散列出一个色相；在线片源有真实海报时
// 仍以海报为主，这里只作为环境光兜底。

import type { CSSProperties } from 'react'

export function hueOf(seed: string): number {
  let hue = 200
  for (const ch of seed) hue = (hue * 31 + (ch.codePointAt(0) ?? 0)) % 360
  // 偏冷紫的基准，避免落到刺眼的黄绿区
  return (hue + 210) % 360
}

/** 整页环境光变量（用于 app-shell 的 CSS 自定义属性）。 */
export function ambientVars(seed: string): CSSProperties {
  const h = hueOf(seed)
  return {
    '--glow-1': `hsla(${h}, 58%, 46%, 0.55)`,
    '--glow-2': `hsla(${(h + 46) % 360}, 56%, 34%, 0.5)`,
    '--glow-3': `hsla(${(h + 312) % 360}, 52%, 22%, 0.6)`,
    '--hue': String(h),
  } as CSSProperties
}

/** 无海报时的封面渐变（monogram 底）。 */
export function posterGradient(seed: string): CSSProperties {
  const h = hueOf(seed)
  return {
    background: `linear-gradient(150deg, hsl(${h}, 44%, 42%) 0%, hsl(${(h + 34) % 360}, 46%, 24%) 46%, hsl(${(h + 300) % 360}, 42%, 12%) 100%)`,
  }
}

/** 详情页大背景用的柔和同色渐变。 */
export function backdropGradient(seed: string): CSSProperties {
  const h = hueOf(seed)
  return {
    background:
      `radial-gradient(120% 130% at 18% 0%, hsla(${h}, 60%, 40%, 0.55), transparent 60%),` +
      `radial-gradient(90% 90% at 92% 6%, hsla(${(h + 50) % 360}, 58%, 32%, 0.42), transparent 55%),` +
      `linear-gradient(180deg, hsl(${h}, 34%, 12%), #08080b 82%)`,
  }
}
