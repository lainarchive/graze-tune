use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Hive {
    #[serde(alias = "HKEY_LOCAL_MACHINE")]
    HKLM,
    #[serde(alias = "HKEY_CURRENT_USER")]
    HKCU,
}

/// One thing a tweak reads or writes. Every backend maps a target to a single value so the undo
/// log can store old values uniformly.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Target {
    Registry {
        hive: Hive,
        path: String,
        name: String,
    },
    /// Registry value under every present PCI device of a class, e.g. MSI mode on the GPU.
    /// `class` is "display", "net", "usb" or "audio"; `subkey` is relative to `Device Parameters`.
    DeviceRegistry {
        class: String,
        subkey: String,
        name: String,
    },
    /// Service start type (2 auto, 3 manual, 4 disabled).
    Service { name: String },
    /// `bcdedit /set {current} <element> <value>`.
    Bcd { element: String },
    /// Power setting on the active plan, AC value.
    Power { subgroup: String, setting: String },
    /// Scheduled task enabled state (Dword 1/0).
    Task { path: String },
    /// NVIDIA driver profile setting. `profile` None = global (base) profile.
    Nvidia {
        profile: Option<String>,
        setting: u32,
    },
}

impl fmt::Display for Target {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Target::Registry { hive, path, name } => write!(f, "{hive:?}\\{path}\\{name}"),
            Target::DeviceRegistry {
                class,
                subkey,
                name,
            } => write!(f, "{class} devices\\Device Parameters\\{subkey}\\{name}"),
            Target::Service { name } => write!(f, "service {name} start type"),
            Target::Bcd { element } => write!(f, "bcdedit {{current}} {element}"),
            Target::Power { subgroup, setting } => write!(f, "powercfg {subgroup} {setting}"),
            Target::Task { path } => write!(f, "task {path}"),
            Target::Nvidia { profile, setting } => write!(
                f,
                "NVIDIA {} 0x{setting:08X}",
                profile.as_deref().unwrap_or("Base Profile")
            ),
        }
    }
}
