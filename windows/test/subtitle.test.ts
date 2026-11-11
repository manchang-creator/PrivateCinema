import { describe, expect, it } from 'vitest'
import { cueAt, parseSRT, parseSubtitle, parseVTT } from '../src/renderer/src/subtitle/parser'

// ==================== 字幕解析 ====================
// 用例覆盖 iOS 端 SubtitleParser 已有的全部语义分支。

const SRT = `1
00:00:01,000 --> 00:00:03,500
第一句

2
00:00:04,000 --> 00:00:06,000
第二句
换行内容

3
00:01:02,250 --> 00:01:05,000
第三句
`

const VTT = `WEBVTT

NOTE 这是注释块

STYLE
::cue { color: white }

1
00:00:01.000 --> 00:00:03.500
<v 旁白>第一句</v>

2
00:01:02.250 --> 00:01:05.000 align:start
第二句
`

describe('parseSRT', () => {
  it('解析时间戳并保留多行文本', () => {
    const cues = parseSRT(SRT)
    expect(cues).toHaveLength(3)
    expect(cues[0]).toEqual({ start: 1, end: 3.5, text: '第一句' })
    expect(cues[1].text).toBe('第二句\n换行内容')
    expect(cues[2].start).toBe(62.25)
  })

  it('结果按 start 升序', () => {
    const shuffled = `1
00:00:10,000 --> 00:00:12,000
后

2
00:00:01,000 --> 00:00:02,000
前
`
    expect(parseSRT(shuffled).map((cue) => cue.text)).toEqual(['前', '后'])
  })

  it('跳过没有文本的块', () => {
    const cues = parseSRT(`1
00:00:01,000 --> 00:00:02,000
`)
    expect(cues).toHaveLength(0)
  })

  it('空输入返回空数组', () => {
    expect(parseSubtitle('')).toEqual([])
    expect(parseSubtitle('   \n  ')).toEqual([])
  })
})

describe('parseVTT', () => {
  it('跳过 WEBVTT / NOTE / STYLE 块', () => {
    const cues = parseVTT(VTT)
    expect(cues).toHaveLength(2)
  })

  it('剥掉内联标签', () => {
    expect(parseVTT(VTT)[0].text).toBe('第一句')
  })

  it('忽略时间行尾部的排版参数', () => {
    expect(parseVTT(VTT)[1]).toEqual({ start: 62.25, end: 65, text: '第二句' })
  })
})

describe('parseSubtitle 自动识别', () => {
  it('以 WEBVTT 开头走 VTT 分支', () => {
    expect(parseSubtitle(VTT)).toHaveLength(2)
  })

  it('其余走 SRT 分支', () => {
    expect(parseSubtitle(SRT)).toHaveLength(3)
  })
})

describe('cueAt', () => {
  const cues = parseSRT(SRT)

  it('命中区间返回对应字幕', () => {
    expect(cueAt(cues, 2)?.text).toBe('第一句')
    expect(cueAt(cues, 4.5)?.text).toBe('第二句\n换行内容')
  })

  it('边界时间点包含在内', () => {
    expect(cueAt(cues, 1)?.text).toBe('第一句')
    expect(cueAt(cues, 3.5)?.text).toBe('第一句')
  })

  it('区间之间返回 null', () => {
    expect(cueAt(cues, 3.8)).toBeNull()
  })

  it('超出末尾返回 null', () => {
    expect(cueAt(cues, 999)).toBeNull()
  })

  it('空列表返回 null', () => {
    expect(cueAt([], 1)).toBeNull()
  })
})

// ==================== 时间轴推进（模拟播放头） ====================
// 播放时每帧用 currentTime 查 cue。这里按 0.1s 步进扫一遍，
// 断言「上屏 / 下屏」的切换点与字幕时间轴严格一致，且不产生重复切换。
// 注意：这验证的是查找逻辑，不是真实字幕在画面上渲染正确（那需端到端验证）。

describe('cueAt 时间轴推进', () => {
  const cues = parseSRT(SRT)

  /** 按固定步长推进播放头，返回每次「当前字幕变化」的 (时间, 文本) 序列。 */
  const sweep = (step: number, until: number): Array<[number, string | null]> => {
    const changes: Array<[number, string | null]> = []
    let previous: string | null = null
    for (let time = 0; time <= until; time = Number((time + step).toFixed(3))) {
      const text = cueAt(cues, time)?.text ?? null
      if (text !== previous) {
        changes.push([time, text])
        previous = text
      }
    }
    return changes
  }

  it('按 0.1s 推进时上屏与下屏时刻准确', () => {
    const changes = sweep(0.1, 66)
    expect(changes).toEqual([
      [1, '第一句'],
      [3.6, null],
      [4, '第二句\n换行内容'],
      [6.1, null],
      [62.3, '第三句'],
      [65.1, null],
    ])
  })

  it('步长变化不改变上屏内容、顺序与时刻（容差为步长）', () => {
    const onAir = (samples: Array<[number, string | null]>): Array<[number, string]> =>
      samples.flatMap(([time, text]) => (text === null ? [] : [[time, text]]))
    const fine = onAir(sweep(0.05, 66))
    const coarse = onAir(sweep(0.5, 66))

    expect(coarse.map(([, text]) => text)).toEqual(fine.map(([, text]) => text))
    coarse.forEach(([time], index) => {
      expect(Math.abs(time - (fine[index]?.[0] ?? time))).toBeLessThanOrEqual(0.5)
    })
  })

  it('同一时刻反复查询结果稳定', () => {
    for (let i = 0; i < 5; i += 1) {
      expect(cueAt(cues, 2)?.text).toBe('第一句')
    }
  })

  it('向后跳跃后查询不受前一次位置影响（无状态）', () => {
    expect(cueAt(cues, 63)?.text).toBe('第三句')
    expect(cueAt(cues, 2)?.text).toBe('第一句')
    expect(cueAt(cues, 63)?.text).toBe('第三句')
  })
})
