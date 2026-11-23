use graze_engine::audit::{self, AuditReport};
use graze_engine::nip::{Nip, NipProfile, NipSetting, Strings, BASE_PROFILE};
use graze_engine::stats::{self, FrameStats, PingStats};
use graze_engine::system::SystemInfo;
use graze_engine::{Batch, Catalog, Planned, System, Target, UndoLog, Value};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::Manager;

#[cfg(windows)]
type Platform = graze_engine::windows::WindowsSystem;
#[cfg(not(windows))]
type Platform = graze_engine::MemorySystem;

struct Core {
    sys: Platform,
    log: Mutex<UndoLog>,
    #[cfg(windows)]
    legacy: PathBuf,
    catalog: Catalog,
}

type State<'a> = tauri::State<'a, Arc<Core>>;
type Res<T> = Result<T, String>;

/// Runs blocking system work off the async runtime's worker threads.
async fn blocking<T: Send + 'static>(
    core: &State<'_>,
    f: impl FnOnce(&Core) -> Res<T> + Send + 'static,
) -> Res<T> {
    let core = Arc::clone(core);
    tauri::async_runtime::spawn_blocking(move || f(&core))
        .await
        .map_err(|e| e.to_string())?
}

fn with_log<T>(
    core: &Core,
    f: impl FnOnce(&mut UndoLog) -> Result<T, graze_engine::undo::UndoError>,
) -> Res<T> {
    let mut log = core.log.lock().map_err(|e| e.to_string())?;
    f(&mut log).map_err(|e| e.to_string())
}

#[tauri::command]
async fn system_info(core: State<'_>) -> Res<SystemInfo> {
    blocking(&core, |c| {
        #[cfg(windows)]
        return Ok(c.sys.info());
        #[cfg(not(windows))]
        return Ok(SystemInfo {
            os: std::env::consts::OS.into(),
            threads: std::thread::available_parallelism()
                .map(|n| n.get())
                .unwrap_or(0),
            ..Default::default()
        })
        .map(|i| {
            let _ = c;
            i
        });
    })
    .await
}

#[tauri::command]
fn catalog(core: State<'_>) -> Catalog {
    core.catalog.clone()
}

#[tauri::command]
async fn run_audit(core: State<'_>, elevated: Option<bool>) -> Res<AuditReport> {
    blocking(&core, move |c| {
        if elevated == Some(true) {
            return privileged(c, Op::Audit);
        }
        let log = c.log.lock().map_err(|e| e.to_string())?;
        Ok(audit::run(&c.sys, &c.catalog, |t| log.owner(t).is_some()))
    })
    .await
}

/// Current value of each target; `None` where it can't be read on this PC.
#[tauri::command]
async fn read_values(core: State<'_>, targets: Vec<Target>) -> Res<Vec<Option<Value>>> {
    blocking(&core, move |c| {
        Ok(targets.iter().map(|t| c.sys.read(t).ok()).collect())
    })
    .await
}

#[derive(Serialize, Deserialize)]
struct ChangeIn {
    target: Target,
    value: Value,
    tweak: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "op")]
enum Op {
    Apply {
        label: String,
        changes: Vec<ChangeIn>,
        restore_point: bool,
    },
    Revert {
        id: u64,
    },
    RevertAll,
    Audit,
}

fn exec_op(
    sys: &dyn System,
    catalog: &Catalog,
    log: &mut UndoLog,
    op: Op,
) -> Res<serde_json::Value> {
    let e = |e: graze_engine::undo::UndoError| e.to_string();
    let out = match op {
        Op::Apply {
            label,
            changes,
            restore_point,
        } => {
            let plan = changes
                .into_iter()
                .map(|ch| Planned {
                    target: ch.target,
                    value: ch.value,
                    tweak: ch.tweak,
                })
                .collect();
            serde_json::to_value(log.apply(sys, &label, plan, restore_point).map_err(e)?)
        }
        Op::Revert { id } => serde_json::to_value(log.revert(sys, id).map_err(e)?),
        Op::RevertAll => serde_json::to_value(log.revert_all(sys).map_err(e)?),
        Op::Audit => serde_json::to_value(audit::run(sys, catalog, |t| log.owner(t).is_some())),
    };
    out.map_err(|e| e.to_string())
}

/// Writes need admin, but WebView2 can't open an elevated window without explorer.exe (it
/// de-elevates through it), so the UI runs as the user and each batch runs in an elevated copy.
fn privileged<T: serde::de::DeserializeOwned>(core: &Core, op: Op) -> Res<T> {
    let mut log = core.log.lock().map_err(|e| e.to_string())?;
    #[cfg(windows)]
    let out = if graze_engine::windows::is_elevated() {
        let (path, legacy, mut elevated_log) = elevated::open_admin_log(&core.legacy)?;
        let out = exec_op(&core.sys, &core.catalog, &mut elevated_log, op);
        *log = UndoLog::open(&path).map_err(|e| e.to_string())?;
        if out.is_ok() {
            elevated::migrate_legacy(legacy.as_deref())?;
        }
        out
    } else {
        let (path, legacy) = elevated::state_paths(&core.legacy)?;
        let out = elevated::run(legacy.as_deref(), op);
        if path.exists() {
            *log = UndoLog::open(path).map_err(|e| e.to_string())?;
        }
        if out.is_ok() {
            elevated::migrate_legacy(legacy.as_deref())?;
        }
        out
    };
    #[cfg(not(windows))]
    let out = exec_op(&core.sys, &core.catalog, &mut log, op);
    serde_json::from_value(out?).map_err(|e| e.to_string())
}

fn to_hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn from_hex(s: &str) -> Option<Vec<u8>> {
    if !s.len().is_multiple_of(2) {
        return None;
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(s.get(i..i + 2)?, 16).ok())
        .collect()
}

#[cfg(windows)]
mod elevated {
    use super::{to_hex, Op, Res};
    use graze_engine::UndoLog;
    use std::os::windows::process::CommandExt;
    use std::path::{Path, PathBuf};
    use std::process::Command;

    /// Runs `op` in `graze-tune.exe --worker` through a UAC prompt and returns its result.
    /// The request rides on the command line so nothing can swap it while the prompt is open.
    // shortcut: a batch over ~16 KB of JSON exceeds the command-line limit; move to a pipe if that happens.
    pub fn run(legacy: Option<&Path>, op: Op) -> Res<serde_json::Value> {
        let s = |e: std::io::Error| e.to_string();
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |duration| duration.as_nanos() as u64)
            ^ u64::from(std::process::id());
        let req = to_hex(
            &serde_json::to_vec(&(legacy.map(Path::to_path_buf), nonce, op))
                .map_err(|e| e.to_string())?,
        );
        let exe = std::env::current_exe().map_err(s)?;
        let resp = graze_engine::windows::state::state_dir()?.join("worker-response.json");
        // PowerShell single-quoted literal holding a double-quoted path, so spaces survive.
        let q = |p: &Path| format!("'\"{}\"'", p.display().to_string().replace('\'', "''"));
        let script = format!(
            "Start-Process -FilePath {} -ArgumentList '--worker','{req}' -Verb RunAs -Wait",
            q(&exe)
        );
        let out = Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .creation_flags(0x0800_0000)
            .output()
            .map_err(s)?;
        if !out.status.success() {
            return Err("Admin permission was not granted, so nothing was changed.".into());
        }
        let text = std::fs::read(&resp).map_err(|_| "The admin helper exited without a result.")?;
        let (response_nonce, result): (u64, Res<serde_json::Value>) = serde_json::from_slice(&text)
            .map_err(|_| "The admin helper exited without a result.")?;
        if response_nonce != nonce {
            return Err("The admin helper exited without a result.".into());
        }
        result
    }

    pub fn state_paths(legacy_path: &Path) -> Res<(PathBuf, Option<PathBuf>)> {
        let dir = graze_engine::windows::state::state_dir()?;
        let path = dir.join("undo-log.json");
        let secure_log_exists =
            matches!(graze_engine::windows::state::trusted_dir(&dir), Ok(true)) && path.exists();
        let legacy = if secure_log_exists || !legacy_path.exists() {
            None
        } else {
            Some(legacy_path.to_path_buf())
        };
        Ok((path, legacy))
    }

    pub fn open_admin_log(legacy_path: &Path) -> Res<(PathBuf, Option<PathBuf>, UndoLog)> {
        let dir = graze_engine::windows::state::secure_state_dir()?;
        let path = dir.join("undo-log.json");
        let legacy = legacy_to_import(&path, Some(legacy_path));
        let log = open_secure_log(&path, legacy.as_deref())?;
        Ok((path, legacy, log))
    }

    // shortcut: the first elevated run trusts the old per-user log once to carry history over; drop the import after a few releases.
    fn legacy_to_import(path: &Path, legacy: Option<&Path>) -> Option<PathBuf> {
        if path.exists() {
            None
        } else {
            legacy
                .filter(|legacy| legacy.exists())
                .map(Path::to_path_buf)
        }
    }

    pub(super) fn open_secure_log(path: &Path, legacy: Option<&Path>) -> Res<UndoLog> {
        let legacy = legacy_to_import(path, legacy);
        UndoLog::open_or_import(path, legacy.as_deref()).map_err(|e| e.to_string())
    }

    pub fn migrate_legacy(legacy: Option<&Path>) -> Res<()> {
        if let Some(legacy) = legacy {
            let migrated = legacy.with_file_name("undo-log.json.migrated");
            match std::fs::rename(legacy, migrated) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(e.to_string()),
            }
        }
        Ok(())
    }
}

/// Entry point for `graze-tune.exe --worker <hex request>`; returns the exit code.
#[cfg(windows)]
pub fn worker(args: &[String]) -> i32 {
    use std::io::Write;
    let [req] = args else {
        return 2;
    };
    let (legacy, nonce, op): (Option<PathBuf>, u64, Op) = match (|| {
        let text = from_hex(req).ok_or_else(|| "malformed worker request".to_string())?;
        serde_json::from_slice(&text).map_err(|e| e.to_string())
    })() {
        Ok(request) => request,
        Err(_) => return 2,
    };
    let dir = match graze_engine::windows::state::secure_state_dir() {
        Ok(dir) => dir,
        Err(_) => return 2,
    };
    let path = dir.join("undo-log.json");
    let result = (|| -> Res<serde_json::Value> {
        let mut log = elevated::open_secure_log(&path, legacy.as_deref())?;
        let catalog = Catalog::builtin().map_err(|e| e.to_string())?;
        exec_op(&Platform::default(), &catalog, &mut log, op)
    })();
    let response = dir.join("worker-response.json");
    let _ = std::fs::remove_file(&response);
    let written = serde_json::to_vec(&(nonce, result))
        .map_err(std::io::Error::other)
        .and_then(|b| {
            std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(response)?
                .write_all(&b)
        });
    i32::from(written.is_err())
}

#[cfg(not(windows))]
pub fn worker(args: &[String]) -> i32 {
    use std::io::Write;
    let [req, response] = args else {
        return 2;
    };
    let result = (|| -> Res<serde_json::Value> {
        let text = from_hex(req).ok_or("malformed worker request")?;
        let (path, op): (PathBuf, Op) = serde_json::from_slice(&text).map_err(|e| e.to_string())?;
        let mut log = UndoLog::open(path).map_err(|e| e.to_string())?;
        let catalog = Catalog::builtin().map_err(|e| e.to_string())?;
        exec_op(&Platform::default(), &catalog, &mut log, op)
    })();
    let _ = std::fs::remove_file(response);
    let written = serde_json::to_vec(&result)
        .map_err(std::io::Error::other)
        .and_then(|bytes| {
            std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(response)?
                .write_all(&bytes)
        });
    i32::from(written.is_err())
}

#[cfg(test)]
mod tests {
    use super::{from_hex, to_hex, Op};
    use std::path::PathBuf;

    #[test]
    fn hex_roundtrip() {
        let b = br#"{"op":"RevertAll"}"#.to_vec();
        assert_eq!(from_hex(&to_hex(&b)), Some(b));
        assert_eq!(from_hex("abc"), None);
        assert_eq!(from_hex("zz"), None);
    }

    #[test]
    fn worker_request_roundtrip() -> Result<(), Box<dyn std::error::Error>> {
        let legacy = PathBuf::from(r"C:\Users\test\AppData\undo-log.json");
        let request = (Some(legacy.clone()), 42, Op::RevertAll);
        let bytes = serde_json::to_vec(&request)?;
        let decoded = from_hex(&to_hex(&bytes)).ok_or("invalid hex")?;
        let (decoded_legacy, nonce, op): (Option<PathBuf>, u64, Op) =
            serde_json::from_slice(&decoded)?;

        assert_eq!(decoded_legacy, Some(legacy));
        assert_eq!(nonce, 42);
        assert!(matches!(op, Op::RevertAll));
        Ok(())
    }
}

#[tauri::command]
async fn apply(
    core: State<'_>,
    label: String,
    changes: Vec<ChangeIn>,
    restore_point: bool,
) -> Res<Batch> {
    blocking(&core, move |c| {
        privileged(
            c,
            Op::Apply {
                label,
                changes,
                restore_point,
            },
        )
    })
    .await
}

#[tauri::command]
async fn history(core: State<'_>) -> Res<Vec<Batch>> {
    blocking(&core, |c| with_log(c, |log| Ok(log.batches.clone()))).await
}

#[tauri::command]
async fn revert(core: State<'_>, id: u64) -> Res<Vec<String>> {
    blocking(&core, move |c| privileged(c, Op::Revert { id })).await
}

#[tauri::command]
async fn revert_all(core: State<'_>) -> Res<Vec<String>> {
    blocking(&core, |c| privileged(c, Op::RevertAll)).await
}

#[cfg(windows)]
mod nv {
    pub use graze_engine::windows::nvapi::{DriverSetting, ProfileInfo, Session};
}
#[cfg(not(windows))]
mod nv {
    pub type DriverSetting = serde_json::Value;
    pub type ProfileInfo = serde_json::Value;
    type Res<T> = Result<T, String>;
    pub struct Session;
    impl Session {
        pub fn profiles(&self) -> Res<Vec<ProfileInfo>> {
            Ok(vec![])
        }
        pub fn settings(&self, _: Option<&str>) -> Res<Vec<DriverSetting>> {
            Ok(vec![])
        }
        pub fn apps(&self, _: &str) -> Res<Vec<String>> {
            Ok(vec![])
        }
        pub fn add_app(&self, _: &str, _: &str) -> Res<()> {
            Ok(())
        }
    }
}

fn nvidia<T>(c: &Core, f: impl FnOnce(&nv::Session) -> Res<T>) -> Res<T> {
    #[cfg(windows)]
    return c.sys.with_nvidia(f);
    #[cfg(not(windows))]
    {
        let _ = (c, f);
        Err("NVIDIA profiles are only available on Windows".into())
    }
}

#[tauri::command]
async fn nv_profiles(core: State<'_>) -> Res<Vec<nv::ProfileInfo>> {
    blocking(&core, |c| nvidia(c, |s| s.profiles())).await
}

#[tauri::command]
async fn nv_settings(core: State<'_>, profile: Option<String>) -> Res<Vec<nv::DriverSetting>> {
    blocking(&core, move |c| {
        nvidia(c, |s| s.settings(profile.as_deref()))
    })
    .await
}

#[tauri::command]
async fn nv_apps(core: State<'_>, profile: String) -> Res<Vec<String>> {
    blocking(&core, move |c| nvidia(c, |s| s.apps(&profile))).await
}

#[tauri::command]
async fn nv_add_app(core: State<'_>, profile: String, exe: String) -> Res<()> {
    blocking(&core, move |c| nvidia(c, |s| s.add_app(&profile, &exe))).await
}

#[derive(Serialize)]
struct PlannedOut {
    target: Target,
    value: Value,
}

#[derive(Serialize)]
struct NipPlan {
    changes: Vec<PlannedOut>,
    apps: Vec<(String, Vec<String>)>,
}

/// Parses a .nip file into the changes it would make. Nothing is written until `apply`.
#[tauri::command]
async fn nip_read(core: State<'_>, path: String) -> Res<NipPlan> {
    blocking(&core, move |_| {
        let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
        let nip = Nip::parse(&bytes).map_err(|e| e.to_string())?;
        Ok(NipPlan {
            changes: nip
                .plan()
                .map_err(|e| e.to_string())?
                .into_iter()
                .map(|(target, value)| PlannedOut { target, value })
                .collect(),
            apps: nip.apps(),
        })
    })
    .await
}

/// Writes the user-set settings of `profiles` (None = base profile) to a .nip file.
#[tauri::command]
async fn nip_write(core: State<'_>, path: String, profiles: Vec<Option<String>>) -> Res<usize> {
    blocking(&core, move |c| {
        let nip = nvidia(c, |s| {
            let mut out = Nip::default();
            for p in &profiles {
                let settings = s.settings(p.as_deref())?;
                #[cfg(windows)]
                let items: Vec<NipSetting> = settings
                    .iter()
                    .filter(|d| d.user_set)
                    .filter_map(|d| NipSetting::from_value(d.id, &d.name, &d.value))
                    .collect();
                #[cfg(not(windows))]
                let items: Vec<NipSetting> = {
                    let _ = settings;
                    vec![]
                };
                let executables = match p {
                    Some(name) => s.apps(name)?,
                    None => vec![],
                };
                out.profiles.push(NipProfile {
                    name: p.clone().unwrap_or_else(|| BASE_PROFILE.into()),
                    executables: Strings { items: executables },
                    settings: graze_engine::nip::Settings { items },
                });
            }
            Ok(out)
        })?;
        let count = nip.profiles.iter().map(|p| p.settings.items.len()).sum();
        std::fs::write(&path, nip.to_bytes().map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        Ok(count)
    })
    .await
}

/// TCP connect round-trips: works without admin rights and through ICMP-blocking routers.
#[tauri::command]
async fn bench_ping(host: String, port: u16, count: u32) -> Res<PingStats> {
    tauri::async_runtime::spawn_blocking(move || {
        use std::net::{TcpStream, ToSocketAddrs};
        let addr = (host.as_str(), port)
            .to_socket_addrs()
            .map_err(|e| e.to_string())?
            .next()
            .ok_or("host did not resolve")?;
        let rtts: Vec<Option<f64>> = (0..count.clamp(1, 500))
            .map(|_| {
                let t = Instant::now();
                let r = TcpStream::connect_timeout(&addr, Duration::from_secs(2))
                    .ok()
                    .map(|_| t.elapsed().as_secs_f64() * 1000.0);
                std::thread::sleep(Duration::from_millis(100));
                r
            })
            .collect();
        Ok(stats::ping_stats(&rtts))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
struct FrameRun {
    stats: FrameStats,
    frametimes: Vec<f64>,
}

/// Captures `seconds` of frametimes for `process` with the bundled PresentMon.
#[tauri::command]
async fn bench_frames(app: tauri::AppHandle, process: String, seconds: u32) -> Res<FrameRun> {
    let exe = app
        .path()
        .resource_dir()
        .map(|d| d.join("PresentMon.exe"))
        .ok()
        .filter(|p| p.exists())
        .ok_or("PresentMon.exe is not bundled; add it to resources/")?;
    let csv = std::env::temp_dir().join("graze-tune-presentmon.csv");
    let secs = seconds.clamp(5, 600).to_string();
    let _ = std::fs::remove_file(&csv);
    let out = tauri::async_runtime::spawn_blocking({
        let csv = csv.clone();
        move || {
            std::process::Command::new(exe)
                .args(["--process_name", &process, "--output_file"])
                .arg(&csv)
                .args([
                    "--timed",
                    &secs,
                    "--terminate_after_timed",
                    "--stop_existing_session",
                ])
                .output()
        }
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(format!(
            "PresentMon failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    let text = std::fs::read_to_string(&csv).map_err(|_| {
        format!(
            "PresentMon produced no data: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        )
    })?;
    let frametimes = stats::parse_presentmon_csv(&text);
    Ok(FrameRun {
        stats: stats::frame_stats(&frametimes),
        frametimes,
    })
}

#[derive(Serialize)]
struct Timer {
    min_ms: f64,
    max_ms: f64,
    current_ms: f64,
}

#[tauri::command]
fn timer_resolution(request_max: Option<bool>) -> Option<Timer> {
    #[cfg(windows)]
    {
        use graze_engine::windows::timer;
        if let Some(on) = request_max {
            timer::request_max(on);
        }
        timer::query().map(|t| Timer {
            min_ms: t.min_ms,
            max_ms: t.max_ms,
            current_ms: t.current_ms,
        })
    }
    #[cfg(not(windows))]
    {
        let _ = request_max;
        None
    }
}

pub fn run() {
    let result = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            #[cfg(windows)]
            let (path, legacy) = {
                let legacy = app.path().app_data_dir()?.join("undo-log.json");
                let secure = graze_engine::windows::state::state_dir()
                    .map_err(std::io::Error::other)?
                    .join("undo-log.json");
                let path = if secure.exists() {
                    secure
                } else {
                    legacy.clone()
                };
                (path, legacy)
            };
            #[cfg(not(windows))]
            let path = app.path().app_data_dir()?.join("undo-log.json");
            let log = UndoLog::open(path)?;
            let catalog = Catalog::builtin()?;
            app.manage(Arc::new(Core {
                sys: Platform::default(),
                log: Mutex::new(log),
                #[cfg(windows)]
                legacy,
                catalog,
            }));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            system_info,
            catalog,
            run_audit,
            read_values,
            apply,
            history,
            revert,
            revert_all,
            nv_profiles,
            nv_settings,
            nv_apps,
            nv_add_app,
            nip_read,
            nip_write,
            bench_ping,
            bench_frames,
            timer_resolution
        ])
        .run(tauri::generate_context!());
    if let Err(e) = result {
        eprintln!("graze-tune failed to start: {e}");
        std::process::exit(1);
    }
}
