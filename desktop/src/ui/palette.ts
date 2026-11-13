// ==================== 封面底纹与氛围光 ====================
// 缺图封面用「标题散列 → 冷色区间渐变」兜底，避免整片蒙版灰。
// 另一条线是主题色：首页主推的封面主色会通过 --accent-* 变量接管整屏强调色
// （播放按钮、进度、选中态），这是 B 站 / 腾讯视频都在用的「内容决定色调」效果。

import type { CSSProperties } from 'react'

export function hueOf(seed: string): number {
  let hue = 200
  for (const ch of seed) hue = (hue * 31 + (ch.codePointAt(0) ?? 0)) % 360
  return hue
}

/** 收进窄冷色区间（蓝—靛），轮播换片时整屏色温只微动，不会忽粉忽绿。 */
export function coolHue(seed: string, lo = 214, span = 46): number {
  return lo + (hueOf(seed) % span)
}

/** 整页环境光：克制的冷调辉光，深浅主题都靠它统一基调。 */
export function ambientVars(seed: string): CSSProperties {
  const h = coolHue(seed)
  return {
    '--glow-1': `hsla(${h}, 44%, 44%, 0.30)`,
    '--glow-2': `hsla(${(h + 16) % 360}, 42%, 32%, 0.24)`,
    '--glow-3': `hsla(${(h + 332) % 360}, 40%, 18%, 0.34)`,
    '--hue': String(h),
  } as CSSProperties
}

/** 主题色：由当前主推内容驱动 --accent / --accent-strong / --accent-soft。 */
export function accentVars(seed: string, dark = true): CSSProperties {
  const h = coolHue(seed, 208, 96)
  return {
    '--accent-h': String(h),
    '--accent': `hsl(${h}, ${dark ? 82 : 74}%, ${dark ? 64 : 48}%)`,
    '--accent-strong': `hsl(${h}, ${dark ? 88 : 80}%, ${dark ? 72 : 40}%)`,
    '--accent-soft': `hsla(${h}, ${dark ? 80 : 70}%, ${dark ? 62 : 50}%, ${dark ? 0.16 : 0.12})`,
    '--accent-line': `hsla(${h}, 80%, ${dark ? 62 : 46}%, 0.45)`,
  } as CSSProperties
}

/** 无海报时的封面渐变底纹。 */
export function posterGradient(seed: string): CSSProperties {
  const h = coolHue(seed, 206, 76)
  return {
    background: `linear-gradient(150deg, hsl(${h}, 40%, 40%) 0%, hsl(${(h + 30) % 360}, 42%, 23%) 46%, hsl(${(h + 302) % 360}, 38%, 12%) 100%)`,
  }
}

/** 详情页主题化底色：只下发色相变量，深浅两套渐变交给 CSS。 */
export function backdropGradient(seed: string): CSSProperties {
  const h = coolHue(seed)
  return {
    '--detail-hue': String(h),
    '--detail-hue-2': String((h + 40) % 360),
  } as CSSProperties
}

/** 四个字以上的标题才能摆成「竖排片名」海报，两个字的容易撑不满。 */
export function canStackTitle(title: string): boolean {
  return Array.from(title.trim()).length >= 3
}
