import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ProgressStore } from '../src/main/progress'
import { isCompleted, progressPercent, type WatchProgress } from '../src/shared/types'

// ==================== 播放进度判定 ====================
// 与 iOS `WatchProgress.isCompleted` 同一阈值：90%。

describe('isCompleted', () => {
  it('恰好 90% 视为看完', () => {
    expect(isCompleted(90, 100)).toBe(true)
  })

  it('89.9% 未看完', () => {
    expect(isCompleted(89.9, 100)).toBe(false)
  })

  it('超过 90% 视为看完', () => {
    expect(isCompleted(100, 100)).toBe(true)
  })

  it('时长为 0 时未看完', () => {
    expect(isCompleted(10, 0)).toBe(false)
  })

  it('时长为负时未看完', () => {
    expect(isCompleted(10, -5)).toBe(false)
  })

  it('位置为 0 时未看完', () => {
    expect(isCompleted(0, 100)).toBe(false)
  })
})

describe('progressPercent', () => {
  it('正常区间线性映射', () => {
    expect(progressPercent(30, 120)).toBeCloseTo(0.25, 6)
  })

  it('超出时长钳制到 1', () => {
    expect(progressPercent(200, 100)).toBe(1)
  })

  it('负数钳制到 0', () => {
    expect(progressPercent(-10, 100)).toBe(0)
  })

  it('时长为 0 返回 0', () => {
    expect(progressPercent(10, 0)).toBe(0)
  })
})

// ==================== 进度落盘与重载 ====================
// 「退出重进续播」的持久层证据：save 后换一个全新实例重读，必须拿到同一份数据。
// 注意：这证明的是存储往返，不是「真实播放到第 N 秒后能续播」——后者需端到端验证。

const makeRecord = (overrides: Partial<WatchProgress> = {}): WatchProgress => ({
  mediaId: 'local-0-demo',
  episodeId: 'local-0-demo#s1e1',
  mediaTitle: '示例影片',
  episodeTitle: '第 1 集',
  episodeIndex: 1,
  position: 42,
  duration: 600,
  lastPlayedAt: '2026-11-08T10:00:00.000Z',
  completed: false,
  ...overrides,
})

describe('ProgressStore 落盘与重载', () => {
  let dir = ''

  const freshStore = async (): Promise<ProgressStore> => {
    dir = await mkdtemp(join(tmpdir(), 'pc-progress-'))
    return new ProgressStore(dir)
  }

  afterEach(async () => {
    if (dir !== '') await rm(dir, { recursive: true, force: true })
    dir = ''
  })

  it('新实例能读回已保存的进度', async () => {
    const store = await freshStore()
    await store.save(makeRecord())

    const reloaded = new ProgressStore(dir)
    const record = await reloaded.load('local-0-demo', 'local-0-demo#s1e1')
    expect(record).not.toBeNull()
    expect(record?.position).toBe(42)
    expect(record?.duration).toBe(600)
  })

  it('未保存过的剧集返回 null', async () => {
    const store = await freshStore()
    await store.save(makeRecord())
    expect(await store.load('local-0-demo', 'local-0-demo#s1e2')).toBeNull()
  })

  it('同一集重复保存是覆盖而非追加', async () => {
    const store = await freshStore()
    await store.save(makeRecord({ position: 42 }))
    await store.save(makeRecord({ position: 120, lastPlayedAt: '2026-11-08T11:00:00.000Z' }))

    const records = await new ProgressStore(dir).list()
    expect(records).toHaveLength(1)
    expect(records[0]?.position).toBe(120)
  })

  it('list 按最后播放时间倒序', async () => {
    const store = await freshStore()
    await store.save(makeRecord({ episodeId: 'a', lastPlayedAt: '2026-11-08T09:00:00.000Z' }))
    await store.save(makeRecord({ episodeId: 'b', lastPlayedAt: '2026-11-08T11:00:00.000Z' }))
    await store.save(makeRecord({ episodeId: 'c', lastPlayedAt: '2026-11-08T10:00:00.000Z' }))

    const records = await store.list()
    expect(records.map((record) => record.episodeId)).toEqual(['b', 'c', 'a'])
  })

  it('remove 只删目标记录，其余保留', async () => {
    const store = await freshStore()
    await store.save(makeRecord({ episodeId: 'a' }))
    await store.save(makeRecord({ episodeId: 'b' }))
    await store.remove('local-0-demo', 'a')

    const reloaded = new ProgressStore(dir)
    expect(await reloaded.load('local-0-demo', 'a')).toBeNull()
    expect(await reloaded.load('local-0-demo', 'b')).not.toBeNull()
  })

  it('remove 不存在的记录不报错也不改文件', async () => {
    const store = await freshStore()
    await store.save(makeRecord({ episodeId: 'a' }))
    await expect(store.remove('local-0-demo', 'nope')).resolves.toBeUndefined()
    expect(await store.list()).toHaveLength(1)
  })

  it('写入后不残留 .tmp 文件', async () => {
    const store = await freshStore()
    await store.save(makeRecord())
    const entries = await readdir(dir)
    expect(entries).toContain('progress.json')
    expect(entries.filter((name) => name.endsWith('.tmp'))).toHaveLength(0)
  })

  it('落盘内容是合法 JSON 且 version 为 1', async () => {
    const store = await freshStore()
    await store.save(makeRecord())
    const raw = await readFile(join(dir, 'progress.json'), 'utf8')
    const parsed = JSON.parse(raw) as { version: number; records: unknown[] }
    expect(parsed.version).toBe(1)
    expect(parsed.records).toHaveLength(1)
  })

  it('文件损坏时从空表重建，不抛错', async () => {
    const store = await freshStore()
    await writeFile(join(dir, 'progress.json'), '{ 这不是 JSON', 'utf8')
    expect(await store.list()).toEqual([])
  })

  it('records 字段类型错误时按空表处理', async () => {
    const store = await freshStore()
    await writeFile(join(dir, 'progress.json'), '{"version":1,"records":"oops"}', 'utf8')
    expect(await store.list()).toEqual([])
  })

  it('目录不存在时自动创建', async () => {
    dir = await mkdtemp(join(tmpdir(), 'pc-progress-'))
    const store = new ProgressStore(join(dir, 'nested', 'deeper'))
    await store.save(makeRecord())
    expect(await new ProgressStore(join(dir, 'nested', 'deeper')).list()).toHaveLength(1)
  })
})
