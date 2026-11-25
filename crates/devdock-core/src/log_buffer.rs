use crate::models::{LogLine, LogStream};
use std::collections::VecDeque;

pub const DEFAULT_LOG_CAPACITY: usize = 10_000;

/// Bounded in-memory ring buffer storing real-time log lines for a single process.
#[derive(Debug)]
pub struct LogBuffer {
    capacity: usize,
    lines: VecDeque<LogLine>,
}

impl LogBuffer {
    pub fn new(capacity: usize) -> Self {
        let cap = capacity.max(1);
        Self {
            capacity: cap,
            lines: VecDeque::with_capacity(cap.min(1024)),
        }
    }

    pub fn with_default_capacity() -> Self {
        Self::new(DEFAULT_LOG_CAPACITY)
    }

    pub fn capacity(&self) -> usize {
        self.capacity
    }

    pub fn len(&self) -> usize {
        self.lines.len()
    }

    pub fn is_empty(&self) -> bool {
        self.lines.is_empty()
    }

    pub fn push(&mut self, line: LogLine) {
        if self.lines.len() >= self.capacity {
            self.lines.pop_front();
        }
        self.lines.push_back(line);
    }

    pub fn clear(&mut self) {
        self.lines.clear();
    }

    pub fn all_lines(&self) -> Vec<LogLine> {
        self.lines.iter().cloned().collect()
    }

    pub fn filtered(&self, filter: Option<&str>, stderr_only: bool) -> Vec<LogLine> {
        filter_log_lines(self.lines.iter(), filter, stderr_only)
    }
}

pub fn filter_log_lines<'a>(
    lines: impl Iterator<Item = &'a LogLine>,
    filter: Option<&str>,
    stderr_only: bool,
) -> Vec<LogLine> {
    let query = filter
        .map(str::trim)
        .filter(|q| !q.is_empty())
        .map(|q| q.to_ascii_lowercase());

    lines
        .filter(|line| {
            if stderr_only && line.stream != LogStream::Stderr {
                return false;
            }
            if let Some(ref q) = query {
                let plain = strip_ansi_codes(&line.text).to_ascii_lowercase();
                plain.contains(q)
                    || line.service_name.to_ascii_lowercase().contains(q)
                    || line.script.to_ascii_lowercase().contains(q)
            } else {
                true
            }
        })
        .cloned()
        .collect()
}

/// Strips ANSI CSI (`\x1b[...m`) and OSC (`\x1b]...`) escape sequences so live search
/// and plain-text log export work reliably on colored terminal output.
pub fn strip_ansi_codes(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();

    while let Some(ch) = chars.next() {
        if ch == '\x1b' {
            match chars.peek().copied() {
                Some('[') => {
                    chars.next();
                    // CSI sequence ends with a byte in 0x40..=0x7E
                    for c in chars.by_ref() {
                        if ('@'..='~').contains(&c) {
                            break;
                        }
                    }
                }
                Some(']') => {
                    chars.next();
                    // OSC sequence ends with BEL (\x07) or ST (\x1b\\)
                    while let Some(c) = chars.next() {
                        if c == '\x07' {
                            break;
                        }
                        if c == '\x1b' && chars.peek() == Some(&'\\') {
                            chars.next();
                            break;
                        }
                    }
                }
                _ => {}
            }
        } else {
            out.push(ch);
        }
    }

    out
}

pub fn format_log_line_for_export(
    line: &LogLine,
    include_service_tag: bool,
    strip_ansi: bool,
) -> String {
    let text = if strip_ansi {
        strip_ansi_codes(&line.text)
    } else {
        line.text.clone()
    };
    let stream_tag = match line.stream {
        LogStream::Stdout => "OUT",
        LogStream::Stderr => "ERR",
        LogStream::System => "SYS",
    };
    if include_service_tag {
        format!(
            "[{}] [{}] [{}:{}] {}",
            line.timestamp, stream_tag, line.service_name, line.script, text
        )
    } else {
        format!("[{}] [{}] {}", line.timestamp, stream_tag, text)
    }
}
