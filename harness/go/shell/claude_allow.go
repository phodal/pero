package shell

import (
	"path/filepath"
	"strings"
	"unicode"
)

// ClaudeAllowCommands splits a Bash command the way Claude's allow-rule matcher
// does before comparing patterns. Recognized separators are &&, ||, ;, |, |&, &
// and newlines. ok is false when the command is unparseable for allow matching:
// trailing &&/||, substitutions, redirections, subshells, comments or quotes
// that prevent a literal split. A specifier that cannot be interpreted never
// grants permission.
func ClaudeAllowCommands(command string) ([]string, bool) {
	command = strings.Trim(command, " \t\r\n")
	if command == "" || strings.IndexByte(command, 0) >= 0 {
		return nil, false
	}
	var commands []string
	var current strings.Builder
	var quote byte
	flush := func() bool {
		part := strings.Trim(current.String(), " \t")
		current.Reset()
		if part == "" {
			return false
		}
		commands = append(commands, part)
		return true
	}
	for i := 0; i < len(command); i++ {
		c := command[i]
		if quote == '\'' {
			current.WriteByte(c)
			if c == '\'' {
				quote = 0
			}
			continue
		}
		if quote == '"' {
			switch c {
			case '"':
				quote = 0
				current.WriteByte(c)
			case '$', '`':
				return nil, false
			case '\\':
				if i+1 >= len(command) {
					return nil, false
				}
				current.WriteByte(c)
				i++
				current.WriteByte(command[i])
			default:
				current.WriteByte(c)
			}
			continue
		}
		switch c {
		case '\'', '"':
			quote = c
			current.WriteByte(c)
		case '\\':
			if i+1 >= len(command) || command[i+1] == '\n' || command[i+1] == '\r' {
				return nil, false
			}
			current.WriteByte(c)
			i++
			current.WriteByte(command[i])
		case '$', '`', '(', ')', '{', '}', '<', '>', '#':
			return nil, false
		case '\n', '\r', ';':
			if !flush() {
				return nil, false
			}
		case '&':
			if i+1 < len(command) && command[i+1] == '&' {
				if !flush() {
					return nil, false
				}
				i++
				if trailingEmptyAllowOperand(command[i+1:]) {
					return nil, false
				}
				continue
			}
			if i+1 < len(command) && command[i+1] == '>' {
				return nil, false
			}
			if !flush() {
				return nil, false
			}
		case '|':
			if i+1 < len(command) && (command[i+1] == '|' || command[i+1] == '&') {
				op := command[i+1]
				if !flush() {
					return nil, false
				}
				i++
				if op == '|' && trailingEmptyAllowOperand(command[i+1:]) {
					return nil, false
				}
				continue
			}
			if !flush() {
				return nil, false
			}
		default:
			current.WriteByte(c)
		}
	}
	if quote != 0 {
		return nil, false
	}
	if current.Len() > 0 || len(commands) == 0 {
		if !flush() {
			return nil, false
		}
	}
	return commands, true
}

func trailingEmptyAllowOperand(rest string) bool {
	return strings.Trim(rest, " \t\r\n") == ""
}

// ClaudeStripAllowWrappers removes the documented fixed wrappers and known-safe
// leading environment assignments before an allow pattern is compared. ok is
// false when a leading assignment is not in that safe set: allow rules must not
// match past an unknown assignment. The remaining text is a slice of the input
// so pattern matching keeps Claude's original spelling.
func ClaudeStripAllowWrappers(command string) (string, bool) {
	command = strings.TrimLeft(command, " \t")
	for {
		trimmed := strings.TrimLeft(command, " \t")
		if trimmed == "" {
			return "", false
		}
		command = trimmed
		words, ok := simpleCommandWords(command)
		if !ok || len(words) == 0 {
			return "", false
		}
		switch base := filepath.Base(words[0]); base {
		case "timeout":
			next, ok := skipAllowWords(command, 2)
			if !ok {
				return command, true
			}
			command = next
			continue
		case "time", "nohup", "noglob", "builtin":
			next, ok := skipAllowWords(command, 1)
			if !ok {
				return command, true
			}
			command = next
			continue
		case "command":
			if len(words) < 2 || words[1] == "-v" || words[1] == "-V" || strings.HasPrefix(words[1], "-") {
				return command, true
			}
			next, ok := skipAllowWords(command, 1)
			if !ok {
				return command, true
			}
			command = next
			continue
		case "nice":
			skip := 1
			if len(words) > 1 {
				switch {
				case words[1] == "-n":
					skip = 3
				case strings.HasPrefix(words[1], "-n") && len(words[1]) > 2:
					skip = 2
				case len(words[1]) > 1 && words[1][0] == '-' && isAllDigits(words[1][1:]):
					skip = 2
				}
			}
			next, ok := skipAllowWords(command, skip)
			if !ok {
				return command, true
			}
			command = next
			continue
		case "stdbuf":
			skip, ok := countStdbufWords(words[1:])
			if !ok {
				return command, true
			}
			next, ok := skipAllowWords(command, 1+skip)
			if !ok {
				return command, true
			}
			command = next
			continue
		case "xargs":
			if len(words) < 2 || strings.HasPrefix(words[1], "-") {
				return command, true
			}
			next, ok := skipAllowWords(command, 1)
			if !ok {
				return command, true
			}
			command = next
			continue
		}
		if name, rest, ok := splitLeadingAssignment(command); ok {
			if !claudeSafeAllowEnv(name) {
				return "", false
			}
			command = rest
			continue
		}
		return command, true
	}
}

// ClaudeReadOnlyAllowCommand reports whether a wrapper-stripped command is in
// Claude's documented read-only set for allow matching. Dangerous find actions
// and unclassified git forms stay outside the set.
func ClaudeReadOnlyAllowCommand(command string) bool {
	stripped, ok := ClaudeStripAllowWrappers(command)
	if !ok {
		return false
	}
	words, ok := simpleCommandWords(stripped)
	if !ok || len(words) == 0 {
		return false
	}
	switch filepath.Base(words[0]) {
	case "ls", "cat", "echo", "pwd", "head", "tail", "grep", "egrep", "fgrep", "rg", "wc", "which", "diff", "stat", "du", "cd":
		return true
	case "find":
		for _, word := range words[1:] {
			switch word {
			case "-delete", "-exec", "-execdir", "-ok", "-okdir", "-fls", "-fprint", "-fprint0", "-fprintf", "-files0-from", "-rm":
				return false
			}
		}
		return true
	case "git":
		return claudeReadOnlyGit(words[1:])
	default:
		return false
	}
}

func claudeReadOnlyGit(args []string) bool {
	for i := 0; i < len(args); i++ {
		switch arg := args[i]; {
		case arg == "--no-pager", arg == "--paginate":
			continue
		case arg == "-C":
			if i+1 >= len(args) {
				return false
			}
			i++
			continue
		case strings.HasPrefix(arg, "-C") && len(arg) > 2:
			continue
		case arg == "status", arg == "log", arg == "diff", arg == "show", arg == "grep",
			arg == "branch", arg == "tag", arg == "remote", arg == "rev-parse", arg == "describe",
			arg == "ls-files", arg == "ls-tree", arg == "cat-file", arg == "blame", arg == "shortlog":
			return true
		default:
			return false
		}
	}
	return false
}

func claudeSafeAllowEnv(name string) bool {
	switch name {
	case "NODE_ENV", "CI", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "TERM", "COLORTERM",
		"HOME", "USER", "LOGNAME", "PWD", "OLDPWD", "TMPDIR", "XDG_RUNTIME_DIR":
		return true
	default:
		return false
	}
}

func splitLeadingAssignment(command string) (name, rest string, ok bool) {
	command = strings.TrimLeft(command, " \t")
	if command == "" {
		return "", "", false
	}
	nameEnd := 0
	for nameEnd < len(command) {
		c := command[nameEnd]
		if c == '=' {
			break
		}
		if nameEnd == 0 {
			if !unicode.IsLetter(rune(c)) && c != '_' {
				return "", "", false
			}
		} else if !unicode.IsLetter(rune(c)) && !unicode.IsDigit(rune(c)) && c != '_' {
			return "", "", false
		}
		nameEnd++
	}
	if nameEnd == 0 || nameEnd >= len(command) || command[nameEnd] != '=' {
		return "", "", false
	}
	i := nameEnd + 1
	switch {
	case i < len(command) && (command[i] == '\'' || command[i] == '"'):
		quote := command[i]
		i++
		for i < len(command) {
			c := command[i]
			if c == quote {
				i++
				break
			}
			if quote == '"' && c == '\\' {
				i++
			}
			i++
		}
	default:
		for i < len(command) && command[i] != ' ' && command[i] != '\t' {
			if strings.ContainsRune("$`&|;<>(){}\n\r", rune(command[i])) {
				return "", "", false
			}
			if command[i] == '\\' {
				i++
			}
			i++
		}
	}
	if i >= len(command) {
		return "", "", false
	}
	for i < len(command) && (command[i] == ' ' || command[i] == '\t') {
		i++
	}
	if i >= len(command) {
		return "", "", false
	}
	return command[:nameEnd], command[i:], true
}

func skipAllowWords(command string, count int) (string, bool) {
	rest := command
	for i := 0; i < count; i++ {
		next, ok := skipOneAllowWord(rest)
		if !ok {
			return "", false
		}
		rest = next
	}
	rest = strings.TrimLeft(rest, " \t")
	if rest == "" {
		return "", false
	}
	return rest, true
}

func skipOneAllowWord(command string) (string, bool) {
	command = strings.TrimLeft(command, " \t")
	if command == "" {
		return "", false
	}
	var quote byte
	for i := 0; i < len(command); i++ {
		c := command[i]
		if quote == '\'' {
			if c == '\'' {
				quote = 0
			}
			continue
		}
		if quote == '"' {
			switch c {
			case '"':
				quote = 0
			case '\\':
				if i+1 >= len(command) {
					return "", false
				}
				i++
			case '$', '`':
				return "", false
			}
			continue
		}
		switch c {
		case '\'', '"':
			quote = c
		case '\\':
			if i+1 >= len(command) {
				return "", false
			}
			i++
		case ' ', '\t':
			return command[i:], true
		case ';', '&', '|', '<', '>', '(', ')', '{', '}', '\n', '\r', '#', '$', '`':
			return "", false
		}
	}
	if quote != 0 {
		return "", false
	}
	return "", true
}

func countStdbufWords(words []string) (int, bool) {
	skip := 0
	for len(words) > 0 {
		word := words[0]
		switch {
		case word == "-e" || word == "-i" || word == "-o" || word == "--error" || word == "--input" || word == "--output":
			if len(words) < 2 {
				return 0, false
			}
			skip += 2
			words = words[2:]
		case strings.HasPrefix(word, "-e") || strings.HasPrefix(word, "-i") || strings.HasPrefix(word, "-o"):
			skip++
			words = words[1:]
		case strings.HasPrefix(word, "--error=") || strings.HasPrefix(word, "--input=") || strings.HasPrefix(word, "--output="):
			skip++
			words = words[1:]
		default:
			return skip, len(words) > 0
		}
	}
	return 0, false
}

func isAllDigits(value string) bool {
	if value == "" {
		return false
	}
	for _, c := range value {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}
