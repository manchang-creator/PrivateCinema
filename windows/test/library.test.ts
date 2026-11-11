import { describe, expect, it } from 'vitest'
import { cleanTitle, isVideoFile, parseEpisodeName } from '../src/main/library'

// ==================== 文件名归组 ====================
// 只测纯函数；目录扫描与文件系统交互属于手工验收范围。

describe('isVideoFile', () => {
  it('识别支持的扩展名', () => {
    expect(isVideoFile('C:\\a\\b.mp4')).toBe(true)
    expect(isVideoFile('C:\\a\\b.MKV')).toBe(true)
    expect(isVideoFile('/home/a/b.webm')).toBe(true)
  })

  it('拒绝非视频扩展名', () => {
    expect(isVideoFile('C:\\a\\b.srt')).toBe(false)
    expect(isVideoFile('C:\\a\\b.txt')).toBe(false)
    expect(isVideoFile('C:\\a\\noext')).toBe(false)
  })
})

describe('parseEpisodeName', () => {
  it('识别 SxxEyy 并提取标题', () => {
    const parsed = parseEpisodeName('Some.Show.S01E02.1080p.mp4')
    expect(parsed).not.toBeNull()
    expect(parsed?.seriesTitle).toBe('Some Show')
    expect(parsed?.seasonIndex).toBe(1)
    expect(parsed?.index).toBe(2)
  })

  it('容忍小写与不同分隔符', () => {
    const parsed = parseEpisodeName('剧名 - s2e10 - 副标题.mkv')
    expect(parsed?.seasonIndex).toBe(2)
    expect(parsed?.index).toBe(10)
    expect(parsed?.seriesTitle).toBe('剧名')
  })

  it('没有剧集信息时返回 null', () => {
    expect(parseEpisodeName('Interstellar.2014.1080p.mp4')).toBeNull()
    expect(parseEpisodeName('普通视频.mp4')).toBeNull()
  })

  it('无副标题时用集号生成默认标题', () => {
    expect(parseEpisodeName('Show.S01E03.mkv')?.episodeTitle).toBe('第 3 集')
  })

  it('保留副标题', () => {
    expect(parseEpisodeName('Show.S01E03.The.Rain.mp4')?.episodeTitle).toBe('The Rain')
  })
})

describe('cleanTitle', () => {
  it('剥掉压制组前缀', () => {
    expect(cleanTitle('[Group] 片名')).toBe('片名')
  })

  it('点号转空格', () => {
    expect(cleanTitle('Some.Show.Name')).toBe('Some Show Name')
  })

  it('去掉年份括号', () => {
    expect(cleanTitle('Interstellar (2014)')).toBe('Interstellar')
  })

  it('合并多余空白', () => {
    expect(cleanTitle('  A   B  ')).toBe('A B')
  })
})
