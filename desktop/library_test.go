package main

import "testing"

func TestCleanTitle(t *testing.T) {
	cases := map[string]string{
		"[Group] Movie (2020) 1080p": "Movie 1080p",
		"Some.Show.Name":             "Some Show Name",
		"  Plain  ":                  "Plain",
	}
	for in, want := range cases {
		if got := cleanTitle(in); got != want {
			t.Errorf("cleanTitle(%q)=%q want %q", in, got, want)
		}
	}
}

func TestParseEpisodeName(t *testing.T) {
	got := parseEpisodeName("Show.Name.S01E02.The.Title.mp4")
	if got == nil {
		t.Fatal("expected match")
	}
	if got.seriesTitle != "Show Name" || got.seasonIndex != 1 || got.index != 2 || got.episodeTitle != "The Title" {
		t.Fatalf("unexpected: %+v", got)
	}
	if parseEpisodeName("JustAMovie.mp4") != nil {
		t.Fatal("plain movie should not match episode pattern")
	}
}

func TestBuildLibraryGroupsSeries(t *testing.T) {
	scan := buildLibrary([]string{
		"/m/Show.S01E02.b.mp4", "/m/Show.S01E01.a.mp4", "/m/Film.mp4",
	})
	if len(scan.Items) != 2 {
		t.Fatalf("items=%d want 2", len(scan.Items))
	}
	var seriesID, movieID string
	for _, it := range scan.Items {
		if it.Kind == KindSeries {
			seriesID = it.ID
		} else {
			movieID = it.ID
		}
	}
	var seriesEps, movieEps int
	for _, ep := range scan.Episodes {
		switch ep.MediaID {
		case seriesID:
			seriesEps++
		case movieID:
			movieEps++
		}
	}
	if seriesEps != 2 || movieEps != 1 {
		t.Fatalf("seriesEps=%d movieEps=%d want 2/1", seriesEps, movieEps)
	}
}

func TestMediaPathRoundTrip(t *testing.T) {
	path := "/home/用户/影片 第1集.mp4"
	if got, err := decodeMediaPath(encodeMediaPath(path)); err != nil || got != path {
		t.Fatalf("roundtrip got=%q err=%v", got, err)
	}
}
