// ==================== 字幕解析 ====================
// 移植自 iOS `SubtitleParser`，语义逐条对齐：
// - 自动识别 SRT / WebVTT
// - SRT 时间戳用逗号作小数分隔符，VTT 用点
// - VTT 剥掉内联标签 <...>
// - 结果按 start 升序

export interface SubtitleCue {
  start: number
  end: number
  text: string
}

/** 自动识别格式并解析。 */
export function parseSubtitle(raw: string): SubtitleCue[] {
  const trimmed = raw.trim()
  if (trimmed === '') return []
  if (trimmed.toUpperCase().startsWith('WEBVTT')) return parseVTT(trimmed)
  return parseSRT(trimmed)
}

/** 按空行切块，统一换行符，并去掉块尾的空行。 */
function splitBlocks(raw: string): string[][] {
  return raw
    .replace(/\r\n/g, '\n')
    .split('\n\n')
    .map((block) => {
      const lines = block.split('\n').map((line) => line.trim())
      while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
      return lines
    })
}

function findTimingIndex(lines: string[]): number {
  return lines.findIndex((line) => line.includes('-->'))
}

/** "00:01:02,500" / "01:02.500" / "00:01:02.500" → 秒 */
function parseTimestamp(raw: string, decimalSeparator: string): number {
  const text = raw.trim().split(decimalSeparator).join('.')
  return text.split(':').reduce((seconds, part) => {
    const value = Number.parseFloat(part)
    return seconds * 60 + (Number.isFinite(value) ? value : 0)
  }, 0)
}

export function parseSRT(raw: string): SubtitleCue[] {
  const cues: SubtitleCue[] = []
  for (const block of splitBlocks(raw)) {
    const lines = block.filter((line) => line !== '')
    if (lines.length < 2) continue
    const timingIndex = findTimingIndex(lines)
    if (timingIndex < 0) continue

    const [startPart, endPart] = splitTiming(lines[timingIndex])
    if (startPart === null || endPart === null) continue

    const text = lines.slice(timingIndex + 1).join('\n')
    if (text === '') continue

    cues.push({
      start: parseTimestamp(startPart, ','),
      end: parseTimestamp(endPart, ','),
      text,
    })
  }
  return cues.sort((a, b) => a.start - b.start)
}

export function parseVTT(raw: string): SubtitleCue[] {
  const cues: SubtitleCue[] = []
  for (const block of splitBlocks(raw)) {
    const first = block[0]?.toUpperCase() ?? ''
    // 头部与元数据块不是字幕
    if (first.startsWith('WEBVTT') || first.startsWith('NOTE') || first.startsWith('STYLE')) {
      continue
    }
    const timingIndex = findTimingIndex(block)
    if (timingIndex < 0) continue

    const [startPart, endPart] = splitTiming(block[timingIndex])
    if (startPart === null || endPart === null) continue

    // VTT 时间行尾部可能带排版参数（align:start 等），只取第一个空格前的部分。
    // 注意 `-->` 后通常带一个前导空格，必须滤掉空串再取首项，
    // 否则会把整个结束时间解析成 0。
    const start = parseTimestamp(startPart.replace(/ /g, ''), '.')
    const endToken = endPart.split(' ').filter((part) => part !== '')[0] ?? ''
    const end = parseTimestamp(endToken, '.')

    const text = block
      .slice(timingIndex + 1)
      .join('\n')
      .replace(/<[^>]+>/g, '')
    if (text === '') continue

    cues.push({ start, end, text })
  }
  return cues.sort((a, b) => a.start - b.start)
}

function splitTiming(line: string): [string | null, string | null] {
  const parts = line.split('-->')
  if (parts.length !== 2) return [null, null]
  return [parts[0], parts[1]]
}

/** 二分查找当前时间点应显示的字幕；无则返回 null。 */
export function cueAt(cues: SubtitleCue[], time: number): SubtitleCue | null {
  let low = 0
  let high = cues.length - 1
  while (low <= high) {
    const mid = (low + high) >> 1
    const cue = cues[mid]
    if (time < cue.start) {
      high = mid - 1
    } else if (time > cue.end) {
      low = mid + 1
    } else {
      return cue
    }
  }
  return null
}
