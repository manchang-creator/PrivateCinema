import SwiftUI

/// 媒体源管理页。
struct SourcesView: View {
    @Environment(AppEnvironment.self) private var environment

    @State private var editingSource: MediaSourceInfo?
    @State private var showAddSheet = false

    var body: some View {
        List {
            Section {
                providerPicker
            } header: {
                Text("内容源")
            } footer: {
                Text("切换内容源后，回到首页 / 片库即可加载对应内容。观看进度按内容源分别记录。")
            }

            Section {
                sourceRow(
                    name: "演示媒体库",
                    type: .customAPI,
                    status: .connected,
                    subtitle: "内置演示内容（Mock）",
                    enabled: true
                )
                sourceRow(
                    name: "本机媒体库",
                    type: .localLibrary,
                    status: .connected,
                    subtitle: "Documents/MediaLibrary",
                    enabled: true
                )
            } header: {
                Text("内置能力")
            } footer: {
                Text("以下配置项对应 P2 路线图（WebDAV / NAS / Jellyfin / Emby / Plex / 自建 API）。协议层已就绪，接入新实现时只需新增 MediaProvider 实现，无需改动播放器与页面。")
            }

            if !environment.sources.sources.isEmpty {
                Section("我的媒体源") {
                    ForEach(environment.sources.sources) { source in
                        sourceConfigRow(source)
                    }
                    .onDelete { indexSet in
                        for index in indexSet {
                            environment.sources.delete(sourceId: environment.sources.sources[index].id)
                        }
                    }
                }
            }
        }
        .navigationTitle("媒体源")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    editingSource = MediaSourceInfo(
                        id: UUID().uuidString,
                        name: "",
                        type: .webdav,
                        baseURL: "https://",
                        username: "",
                        enabled: true,
                        priority: environment.sources.sources.count
                    )
                    showAddSheet = true
                } label: {
                    Image(systemName: "plus")
                }
                .accessibilityLabel("添加媒体源")
            }
        }
        .sheet(isPresented: $showAddSheet) {
            if let source = editingSource {
                SourceEditSheet(source: source) { info, secret in
                    environment.sources.save(info, secret: secret)
                }
            }
        }
    }

    /// 内容源选择列表（Mock / 本机等）。
    private var providerPicker: some View {
        ForEach(environment.providers.map(\.info), id: \.id) { info in
            Button {
                Haptics.selection()
                environment.setActiveProvider(info.id)
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: info.kind == .remote
                        ? "globe"
                        : (info.kind == .local ? "internaldrive" : "sparkles.tv"))
                        .foregroundStyle(.tint)
                        .frame(width: 26)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(info.name)
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(.primary)
                        Text(info.description)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    if environment.activeProviderID == info.id {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundStyle(.tint)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func sourceRow(
        name: String,
        type: MediaSourceType,
        status: MediaSourceInfo.ConnectionStatus,
        subtitle: String,
        enabled: Bool
    ) -> some View {
        HStack(spacing: 12) {
            Image(systemName: type.systemImage)
                .font(.system(size: 18))
                .foregroundStyle(.tint)
                .frame(width: 34, height: 34)
                .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 8))
            VStack(alignment: .leading, spacing: 2) {
                Text(name).font(.subheadline.weight(.medium))
                Text(subtitle).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            statusBadge(status, enabled: enabled)
        }
    }

    @ViewBuilder
    private func sourceConfigRow(_ source: MediaSourceInfo) -> some View {
        let status = environment.sources.statuses[source.id] ?? .unknown
        HStack(spacing: 12) {
            Image(systemName: source.type.systemImage)
                .foregroundStyle(.tint)
                .frame(width: 30)
            VStack(alignment: .leading, spacing: 2) {
                Text(source.name.isEmpty ? source.type.displayName : source.name)
                    .font(.subheadline.weight(.medium))
                Text(source.baseURL)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer()
            if source.type.isImplemented {
                statusBadge(status, enabled: source.enabled)
            } else {
                Text("待接入")
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(.orange)
            }
        }
        .swipeActions(edge: .trailing) {
            Button(role: .destructive) {
                environment.sources.delete(sourceId: source.id)
            } label: {
                Label("删除", systemImage: "trash")
            }
            Button {
                editingSource = source
                showAddSheet = true
            } label: {
                Label("编辑", systemImage: "pencil")
            }
        }
    }

    @ViewBuilder
    private func statusBadge(_ status: MediaSourceInfo.ConnectionStatus, enabled: Bool) -> some View {
        if !enabled {
            Text("已停用")
                .font(.caption2)
                .foregroundStyle(.secondary)
        } else {
            switch status {
            case .unknown:
                EmptyView()
            case .testing:
                ProgressView().controlSize(.mini)
            case .connected:
                Text("已连接").font(.caption2).foregroundStyle(.green)
            case .failed:
                Text("未连接").font(.caption2).foregroundStyle(.red)
            }
        }
    }
}

/// 添加 / 编辑媒体源。
struct SourceEditSheet: View {
    @Environment(\.dismiss) private var dismiss

    @State var source: MediaSourceInfo
    @State private var secret = ""
    let onSave: (MediaSourceInfo, String?) -> Void

    var body: some View {
        NavigationStack {
            Form {
                Section("基本信息") {
                    TextField("名称", text: $source.name)
                    Picker("类型", selection: $source.type) {
                        ForEach(MediaSourceType.allCases.filter { $0 != .localLibrary }) { type in
                            Text(type.displayName).tag(type)
                        }
                    }
                    TextField("服务器地址", text: $source.baseURL)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }
                Section("鉴权") {
                    TextField("用户名（可选）", text: $source.username)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    SecureField("密码 / Token（存入 Keychain）", text: $secret)
                }
                Section {
                    Toggle("启用", isOn: $source.enabled)
                    Button("测试连接") {
                        Task { await testConnection() }
                    }
                }
            }
            .navigationTitle("媒体源")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("保存") {
                        onSave(source, secret.isEmpty ? nil : secret)
                        dismiss()
                    }
                    .disabled(source.name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func testConnection() async {
        // 表单内尚未保存的凭据也参与测试（鉴权源不带凭据会误报）
        let probe = TestConnectionProbe()
        await probe.probe(
            urlString: source.baseURL,
            username: source.username.isEmpty ? nil : source.username,
            secret: secret.isEmpty ? nil : secret
        )
    }
}

/// 轻量连接探测（不落库）。
@MainActor
final class TestConnectionProbe {
    func probe(urlString: String, username: String?, secret: String?) async {
        guard let url = URL(string: urlString), url.host != nil else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "HEAD"
        request.timeoutInterval = 5
        if let username, let secret {
            let credential = Data("\(username):\(secret)".utf8).base64EncodedString()
            request.setValue("Basic \(credential)", forHTTPHeaderField: "Authorization")
        }
        _ = try? await URLSession.shared.data(for: request)
    }
}
