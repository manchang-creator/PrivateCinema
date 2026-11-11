import { describe, expect, it } from 'vitest'
import { clampBrightness, describeWin32Error } from '../src/main/brightness'

// ==================== 亮度纯逻辑 ====================
// 只测不依赖 DXVA2 的部分。真实 DDC/CI 往返需要能调光的物理显示器，
// 属端到端验收范围，不在单测里假装覆盖。

describe('clampBrightness', () => {
  it('区间内取整', () => {
    expect(clampBrightness(50.4, 0, 100)).toBe(50)
    expect(clampBrightness(50.6, 0, 100)).toBe(51)
  })

  it('超过上限钳制到 max', () => {
    expect(clampBrightness(150, 0, 100)).toBe(100)
  })

  it('低于下限钳制到 min', () => {
    expect(clampBrightness(-20, 0, 100)).toBe(0)
  })

  it('非 0-100 刻度按实际范围收敛', () => {
    // 部分外屏用 0-255 或带偏移的区间，不能假定上限是 100
    expect(clampBrightness(300, 0, 255)).toBe(255)
    expect(clampBrightness(10, 20, 80)).toBe(20)
    expect(clampBrightness(90, 20, 80)).toBe(80)
  })

  it('min 等于 max 时返回该值', () => {
    expect(clampBrightness(50, 30, 30)).toBe(30)
  })
})

describe('describeWin32Error', () => {
  it('1168 提示 DDC/CI 不支持或被禁用', () => {
    expect(describeWin32Error(1168)).toContain('DDC/CI')
  })

  it('1461 提示句柄无效', () => {
    expect(describeWin32Error(1461)).toContain('句柄')
  })

  it('5 提示权限不足', () => {
    expect(describeWin32Error(5)).toContain('权限')
  })

  it('0 说明没有错误码', () => {
    expect(describeWin32Error(0)).toContain('没有返回错误码')
  })

  it('未知错误码保留原始数字', () => {
    expect(describeWin32Error(4321)).toContain('4321')
  })
})
