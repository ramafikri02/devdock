use crate::models::GitStatusInfo;
use std::path::Path;
use std::process::{Command, Stdio};

/// Inspects a folder's Git repository state in read-only mode.
pub fn inspect_git_folder(folder: &Path) -> GitStatusInfo {
    if !folder.is_dir() {
        return GitStatusInfo {
            is_git_repo: false,
            branch: None,
            is_dirty: false,
            changed_files: 0,
        };
    }

    let output = Command::new("git")
        .args(["-C"])
        .arg(folder)
        .args(["status", "--porcelain=v1", "-b"])
        .stdin(Stdio::null())
        .output();

    let Ok(out) = output else {
        return GitStatusInfo {
            is_git_repo: false,
            branch: None,
            is_dirty: false,
            changed_files: 0,
        };
    };

    if !out.status.success() {
        return GitStatusInfo {
            is_git_repo: false,
            branch: None,
            is_dirty: false,
            changed_files: 0,
        };
    }

    let stdout = String::from_utf8_lossy(&out.stdout);
    let mut lines = stdout.lines();
    let header = lines.next().unwrap_or("");
    let mut branch = parse_porcelain_branch(header);

    if branch.is_none() {
        if let Ok(head_out) = Command::new("git")
            .args(["-C"])
            .arg(folder)
            .args(["rev-parse", "--short", "HEAD"])
            .stdin(Stdio::null())
            .output()
        {
            if head_out.status.success() {
                let rev = String::from_utf8_lossy(&head_out.stdout).trim().to_string();
                if !rev.is_empty() {
                    branch = Some(format!("HEAD ({rev})"));
                }
            }
        }
    }

    let changed_files = lines.filter(|l| !l.trim().is_empty()).count();
    GitStatusInfo {
        is_git_repo: true,
        branch,
        is_dirty: changed_files > 0,
        changed_files,
    }
}

fn parse_porcelain_branch(header: &str) -> Option<String> {
    let rest = header.strip_prefix("## ")?.trim();
    if let Some(branch_part) = rest.strip_prefix("No commits yet on ") {
        let name = branch_part.trim();
        return if name.is_empty() {
            None
        } else {
            Some(name.to_string())
        };
    }
    if rest.starts_with("HEAD (no branch)") {
        return None;
    }
    let name = rest.split("...").next().unwrap_or(rest).trim();
    if name.is_empty() {
        None
    } else {
        Some(name.to_string())
    }
}
