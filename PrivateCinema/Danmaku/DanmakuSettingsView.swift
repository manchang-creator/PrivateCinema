import SwiftUI

/// 弹幕设置 Bottom Sheet。
struct DanmakuSettingsView: View {
    @Bindable var settings: DanmakuSettings
    @Environment(\.dismiss) private var dismiss

    private let areaOptions: [(String, Double)] = [
        ("1/4", 0.25), ("1/2", 0.5), ("3/4", 0.75), ("全屏", 1.0),
    ]

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Toggle("弹幕", isOn: $settings.isEnabled)
                }

                Section("显示区域") {
                    Picker("区域", selection: $settings.areaRatio) {
                        ForEach(areaOptions, id: \.1) { option in
                            Text(option.0).tag(option.1)
                        }
                    }
                    .pickerStyle(.segmented)
                }

                Section("样式") {
                    LabeledContent("透明度") {
                        Slider(value: $settings.opacity, in: 0.2...1)
                    }
                    LabeledContent("字体大小") {
                        Slider(value: $settings.fontScale, in: 0.7...1.5)
                    }
                    LabeledContent("弹幕速度") {
                        Slider(value: $settings.speedFactor, in: 0.5...2)
                    }
                }

                Section("屏蔽") {
                    Toggle("屏蔽顶部弹幕", isOn: $settings.blockTop)
                    Toggle("屏蔽底部弹幕", isOn: $settings.blockBottom)
                    Toggle("屏蔽滚动弹幕", isOn: $settings.blockScroll)
                    Toggle("显示我自己发送的弹幕", isOn: $settings.showMine)
                }

                Section {
                    KeywordEditor(keywords: $settings.blockKeywords)
                } header: {
                    Text("关键词屏蔽（含防剧透）")
                }

                Section {
                    Button("恢复默认设置", role: .destructive) {
                        settings.resetToDefault()
                        Haptics.light()
                    }
                }
            }
            .navigationTitle("弹幕设置")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("完成") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}

/// 关键词屏蔽编辑器。
struct KeywordEditor: View {
    @Binding var keywords: [String]
    @State private var draft = ""

    var body: some View {
        VStack(spacing: 8) {
            if keywords.isEmpty {
                Text("暂无屏蔽词")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            ForEach(keywords, id: \.self) { keyword in
                HStack {
                    Text(keyword)
                        .font(.subheadline)
                    Spacer()
                    Button {
                        keywords.removeAll { $0 == keyword }
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(.tertiary)
                    }
                    .buttonStyle(.borderless)
                }
            }
            HStack {
                TextField("添加屏蔽词", text: $draft)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                Button("添加") {
                    let value = draft.trimmingCharacters(in: .whitespaces)
                    guard !value.isEmpty else { return }
                    if !keywords.contains(value) {
                        keywords.append(value)
                    }
                    draft = ""
                }
                .disabled(draft.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .padding(.vertical, 4)
    }
}
