pub mod git_sync;
pub mod markdown;
pub mod models;
pub mod plugins;
pub mod search;
pub mod vault;

use std::fmt;

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Debug)]
pub enum FolkloreError {
    Io(std::io::Error),
    Validation(String),
    Parse(String),
    Git(String),
    NotFound(String),
}

impl fmt::Display for FolkloreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            FolkloreError::Io(err) => write!(f, "I/O error: {}", err),
            FolkloreError::Validation(msg) => write!(f, "Validation error: {}", msg),
            FolkloreError::Parse(msg) => write!(f, "Parse error: {}", msg),
            FolkloreError::Git(msg) => write!(f, "Git error: {}", msg),
            FolkloreError::NotFound(msg) => write!(f, "Not found: {}", msg),
        }
    }
}

impl std::error::Error for FolkloreError {}

impl From<std::io::Error> for FolkloreError {
    fn from(value: std::io::Error) -> Self {
        FolkloreError::Io(value)
    }
}

pub type Result<T> = std::result::Result<T, FolkloreError>;
