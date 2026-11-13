package main

import (
	"testing"
	"time"

	"github.com/beilunyang/openhongguo/sdk"
)

func TestIsHongguoQuotaErr(t *testing.T) {
	cases := []struct {
		err  error
		want bool
	}{
		{sdk.ErrAnonymousLimited, true},
		{sdk.ErrRateLimited, true},
		{sdk.ErrDeviceRejected, true},
		{sdk.ErrContentUnavailable, false},
		{nil, false},
	}
	for _, c := range cases {
		if got := isHongguoQuotaErr(c.err); got != c.want {
			t.Errorf("isHongguoQuotaErr(%v)=%v want %v", c.err, got, c.want)
		}
	}
}

func TestQuotaBackoff(t *testing.T) {
	base := 800 * time.Millisecond
	want := []time.Duration{800, 1600, 3200, 6400}
	for i, w := range want {
		if got := quotaBackoff(i+1, base); got != w*time.Millisecond {
			t.Errorf("quotaBackoff(%d)=%v want %v", i+1, got, w*time.Millisecond)
		}
	}
	if got := quotaBackoff(10, base); got != 8*time.Second {
		t.Errorf("quotaBackoff(10)=%v want 8s (cap)", got)
	}
}

func TestEnvInt(t *testing.T) {
	t.Setenv("HONGGUO_TEST_INT", "5")
	if got := envInt("HONGGUO_TEST_INT", 1); got != 5 {
		t.Fatalf("envInt=5 got %d", got)
	}
	t.Setenv("HONGGUO_TEST_INT", "bad")
	if got := envInt("HONGGUO_TEST_INT", 1); got != 1 {
		t.Fatalf("envInt fallback got %d", got)
	}
}
