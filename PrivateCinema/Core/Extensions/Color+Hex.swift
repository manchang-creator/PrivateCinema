import SwiftUI

extension Color {
    /// 支持从 "#RRGGBB" / "RRGGBB" 创建颜色（弹幕颜色存储用）。
    init(hex: String) {
        var value = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.hasPrefix("#") {
            value.removeFirst()
        }
        var rgb: UInt64 = 0xFFFFFF
        Scanner(string: value).scanHexInt64(&rgb)
        let r = Double((rgb >> 16) & 0xFF) / 255.0
        let g = Double((rgb >> 8) & 0xFF) / 255.0
        let b = Double(rgb & 0xFF) / 255.0
        self.init(red: r, green: g, blue: b)
    }

    /// 输出 "#RRGGBB"。
    var hexString: String {
        let uiColor = UIColor(self)
        var red: CGFloat = 1
        var green: CGFloat = 1
        var blue: CGFloat = 1
        var alpha: CGFloat = 1
        uiColor.getRed(&red, green: &green, blue: &blue, alpha: &alpha)
        return String(format: "#%02X%02X%02X",
                      Int(red * 255), Int(green * 255), Int(blue * 255))
    }
}
