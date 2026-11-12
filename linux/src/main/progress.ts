// ==================== 播放进度存储 ====================
// 单一真相源：主进程独占一个 JSON 文件，渲染进程只能经 IPC 读写。
// 与 iOS 的差异：iOS 用 SwiftData，这里用 JSON + 原子写入（先写临时文件再 rename），
// 避免进程中途被杀留下半截文件。

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { WatchProgress } from '@private-cinema/core/shared'

interface ProgressFile {
  version: 1
  records: WatchProgress[]
}

const EMPTY: ProgressFile = { version: 1, records: [] }

export class ProgressStore {
  private readonly filePath: string
  private cache: ProgressFile | null = null

  constructor(userDataDir: string) {
    this.filePath = join(userDataDir, 'progress.json')
  }

  async load(mediaId: string, episodeId: string): Promise<WatchProgress | null> {
    const file = await this.read()
    return (
      file.records.find(
        (record) => record.mediaId === mediaId && record.episodeId === episodeId,
      ) ?? null
    )
  }

  async list(): Promise<WatchProgress[]> {
    const file = await this.read()
    return [...file.records].sort((a, b) => b.lastPlayedAt.localeCompare(a.lastPlayedAt))
  }

  async save(progress: WatchProgress): Promise<void> {
    const file = await this.read()
    const index = file.records.findIndex(
      (record) =>
        record.mediaId === progress.mediaId && record.episodeId === progress.episodeId,
    )
    if (index >= 0) {
      file.records[index] = progress
    } else {
      file.records.push(progress)
    }
    await this.write(file)
  }

  async remove(mediaId: string, episodeId: string): Promise<void> {
    const file = await this.read()
    const next = file.records.filter(
      (record) => !(record.mediaId === mediaId && record.episodeId === episodeId),
    )
    if (next.length === file.records.length) return
    file.records = next
    await this.write(file)
  }

  // ==================== 落盘 ====================

  private async read(): Promise<ProgressFile> {
    if (this.cache !== null) return this.cache
    try {
      const raw = await readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as Partial<ProgressFile>
      this.cache = {
        version: 1,
        records: Array.isArray(parsed.records) ? parsed.records : [],
      }
    } catch {
      // 首次运行 / 文件损坏：从空表开始。这里不做「旧字段兼容」兜底，
      // 进度是纯本地可重建数据，坏文件直接重建比猜测字段更可靠。
      this.cache = { ...EMPTY, records: [] }
    }
    return this.cache
  }

  private async write(file: ProgressFile): Promise<void> {
    this.cache = file
    await mkdir(dirname(this.filePath), { recursive: true })
    const temp = `${this.filePath}.tmp`
    await writeFile(temp, JSON.stringify(file, null, 2), 'utf8')
    await rename(temp, this.filePath)
  }
}
