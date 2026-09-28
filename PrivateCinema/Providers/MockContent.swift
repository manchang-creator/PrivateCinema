import Foundation

/// Mock 内容数据。
/// 视频使用公开测试流（Apple HLS 示例 / Google 开放示例视频），
/// 海报与剧照使用公开占位图服务。
enum MockContent {

    // MARK: - 测试视频

    /// Apple 官方 HLS 示例（含内嵌 WebVTT 字幕与多码率）。
    static let appleHLS = URL(string: "https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_ts/master.m3u8")!

    /// Google 开放示例视频。
    static let sampleMP4s: [URL] = [
        URL(string: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4")!,
        URL(string: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4")!,
        URL(string: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4")!,
        URL(string: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4")!,
        URL(string: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4")!,
        URL(string: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4")!,
        URL(string: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4")!,
        URL(string: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/WhatCarCanYouGetForAGrand.mp4")!,
    ]

    static func poster(_ seed: String) -> URL {
        URL(string: "https://picsum.photos/seed/\(seed)-p/600/900")!
    }

    static func backdrop(_ seed: String) -> URL {
        URL(string: "https://picsum.photos/seed/\(seed)-b/1600/900")!
    }

    static func still(_ seed: String, index: Int) -> URL {
        URL(string: "https://picsum.photos/seed/\(seed)-s\(index)/1200/675")!
    }

    // MARK: - 剧组

    private static func cast(_ names: [String]) -> [Person] {
        names.map { Person(name: $0, role: "主演") }
    }

    private static func director(_ names: [String]) -> [Person] {
        names.map { Person(name: $0, role: "导演") }
    }

    // MARK: - 电影（6 部）

    static let movies: [MediaItem] = [
        MediaItem(
            id: "mock-movie-01",
            title: "星际漫游者",
            kind: .movie, year: 2024, area: "美国", language: "英语",
            genres: ["科幻", "冒险"], rating: 8.7, durationMinutes: 148,
            overview: "一艘深空探索船在距离地球六光年的殖民星附近失去信号，留守的领航员必须穿越未知星域，在燃料耗尽前找回失落的船员。影片以极致的实景特效与沉浸式声场，呈现一场孤独而浪漫的星际旅程。",
            posterURL: poster("starpioneer"), backdropURL: backdrop("starpioneer"),
            remark: "4K 杜比视界", isFinished: true,
            specs: MediaSpecs(is4K: true, isHDR: true, isDolbyVision: true, isDolbyAtmos: true, isHEVC: true),
            cast: cast(["林晚舟", "苏见川", "程一苇", "纪云深"]),
            directors: director(["陈默"]),
            stillImageURLs: (1...4).map { still("starpioneer", index: $0) },
            updatedAt: Date(timeIntervalSinceNow: -86400 * 3)
        ),
        MediaItem(
            id: "mock-movie-02",
            title: "雪线之上",
            kind: .movie, year: 2023, area: "中国大陆", language: "国语",
            genres: ["剧情", "山岳"], rating: 8.2, durationMinutes: 126,
            overview: "海拔五千米的高山救援队接到求救信号，风雪封路、时间紧迫。老队长带着新队员踏上最后的冲顶路线，这一次他们面对的不只是山。",
            posterURL: poster("snowline"), backdropURL: backdrop("snowline"),
            remark: "4K HDR", isFinished: true,
            specs: MediaSpecs(is4K: true, isHDR: true, isDolbyAtmos: true, isHEVC: true),
            cast: cast(["祁远", "孟千帆", "洛桑丹增"]),
            directors: director(["顾青山"]),
            stillImageURLs: (1...3).map { still("snowline", index: $0) },
            updatedAt: Date(timeIntervalSinceNow: -86400 * 7)
        ),
        MediaItem(
            id: "mock-movie-03",
            title: "城市微光",
            kind: .movie, year: 2024, area: "中国台湾", language: "国语",
            genres: ["爱情", "文艺"], rating: 7.9, durationMinutes: 108,
            overview: "凌晨营业的旧书店里，两个失眠的人因为一本夹着旧车票的诗集相遇。城市很大，微光很轻，但足够照亮一个决定。",
            posterURL: poster("cityglow"), backdropURL: backdrop("cityglow"),
            remark: "高清", isFinished: true,
            specs: MediaSpecs(),
            cast: cast(["许念安", "江以恒"]),
            directors: director(["温子谦"]),
            stillImageURLs: (1...3).map { still("cityglow", index: $0) },
            updatedAt: Date(timeIntervalSinceNow: -86400 * 12)
        ),
        MediaItem(
            id: "mock-movie-04",
            title: "极速方程式",
            kind: .movie, year: 2025, area: "英国", language: "英语",
            genres: ["运动", "热血"], rating: 8.4, durationMinutes: 134,
            overview: "从卡丁车赛场一路闯进顶级方程式的新人车手，要在赛季最后一站证明：天赋之外，还有一颗不肯认输的心。",
            posterURL: poster("apexlap"), backdropURL: backdrop("apexlap"),
            remark: "4K 杜比视界", isFinished: true,
            specs: MediaSpecs(is4K: true, isHDR: true, isDolbyVision: true, isDolbyAtmos: true, isHEVC: true, fps: 60),
            cast: cast(["卢卡·莫雷蒂", "艾玛·怀特"]),
            directors: director(["丹尼尔·克罗斯"]),
            stillImageURLs: (1...4).map { still("apexlap", index: $0) },
            updatedAt: Date(timeIntervalSinceNow: -86400 * 2)
        ),
        MediaItem(
            id: "mock-movie-05",
            title: "纸鸢",
            kind: .movie, year: 2022, area: "中国大陆", language: "国语",
            genres: ["家庭", "成长"], rating: 8.0, durationMinutes: 96,
            overview: "小镇少年和守着老屋的爷爷之间隔着一道沉默。一只断了线的风筝，让两代人终于说出了积攒多年的话。",
            posterURL: poster("paperkite"), backdropURL: backdrop("paperkite"),
            remark: "高清", isFinished: true,
            specs: MediaSpecs(),
            cast: cast(["白小满", "郑树声"]),
            directors: director(["何清源"]),
            stillImageURLs: (1...2).map { still("paperkite", index: $0) },
            updatedAt: Date(timeIntervalSinceNow: -86400 * 30)
        ),
        MediaItem(
            id: "mock-movie-06",
            title: "山海食肆",
            kind: .movie, year: 2025, area: "中国大陆", language: "国语",
            genres: ["美食", "奇幻"], rating: 7.6, durationMinutes: 112,
            overview: "山海之间有一间只在雾天开门的小馆，主厨用一道菜换一个故事。今夜来客说：我想吃一顿已经忘了的味道。",
            posterURL: poster("mountainfeast"), backdropURL: backdrop("mountainfeast"),
            remark: "4K HDR", isFinished: true,
            specs: MediaSpecs(is4K: true, isHDR: true, isHEVC: true),
            cast: cast(["乌桕", "阿萝"]),
            directors: director(["薛以宁"]),
            stillImageURLs: (1...3).map { still("mountainfeast", index: $0) },
            updatedAt: Date(timeIntervalSinceNow: -86400)
        ),
    ]

    // MARK: - 剧集 / 动漫 / 综艺（6 部，10~20 集）

    struct MockSeriesPlan {
        let id: String
        let title: String
        let kind: MediaKind
        let year: Int
        let area: String
        let genres: [String]
        let rating: Double
        let episodeCount: Int
        let episodeMinutes: Int
        let overview: String
        let seed: String
        let finished: Bool
        let specs: MediaSpecs
        let cast: [String]
        let director: String
        let useHLS: Bool
        let daysAgo: Int
    }

    static let seriesPlans: [MockSeriesPlan] = [
        MockSeriesPlan(
            id: "mock-series-01", title: "长夜将尽", kind: .series, year: 2025,
            area: "中国大陆", genres: ["悬疑", "犯罪"], rating: 9.1, episodeCount: 16,
            episodeMinutes: 45,
            overview: "滨城连环旧案重启，刑警队副队长在卷宗的字缝里发现了一个所有人都忽略的名字。随着调查深入，长夜里的每一盏灯都开始变得可疑。",
            seed: "longnight", finished: true,
            specs: MediaSpecs(is4K: true, isHDR: true, isDolbyVision: true, isDolbyAtmos: true, isHEVC: true),
            cast: ["赵拾光", "文岫", "老金"], director: "梁北", useHLS: true, daysAgo: 1
        ),
        MockSeriesPlan(
            id: "mock-series-02", title: "云上小馆", kind: .series, year: 2024,
            area: "日本", genres: ["治愈", "美食"], rating: 8.8, episodeCount: 12,
            episodeMinutes: 24,
            overview: "只有晴天营业的高山食堂，老板娘会根据客人的心事决定今日菜单。十二个故事，十二道菜，慢慢来。",
            seed: "cloudcafe", finished: true,
            specs: MediaSpecs(is4K: true, isHDR: true),
            cast: ["早乙女花", "栗山彻"], director: "小林泉", useHLS: false, daysAgo: 4
        ),
        MockSeriesPlan(
            id: "mock-series-03", title: "星轨行者", kind: .anime, year: 2025,
            area: "日本", genres: ["科幻", "热血"], rating: 9.3, episodeCount: 20,
            episodeMinutes: 24,
            overview: "人类沿着星轨向银河边缘迁徙的时代，少年拾荒者捡到了一颗还在跳动的心脏——那是一艘传说级航船的启动核心。",
            seed: "starorbit", finished: false,
            specs: MediaSpecs(is4K: true, isHDR: true, isDolbyAtmos: true, isHEVC: true),
            cast: ["入野疾风", "花泽雪绪"], director: "宫野航", useHLS: false, daysAgo: 0
        ),
        MockSeriesPlan(
            id: "mock-series-04", title: "幻界纪行", kind: .anime, year: 2024,
            area: "中国大陆", genres: ["奇幻", "冒险"], rating: 8.5, episodeCount: 12,
            episodeMinutes: 22,
            overview: "打开祖传旧柜子的少年成为了异界“行商”，靠倒卖两个世界的小物件发家，却不知不觉卷入了两个世界的命运。",
            seed: "fantasytrip", finished: true,
            specs: MediaSpecs(is4K: true, isHDR: true),
            cast: ["云雀", "苍梧"], director: "顾远山", useHLS: false, daysAgo: 9
        ),
        MockSeriesPlan(
            id: "mock-series-05", title: "星夜食光机", kind: .variety, year: 2025,
            area: "中国大陆", genres: ["真人秀", "美食"], rating: 8.1, episodeCount: 14,
            episodeMinutes: 90,
            overview: "六位嘉宾开着移动餐车环游海岸线，用当地食材做一顿深夜晚餐，也收集陌生人的人生故事。",
            seed: "nightfood", finished: false,
            specs: MediaSpecs(is4K: true, isDolbyAtmos: true),
            cast: ["贺星辰", "陆知野", "许见山", "多多"], director: "节目组", useHLS: false, daysAgo: 0
        ),
        MockSeriesPlan(
            id: "mock-series-06", title: "山海音乐会", kind: .variety, year: 2024,
            area: "中国大陆", genres: ["音乐", "现场"], rating: 8.9, episodeCount: 10,
            episodeMinutes: 75,
            overview: "把舞台搬进山谷、海岛与天台，每一期与一位音乐人重新编配一首老歌，献给自然与路过的人。",
            seed: "mountainconcert", finished: true,
            specs: MediaSpecs(is4K: true, isHDR: true, isDolbyAtmos: true, isHEVC: true),
            cast: ["多位音乐人"], director: "节目组", useHLS: false, daysAgo: 6
        ),
    ]

    static func seriesItem(from plan: MockSeriesPlan) -> MediaItem {
        MediaItem(
            id: plan.id,
            title: plan.title,
            kind: plan.kind,
            year: plan.year,
            area: plan.area,
            language: plan.area.contains("日本") ? "日语" : "国语",
            genres: plan.genres,
            rating: plan.rating,
            durationMinutes: plan.episodeMinutes,
            overview: plan.overview,
            posterURL: poster(plan.seed),
            backdropURL: backdrop(plan.seed),
            remark: plan.finished ? "已完结" : "更新至第\(plan.episodeCount)集",
            isFinished: plan.finished,
            specs: plan.specs,
            cast: cast(plan.cast),
            directors: director([plan.director]),
            stillImageURLs: (1...4).map { still(plan.seed, index: $0) },
            updatedAt: Date(timeIntervalSinceNow: -86400 * TimeInterval(plan.daysAgo))
        )
    }

    static func episodes(for plan: MockSeriesPlan) -> [Episode] {
        (1...plan.episodeCount).map { index in
            Episode(
                id: "\(plan.id)-ep-\(String(format: "%02d", index))",
                mediaId: plan.id,
                seasonIndex: 1,
                index: index,
                title: "第\(index)集",
                duration: Double(plan.episodeMinutes * 60),
                stillURL: still(plan.seed, index: (index - 1) % 4 + 1),
                remark: nil
            )
        }
    }

    static func seasons(for plan: MockSeriesPlan) -> [Season] {
        [Season(id: "\(plan.id)-s1", mediaId: plan.id, index: 1, name: "第1季")]
    }

    static func playURL(plan: MockSeriesPlan, episodeIndex: Int) -> URL {
        if plan.useHLS && episodeIndex == 1 {
            return appleHLS
        }
        let pool = sampleMP4s
        let hash = abs(plan.id.hashValue + episodeIndex)
        return pool[hash % pool.count]
    }

    // MARK: - 弹幕示例词库

    static let danmakuPool: [String] = [
        "这里真的笑死我了", "名场面来了！！", "前排围观", "画面质感绝了",
        "这段运镜太舒服了", "BGM一响眼泪就下来", "蹲一个下集", "进度条不够用了",
        "三刷打卡", "导演拍得真好", "演员台词功底好强", "这个转场满分",
        "高能预警！！", "素材来自未来吧这画质", "爷青回", "别催了在更了",
        "这集信息量好大", "音乐挑得太准了", "泪目", "建议反复观看",
        "他回头那一秒我心跳停了", "这颜色调得真高级", "冲着海报来的", "完结撒花",
        "人设好立体", "编剧加鸡腿", "空镜太美了", "下集呢下集呢",
        "打卡第N天", "沉浸式观影", "耳机党狂喜", "这卷我不允许有人没看过",
    ]

    static let danmakuColors = ["#FFFFFF", "#FFFFFF", "#FFFFFF", "#FFE08A", "#9BE7FF", "#FFB3C6"]
}
