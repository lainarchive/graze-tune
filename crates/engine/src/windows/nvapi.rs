//! NVIDIA driver settings (DRS) through nvapi64.dll, loaded at runtime so the app still starts
//! on PCs without an NVIDIA driver.
use crate::Value;
use serde::Serialize;
use std::ffi::c_void;
use std::mem::size_of;
use windows::core::{s, w};
use windows::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};

type H = *mut c_void;
const STR: usize = 2048;
const OK: i32 = 0;
const END_ENUMERATION: i32 = -7;
const SETTING_NOT_FOUND: i32 = -160;
const PROFILE_NOT_FOUND: i32 = -163;
const EXECUTABLE_NOT_FOUND: i32 = -166;

#[repr(C)]
#[derive(Clone, Copy)]
struct Raw([u8; 4100]);

#[repr(C)]
#[derive(Clone, Copy)]
struct Setting {
    version: u32,
    name: [u16; STR],
    id: u32,
    kind: u32,
    location: u32,
    is_current_predefined: u32,
    is_predefined_valid: u32,
    predefined: Raw,
    current: Raw,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct Profile {
    version: u32,
    name: [u16; STR],
    gpu_support: u32,
    is_predefined: u32,
    num_apps: u32,
    num_settings: u32,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct App {
    version: u32,
    is_predefined: u32,
    name: [u16; STR],
    friendly: [u16; STR],
    launcher: [u16; STR],
    file_in_folder: [u16; STR],
    bits: u32,
}

const _: () = assert!(size_of::<Setting>() == 12320);
// sizeof(NVDRS_SETTING_V1) in nvapi.h; a wrong size makes DRS_GetSetting return -9.
const _: () = assert!(size_of::<Profile>() == 4116 && size_of::<App>() == 16396);
const SETTING_V1: u32 = size_of::<Setting>() as u32 | (1 << 16);
const PROFILE_V1: u32 = size_of::<Profile>() as u32 | (1 << 16);
const APP_V3: u32 = size_of::<App>() as u32 | (3 << 16);

fn zeroed<T: Copy>() -> Box<T> {
    // SAFETY: only used for the plain-old-data NVAPI structs above, for which all-zero is valid.
    Box::new(unsafe { std::mem::zeroed() })
}

fn wide(s: &str) -> [u16; STR] {
    let mut out = [0u16; STR];
    for (o, c) in out.iter_mut().zip(s.encode_utf16().take(STR - 1)) {
        *o = c;
    }
    out
}

fn from_wide(w: &[u16]) -> String {
    let end = w.iter().position(|&c| c == 0).unwrap_or(w.len());
    String::from_utf16_lossy(&w[..end])
}

fn raw_to_value(kind: u32, raw: &Raw) -> Value {
    let b = &raw.0;
    let u32_at = |i: usize| u32::from_le_bytes([b[i], b[i + 1], b[i + 2], b[i + 3]]);
    match kind {
        0 => Value::Dword(u32_at(0)),
        1 => Value::Binary(b[4..4 + (u32_at(0) as usize).min(4096)].to_vec()),
        2 | 3 => Value::String(from_wide(
            &b.as_chunks::<2>()
                .0
                .iter()
                .map(|c| u16::from_le_bytes([c[0], c[1]]))
                .collect::<Vec<_>>(),
        )),
        4 => Value::Qword(u64::from_le_bytes([
            b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7],
        ])),
        _ => Value::Missing,
    }
}

fn value_to_raw(v: &Value) -> Option<(u32, Raw)> {
    let mut r = Raw([0; 4100]);
    let kind = match v {
        Value::Dword(n) => {
            r.0[..4].copy_from_slice(&n.to_le_bytes());
            0
        }
        Value::Binary(bytes) => {
            let n = bytes.len().min(4096);
            r.0[..4].copy_from_slice(&(n as u32).to_le_bytes());
            r.0[4..4 + n].copy_from_slice(&bytes[..n]);
            1
        }
        Value::String(s) => {
            for (i, c) in s.encode_utf16().take(STR - 1).enumerate() {
                r.0[i * 2..i * 2 + 2].copy_from_slice(&c.to_le_bytes());
            }
            3
        }
        Value::Qword(n) => {
            r.0[..8].copy_from_slice(&n.to_le_bytes());
            4
        }
        _ => return None,
    };
    Some((kind, r))
}

macro_rules! fns {
    ($($name:ident = $id:literal $(| $fallback:literal)? : fn($($arg:ty),*);)*) => {
        struct Fns { $($name: unsafe extern "C" fn($($arg),*) -> i32,)* }
        impl Fns {
            fn load(qi: unsafe extern "C" fn(u32) -> *mut c_void) -> Result<Self, String> {
                Ok(Self { $($name: {
                    // SAFETY: nvapi_QueryInterface returns the function for this ID.
                    let p = unsafe { qi($id) };
                    $(let p = if p.is_null() { unsafe { qi($fallback) } } else { p };)?
                    if p.is_null() { return Err(format!("nvapi is missing {}", stringify!($name))); }
                    // SAFETY: documented Set/Get fallbacks ignore extra trailing args on x64, as Profile Inspector relies on.
                    unsafe { std::mem::transmute::<*mut c_void, unsafe extern "C" fn($($arg),*) -> i32>(p) }
                },)* })
            }
        }
    };
}

fns! {
    initialize = 0x0150e828: fn();
    create_session = 0x0694d52e: fn(*mut H);
    destroy_session = 0xdad9cff8: fn(H);
    load_settings = 0x375dbd6b: fn(H);
    save_settings = 0xfcbc7e14: fn(H);
    create_profile = 0xcc176068: fn(H, *mut Profile, *mut H);
    get_profile_info = 0x61cd6fd6: fn(H, H, *mut Profile);
    find_profile_by_name = 0x7e4a9a0b: fn(H, *const u16, *mut H);
    enum_profiles = 0xbc371ee0: fn(H, u32, *mut H);
    create_application = 0x4347a9de: fn(H, H, *mut App);
    enum_applications = 0x7fa2173a: fn(H, H, u32, *mut u32, *mut App);
    find_application_by_name = 0xeee566b2: fn(H, *const u16, *mut H, *mut App);
    set_setting = 0x8a2cf5f5 | 0x577dd202: fn(H, H, *mut Setting, u32, u32);
    get_setting = 0xea99498d | 0x73bf8338: fn(H, H, u32, *mut Setting, *mut u32);
    enum_settings = 0xcfd6983e | 0xae3039da: fn(H, H, u32, *mut u32, *mut Setting);
    delete_profile_setting = 0xe4a26362: fn(H, H, u32);
    get_base_profile = 0xda8466a0: fn(H, *mut H);
}

#[derive(Debug, Clone, Serialize)]
pub struct ProfileInfo {
    pub name: String,
    pub predefined: bool,
    pub apps: u32,
    pub settings: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct DriverSetting {
    pub id: u32,
    pub name: String,
    pub value: Value,
    pub predefined: Option<Value>,
    /// Set by the user on this profile (not inherited or a driver default).
    pub user_set: bool,
}

pub struct Nvapi {
    f: Fns,
}

fn check(status: i32, what: &str) -> Result<(), String> {
    if status == OK {
        Ok(())
    } else {
        Err(format!("{what} failed (NVAPI status {status})"))
    }
}

impl Nvapi {
    pub fn load() -> Result<Self, String> {
        // SAFETY: plain library load and symbol lookup.
        let qi = unsafe {
            let lib = LoadLibraryW(w!("nvapi64.dll"))
                .map_err(|_| "no NVIDIA driver (nvapi64.dll not found)".to_string())?;
            GetProcAddress(lib, s!("nvapi_QueryInterface"))
                .ok_or("nvapi_QueryInterface not found")?
        };
        // SAFETY: nvapi_QueryInterface has this signature.
        let qi = unsafe {
            std::mem::transmute::<
                unsafe extern "system" fn() -> isize,
                unsafe extern "C" fn(u32) -> *mut c_void,
            >(qi)
        };
        let f = Fns::load(qi)?;
        // SAFETY: no arguments.
        check(unsafe { (f.initialize)() }, "NvAPI_Initialize")?;
        Ok(Self { f })
    }

    pub fn session(&self) -> Result<Session<'_>, String> {
        let mut h: H = std::ptr::null_mut();
        // SAFETY: out-pointer to a local.
        check(
            unsafe { (self.f.create_session)(&mut h) },
            "DRS_CreateSession",
        )?;
        let s = Session { f: &self.f, h };
        // SAFETY: valid session handle.
        check(unsafe { (self.f.load_settings)(h) }, "DRS_LoadSettings")?;
        Ok(s)
    }
}

pub struct Session<'a> {
    f: &'a Fns,
    h: H,
}

impl Drop for Session<'_> {
    fn drop(&mut self) {
        // SAFETY: handle came from create_session and is destroyed once.
        unsafe { (self.f.destroy_session)(self.h) };
    }
}

impl Session<'_> {
    fn profile(&self, name: Option<&str>, create: bool) -> Result<Option<H>, String> {
        let mut hp: H = std::ptr::null_mut();
        // SAFETY: valid session, out-pointer to a local, name buffer lives across the call.
        let status = unsafe {
            match name {
                None => (self.f.get_base_profile)(self.h, &mut hp),
                Some(n) => (self.f.find_profile_by_name)(self.h, wide(n).as_ptr(), &mut hp),
            }
        };
        match (status, name) {
            (OK, _) => Ok(Some(hp)),
            (PROFILE_NOT_FOUND, Some(n)) if create => {
                let mut p = zeroed::<Profile>();
                p.version = PROFILE_V1;
                p.name = wide(n);
                // SAFETY: valid session, struct initialised with its version.
                check(
                    unsafe { (self.f.create_profile)(self.h, &mut *p, &mut hp) },
                    "DRS_CreateProfile",
                )?;
                Ok(Some(hp))
            }
            (PROFILE_NOT_FOUND, _) => Ok(None),
            (s, _) => check(s, "find profile").map(|_| None),
        }
    }

    /// The user-set value on `profile`, or Missing when it is inherited or the driver default.
    pub fn get(&self, profile: Option<&str>, id: u32) -> Result<Value, String> {
        let Some(hp) = self.profile(profile, false)? else {
            return Ok(Value::Missing);
        };
        let mut s = zeroed::<Setting>();
        s.version = SETTING_V1;
        let mut x = 0u32;
        // SAFETY: valid handles, struct initialised with its version.
        match unsafe { (self.f.get_setting)(self.h, hp, id, &mut *s, &mut x) } {
            OK if s.location == 0 && s.is_current_predefined == 0 => {
                Ok(raw_to_value(s.kind, &s.current))
            }
            OK | SETTING_NOT_FOUND => Ok(Value::Missing),
            st => check(st, "DRS_GetSetting").map(|_| Value::Missing),
        }
    }

    pub fn set(&self, profile: Option<&str>, id: u32, value: &Value) -> Result<(), String> {
        let hp = self.profile(profile, !matches!(value, Value::Missing))?;
        match (hp, value_to_raw(value)) {
            (None, _) => Ok(()),
            (Some(hp), None) => {
                // SAFETY: valid handles.
                match unsafe { (self.f.delete_profile_setting)(self.h, hp, id) } {
                    OK | SETTING_NOT_FOUND => Ok(()),
                    st => check(st, "DRS_DeleteProfileSetting"),
                }
            }
            (Some(hp), Some((kind, raw))) => {
                let mut s = zeroed::<Setting>();
                s.version = SETTING_V1;
                s.id = id;
                s.kind = kind;
                s.current = raw;
                // SAFETY: valid handles, struct initialised with its version.
                check(
                    unsafe { (self.f.set_setting)(self.h, hp, &mut *s, 0, 0) },
                    "DRS_SetSetting",
                )
            }
        }?;
        // SAFETY: valid session.
        check(
            unsafe { (self.f.save_settings)(self.h) },
            "DRS_SaveSettings",
        )
    }

    pub fn profiles(&self) -> Result<Vec<ProfileInfo>, String> {
        let mut out = vec![];
        for i in 0.. {
            let mut hp: H = std::ptr::null_mut();
            // SAFETY: valid session, out-pointer to a local.
            match unsafe { (self.f.enum_profiles)(self.h, i, &mut hp) } {
                OK => {}
                END_ENUMERATION => break,
                st => return check(st, "DRS_EnumProfiles").map(|_| out),
            }
            let mut p = zeroed::<Profile>();
            p.version = PROFILE_V1;
            // SAFETY: valid handles, struct initialised with its version.
            if unsafe { (self.f.get_profile_info)(self.h, hp, &mut *p) } == OK {
                out.push(ProfileInfo {
                    name: from_wide(&p.name),
                    predefined: p.is_predefined != 0,
                    apps: p.num_apps,
                    settings: p.num_settings,
                });
            }
        }
        Ok(out)
    }

    pub fn settings(&self, profile: Option<&str>) -> Result<Vec<DriverSetting>, String> {
        let Some(hp) = self.profile(profile, false)? else {
            return Ok(vec![]);
        };
        let mut out = vec![];
        loop {
            let mut buf = vec![*zeroed::<Setting>(); 32];
            for s in buf.iter_mut() {
                s.version = SETTING_V1;
            }
            let mut count = buf.len() as u32;
            // SAFETY: buffer holds `count` initialised structs.
            match unsafe {
                (self.f.enum_settings)(self.h, hp, out.len() as u32, &mut count, buf.as_mut_ptr())
            } {
                OK => {}
                END_ENUMERATION => break,
                st => return check(st, "DRS_EnumSettings").map(|_| out),
            }
            for s in &buf[..count as usize] {
                out.push(DriverSetting {
                    id: s.id,
                    name: from_wide(&s.name),
                    value: raw_to_value(s.kind, &s.current),
                    predefined: (s.is_predefined_valid != 0)
                        .then(|| raw_to_value(s.kind, &s.predefined)),
                    user_set: s.location == 0 && s.is_current_predefined == 0,
                });
            }
            if (count as usize) < buf.len() {
                break;
            }
        }
        Ok(out)
    }

    pub fn apps(&self, profile: &str) -> Result<Vec<String>, String> {
        let Some(hp) = self.profile(Some(profile), false)? else {
            return Ok(vec![]);
        };
        let mut out = vec![];
        loop {
            let mut buf = vec![*zeroed::<App>(); 16];
            for a in buf.iter_mut() {
                a.version = APP_V3;
            }
            let mut count = buf.len() as u32;
            // SAFETY: buffer holds `count` initialised structs.
            match unsafe {
                (self.f.enum_applications)(
                    self.h,
                    hp,
                    out.len() as u32,
                    &mut count,
                    buf.as_mut_ptr(),
                )
            } {
                OK => {}
                END_ENUMERATION => break,
                st => return check(st, "DRS_EnumApplications").map(|_| out),
            }
            out.extend(buf[..count as usize].iter().map(|a| from_wide(&a.name)));
            if (count as usize) < buf.len() {
                break;
            }
        }
        Ok(out)
    }

    pub fn app_profile(&self, exe: &str) -> Result<Option<String>, String> {
        let mut hp: H = std::ptr::null_mut();
        let mut app = zeroed::<App>();
        app.version = APP_V3;
        // SAFETY: valid session; name buffer and output structs live across the call.
        let status = unsafe {
            (self.f.find_application_by_name)(self.h, wide(exe).as_ptr(), &mut hp, &mut *app)
        };
        if status == EXECUTABLE_NOT_FOUND {
            return Ok(None);
        }
        check(status, "DRS_FindApplicationByName")?;
        let mut p = zeroed::<Profile>();
        p.version = PROFILE_V1;
        // SAFETY: valid handles, struct initialised with its version.
        check(
            unsafe { (self.f.get_profile_info)(self.h, hp, &mut *p) },
            "DRS_GetProfileInfo",
        )?;
        Ok(Some(from_wide(&p.name)))
    }

    /// Creates `profile` if needed and attaches `exe` to it.
    pub fn add_app(&self, profile: &str, exe: &str) -> Result<(), String> {
        let hp = self
            .profile(Some(profile), true)?
            .ok_or("profile could not be created")?;
        if self
            .apps(profile)?
            .iter()
            .any(|a| a.eq_ignore_ascii_case(exe))
        {
            return Ok(());
        }
        let mut a = zeroed::<App>();
        a.version = APP_V3;
        a.name = wide(exe);
        // SAFETY: valid handles, struct initialised with its version.
        check(
            unsafe { (self.f.create_application)(self.h, hp, &mut *a) },
            "DRS_CreateApplication",
        )?;
        // SAFETY: valid session.
        check(
            unsafe { (self.f.save_settings)(self.h) },
            "DRS_SaveSettings",
        )
    }
}
