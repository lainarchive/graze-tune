use crate::{System, Target, Value};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Entry {
    pub target: Target,
    pub old: Value,
    pub new: Value,
    pub tweak: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BatchState {
    /// Old values recorded, writes in progress. Seen after a crash: revert it.
    Pending,
    Applied,
    Failed,
    Reverted,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Batch {
    pub id: u64,
    pub at: u64,
    pub label: String,
    pub restore_point: Option<i64>,
    pub entries: Vec<Entry>,
    pub state: BatchState,
    pub error: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum UndoError {
    #[error("undo log io: {0}")]
    Io(#[from] std::io::Error),
    #[error("undo log is corrupt: {0}")]
    Corrupt(#[from] serde_json::Error),
    #[error(transparent)]
    Sys(#[from] crate::SysError),
    #[error("no batch {0}")]
    NoBatch(u64),
}

/// Write-ahead undo log. Old values are saved to disk before anything is written, so a crash
/// mid-batch still leaves enough to put everything back.
pub struct UndoLog {
    path: PathBuf,
    pub batches: Vec<Batch>,
}

pub struct Planned {
    pub target: Target,
    pub value: Value,
    pub tweak: Option<String>,
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

impl UndoLog {
    pub fn open(path: impl Into<PathBuf>) -> Result<Self, UndoError> {
        let path = path.into();
        let batches = match std::fs::read(&path) {
            Ok(b) => serde_json::from_slice(&b)?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => vec![],
            Err(e) => return Err(e.into()),
        };
        Ok(Self { path, batches })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    fn save(&self) -> Result<(), UndoError> {
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let tmp = self.path.with_extension("tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(&self.batches)?)?;
        std::fs::rename(&tmp, &self.path)?;
        Ok(())
    }

    /// Applies `plan` as one batch. On any write failure the already-written values are put back
    /// and the batch is recorded as failed.
    pub fn apply(
        &mut self,
        sys: &dyn System,
        label: &str,
        plan: Vec<Planned>,
        restore_point: bool,
    ) -> Result<Batch, UndoError> {
        let mut entries = Vec::with_capacity(plan.len());
        for p in plan {
            let old = sys.read(&p.target)?;
            if old != p.value {
                entries.push(Entry {
                    target: p.target,
                    old,
                    new: p.value,
                    tweak: p.tweak,
                });
            }
        }
        let rp = if restore_point && !entries.is_empty() {
            sys.restore_point(&format!("graze-tune: {label}"))?
        } else {
            None
        };
        let id = self.batches.iter().map(|b| b.id).max().unwrap_or(0) + 1;
        self.batches.push(Batch {
            id,
            at: now(),
            label: label.into(),
            restore_point: rp,
            entries,
            state: BatchState::Pending,
            error: None,
        });
        self.save()?;

        let idx = self.batches.len() - 1;
        let mut done = 0;
        let mut failure = None;
        for e in &self.batches[idx].entries {
            if let Err(err) = sys.write(&e.target, &e.new) {
                failure = Some(err.to_string());
                break;
            }
            done += 1;
        }
        let batch = &mut self.batches[idx];
        if let Some(msg) = failure {
            for e in batch.entries[..done].iter().rev() {
                let _ = sys.write(&e.target, &e.old);
            }
            batch.state = BatchState::Failed;
            batch.error = Some(msg);
        } else {
            batch.state = BatchState::Applied;
        }
        let out = batch.clone();
        self.save()?;
        Ok(out)
    }

    /// Puts back the old values of one batch, newest write first. Returns targets that failed.
    pub fn revert(&mut self, sys: &dyn System, id: u64) -> Result<Vec<String>, UndoError> {
        let batch = self
            .batches
            .iter_mut()
            .find(|b| b.id == id)
            .ok_or(UndoError::NoBatch(id))?;
        if batch.state == BatchState::Reverted {
            return Ok(vec![]);
        }
        let failed: Vec<String> = batch
            .entries
            .iter()
            .rev()
            .filter_map(|e| {
                sys.write(&e.target, &e.old)
                    .err()
                    .map(|err| err.to_string())
            })
            .collect();
        if failed.is_empty() {
            batch.state = BatchState::Reverted;
        } else {
            batch.error = Some(failed.join("; "));
        }
        self.save()?;
        Ok(failed)
    }

    /// Reverts every applied or interrupted batch, newest first.
    pub fn revert_all(&mut self, sys: &dyn System) -> Result<Vec<String>, UndoError> {
        let ids: Vec<u64> = self
            .batches
            .iter()
            .rev()
            .filter(|b| matches!(b.state, BatchState::Applied | BatchState::Pending))
            .map(|b| b.id)
            .collect();
        let mut failed = vec![];
        for id in ids {
            failed.extend(self.revert(sys, id)?);
        }
        Ok(failed)
    }

    /// The value graze-tune last wrote for `target`, if a live batch owns it.
    pub fn owner(&self, target: &Target) -> Option<&Entry> {
        self.batches
            .iter()
            .rev()
            .filter(|b| b.state == BatchState::Applied)
            .flat_map(|b| b.entries.iter())
            .find(|e| &e.target == target)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Hive, MemorySystem};

    fn reg(name: &str) -> Target {
        Target::Registry {
            hive: Hive::HKLM,
            path: "SOFTWARE\\Test".into(),
            name: name.into(),
        }
    }

    fn plan(name: &str, v: u32) -> Planned {
        Planned {
            target: reg(name),
            value: Value::Dword(v),
            tweak: None,
        }
    }

    fn tmp(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("graze-undo-{name}-{}.json", std::process::id()));
        let _ = std::fs::remove_file(&p);
        p
    }

    #[test]
    fn apply_then_revert_restores_old_values_and_persists() -> Result<(), UndoError> {
        let sys = MemorySystem::with([(reg("a"), Value::Dword(1))]);
        let path = tmp("roundtrip");
        let mut log = UndoLog::open(&path)?;
        let b = log.apply(&sys, "test", vec![plan("a", 2), plan("b", 5)], false)?;
        assert_eq!(b.state, BatchState::Applied);
        assert_eq!(sys.read(&reg("b"))?, Value::Dword(5));

        let mut log = UndoLog::open(&path)?;
        assert_eq!(log.batches.len(), 1);
        assert!(log.revert(&sys, b.id)?.is_empty());
        assert_eq!(sys.read(&reg("a"))?, Value::Dword(1));
        assert_eq!(sys.read(&reg("b"))?, Value::Missing);
        Ok(())
    }

    #[test]
    fn failed_write_rolls_back_partial_batch() -> Result<(), UndoError> {
        let sys = MemorySystem::with([(reg("a"), Value::Dword(1))]);
        if let Ok(mut f) = sys.fail_on.lock() {
            *f = Some(reg("b"));
        }
        let mut log = UndoLog::open(tmp("fail"))?;
        let b = log.apply(&sys, "test", vec![plan("a", 2), plan("b", 5)], false)?;
        assert_eq!(b.state, BatchState::Failed);
        assert_eq!(sys.read(&reg("a"))?, Value::Dword(1));
        Ok(())
    }

    #[test]
    fn revert_all_goes_newest_first() -> Result<(), UndoError> {
        let sys = MemorySystem::with([(reg("a"), Value::Dword(1))]);
        let mut log = UndoLog::open(tmp("all"))?;
        log.apply(&sys, "one", vec![plan("a", 2)], false)?;
        log.apply(&sys, "two", vec![plan("a", 3)], false)?;
        assert!(log.revert_all(&sys)?.is_empty());
        assert_eq!(sys.read(&reg("a"))?, Value::Dword(1));
        Ok(())
    }

    #[test]
    fn unchanged_values_are_skipped() -> Result<(), UndoError> {
        let sys = MemorySystem::with([(reg("a"), Value::Dword(2))]);
        let mut log = UndoLog::open(tmp("skip"))?;
        let b = log.apply(&sys, "noop", vec![plan("a", 2)], false)?;
        assert!(b.entries.is_empty());
        Ok(())
    }
}
