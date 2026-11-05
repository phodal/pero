package nativetools

type terminalToolDefinition struct {
	name, action, description, properties, required string
	approval                                        bool
}

func terminalToolDefinitions(claude bool) []terminalToolDefinition {
	names := []string{"terminal_open", "terminal_read", "terminal_write", "terminal_resize", "terminal_stop"}
	if claude {
		names = []string{"TerminalOpen", "TerminalRead", "TerminalWrite", "TerminalResize", "TerminalStop"}
	}
	id := `"terminal_id":{"type":"string","minLength":1,"maxLength":128}`
	dimensions := `"rows":{"type":"integer","minimum":1,"maximum":1000},"columns":{"type":"integer","minimum":1,"maximum":1000}`
	return []terminalToolDefinition{
		{names[0], "open", "Start an approved command attached to a real PTY. The returned terminal_id belongs to this exact agent and remains live across turns until exit, stop, cancellation, retirement or timeout. timeout_ms uses the configured shell default and maximum; there is no unlimited lifetime. Capacity is 16 live terminals and 128 retained handles per native owner. Output retains only the configured shell byte budget (at most 64 KiB), with cursor/truncation receipts. Uses existing shell/workspace authority and bounded environment. Linux/macOS without a configured sandbox only; this is not OS confinement. An intent is checkpointed before launch; historical processes are never restarted. Output is raw terminal text/escape sequences, not a rendered screen.", `"command":{"type":"string","minLength":1,"maxLength":16384},"timeout_ms":{"type":"integer","minimum":1},` + dimensions, `"command"`, true},
		{names[1], "read", "Read bounded PTY output by zero-based byte offset. Default limit 8192, maximum 16384. wait_ms waits at most 1000ms for new output or exit. next_offset continues; available_from/truncated report discarded ring-buffer bytes. running=false exposes actual exit/signal/cancellation.", id + `,"offset":{"type":"integer","minimum":0},"limit":{"type":"integer","minimum":1,"maximum":16384},"wait_ms":{"type":"integer","minimum":0,"maximum":1000}`, `"terminal_id"`, false},
		{names[2], "write", "Send approved UTF-8 stdin to the owned live PTY, at most 16 KiB with a one-second write deadline. Data may include newlines or terminal control characters. written_bytes reports accepted data bytes even on partial failure; never blindly retry. eof=true sends canonical Ctrl-D twice and closes further tool input; programs in raw mode or with modified EOF handling may not exit. Read the actual state or explicitly stop.", id + `,"data":{"type":"string","maxLength":16384},"eof":{"type":"boolean"}`, `"terminal_id"`, true},
		{names[3], "resize", "Resize an owned PTY and notify its foreground program through the operating system. Dimensions are rows/columns, each 1..1000.", id + `,` + dimensions, `"terminal_id","rows","columns"`, false},
		{names[4], "stop", "Stop and join an owned PTY process group. Returns its observed final state; does not discard the retained bounded output.", id, `"terminal_id"`, false},
	}
}
