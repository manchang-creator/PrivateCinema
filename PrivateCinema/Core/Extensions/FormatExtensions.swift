import Foundation

extension Double {
    /// 32:14 风格；超过 1 小时为 1:32:14。
    var clockString: String {
        let total = Int(self.rounded())
        let h = total / 3600
        let m = (total % 3600) / 60
        let s = total % 60
        if h > 0 {
            return String(format: "%d:%02d:%02d", h, m, s)
        }
        return String(format: "%02d:%02d", m, s)
    }

    /// 45 分钟 / 23 分钟
    var minutesDescription: String {
        let minutes = Int((self / 60).rounded())
        return "\(minutes) 分钟"
    }
}

extension Date {
    /// 同一天判断（本地时区）。
    func isSameDay(as other: Date) -> Bool {
        Calendar.current.isDate(self, inSameDayAs: other)
    }

    var historyDayLabel: String {
        let calendar = Calendar.current
        if calendar.isDateInToday(self) { return "今天" }
        if calendar.isDateInYesterday(self) { return "昨天" }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.dateFormat = "M月d日"
        return formatter.string(from: self)
    }
}
