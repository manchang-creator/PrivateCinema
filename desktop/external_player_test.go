package main

import (
	"os"
	"strings"
	"testing"
)

func TestPickPlayerEnvOverride(t *testing.T) {
	t.Setenv("PRIVATE_CINEMA_PLAYER", "/bin/echo --fs")
	player, args, err := pickPlayer()
	if err != nil {
		t.Fatalf("pickPlayer: %v", err)
	}
	if player != "/bin/echo" {
		t.Fatalf("player=%q want /bin/echo", player)
	}
	if len(args) != 1 || args[0] != "--fs" {
		t.Fatalf("args=%v want [--fs]", args)
	}
}

func TestPlayExternalRejectsUnauthorized(t *testing.T) {
	c := &Cinema{access: newAccessRegistry()}
	if _, err := c.PlayExternal("/tmp/whatever.mkv"); err == nil || !strings.Contains(err.Error(), "未授权") {
		t.Fatalf("expected 未授权, got %v", err)
	}
}

func TestPlayExternalMissingAuthorized(t *testing.T) {
	c := &Cinema{access: newAccessRegistry()}
	path := "/tmp/private-cinema-definitely-missing.mkv"
	c.access.Authorize([]string{path})
	if _, err := c.PlayExternal(path); err == nil || !strings.Contains(err.Error(), "文件不存在") {
		t.Fatalf("expected 文件不存在, got %v", err)
	}
}

func TestPlayExternalSpawnsPlayer(t *testing.T) {
	dir := t.TempDir()
	path := dir + "/sample.mkv"
	if err := os.WriteFile(path, []byte("not-a-real-video"), 0o644); err != nil {
		t.Fatal(err)
	}
	c := &Cinema{access: newAccessRegistry()}
	c.access.Authorize([]string{path})
	t.Setenv("PRIVATE_CINEMA_PLAYER", "/bin/true")
	player, err := c.PlayExternal(path)
	if err != nil {
		t.Fatalf("PlayExternal: %v", err)
	}
	if player != "/bin/true" {
		t.Fatalf("player=%q want /bin/true", player)
	}
}
