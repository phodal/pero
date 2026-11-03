package pluginruntime

func (app *HookApp) writeTerminal(sequence string) {
	if app == nil || sequence == "" || app.options.EmitTerminal == nil {
		return
	}
	app.options.EmitTerminal(sequence)
}
