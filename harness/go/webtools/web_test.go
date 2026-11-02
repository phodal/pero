package webtools

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestSearchSelection(t *testing.T) {
	sources := []Source{{URL: "https://example.com/a", Title: "root", Summary: "root summary"}, {URL: "https://docs.example.com/b", Title: "docs"}, {URL: "https://example.com.evil.test/c"}, {URL: "https://notexample.com/d"}, {URL: "https://user:password@example.com/e"}, {URL: "file:///etc/passwd"}}
	for _, test := range []struct {
		name             string
		allowed, blocked []string
		count, filtered  int
	}{
		{"allow includes real subdomains", []string{"EXAMPLE.COM"}, nil, 2, 4},
		{"block includes real subdomains", nil, []string{"example.com"}, 2, 4},
		{"narrow subdomain excludes parent", []string{"docs.example.com"}, nil, 1, 5},
	} {
		t.Run(test.name, func(t *testing.T) {
			query, err := NewSearchQuery("current details", test.allowed, test.blocked)
			if err != nil {
				t.Fatal(err)
			}
			result := query.Select(sources)
			if len(result.Sources) != test.count || result.Filtered != test.filtered {
				t.Fatalf("%+v", result)
			}
		})
	}
	for _, bad := range []string{"https://example.com", "example.com/path", "*.example.com", "example.com:443", "exämple.com", "-bad.test", "bad..test", " bad.test"} {
		if _, err := NewSearchQuery("details", []string{bad}, nil); err == nil {
			t.Errorf("accepted invalid domain %q", bad)
		}
	}
	if _, err := NewSearchQuery("details", []string{"example.com"}, []string{"other.test"}); err == nil {
		t.Fatal("combined domain filters accepted")
	}
	for _, bad := range []string{" ", strings.Repeat("界", 129)} {
		if _, err := NewSearchQuery(bad, nil, nil); err == nil {
			t.Fatal("invalid query accepted")
		}
	}
	query, err := NewSearchQuery(strings.Repeat("界", 128), []string{"example.com"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if utf8.RuneCountInString(query.ProviderQuery()) != 128 {
		t.Fatal("domain hint overflowed upstream query limit")
	}
	list := []Source{}
	for i := 0; i < 10; i++ {
		list = append(list, Source{URL: "https://example.com/" + strings.Repeat("x", i), Summary: strings.Repeat("界", 900)})
	}
	result := query.Select(list)
	if !result.Truncated || len(result.Sources) != MaxSources || utf8.RuneCountInString(result.Sources[0].Summary) != 800 {
		t.Fatalf("source/excerpt bounds lost: %+v", result)
	}
}

func TestPageExcerpt(t *testing.T) {
	for _, bad := range []string{"http://localhost/a", "https://intranet/a", "file:///tmp/file", "https://user:password@example.com/", "https://example.com/has space"} {
		if _, err := NewPageURL(bad); err == nil {
			t.Errorf("accepted unsupported URL %q", bad)
		}
	}
	query, err := NewFetchQuery("http://example.com/article", "extract the acceptance criteria", 2)
	if err != nil {
		t.Fatal(err)
	}
	page := Page{Title: "source", Markdown: "前缀" + strings.Repeat("界", MaxPageCharacters) + "tail"}
	excerpt, err := query.Excerpt(page)
	if err != nil {
		t.Fatal(err)
	}
	if excerpt.URL != "https://example.com/article" || excerpt.Offset != 2 || excerpt.EndOffset != MaxPageCharacters+2 || excerpt.TotalCharacters != MaxPageCharacters+6 || !excerpt.Truncated || utf8.RuneCountInString(excerpt.Content) != MaxPageCharacters || !utf8.ValidString(excerpt.Content) {
		t.Fatalf("%+v", excerpt)
	}
	next, err := NewFetchQuery(excerpt.URL, "continue", excerpt.EndOffset)
	if err != nil {
		t.Fatal(err)
	}
	last, err := next.Excerpt(page)
	if err != nil || last.Content != "tail" || last.Truncated {
		t.Fatalf("%+v %v", last, err)
	}
	past, err := NewFetchQuery(excerpt.URL, "continue", len([]rune(page.Markdown))+1)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := past.Excerpt(page); err == nil {
		t.Fatal("past-page offset accepted")
	}
	for _, test := range []struct {
		prompt string
		offset int
	}{{" ", 0}, {"read", -1}} {
		if _, err := NewFetchQuery("https://example.com/", test.prompt, test.offset); err == nil {
			t.Fatal("invalid fetch request accepted")
		}
	}
}
