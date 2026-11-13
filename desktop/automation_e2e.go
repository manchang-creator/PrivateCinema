//go:build e2e

package main

// 仅在 `go build -tags e2e` 时编入：链接 MyGo 的 automation 插件，
// 使外部进程（如 mygo-automation CLI）可以驱动正在运行的应用。
// 发布构建（mygo build）不带此 tag，因此不会进入正式分发包。
import _ "github.com/egoist/mygo/plugins/automation"
