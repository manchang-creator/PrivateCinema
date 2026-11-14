resources/ffmpeg/ 与 resources/<goos>-<goarch>/ 下的 ffmpeg 相关文件：

- ffmpeg(.exe)          随包分发的 FFmpeg 可执行文件（解密 + 转码用）
- ffmpeg-LICENSE.txt    该构建的完整许可文本（GPLv3；Gyan essentials build 是 --enable-gpl）
- ffmpeg-NOTICE.txt     来源、版本、用途与源码获取方式
- COPYING.GPLv3         上面文本的副本，方便打包工具一层层带上

源码获取：https://ffmpeg.org/releases/ffmpeg-<版本>.tar.xz
构建脚本：https://github.com/GyanD/codexffmpeg

不要手工改这些文件：它们由 desktop/scripts/fetch-ffmpeg.sh 生成。
