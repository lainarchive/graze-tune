use crate::{AuditRule, Catalog, System, Target, Value, Verdict};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct Finding {
    pub id: String,
    pub title: String,
    pub target: Target,
    pub location: String,
    pub current: Value,
    pub windows_default: Value,
    pub verdict: Verdict,
    pub sources: Vec<String>,
    pub why: String,
    /// True when graze-tune itself wrote the current value.
    pub ours: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct AuditReport {
    pub checked: usize,
    pub findings: Vec<Finding>,
    pub errors: Vec<String>,
}

/// Read-only. Compares every audit rule and catalog target against its Windows default.
pub fn run(sys: &dyn System, catalog: &Catalog, ours: impl Fn(&Target) -> bool) -> AuditReport {
    let mut findings = vec![];
    let mut errors = vec![];
    let mut checked = 0;
    let mut seen = std::collections::HashSet::new();

    let mut check = |rule: &AuditRule| {
        if !seen.insert(rule.target.clone()) {
            return;
        }
        checked += 1;
        match sys.read(&rule.target) {
            Ok(current) if current != rule.default => findings.push(Finding {
                id: rule.id.clone(),
                title: rule.title.clone(),
                location: rule.target.to_string(),
                target: rule.target.clone(),
                ours: ours(&rule.target),
                current,
                windows_default: rule.default.clone(),
                verdict: rule.verdict.clone(),
                sources: rule.sources.clone(),
                why: rule.why.clone(),
            }),
            Ok(_) => {}
            Err(crate::SysError::Unsupported) => {}
            Err(e) => errors.push(e.to_string()),
        }
    };

    for rule in &catalog.audit {
        check(rule);
    }
    // Catalog targets changed by something else are reported as "keep": the change is one
    // graze-tune would also make, but it should be benchmarked and owned by the undo log.
    for t in &catalog.tweaks {
        for c in &t.changes {
            check(&AuditRule {
                id: format!("{}:{}", t.id, c.target),
                title: t.title.clone(),
                target: c.target.clone(),
                default: c.default.clone(),
                verdict: if t.risk == crate::Risk::OptIn {
                    Verdict::Risk
                } else {
                    Verdict::Keep
                },
                sources: vec![],
                why: t.why.clone(),
            });
        }
    }
    AuditReport {
        checked,
        findings,
        errors,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Hive, MemorySystem};

    #[test]
    fn reports_only_values_that_differ_from_default() -> Result<(), String> {
        let catalog = Catalog::builtin().map_err(|e| e.to_string())?;
        let rule = catalog.audit.first().ok_or("no audit rules")?.clone();
        let changed = match &rule.default {
            Value::Missing => Value::Dword(1),
            _ => Value::Missing,
        };
        let sys = MemorySystem::with([(rule.target.clone(), changed)]);
        let report = run(&sys, &catalog, |_| false);
        assert!(report.findings.iter().any(|f| f.id == rule.id));
        let untouched = Target::Registry {
            hive: Hive::HKLM,
            path: "X".into(),
            name: "Y".into(),
        };
        assert!(report.findings.iter().all(|f| f.target != untouched));
        Ok(())
    }
}
