import SwiftUI

/// 字幕设置 Bottom Sheet（样式只作用于外挂字幕渲染；
/// 内嵌字幕走系统渲染，提供开关与轨道选择）。
struct SubtitleSettingsView: View {
    @Bindable var manager: SubtitleManager
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    LabeledContent("字体大小") {
                        Slider(value: $manager.fontSize, in: 12...32)
                    }
                    LabeledContent("字幕位置") {
                        Slider(value: $manager.positionRatio, in: 0.2...0.95)
                    }
                    LabeledContent("背景透明度") {
                        Slider(value: $manager.backgroundOpacity, in: 0...0.9)
                    }
                    LabeledContent("时间偏移") {
                        HStack {
                            Text("\(manager.offset >= 0 ? "+" : "")\(String(format: "%.1f", manager.offset))s")
                                .monospacedDigit()
                                .frame(width: 52)
                            Slider(value: $manager.offset, in: -5...5)
                        }
                    }
                    ColorPicker("字幕颜色", selection: Binding(
                        get: { Color(hex: manager.colorHex) },
                        set: { manager.colorHex = $0.hexString }
                    ))
                    Button("恢复默认样式", role: .destructive) {
                        manager.resetStyle()
                    }
                } header: {
                    Text("样式（外挂字幕）")
                } footer: {
                    Text("时间偏移为正表示字幕延后显示，范围 -5s ~ +5s。")
                }
            }
            .navigationTitle("字幕设置")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("完成") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium])
    }
}
