use serde::{Deserialize, Serialize};
use std::fmt;

/// A setting value as read from or written to the system. `Missing` means "not set", which is
/// how Windows represents most defaults, so resetting to it deletes the value.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", content = "data", rename_all = "lowercase")]
pub enum Value {
    Missing,
    Dword(u32),
    Qword(u64),
    String(String),
    Multi(Vec<String>),
    Binary(Vec<u8>),
}

impl fmt::Display for Value {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Value::Missing => write!(f, "not set"),
            Value::Dword(v) if *v > 9 => write!(f, "0x{v:X}"),
            Value::Dword(v) => write!(f, "{v}"),
            Value::Qword(v) => write!(f, "0x{v:X}"),
            Value::String(s) => write!(f, "{s}"),
            Value::Multi(v) => write!(f, "{}", v.join(", ")),
            Value::Binary(b) => {
                for x in b.iter().take(16) {
                    write!(f, "{x:02X}")?;
                }
                if b.len() > 16 {
                    write!(f, "…")?;
                }
                Ok(())
            }
        }
    }
}
