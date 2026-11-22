use crate::{Target, Value};
use std::collections::HashMap;
use std::sync::Mutex;

#[derive(Debug, thiserror::Error)]
pub enum SysError {
    #[error("{0}")]
    Io(#[from] std::io::Error),
    #[error("{target}: {msg}")]
    Backend { target: String, msg: String },
    #[error("not supported on this platform")]
    Unsupported,
}

pub type SysResult<T> = Result<T, SysError>;

pub fn backend_err(target: &Target, msg: impl ToString) -> SysError {
    SysError::Backend {
        target: target.to_string(),
        msg: msg.to_string(),
    }
}

/// Reads and writes system settings. `WindowsSystem` is the real one; `MemorySystem` backs tests
/// and the browser preview.
pub trait System: Send + Sync {
    fn read(&self, target: &Target) -> SysResult<Value>;
    fn write(&self, target: &Target, value: &Value) -> SysResult<()>;
    /// Returns a restore point sequence number, if one was created.
    fn restore_point(&self, description: &str) -> SysResult<Option<i64>>;
}

#[derive(Default)]
pub struct MemorySystem {
    values: Mutex<HashMap<Target, Value>>,
    pub fail_on: Mutex<Option<Target>>,
}

impl MemorySystem {
    pub fn with(values: impl IntoIterator<Item = (Target, Value)>) -> Self {
        Self {
            values: Mutex::new(values.into_iter().collect()),
            fail_on: Mutex::new(None),
        }
    }
}

impl System for MemorySystem {
    fn read(&self, target: &Target) -> SysResult<Value> {
        let map = self.values.lock().map_err(|e| backend_err(target, e))?;
        Ok(map.get(target).cloned().unwrap_or(Value::Missing))
    }

    fn write(&self, target: &Target, value: &Value) -> SysResult<()> {
        if self
            .fail_on
            .lock()
            .map_err(|e| backend_err(target, e))?
            .as_ref()
            == Some(target)
        {
            return Err(backend_err(target, "simulated failure"));
        }
        let mut map = self.values.lock().map_err(|e| backend_err(target, e))?;
        match value {
            Value::Missing => map.remove(target),
            v => map.insert(target.clone(), v.clone()),
        };
        Ok(())
    }

    fn restore_point(&self, _: &str) -> SysResult<Option<i64>> {
        Ok(None)
    }
}

#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct SystemInfo {
    pub os: String,
    pub cpu: String,
    pub threads: usize,
    pub ram_bytes: u64,
    pub board: String,
    pub bios: String,
    pub gpus: Vec<String>,
    pub power_plan: String,
    pub timer_resolution_ms: Option<f64>,
    pub nvidia: bool,
}
