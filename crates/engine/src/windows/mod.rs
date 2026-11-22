//! Real Windows backends. Everything here is behind `cfg(windows)`.
pub mod nvapi;

use crate::system::{backend_err, SystemInfo};
use crate::{Hive, SysError, SysResult, System, Target, Value};
use std::os::windows::process::CommandExt;
use std::process::Command;
use std::sync::Mutex;
use winreg::enums::*;
use winreg::types::FromRegValue;
use winreg::{RegKey, RegValue};

const NO_WINDOW: u32 = 0x0800_0000;
const ENUM_PCI: &str = r"SYSTEM\CurrentControlSet\Enum\PCI";

pub struct WindowsSystem {
    nv: Mutex<Option<nvapi::Nvapi>>,
}

impl Default for WindowsSystem {
    fn default() -> Self {
        Self {
            nv: Mutex::new(nvapi::Nvapi::load().ok()),
        }
    }
}

fn run(target: &Target, exe: &str, args: &[&str]) -> SysResult<String> {
    let out = Command::new(exe)
        .args(args)
        .creation_flags(NO_WINDOW)
        .output()?;
    let text = String::from_utf8_lossy(&out.stdout).into_owned();
    if out.status.success() {
        Ok(text)
    } else {
        Err(backend_err(
            target,
            format!(
                "{exe} {}: {}{}",
                args.join(" "),
                text.trim(),
                String::from_utf8_lossy(&out.stderr).trim()
            ),
        ))
    }
}

fn root(h: Hive) -> RegKey {
    RegKey::predef(match h {
        Hive::HKLM => HKEY_LOCAL_MACHINE,
        Hive::HKCU => HKEY_CURRENT_USER,
    })
}

fn not_found(e: &std::io::Error) -> bool {
    e.kind() == std::io::ErrorKind::NotFound
}

fn reg_read(key: &RegKey, path: &str, name: &str) -> std::io::Result<Value> {
    let k = match key.open_subkey(path) {
        Ok(k) => k,
        Err(e) if not_found(&e) => return Ok(Value::Missing),
        Err(e) => return Err(e),
    };
    let rv = match k.get_raw_value(name) {
        Ok(v) => v,
        Err(e) if not_found(&e) => return Ok(Value::Missing),
        Err(e) => return Err(e),
    };
    Ok(match rv.vtype {
        REG_DWORD => Value::Dword(u32::from_reg_value(&rv)?),
        REG_QWORD => Value::Qword(u64::from_reg_value(&rv)?),
        REG_SZ | REG_EXPAND_SZ => Value::String(String::from_reg_value(&rv)?),
        REG_MULTI_SZ => Value::Multi(Vec::<String>::from_reg_value(&rv)?),
        _ => Value::Binary(rv.bytes.to_vec()),
    })
}

fn reg_write(key: &RegKey, path: &str, name: &str, value: &Value) -> std::io::Result<()> {
    if let Value::Missing = value {
        return match key.open_subkey_with_flags(path, KEY_SET_VALUE) {
            Ok(k) => match k.delete_value(name) {
                Err(e) if !not_found(&e) => Err(e),
                _ => Ok(()),
            },
            Err(e) if not_found(&e) => Ok(()),
            Err(e) => Err(e),
        };
    }
    let (k, _) = key.create_subkey(path)?;
    match value {
        Value::Dword(v) => k.set_value(name, v),
        Value::Qword(v) => k.set_value(name, v),
        Value::String(v) => k.set_value(name, v),
        Value::Multi(v) => k.set_value(name, v),
        Value::Binary(b) => k.set_raw_value(
            name,
            &RegValue {
                bytes: b.clone(),
                vtype: REG_BINARY,
            },
        ),
        Value::Missing => Ok(()),
    }
}

fn class_guid(class: &str) -> Option<&'static str> {
    Some(match class {
        "display" => "{4d36e968-e325-11ce-bfc1-08002be10318}",
        "net" => "{4d36e972-e325-11ce-bfc1-08002be10318}",
        "usb" => "{36fc9e60-c465-11cf-8056-444553540000}",
        "audio" => "{4d36e96c-e325-11ce-bfc1-08002be10318}",
        _ => return None,
    })
}

/// Registry paths (under HKLM) for every physical PCI device of `class`. With an empty `subkey`
/// this is the driver key, where NIC advanced properties live; otherwise `Device Parameters\subkey`.
fn device_paths(class: &str, subkey: &str) -> Vec<String> {
    let Some(guid) = class_guid(class) else {
        return vec![];
    };
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let Ok(pci) = hklm.open_subkey(ENUM_PCI) else {
        return vec![];
    };
    let mut out = vec![];
    for dev in pci.enum_keys().flatten() {
        let Ok(dk) = pci.open_subkey(&dev) else {
            continue;
        };
        for inst in dk.enum_keys().flatten() {
            let Ok(ik) = dk.open_subkey(&inst) else {
                continue;
            };
            let cls: String = ik.get_value("ClassGUID").unwrap_or_default();
            if !cls.eq_ignore_ascii_case(guid) {
                continue;
            }
            if subkey.is_empty() {
                if let Ok(driver) = ik.get_value::<String, _>("Driver") {
                    out.push(format!(r"SYSTEM\CurrentControlSet\Control\Class\{driver}"));
                }
            } else {
                out.push(format!(
                    r"{ENUM_PCI}\{dev}\{inst}\Device Parameters\{subkey}"
                ));
            }
        }
    }
    out
}

fn bcd_read(target: &Target, element: &str) -> SysResult<Value> {
    let out = run(target, "bcdedit", &["/enum", "{current}"])?;
    Ok(out
        .lines()
        .find_map(|l| {
            let mut parts = l.split_whitespace();
            (parts.next()? == element).then(|| Value::String(parts.collect::<Vec<_>>().join(" ")))
        })
        .unwrap_or(Value::Missing))
}

/// `powercfg /qh` prints the AC then DC index as the last two hex values; labels are localized.
fn power_read(target: &Target, sub: &str, setting: &str) -> SysResult<Value> {
    let out = run(target, "powercfg", &["/qh", "SCHEME_CURRENT", sub, setting])?;
    let hex: Vec<u32> = out
        .lines()
        .filter_map(|l| {
            l.rsplit_once(": 0x")
                .and_then(|(_, h)| u32::from_str_radix(h.trim(), 16).ok())
        })
        .collect();
    match hex.len() {
        n if n >= 2 => Ok(Value::Dword(hex[n - 2])),
        _ => Err(SysError::Unsupported),
    }
}

fn task_read(target: &Target, path: &str) -> SysResult<Value> {
    let xml = run(target, "schtasks", &["/query", "/tn", path, "/xml"])
        .map_err(|_| SysError::Unsupported)?;
    let settings = xml.split("<Settings>").nth(1).unwrap_or("");
    let settings = settings.split("</Settings>").next().unwrap_or("");
    Ok(Value::Dword(u32::from(
        !settings.contains("<Enabled>false</Enabled>"),
    )))
}

impl WindowsSystem {
    pub fn with_nvidia<T>(
        &self,
        f: impl FnOnce(&nvapi::Session) -> Result<T, String>,
    ) -> Result<T, String> {
        let nv = self.nv.lock().map_err(|e| e.to_string())?;
        let api = nv.as_ref().ok_or("NVIDIA driver not available")?;
        let session = api.session()?;
        f(&session)
    }

    pub fn info(&self) -> SystemInfo {
        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
        let s = |path: &str, name: &str| {
            hklm.open_subkey(path)
                .and_then(|k| k.get_value::<String, _>(name))
                .unwrap_or_default()
        };
        let nt = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion";
        let bios = r"HARDWARE\DESCRIPTION\System\BIOS";
        let class_names = |guid: &str| -> Vec<String> {
            let Ok(k) = hklm.open_subkey(format!(r"SYSTEM\CurrentControlSet\Control\Class\{guid}"))
            else {
                return vec![];
            };
            k.enum_keys()
                .flatten()
                .filter_map(|n| k.open_subkey(&n).ok())
                .filter_map(|d| {
                    let name: String = d.get_value("DriverDesc").ok()?;
                    let ver: String = d.get_value("DriverVersion").unwrap_or_default();
                    Some(if ver.is_empty() {
                        name
                    } else {
                        format!("{name} ({ver})")
                    })
                })
                .collect()
        };
        let mut mem = windows::Win32::System::SystemInformation::MEMORYSTATUSEX {
            dwLength: 64,
            ..Default::default()
        };
        // SAFETY: struct sized and versioned per the API contract.
        let ram =
            unsafe { windows::Win32::System::SystemInformation::GlobalMemoryStatusEx(&mut mem) }
                .map(|_| mem.ullTotalPhys)
                .unwrap_or(0);
        let plan = run(
            &Target::Bcd {
                element: String::new(),
            },
            "powercfg",
            &["/getactivescheme"],
        )
        .ok()
        .and_then(|o| {
            o.split_once('(')
                .map(|(_, r)| r.trim_end().trim_end_matches(')').to_string())
        })
        .unwrap_or_default();
        SystemInfo {
            os: format!(
                "{} {} (build {})",
                s(nt, "ProductName"),
                s(nt, "DisplayVersion"),
                s(nt, "CurrentBuild")
            ),
            cpu: s(
                r"HARDWARE\DESCRIPTION\System\CentralProcessor\0",
                "ProcessorNameString",
            )
            .trim()
            .to_string(),
            threads: std::thread::available_parallelism()
                .map(|n| n.get())
                .unwrap_or(0),
            ram_bytes: ram,
            board: format!(
                "{} {}",
                s(bios, "BaseBoardManufacturer"),
                s(bios, "BaseBoardProduct")
            ),
            bios: format!("{} {}", s(bios, "BIOSVendor"), s(bios, "BIOSVersion")),
            gpus: class_names("{4d36e968-e325-11ce-bfc1-08002be10318}"),
            power_plan: plan,
            timer_resolution_ms: timer::query().map(|t| t.current_ms),
            nvidia: self.nv.lock().map(|n| n.is_some()).unwrap_or(false),
        }
    }
}

impl System for WindowsSystem {
    fn read(&self, target: &Target) -> SysResult<Value> {
        let io = |e: std::io::Error| backend_err(target, e);
        match target {
            Target::Registry { hive, path, name } => reg_read(&root(*hive), path, name).map_err(io),
            Target::DeviceRegistry {
                class,
                subkey,
                name,
            } => {
                let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
                let path = device_paths(class, subkey)
                    .into_iter()
                    .next()
                    .ok_or(SysError::Unsupported)?;
                reg_read(&hklm, &path, name).map_err(io)
            }
            Target::Service { name } => {
                let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
                let path = format!(r"SYSTEM\CurrentControlSet\Services\{name}");
                match reg_read(&hklm, &path, "Start").map_err(io)? {
                    Value::Missing => Err(SysError::Unsupported),
                    v => Ok(v),
                }
            }
            Target::Bcd { element } => bcd_read(target, element),
            Target::Power { subgroup, setting } => power_read(target, subgroup, setting),
            Target::Task { path } => task_read(target, path),
            Target::Nvidia { profile, setting } => {
                match self.with_nvidia(|s| s.get(profile.as_deref(), *setting)) {
                    Err(e) if e.contains("not available") => Err(SysError::Unsupported),
                    r => r.map_err(|e| backend_err(target, e)),
                }
            }
        }
    }

    fn write(&self, target: &Target, value: &Value) -> SysResult<()> {
        let io = |e: std::io::Error| backend_err(target, e);
        match target {
            Target::Registry { hive, path, name } => {
                reg_write(&root(*hive), path, name, value).map_err(io)
            }
            Target::DeviceRegistry {
                class,
                subkey,
                name,
            } => {
                let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
                let paths = device_paths(class, subkey);
                if paths.is_empty() {
                    return Err(SysError::Unsupported);
                }
                paths
                    .iter()
                    .try_for_each(|p| reg_write(&hklm, p, name, value))
                    .map_err(io)
            }
            Target::Service { name } => {
                let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
                let Value::Dword(_) = value else {
                    return Err(backend_err(target, "service start type must be a number"));
                };
                reg_write(
                    &hklm,
                    &format!(r"SYSTEM\CurrentControlSet\Services\{name}"),
                    "Start",
                    value,
                )
                .map_err(io)
            }
            Target::Bcd { element } => match value {
                Value::Missing if bcd_read(target, element)? == Value::Missing => Ok(()),
                Value::Missing => {
                    run(target, "bcdedit", &["/deletevalue", "{current}", element]).map(drop)
                }
                v => run(
                    target,
                    "bcdedit",
                    &["/set", "{current}", element, &v.to_string()],
                )
                .map(drop),
            },
            Target::Power { subgroup, setting } => {
                let Value::Dword(v) = value else {
                    return Ok(());
                };
                run(
                    target,
                    "powercfg",
                    &[
                        "/setacvalueindex",
                        "SCHEME_CURRENT",
                        subgroup,
                        setting,
                        &v.to_string(),
                    ],
                )?;
                run(target, "powercfg", &["/setactive", "SCHEME_CURRENT"]).map(drop)
            }
            Target::Task { path } => {
                let flag = if *value == Value::Dword(0) {
                    "/disable"
                } else {
                    "/enable"
                };
                run(target, "schtasks", &["/change", "/tn", path, flag]).map(drop)
            }
            Target::Nvidia { profile, setting } => self
                .with_nvidia(|s| s.set(profile.as_deref(), *setting, value))
                .map_err(|e| backend_err(target, e)),
        }
    }

    fn restore_point(&self, description: &str) -> SysResult<Option<i64>> {
        use windows::Win32::System::Restore::*;
        let mut info = RESTOREPOINTINFOW {
            dwEventType: BEGIN_SYSTEM_CHANGE,
            dwRestorePtType: MODIFY_SETTINGS,
            ..Default::default()
        };
        let mut desc = [0u16; 256];
        for (d, c) in desc.iter_mut().zip(description.encode_utf16().take(255)) {
            *d = c;
        }
        info.szDescription = desc;
        let mut status = STATEMGRSTATUS::default();
        // SAFETY: both structs are fully initialised and outlive the call.
        let ok = unsafe { SRSetRestorePointW(&info, &mut status) }.as_bool();
        if !ok {
            let code = { status.nStatus }.0;
            let target = Target::Bcd {
                element: "restore point".into(),
            };
            return Err(backend_err(
                &target,
                format!("System Restore is off or failed (status {code})"),
            ));
        }
        info.dwEventType = END_SYSTEM_CHANGE;
        info.llSequenceNumber = status.llSequenceNumber;
        // SAFETY: as above.
        let _ = unsafe { SRSetRestorePointW(&info, &mut status) };
        Ok(Some(info.llSequenceNumber))
    }
}

pub mod timer {
    #[link(name = "ntdll")]
    extern "system" {
        fn NtQueryTimerResolution(min: *mut u32, max: *mut u32, current: *mut u32) -> i32;
        fn NtSetTimerResolution(desired: u32, set: u8, current: *mut u32) -> i32;
    }

    #[derive(Debug, Clone, Copy, serde::Serialize)]
    pub struct TimerResolution {
        pub min_ms: f64,
        pub max_ms: f64,
        pub current_ms: f64,
    }

    /// Values are in 100 ns units; "min" is the coarsest (15.6 ms), "max" the finest (0.5 ms).
    pub fn query() -> Option<TimerResolution> {
        let (mut min, mut max, mut cur) = (0, 0, 0);
        // SAFETY: three out-pointers to locals.
        (unsafe { NtQueryTimerResolution(&mut min, &mut max, &mut cur) } == 0).then(|| {
            TimerResolution {
                min_ms: f64::from(min) / 10_000.0,
                max_ms: f64::from(max) / 10_000.0,
                current_ms: f64::from(cur) / 10_000.0,
            }
        })
    }

    /// Requests the finest resolution for as long as this process runs (or `false` to release).
    pub fn request_max(on: bool) -> Option<f64> {
        let t = query()?;
        let mut cur = 0;
        // SAFETY: out-pointer to a local.
        let st =
            unsafe { NtSetTimerResolution((t.max_ms * 10_000.0) as u32, u8::from(on), &mut cur) };
        (st == 0).then(|| f64::from(cur) / 10_000.0)
    }
}
