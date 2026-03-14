import React from "react";
import { WORKOUTS } from "../data";

export default function WorkoutChart({ entries }) {
    const dates = Object.keys(entries).sort();
    if (dates.length === 0) return <div style={{ textAlign: 'center', color: 'var(--muted)' }}>No workout data</div>;

    const width = 300, height = 160, padding = 24; // narrower for mobile
    const colors = ["var(--accent-primary)", "var(--accent-med)", "var(--accent-workout)", "var(--accent-hygiene)", "var(--accent-note)"];

    // helper for single series (returns arr, pts, path, max)
    const buildSeries = (key) => {
        const arr = dates.map(date => {
            const w = entries[date].workouts || {};
            return { date, val: parseInt(w[key]) || 0 };
        });
        const m = Math.max(...arr.map(d => d.val));
        const pts = arr.map((d, i) => {
            const x = padding + (i / (dates.length - 1)) * (width - 2 * padding);
            const y = height - padding - (m ? (d.val / m) * (height - 2 * padding) : 0);
            return [x, y];
        });
        const path = pts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0] + ',' + p[1]).join(' ');
        return { arr, pts, path, max: m };
    };

    // responsive grid container
    return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', justifyContent: 'center' }}>
            {WORKOUTS.map((w, idx) => {
                const { arr, pts, path, max } = buildSeries(w.key);
                const color = colors[idx % colors.length];
                return (
                    <div key={w.key} style={{ flex: '1 1 140px', maxWidth: '320px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                            <span style={{ fontSize: '16px' }}>{w.emoji}</span>
                            <span style={{ fontSize: '13px', fontWeight: 500, color }}>{w.label}</span>
                        </div>
                        <div style={{ position: 'relative' }}>
                            <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
                                <rect width="100%" height="100%" fill="var(--surface)" />
                                <path d={path} fill="none" stroke={color} strokeWidth="2" />
                                {pts.map((p, i) => (
                                    <circle key={i} cx={p[0]} cy={p[1]} r={4} fill={color}>
                                        <title>{`${new Date(arr[i].date).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}: ${arr[i].val}`}</title>
                                    </circle>
                                ))}
                                {dates.map((date, i) => {
                                    const x = padding + (i / (dates.length - 1)) * (width - 2 * padding);
                                    return (
                                        <text key={i} x={x} y={height - padding + 12} fontSize="8" fill="var(--muted)" textAnchor="middle">
                                            {new Date(date).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}
                                        </text>
                                    );
                                })}
                                {Array.from({ length: max + 1 }).map((_, i) => (
                                    <text key={i} x={padding - 8} y={height - padding - (max ? (i / max) * (height - 2 * padding) : 0) + 3} fontSize="8" fill="var(--muted)" textAnchor="end">
                                        {i}
                                    </text>
                                ))}
                            </svg>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
