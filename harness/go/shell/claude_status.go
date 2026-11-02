package shell

import (
	"path/filepath"
	"strings"
)

// ClaudeCommandSucceeded applies the Bash tool's documented exit-1 exceptions
// only when the command can be identified without evaluating shell syntax.
// Compound commands, substitutions and redirections retain ordinary failure
// semantics rather than attributing another command's status to a search.
func ClaudeCommandSucceeded(command string, exitCode *int) bool {
	if exitCode == nil {
		return false
	}
	if *exitCode == 0 {
		return true
	}
	if *exitCode != 1 {
		return false
	}
	words, ok := simpleCommandWords(command)
	if !ok || len(words) == 0 {
		return false
	}
	switch filepath.Base(words[0]) {
	case "grep", "rg", "egrep", "fgrep", "find", "diff", "test", "[":
		return true
	case "git":
		// These global options preserve the following literal subcommand. Other
		// prefixes are intentionally not inferred from a partial shell parse.
		for i := 1; i < len(words); i++ {
			switch word := words[i]; {
			case word == "--no-pager", word == "--paginate":
				continue
			case word == "-C":
				if i+1 >= len(words) {
					return false
				}
				i++
				continue
			case strings.HasPrefix(word, "-C") && len(word) > 2:
				continue
			default:
				return word == "diff" || word == "grep"
			}
		}
	}
	return false
}

// simpleCommandWords recognizes literal shell words with quoting and escaping.
// It is deliberately not a shell evaluator: expansions, control operators and
// redirections are outside the subset whose exit status can be classified.
func simpleCommandWords(command string) ([]string, bool) {
	command = strings.Trim(command, " \t\r\n")
	if strings.IndexByte(command, 0) >= 0 {
		return nil, false
	}
	var words []string
	var word strings.Builder
	var quote byte
	started := false
	for i := 0; i < len(command); i++ {
		c := command[i]
		if quote == '\'' {
			if c == '\'' {
				quote = 0
			} else {
				word.WriteByte(c)
			}
			continue
		}
		if quote == '"' {
			switch c {
			case '"':
				quote = 0
			case '$', '`':
				return nil, false
			case '\\':
				if i+1 >= len(command) {
					return nil, false
				}
				next := command[i+1]
				if next == '\n' || next == '\r' {
					return nil, false
				}
				if strings.ContainsRune("$`\"\\", rune(next)) {
					i++
					word.WriteByte(next)
				} else {
					word.WriteByte(c)
				}
			default:
				word.WriteByte(c)
			}
			continue
		}
		switch c {
		case ' ', '\t':
			if started {
				words = append(words, word.String())
				word.Reset()
				started = false
			}
		case '\'', '"':
			quote, started = c, true
		case '\\':
			if i+1 >= len(command) || command[i+1] == '\n' || command[i+1] == '\r' {
				return nil, false
			}
			i++
			word.WriteByte(command[i])
			started = true
		case ';', '&', '|', '<', '>', '(', ')', '{', '}', '\n', '\r', '#', '$', '`':
			return nil, false
		default:
			word.WriteByte(c)
			started = true
		}
	}
	if quote != 0 {
		return nil, false
	}
	if started {
		words = append(words, word.String())
	}
	return words, true
}
