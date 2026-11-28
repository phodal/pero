package migrations

import (
	"strconv"
	"strings"
	"testing"
)

func TestMigrationVersionsAreUnique(t *testing.T) {
	entries, err := scripts.ReadDir(".")
	if err != nil {
		t.Fatal(err)
	}
	seen := map[int]string{}
	for _, entry := range entries {
		prefix, _, ok := strings.Cut(entry.Name(), "_")
		if !ok || !strings.HasSuffix(entry.Name(), ".sql") {
			t.Fatalf("migration name %s", entry.Name())
		}
		version, err := strconv.Atoi(prefix)
		if err != nil {
			t.Fatal(err)
		}
		if previous, exists := seen[version]; exists {
			t.Fatalf("migration version %d is used by %s and %s", version, previous, entry.Name())
		}
		seen[version] = entry.Name()
	}
	if len(seen) == 0 {
		t.Fatal("no migrations")
	}
}
