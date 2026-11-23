use crate::{Target, Value};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Risk {
    Safe,
    Caution,
    OptIn,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Verdict {
    Harmful,
    Conflict,
    Placebo,
    Keep,
    Risk,
}

/// Catalog values are written loosely in TOML: integers are DWORDs, "not set" means Missing.
#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
enum RawValue {
    Int(u64),
    Str(String),
    List(Vec<String>),
}

fn value<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Value, D::Error> {
    Ok(match RawValue::deserialize(d)? {
        RawValue::Int(n) => match u32::try_from(n) {
            Ok(v) => Value::Dword(v),
            Err(_) => Value::Qword(n),
        },
        RawValue::Str(s) if s == "not set" => Value::Missing,
        RawValue::Str(s) => Value::String(s),
        RawValue::List(v) => Value::Multi(v),
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Change {
    pub target: Target,
    #[serde(deserialize_with = "value")]
    pub value: Value,
    /// Clean Windows 11 value, used by "reset to default".
    #[serde(deserialize_with = "value")]
    pub default: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tweak {
    pub id: String,
    pub module: String,
    pub title: String,
    pub why: String,
    pub risk: Risk,
    #[serde(default)]
    pub restart: bool,
    pub changes: Vec<Change>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditRule {
    pub id: String,
    pub title: String,
    pub target: Target,
    #[serde(deserialize_with = "value")]
    pub default: Value,
    /// Verdict when the current value differs from `default`.
    pub verdict: Verdict,
    #[serde(default)]
    pub sources: Vec<String>,
    pub why: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Preset {
    pub id: String,
    pub title: String,
    pub summary: String,
    pub tweaks: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Catalog {
    #[serde(default, rename = "tweak")]
    pub tweaks: Vec<Tweak>,
    #[serde(default, rename = "audit")]
    pub audit: Vec<AuditRule>,
    #[serde(default, rename = "preset")]
    pub presets: Vec<Preset>,
}

const SOURCES: &[&str] = &[
    include_str!("../catalog/cpu.toml"),
    include_str!("../catalog/timers.toml"),
    include_str!("../catalog/interrupts.toml"),
    include_str!("../catalog/memory.toml"),
    include_str!("../catalog/storage.toml"),
    include_str!("../catalog/graphics.toml"),
    include_str!("../catalog/input.toml"),
    include_str!("../catalog/audio.toml"),
    include_str!("../catalog/network.toml"),
    include_str!("../catalog/windows.toml"),
    include_str!("../catalog/security.toml"),
    include_str!("../catalog/privacy.toml"),
    include_str!("../catalog/audit.toml"),
    include_str!("../catalog/presets.toml"),
];

#[derive(Debug, thiserror::Error)]
#[error("catalog file {index}: {source}")]
pub struct CatalogError {
    index: usize,
    source: toml::de::Error,
}

impl Catalog {
    pub fn builtin() -> Result<Self, CatalogError> {
        let mut all = Catalog {
            tweaks: vec![],
            audit: vec![],
            presets: vec![],
        };
        for (index, src) in SOURCES.iter().enumerate() {
            let c: Catalog =
                toml::from_str(src).map_err(|source| CatalogError { index, source })?;
            all.tweaks.extend(c.tweaks);
            all.audit.extend(c.audit);
            all.presets.extend(c.presets);
        }
        Ok(all)
    }

    pub fn tweak(&self, id: &str) -> Option<&Tweak> {
        self.tweaks.iter().find(|t| t.id == id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn builtin_catalog_parses_with_unique_ids() {
        let c = Catalog::builtin().map_err(|e| e.to_string());
        let c = match c {
            Ok(c) => c,
            Err(e) => panic!("{e}"),
        };
        assert!(c.tweaks.len() >= 150, "only {} tweaks", c.tweaks.len());
        let mut seen = HashSet::new();
        for t in &c.tweaks {
            assert!(seen.insert(t.id.clone()), "duplicate tweak id {}", t.id);
            assert!(!t.changes.is_empty(), "{} has no changes", t.id);
        }
        for a in &c.audit {
            assert!(seen.insert(a.id.clone()), "duplicate audit id {}", a.id);
        }
    }

    #[test]
    fn presets_reference_known_tweaks() {
        let c = Catalog::builtin().map_err(|e| e.to_string());
        let c = match c {
            Ok(c) => c,
            Err(e) => panic!("{e}"),
        };
        assert!(c.presets.len() >= 6, "only {} presets", c.presets.len());
        let mut preset_ids = HashSet::new();
        for preset in &c.presets {
            assert!(
                preset_ids.insert(preset.id.clone()),
                "duplicate preset id {}",
                preset.id
            );
            let mut tweak_ids = HashSet::new();
            for id in &preset.tweaks {
                assert!(tweak_ids.insert(id), "duplicate tweak id {id} in {}", preset.id);
                let tweak = c
                    .tweak(id)
                    .unwrap_or_else(|| panic!("unknown tweak id {id} in {}", preset.id));
                assert_ne!(
                    tweak.risk,
                    Risk::OptIn,
                    "opt-in tweak {id} in {}",
                    preset.id
                );
            }
        }
    }
}
