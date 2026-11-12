import { describe, expect, it } from 'vitest'
import {
  clampBrightness,
  describeDdcutilError,
  parseDdcutilDetect,
  parseDdcutilVcp,
  parseXrandrBrightness,
  parseXrandrConnected,
} from '../src/main/brightness'

// ==================== 亮度纯逻辑 ====================
// 只测不依赖真实背光设备 / i2c 总线的部分。
// sysfs 读写与 ddcutil 子进程属于端到端验收范围，不在单测里假装覆盖。

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

  it('按实际刻度收敛，不假定上限是 100', () => {
    // sysfs 常见 0..937（intel_backlight）或 0..2047，ddcutil 多为 0..100
    expect(clampBrightness(3000, 0, 2047)).toBe(2047)
    expect(clampBrightness(10, 20, 80)).toBe(20)
  })
})

describe('parseDdcutilDetect', () => {
  it('提取每块 Display 的总线与型号', () => {
    const output = [
      'Display 1',
      '   I2C bus:  /dev/i2c-4',
      '   DRM connector:           card1-DP-1',
      '   Monitor:                 DELL U2720Q',
      '   Monitor supports DDC/CI',
      'Display 2',
      '   I2C bus:  /dev/i2c-7',
      '   Monitor:                 LG HDR 4K',
    ].join('\n')

    expect(parseDdcutilDetect(output)).toEqual([
      { bus: 4, label: 'DELL U2720Q' },
      { bus: 7, label: 'LG HDR 4K' },
    ])
  })

  it('缺型号时用总线号兜底，不产生空 label', () => {
    const output = ['Display 1', '   I2C bus:  /dev/i2c-3', '   Monitor supports DDC/CI'].join('\n')
    expect(parseDdcutilDetect(output)).toEqual([{ bus: 3, label: '总线 3' }])
  })

  it('没有显示器时返回空表', () => {
    expect(parseDdcutilDetect('No displays found\n')).toEqual([])
  })

  it('没有 I2C bus 行的块被丢弃', () => {
    const output = ['Display 1', '   Monitor:  Epson Projector'].join('\n')
    expect(parseDdcutilDetect(output)).toEqual([])
  })
})

describe('parseDdcutilVcp', () => {
  it('解析 --brief 的 VCP 10 结果', () => {
    // 真实输出形如 `VCP 10 C 50 100`：当前值 50，上限 100
    expect(parseDdcutilVcp('VCP 10 C 50 100\n')).toEqual({ current: 50, max: 100, min: 0 })
  })

  it('刻度不是 0-100 时照实返回', () => {
    expect(parseDdcutilVcp('VCP 10 C 120 255')).toEqual({ current: 120, max: 255, min: 0 })
  })

  it('不支持该 VCP 码时返回 null', () => {
    expect(parseDdcutilVcp('VCP 10 ERR\n')).toBeNull()
  })
})

describe('describeDdcutilError', () => {
  it('未安装 ddcutil 时明确说缺依赖', () => {
    expect(describeDdcutilError('', false)).toContain('未安装 ddcutil')
  })

  it('权限问题提示 i2c 组与 udev', () => {
    const message = describeDdcutilError('Error: Permission denied during i2c open', true)
    expect(message).toContain('i2c')
  })

  it('未检测到显示器时如实说明', () => {
    expect(describeDdcutilError('No displays found', true)).toContain('未检测到')
  })

  it('其它错误原样带上最后一行，便于排查', () => {
    expect(describeDdcutilError('first line\nlast line detail', true)).toContain('last line detail')
  })
})

describe('parseXrandrConnected', () => {
  it('只取 connected 输出，并识别 primary', () => {
    const output = [
      'Screen 0: minimum 8 x 8, current 1920 x 1080, maximum 32767 x 32767',
      'DP-0 disconnected (normal left inverted right x axis y axis)',
      'DP-2 connected primary 1920x1080+0+0 (normal left inverted right x axis y axis) 344mm x 193mm',
      'HDMI-0 disconnected (normal left inverted right x axis y axis)',
    ].join('\n')

    expect(parseXrandrConnected(output)).toEqual([{ name: 'DP-2', primary: true }])
  })

  it('没有连接输出时返回空表', () => {
    expect(parseXrandrConnected('eDP-1 disconnected 0x0+0+0')).toEqual([])
  })
})

describe('parseXrandrBrightness', () => {
  it('取指定输出块的 Brightness 值', () => {
    const verbose = [
      'DP-2 connected primary 1920x1080+0+0 (0x4b) normal',
      '\tGamma:      1.0:1.0:1.0',
      '\tBrightness: 0.60',
      'HDMI-0 disconnected (normal)',
      '\tBrightness: 1.00',
    ].join('\n')

    expect(parseXrandrBrightness(verbose, 'DP-2')).toBe(0.6)
  })

  it('找不到目标输出时返回 null', () => {
    expect(parseXrandrBrightness('eDP-1 disconnected\n\tBrightness: 1.0', 'DP-2')).toBeNull()
  })
})
