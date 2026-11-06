# Persistent R cell worker. Frames match worker_python.py. No host.mcp.

limit <- as.integer(Sys.getenv("PERO_SCIENCE_OUTPUT_BYTES", "262144"))
input <- file("stdin", open = "rb")

read_line_raw <- function(con) {
  out <- raw()
  repeat {
    byte <- readBin(con, "raw", 1)
    if (length(byte) == 0) return(character())
    if (byte[[1]] == as.raw(10L)) return(rawToChar(out))
    if (byte[[1]] != as.raw(13L)) out <- c(out, byte)
  }
}

read_frame <- function() {
  header <- read_line_raw(input)
  if (length(header) == 0 || header == "") quit(save = "no", status = 0)
  parts <- strsplit(header, " ", fixed = TRUE)[[1]]
  kind <- parts[[1]]
  n <- as.integer(parts[[2]])
  payload <- if (n > 0) rawToChar(readBin(input, "raw", n)) else ""
  list(kind = kind, payload = payload)
}

write_frame <- function(kind, payload) {
  if (!is.character(payload)) payload <- rawToChar(payload)
  payload <- enc2utf8(payload)
  cat(kind, " ", nchar(payload, type = "bytes"), "\n", payload, sep = "")
  flush(stdout())
}

clip <- function(text) {
  raw <- charToRaw(enc2utf8(text))
  if (length(raw) <= limit) return(text)
  paste0(rawToChar(raw[seq_len(limit)]), "\n...[truncated]")
}

json_str <- function(text) {
  text <- enc2utf8(if (is.null(text) || is.na(text)) "" else text)
  text <- gsub("\\", "\\\\", text, fixed = TRUE)
  text <- gsub("\"", "\\\"", text, fixed = TRUE)
  text <- gsub("\n", "\\n", text, fixed = TRUE)
  text <- gsub("\r", "\\r", text, fixed = TRUE)
  text <- gsub("\t", "\\t", text, fixed = TRUE)
  paste0("\"", text, "\"")
}

read_file <- function(path) {
  if (!file.exists(path) || file.info(path)$size == 0) return("")
  paste(readLines(path, warn = FALSE), collapse = "\n")
}

run_cell <- function(code) {
  out_f <- tempfile("pero-science-out-")
  msg_f <- tempfile("pero-science-msg-")
  msg_con <- file(msg_f, open = "wt")
  err <- ""
  sink(out_f)
  sink(msg_con, type = "message")
  tryCatch({
    exprs <- parse(text = code)
    visible <- FALSE
    value <- NULL
    if (length(exprs) > 0) {
      for (i in seq_along(exprs)) {
        shown <- withVisible(eval(exprs[[i]], envir = .GlobalEnv))
        value <- shown$value
        visible <- shown$visible
      }
      if (isTRUE(visible) && !is.null(value)) print(value)
    }
  }, error = function(e) {
    err <<- conditionMessage(e)
  })
  sink(type = "message")
  sink()
  close(msg_con)
  list(stdout = read_file(out_f), stderr = read_file(msg_f), error = err)
}

repeat {
  frame <- read_frame()
  if (frame$kind != "EXEC") {
    body <- paste0("{\"stdout\":\"\",\"stderr\":\"\",\"error\":", json_str(paste("unexpected frame", frame$kind)), "}")
    write_frame("RESULT", body)
    next
  }
  result <- run_cell(frame$payload)
  body <- paste0(
    "{\"stdout\":", json_str(clip(result$stdout)),
    ",\"stderr\":", json_str(clip(result$stderr)),
    ",\"error\":", json_str(clip(result$error)), "}"
  )
  write_frame("RESULT", body)
}
