//! Benchmark math, kept platform-independent so it is unit-tested on any OS.
use serde::Serialize;

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct FrameStats {
    pub frames: usize,
    pub avg_fps: f64,
    /// Average fps over the slowest 1% / 0.1% of frames.
    pub low1_fps: f64,
    pub low01_fps: f64,
    pub avg_ms: f64,
    pub p99_ms: f64,
}

pub fn percentile(sorted: &[f64], p: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    let rank = (p / 100.0 * (sorted.len() - 1) as f64).round() as usize;
    sorted[rank.min(sorted.len() - 1)]
}

fn worst_avg_fps(sorted_desc: &[f64], frac: f64) -> f64 {
    let n = ((sorted_desc.len() as f64 * frac).ceil() as usize).clamp(1, sorted_desc.len());
    let ms = sorted_desc[..n].iter().sum::<f64>() / n as f64;
    if ms > 0.0 {
        1000.0 / ms
    } else {
        0.0
    }
}

pub fn frame_stats(frametimes_ms: &[f64]) -> FrameStats {
    let mut v: Vec<f64> = frametimes_ms
        .iter()
        .copied()
        .filter(|x| x.is_finite() && *x > 0.0)
        .collect();
    if v.is_empty() {
        return FrameStats::default();
    }
    v.sort_by(|a, b| a.total_cmp(b));
    let total: f64 = v.iter().sum();
    let avg_ms = total / v.len() as f64;
    let p99_ms = percentile(&v, 99.0);
    v.reverse();
    FrameStats {
        frames: v.len(),
        avg_fps: 1000.0 / avg_ms,
        low1_fps: worst_avg_fps(&v, 0.01),
        low01_fps: worst_avg_fps(&v, 0.001),
        avg_ms,
        p99_ms,
    }
}

/// Frametimes from a PresentMon CSV (1.x `MsBetweenPresents` or 2.x `FrameTime`).
pub fn parse_presentmon_csv(csv: &str) -> Vec<f64> {
    let mut lines = csv.lines();
    let Some(header) = lines.next() else {
        return vec![];
    };
    let cols: Vec<&str> = header.split(',').map(str::trim).collect();
    let Some(idx) = ["FrameTime", "MsBetweenPresents"]
        .iter()
        .find_map(|name| cols.iter().position(|c| c == name))
    else {
        return vec![];
    };
    lines
        .filter_map(|l| l.split(',').nth(idx)?.trim().parse::<f64>().ok())
        .collect()
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct PingStats {
    pub samples: usize,
    pub lost: usize,
    pub avg_ms: f64,
    pub min_ms: f64,
    pub jitter_ms: f64,
}

/// `None` entries are lost probes. Jitter is the mean absolute difference of consecutive RTTs.
pub fn ping_stats(rtts: &[Option<f64>]) -> PingStats {
    let ok: Vec<f64> = rtts.iter().flatten().copied().collect();
    if ok.is_empty() {
        return PingStats {
            samples: rtts.len(),
            lost: rtts.len(),
            ..Default::default()
        };
    }
    let jitter = if ok.len() > 1 {
        ok.windows(2).map(|w| (w[1] - w[0]).abs()).sum::<f64>() / (ok.len() - 1) as f64
    } else {
        0.0
    };
    PingStats {
        samples: rtts.len(),
        lost: rtts.len() - ok.len(),
        avg_ms: ok.iter().sum::<f64>() / ok.len() as f64,
        min_ms: ok.iter().copied().fold(f64::INFINITY, f64::min),
        jitter_ms: jitter,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frame_stats_on_known_series() {
        let mut ft = vec![10.0; 99];
        ft.push(50.0);
        let s = frame_stats(&ft);
        assert_eq!(s.frames, 100);
        assert!((s.avg_ms - 10.4).abs() < 1e-9);
        assert!((s.low1_fps - 20.0).abs() < 1e-9);
        assert_eq!(s.p99_ms, 10.0);
    }

    #[test]
    fn empty_series_is_zeroed() {
        assert_eq!(frame_stats(&[]), FrameStats::default());
    }

    #[test]
    fn parses_presentmon_v2_and_v1() {
        assert_eq!(
            parse_presentmon_csv("Application,FrameTime\ngame.exe,6.9\ngame.exe,7.1\n"),
            vec![6.9, 7.1]
        );
        assert_eq!(
            parse_presentmon_csv("Application,MsBetweenPresents\ng,8.0\n"),
            vec![8.0]
        );
        assert!(parse_presentmon_csv("nope\n1\n").is_empty());
    }

    #[test]
    fn ping_jitter_and_loss() {
        let s = ping_stats(&[Some(30.0), None, Some(34.0), Some(32.0)]);
        assert_eq!(s.lost, 1);
        assert!((s.jitter_ms - 3.0).abs() < 1e-9);
        assert_eq!(s.min_ms, 30.0);
    }
}
