//go:build e2e

package main

// e2e 专用：绕过原生 GTK 文件对话框，用给定路径直接播种片库。
//
// 原生文件对话框（mygo.Dialog.Open）无法被自动化驱动，所以真机端到端脚本
// 走这条测试通道：前端在 eval 里用 globalThis.mygo.call("Cinema.SeedPaths", paths)
// 调本方法，语义与 PickVideos 去掉对话框后完全一致——授权访问 + 扫描归组。
//
// 只在 `go build -tags e2e` 时编入；`mygo build` 的发布包不含此文件，
// 因此不会成为正式分发面的一部分（也不会出现在生成的 src/mygo.ts 里）。
func (c *Cinema) SeedPaths(paths []string) (*LibraryScan, error) {
	if len(paths) == 0 {
		return nil, nil
	}
	// 与 PickVideos 相同：先登记授权，媒体服务才会放行这些路径。
	c.access.Authorize(paths)
	scan := buildLibrary(paths)
	return &scan, nil
}
