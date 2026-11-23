use std::ffi::OsString;
use std::fs;
use std::os::windows::ffi::{OsStrExt, OsStringExt};
use std::os::windows::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use windows::core::{BOOL, PCWSTR};
use windows::Win32::Foundation::{LocalFree, HLOCAL};
use windows::Win32::Security::Authorization::{
    ConvertStringSecurityDescriptorToSecurityDescriptorW, GetNamedSecurityInfoW, SDDL_REVISION_1,
    SE_FILE_OBJECT,
};
use windows::Win32::Security::{
    IsWellKnownSid, WinBuiltinAdministratorsSid, WinLocalSystemSid, OWNER_SECURITY_INFORMATION,
    PSECURITY_DESCRIPTOR, PSID, SECURITY_ATTRIBUTES,
};
use windows::Win32::Storage::FileSystem::{CreateDirectoryW, FILE_ATTRIBUTE_REPARSE_POINT};
use windows::Win32::System::Com::CoTaskMemFree;
use windows::Win32::UI::Shell::{FOLDERID_ProgramData, SHGetKnownFolderPath, KNOWN_FOLDER_FLAG};

pub fn state_dir() -> Result<PathBuf, String> {
    let path = unsafe {
        SHGetKnownFolderPath(&FOLDERID_ProgramData, KNOWN_FOLDER_FLAG(0), None)
            .map_err(|e| format!("SHGetKnownFolderPath: {e}"))?
    };
    // SAFETY: SHGetKnownFolderPath returns a live, null-terminated UTF-16 allocation.
    let path_len = unsafe {
        let mut len = 0;
        while *path.0.add(len) != 0 {
            len += 1;
        }
        len
    };
    // SAFETY: the preceding scan found the terminator in the returned allocation.
    let program_data = unsafe { OsString::from_wide(std::slice::from_raw_parts(path.0, path_len)) };
    // SAFETY: the shell allocated this buffer with the task allocator.
    unsafe { CoTaskMemFree(Some(path.0.cast())) };
    Ok(PathBuf::from(program_data).join("Graze Tune"))
}

pub fn trusted_dir(path: &Path) -> Result<bool, String> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(e) => return Err(e.to_string()),
    };
    if !metadata.is_dir() || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT.0 != 0 {
        return Ok(false);
    }

    let name: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let mut owner = PSID::default();
    let mut descriptor = PSECURITY_DESCRIPTOR::default();
    // SAFETY: name is terminated; output pointers remain valid through the call.
    let status = unsafe {
        GetNamedSecurityInfoW(
            PCWSTR(name.as_ptr()),
            SE_FILE_OBJECT,
            OWNER_SECURITY_INFORMATION,
            Some(&mut owner),
            None,
            None,
            None,
            &mut descriptor,
        )
    };
    if status.0 != 0 {
        // SAFETY: GetNamedSecurityInfoW allocates the descriptor with LocalAlloc.
        unsafe { LocalFree(Some(HLOCAL(descriptor.0))) };
        return Err(format!(
            "GetNamedSecurityInfoW failed with status {}",
            status.0
        ));
    }
    let trusted = !owner.is_invalid()
        && unsafe {
            IsWellKnownSid(owner, WinBuiltinAdministratorsSid).as_bool()
                || IsWellKnownSid(owner, WinLocalSystemSid).as_bool()
        };
    // SAFETY: GetNamedSecurityInfoW allocated the descriptor with LocalAlloc.
    unsafe { LocalFree(Some(HLOCAL(descriptor.0))) };
    Ok(trusted)
}

pub fn secure_state_dir() -> Result<PathBuf, String> {
    let path = state_dir()?;
    match fs::symlink_metadata(&path) {
        Ok(_) if matches!(trusted_dir(&path), Ok(true)) => return Ok(path),
        Ok(_) => {
            let seconds = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_or(0, |duration| duration.as_secs());
            let untrusted = path.with_file_name(format!("Graze Tune.untrusted-{seconds}"));
            fs::rename(&path, untrusted).map_err(|e| format!("quarantine state directory: {e}"))?;
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e.to_string()),
    }
    create_state_dir(&path)?;
    Ok(path)
}

fn create_state_dir(path: &Path) -> Result<(), String> {
    let mut descriptor = PSECURITY_DESCRIPTOR::default();
    // SAFETY: SDDL is a static, null-terminated security descriptor string.
    unsafe {
        ConvertStringSecurityDescriptorToSecurityDescriptorW(
            windows::core::w!("O:BAD:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;FRFX;;;BU)"),
            SDDL_REVISION_1,
            &mut descriptor,
            None,
        )
    }
    .map_err(|e| format!("convert state directory ACL: {e}"))?;

    let attributes = SECURITY_ATTRIBUTES {
        nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: descriptor.0,
        bInheritHandle: BOOL(0),
    };
    let wide_path: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    // SAFETY: path and security attributes remain live through the call.
    let result = unsafe { CreateDirectoryW(PCWSTR(wide_path.as_ptr()), Some(&attributes)) };
    // SAFETY: the descriptor was allocated by ConvertStringSecurityDescriptorToSecurityDescriptorW.
    unsafe { LocalFree(Some(HLOCAL(descriptor.0))) };
    result.map_err(|e| format!("create state directory: {e}"))
}

#[cfg(test)]
mod tests {
    use super::trusted_dir;
    use std::error::Error;
    use std::fs;
    use std::process::Command;

    #[test]
    fn rejects_junction_state_dir() -> Result<(), Box<dyn Error>> {
        let root = std::env::temp_dir().join(format!("graze-state-{}", std::process::id()));
        let target = root.join("target");
        let junction = root.join("junction");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&target)?;
        let output = Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&junction)
            .arg(&target)
            .output()?;
        if !output.status.success() {
            return Err(
                format!("mklink failed: {}", String::from_utf8_lossy(&output.stderr)).into(),
            );
        }

        let result = trusted_dir(&junction);
        fs::remove_dir(&junction)?;
        fs::remove_dir_all(&root)?;
        assert!(matches!(result, Ok(false) | Err(_)));
        Ok(())
    }
}
