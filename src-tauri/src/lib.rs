use graze_engine::audit::{self, AuditReport};
use graze_engine::nip::{Nip, NipProfile, NipSetting, Strings, BASE_PROFILE};
use graze_engine::stats::{self, FrameStats, PingStats};
use graze_engine::system::SystemInfo;
use graze_engine::{Batch, Catalog, Planned, System, Target, UndoLog, Value};
use serde::{Deserialize, Serialize};
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
async fn run_audit(core: State<'_>) -> Res<AuditReport> {
    blocking(&core, |c| {
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

#[derive(Deserialize)]
struct ChangeIn {
    target: Target,
    value: Value,
    tweak: Option<String>,
}

#[tauri::command]
async fn apply(
    core: State<'_>,
    label: String,
    changes: Vec<ChangeIn>,
    restore_point: bool,
) -> Res<Batch> {
    blocking(&core, move |c| {
        let plan = changes
            .into_iter()
            .map(|ch| Planned {
                target: ch.target,
                value: ch.value,
                tweak: ch.tweak,
            })
            .collect();
        with_log(c, |log| log.apply(&c.sys, &label, plan, restore_point))
    })
    .await
}

#[tauri::command]
async fn history(core: State<'_>) -> Res<Vec<Batch>> {
    blocking(&core, |c| with_log(c, |log| Ok(log.batches.clone()))).await
}

#[tauri::command]
async fn revert(core: State<'_>, id: u64) -> Res<Vec<String>> {
    blocking(&core, move |c| with_log(c, |log| log.revert(&c.sys, id))).await
}

#[tauri::command]
async fn revert_all(core: State<'_>) -> Res<Vec<String>> {
    blocking(&core, |c| with_log(c, |log| log.revert_all(&c.sys))).await
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
            let dir = app.path().app_data_dir()?;
            let log = UndoLog::open(dir.join("undo-log.json"))?;
            let catalog = Catalog::builtin()?;
            app.manage(Arc::new(Core {
                sys: Platform::default(),
                log: Mutex::new(log),
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
