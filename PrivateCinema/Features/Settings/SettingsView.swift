import SwiftUI

/// 设置页：播放 / 字幕 / 弹幕 / 外观 / 首页模块 / 存储 / 关于。
struct SettingsView: View {
    @Environment(AppEnvironment.self) private var environment

    @State private var cacheSizeText = "计算中…"

    var body: some View {
        @Bindable var playback = environment.playbackSettings
        @Bindable var danmakuSettings = environment.danmaku.settings

        List {
            Section("播放") {
                Toggle("自动播放下一集", isOn: $playback.autoPlayNext)
                Toggle("记住播放速度", isOn: $playback.rememberRate)
                if !playback.rememberRate {
                    Picker("默认倍速", selection: $playback.defaultRate) {
                        ForEach([0.75, 1.0, 1.25, 1.5], id: \.self) { rate in
                            Text("\(rateText(rate))x").tag(rate)
                        }
                    }
                }
                Toggle("进入播放器自动横屏", isOn: $playback.autoLandscape)
            }

            Section("字幕") {
                // 字幕样式持久化在 UserDefaults，构造临时管理器读写同一份配置
                NavigationLink {
                    SubtitleSettingsView(manager: SubtitleManager())
                } label: {
                    Label("字幕设置", systemImage: "captions.bubble")
                }
            }

            Section("弹幕") {
                Toggle("弹幕", isOn: $danmakuSettings.isEnabled)
                NavigationLink {
                    DanmakuSettingsView(settings: environment.danmaku.settings)
                } label: {
                    Label("弹幕设置", systemImage: "list.bullet.rectangle")
                }
            }

            Section("外观") {
                Picker("外观", selection: Binding(
                    get: { playback.appearance },
                    set: { playback.appearance = $0 }
                )) {
                    ForEach(PlaybackSettings.AppearanceMode.allCases) { mode in
                        Text(mode.displayName).tag(mode)
                    }
                }
                .pickerStyle(.segmented)
            }

            Section("首页模块") {
                ForEach(HomeModule.allCases) { module in
                    Toggle(module.displayName, isOn: Binding(
                        get: { !HomeModule.loadHidden().contains(module) },
                        set: { visible in
                            var hidden = HomeModule.loadHidden()
                            if visible {
                                hidden.remove(module)
                            } else {
                                hidden.insert(module)
                            }
                            HomeModule.saveHidden(hidden)
                        }
                    ))
                }
            }

            Section("存储") {
                LabeledContent("图片缓存", value: cacheSizeText)
                Button("清理缓存") {
                    Haptics.light()
                    Task {
                        await ImageLoader.shared.clearCache()
                        refreshCacheSize()
                    }
                }
            }

            Section("关于") {
                LabeledContent("版本", value: "0.1.0 (1)")
                LabeledContent("弹幕昵称", value: environment.identity.displayName)
                LabeledContent("设备用户 ID", value: shortUserID)
                VStack(alignment: .leading, spacing: 4) {
                    Text("私人影院 · PrivateCinema")
                        .font(.subheadline.weight(.medium))
                    Text("Apple TV + Infuse 风格的极简私人影视中心。仅供个人使用。")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .padding(.vertical, 4)
            }
        }
        .navigationTitle("设置")
        .task { refreshCacheSize() }
    }

    private var shortUserID: String {
        let id = environment.identity.userId
        return id.count > 13 ? String(id.prefix(13)) + "…" : id
    }

    private func rateText(_ rate: Double) -> String {
        rate.truncatingRemainder(dividingBy: 1) == 0 ? String(Int(rate)) : String(rate)
    }

    private func refreshCacheSize() {
        Task {
            let bytes = await ImageLoader.shared.diskCacheSize
            let formatter = ByteCountFormatter()
            formatter.countStyle = .file
            cacheSizeText = formatter.string(fromByteCount: Int64(bytes))
        }
    }
}
