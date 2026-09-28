import SwiftUI

/// 发送弹幕输入面板。
struct DanmakuInputView: View {
    @Binding var isPresented: Bool

    /// 当前播放时间（发送时写入弹幕 time）。
    let currentTime: Double
    let mediaId: String
    let episodeId: String
    var onSend: (DanmakuItem) -> Void

    @State private var content = ""
    @State private var type: DanmakuType = .scroll
    @State private var colorHex = "#FFFFFF"

    private let colors = ["#FFFFFF", "#FFE08A", "#9BE7FF", "#FFB3C6", "#B7F5A8", "#FFA07A"]

    var body: some View {
        VStack(spacing: 14) {
            HStack(spacing: 10) {
                TextField("发条友善的弹幕吧…", text: $content, axis: .horizontal)
                    .textFieldStyle(.plain)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 9)
                    .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 10))
                    .onSubmit(send)

                Button(action: send) {
                    Image(systemName: "paperplane.fill")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(width: 40, height: 40)
                        .background(.tint, in: Circle())
                }
                .disabled(content.trimmingCharacters(in: .whitespaces).isEmpty)
            }

            HStack {
                Picker("类型", selection: $type) {
                    Text("滚动").tag(DanmakuType.scroll)
                    Text("顶部").tag(DanmakuType.top)
                    Text("底部").tag(DanmakuType.bottom)
                }
                .pickerStyle(.segmented)
                .frame(maxWidth: 220)

                Spacer()

                HStack(spacing: 8) {
                    ForEach(colors, id: \.self) { hex in
                        Circle()
                            .fill(Color(hex: hex))
                            .frame(width: 20, height: 20)
                            .overlay {
                                if colorHex == hex {
                                    Circle().strokeBorder(.white, lineWidth: 2).padding(-3)
                                }
                            }
                            .onTapGesture {
                                colorHex = hex
                                Haptics.selection()
                            }
                    }
                }
            }
            .font(.footnote)
        }
        .padding(16)
        .background(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .fill(.bar)
        )
        .padding(.horizontal, 12)
        .padding(.bottom, 8)
    }

    private func send() {
        let text = content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        let item = DanmakuItem(
            mediaId: mediaId,
            episodeId: episodeId,
            time: max(0, currentTime),
            content: text,
            type: type,
            color: colorHex,
            userId: ""
        )
        onSend(item)
        content = ""
        Haptics.success()
        isPresented = false
    }
}
