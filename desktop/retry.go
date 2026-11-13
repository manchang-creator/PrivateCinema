package main

// ==================== 红果匿名额度：设备轮换 + 重试 ====================
// 背景：2026-10-29 起，红果对「每台匿名设备」大约只给一次播放模型，用尽后播放接口返回空，
// SDK 抛 ErrAnonymousLimited。SDK 内部自带 DeviceResets（默认 2 次）会在该错误/设备被拒时
// 丢弃当前设备、注册新设备再重试。这里再加一层「外层轮换」：
//   - 当 SDK 内部轮换耗尽仍受限时，显式调用 client.ResetDevice 强制换一台匿名设备，再重跑整次调用；
//   - 次数与退避可用环境变量调：HONGGUO_MAX_ROTATIONS（默认 2）、HONGGUO_ROTATE_DELAY_MS（默认 800ms，指数退避封顶 8s）；
//   - 只对「额度/限流/设备被拒」这类可恢复错误轮换，其它错误（内容下架、鉴权）直接上抛。
// 注意：若上游按 IP/地区限流，换设备也救不了，此时会如实把错误抛给界面。

import (
	"context"
	"errors"
	"log"
	"os"
	"strconv"
	"time"

	"github.com/beilunyang/openhongguo/sdk"
)

func envInt(key string, fallback int) int {
	if raw := os.Getenv(key); raw != "" {
		if v, err := strconv.Atoi(raw); err == nil && v >= 0 {
			return v
		}
	}
	return fallback
}

// isHongguoQuotaErr 判断错误是否属于「换设备后可能恢复」的匿名额度类错误。
func isHongguoQuotaErr(err error) bool {
	if err == nil {
		return false
	}
	return errors.Is(err, sdk.ErrAnonymousLimited) ||
		errors.Is(err, sdk.ErrRateLimited) ||
		errors.Is(err, sdk.ErrDeviceRejected)
}

// quotaBackoff 第 attempt 次（从 1 起）换设备前的等待：base * 2^(attempt-1)，封顶 8s。
func quotaBackoff(attempt int, base time.Duration) time.Duration {
	if attempt < 1 {
		attempt = 1
	}
	d := base
	for i := 1; i < attempt; i++ {
		d *= 2
		if d >= 8*time.Second {
			return 8 * time.Second
		}
	}
	if d > 8*time.Second {
		d = 8 * time.Second
	}
	return d
}

// resetHongguoDevice 强制让 SDK 丢弃当前匿名设备并注册一台新的。
func resetHongguoDevice() error {
	client, err := getClient()
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), hongguoTimeout)
	defer cancel()
	return client.ResetDevice(ctx)
}

// withQuotaRetry 执行一次红果调用；若因匿名额度受限，则换设备后重试若干次。
func withQuotaRetry[T any](label string, fn func() (T, error)) (T, error) {
	res, err := fn()
	if err == nil || !isHongguoQuotaErr(err) {
		return res, err
	}
	rotations := envInt("HONGGUO_MAX_ROTATIONS", 2)
	base := time.Duration(envInt("HONGGUO_ROTATE_DELAY_MS", 800)) * time.Millisecond
	for i := 1; i <= rotations; i++ {
		wait := quotaBackoff(i, base)
		log.Printf("[hongguo] %s 受限（%v），换设备重试 %d/%d，等待 %s", label, err, i, rotations, wait)
		if rerr := resetHongguoDevice(); rerr != nil {
			log.Printf("[hongguo] ResetDevice 失败：%v", rerr)
			return res, err
		}
		time.Sleep(wait)
		res, err = fn()
		if err == nil || !isHongguoQuotaErr(err) {
			return res, err
		}
	}
	return res, err
}
