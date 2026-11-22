//! NVIDIA Profile Inspector `.nip` files: XML, usually UTF-16 with a BOM.
use crate::{Target, Value};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename = "ArrayOfProfile")]
pub struct Nip {
    #[serde(rename = "Profile", default)]
    pub profiles: Vec<NipProfile>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct NipProfile {
    #[serde(rename = "ProfileName")]
    pub name: String,
    #[serde(rename = "Executeables", default)]
    pub executables: Strings,
    #[serde(rename = "Settings", default)]
    pub settings: Settings,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Strings {
    #[serde(rename = "string", default)]
    pub items: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Settings {
    #[serde(rename = "ProfileSetting", default)]
    pub items: Vec<NipSetting>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct NipSetting {
    #[serde(rename = "SettingNameInfo", default)]
    pub name: String,
    #[serde(rename = "SettingID")]
    pub id: u32,
    #[serde(rename = "SettingValue", default)]
    pub value: String,
    #[serde(rename = "ValueType", default)]
    pub value_type: String,
}

#[derive(Debug, thiserror::Error)]
pub enum NipError {
    #[error("not valid UTF-16 or UTF-8 text")]
    Encoding,
    #[error("bad .nip XML: {0}")]
    Xml(String),
    #[error("setting 0x{id:08X} has an unreadable {kind} value: {value}")]
    Value {
        id: u32,
        kind: String,
        value: String,
    },
}

pub const BASE_PROFILE: &str = "Base Profile";

fn decode(bytes: &[u8]) -> Result<String, NipError> {
    let utf16 = |b: &[u8], le: bool| {
        let units: Vec<u16> = b
            .as_chunks::<2>()
            .0
            .iter()
            .map(|c| {
                if le {
                    u16::from_le_bytes([c[0], c[1]])
                } else {
                    u16::from_be_bytes([c[0], c[1]])
                }
            })
            .collect();
        String::from_utf16(&units).map_err(|_| NipError::Encoding)
    };
    match bytes {
        [0xFF, 0xFE, rest @ ..] => utf16(rest, true),
        [0xFE, 0xFF, rest @ ..] => utf16(rest, false),
        [0xEF, 0xBB, 0xBF, rest @ ..] => {
            String::from_utf8(rest.to_vec()).map_err(|_| NipError::Encoding)
        }
        [b'<', 0, ..] => utf16(bytes, true),
        _ => String::from_utf8(bytes.to_vec()).map_err(|_| NipError::Encoding),
    }
}

impl Nip {
    pub fn parse(bytes: &[u8]) -> Result<Self, NipError> {
        let text = decode(bytes)?;
        // quick-xml rejects the utf-16 declaration once the text is already decoded.
        let body = match text.find("?>") {
            Some(i) if text.trim_start().starts_with("<?xml") => &text[i + 2..],
            _ => &text,
        };
        quick_xml::de::from_str(body).map_err(|e| NipError::Xml(e.to_string()))
    }

    /// UTF-16LE with BOM, the encoding Profile Inspector writes.
    pub fn to_bytes(&self) -> Result<Vec<u8>, NipError> {
        let xml = quick_xml::se::to_string(self).map_err(|e| NipError::Xml(e.to_string()))?;
        let text = format!("<?xml version=\"1.0\" encoding=\"utf-16\"?>\r\n{xml}");
        let mut out = vec![0xFF, 0xFE];
        out.extend(text.encode_utf16().flat_map(u16::to_le_bytes));
        Ok(out)
    }

    /// Game executables to attach to each named profile before applying `plan`.
    pub fn apps(&self) -> Vec<(String, Vec<String>)> {
        self.profiles
            .iter()
            .filter(|p| p.name != BASE_PROFILE && !p.executables.items.is_empty())
            .map(|p| (p.name.clone(), p.executables.items.clone()))
            .collect()
    }

    /// Every setting as a target/value pair, ready for an undo-logged batch.
    pub fn plan(&self) -> Result<Vec<(Target, Value)>, NipError> {
        let mut out = vec![];
        for p in &self.profiles {
            let profile = (p.name != BASE_PROFILE).then(|| p.name.clone());
            for s in &p.settings.items {
                out.push((
                    Target::Nvidia {
                        profile: profile.clone(),
                        setting: s.id,
                    },
                    s.to_value()?,
                ));
            }
        }
        Ok(out)
    }
}

impl NipSetting {
    pub fn to_value(&self) -> Result<Value, NipError> {
        let bad = || NipError::Value {
            id: self.id,
            kind: self.value_type.clone(),
            value: self.value.clone(),
        };
        match self.value_type.as_str() {
            "String" => Ok(Value::String(self.value.clone())),
            "Binary" => {
                let hex = self.value.trim_start_matches("0x");
                (0..hex.len())
                    .step_by(2)
                    .map(|i| {
                        hex.get(i..i + 2)
                            .and_then(|h| u8::from_str_radix(h, 16).ok())
                            .ok_or_else(bad)
                    })
                    .collect::<Result<Vec<u8>, _>>()
                    .map(Value::Binary)
            }
            _ => {
                let v = self.value.trim();
                let n = match v.strip_prefix("0x") {
                    Some(h) => u32::from_str_radix(h, 16),
                    None => v.parse::<u32>(),
                };
                n.map(Value::Dword).map_err(|_| bad())
            }
        }
    }

    pub fn from_value(id: u32, name: &str, value: &Value) -> Option<Self> {
        let (value, value_type) = match value {
            Value::Dword(n) => (n.to_string(), "Dword"),
            Value::String(s) => (s.clone(), "String"),
            Value::Binary(b) => (
                format!(
                    "0x{}",
                    b.iter().map(|x| format!("{x:02x}")).collect::<String>()
                ),
                "Binary",
            ),
            _ => return None,
        };
        Some(Self {
            name: name.into(),
            id,
            value,
            value_type: value_type.into(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"<?xml version="1.0" encoding="utf-16"?>
<ArrayOfProfile>
  <Profile>
    <ProfileName>Base Profile</ProfileName>
    <Executeables />
    <Settings>
      <ProfileSetting>
        <SettingNameInfo>Vertical Sync</SettingNameInfo>
        <SettingID>11041231</SettingID>
        <SettingValue>138504007</SettingValue>
        <ValueType>Dword</ValueType>
      </ProfileSetting>
    </Settings>
  </Profile>
  <Profile>
    <ProfileName>VALORANT</ProfileName>
    <Executeables>
      <string>valorant-win64-shipping.exe</string>
    </Executeables>
    <Settings>
      <ProfileSetting>
        <SettingNameInfo>Frame Rate Limiter V3</SettingNameInfo>
        <SettingID>277041154</SettingID>
        <SettingValue>237</SettingValue>
        <ValueType>Dword</ValueType>
      </ProfileSetting>
    </Settings>
  </Profile>
</ArrayOfProfile>"#;

    fn utf16(s: &str) -> Vec<u8> {
        let mut b = vec![0xFF, 0xFE];
        b.extend(s.encode_utf16().flat_map(u16::to_le_bytes));
        b
    }

    #[test]
    fn parses_utf16_nip_into_plan() -> Result<(), NipError> {
        let nip = Nip::parse(&utf16(SAMPLE))?;
        assert_eq!(nip.profiles.len(), 2);
        assert!(nip.profiles[0].executables.items.is_empty());
        let plan = nip.plan()?;
        assert_eq!(
            plan[0],
            (
                Target::Nvidia {
                    profile: None,
                    setting: 0x00A879CF
                },
                Value::Dword(0x08416747)
            )
        );
        assert_eq!(
            plan[1],
            (
                Target::Nvidia {
                    profile: Some("VALORANT".into()),
                    setting: 0x10835002
                },
                Value::Dword(237)
            )
        );
        Ok(())
    }

    #[test]
    fn write_then_read_round_trips() -> Result<(), NipError> {
        let nip = Nip::parse(SAMPLE.as_bytes())?;
        assert_eq!(Nip::parse(&nip.to_bytes()?)?, nip);
        Ok(())
    }

    #[test]
    fn binary_values_decode() -> Result<(), NipError> {
        let s = NipSetting {
            id: 1,
            value: "0x0aff".into(),
            value_type: "Binary".into(),
            ..Default::default()
        };
        assert_eq!(s.to_value()?, Value::Binary(vec![0x0a, 0xff]));
        Ok(())
    }
}
