// ==================== 字幕文件发现 ====================
// 与视频同目录、同文件名（或带语言后缀）的字幕视为该视频的字幕。
// 优先级：精确同名 > .zh / .chs / .chi > .en；同优先级取字典序第一个。

import { readdir, readFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import type { SubtitleFile } from '@private-cinema/core/shared'

const SUBTITLE_EXTENSIONS = ['.srt', '.vtt']

/** 语言后缀优先级，越靠前越优先。 */
const LANGUAGE_PRIORITY = ['zh', 'chs', 'chi', 'zh-cn', 'zh-hans', 'sc', 'en']

export async function findSubtitleFor(videoPath: string): Promise<SubtitleFile | null> {
  const dir = dirname(videoPath)
  const stem = basename(videoPath, extname(videoPath)).toLowerCase()

  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return null
  }

  const candidates: { path: string; score: number }[] = []
  for (const name of entries) {
    const ext = extname(name).toLowerCase()
    if (!SUBTITLE_EXTENSIONS.includes(ext)) continue

    const nameStem = basename(name, extname(name)).toLowerCase()
    if (!nameStem.startsWith(stem)) continue

    // 只允许「完全同名」或「同名 + 语言后缀」，避免 a.srt 抢走 ab.mp4 的字幕
    const suffix = nameStem.slice(stem.length)
    if (suffix !== '' && !/^[.\-_ ]/.test(suffix)) continue

    candidates.push({ path: join(dir, name), score: scoreSuffix(suffix) })
  }

  if (candidates.length === 0) return null
  candidates.sort((a, b) => a.score - b.score || a.path.localeCompare(b.path))
  return readSubtitle(candidates[0].path)
}

export async function readSubtitle(path: string): Promise<SubtitleFile> {
  const content = await readFile(path, 'utf8')
  return { name: basename(path), content }
}

/** 分数越小越优先。 */
function scoreSuffix(suffix: string): number {
  if (suffix === '') return 0
  const token = suffix.replace(/^[.\-_ ]+/, '').toLowerCase()
  const index = LANGUAGE_PRIORITY.indexOf(token)
  return index < 0 ? LANGUAGE_PRIORITY.length + 1 : index + 1
}
