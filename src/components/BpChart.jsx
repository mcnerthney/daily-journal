import React from "react";

export default function BpChart({ entries }) {
    const dates = Object.keys(entries).sort();
    if (dates.length === 0) return <div style={{ textAlign: 'center', color: '#555' }}>No data</div>;



    // build arrays, excluding missing/zero readings
    const sysArr = dates
        .map(date => ({ date, val: entries[date].systolic }))
        .filter(d => d.val != null && d.val > 0);
    const diaArr = dates
        .map(date => ({ date, val: entries[date].diastolic }))
        .filter(d => d.val != null && d.val > 0);
    const max = Math.max(
        ...sysArr.map(d => d.val),
        ...diaArr.map(d => d.val),
        0
    );

    const width = 700, height = 240, padding = 40;
    const colors = { systolic: '#fb923c', diastolic: '#4ade80' };

    const buildPoints = (arr) =>
        arr.map((d) => {
            // determine index of this date in full series to place on correct x
            const i = dates.indexOf(d.date);
            const x = padding + (i / (dates.length - 1)) * (width - 2 * padding);
            const y = height - padding - (max ? (d.val / max) * (height - 2 * padding) : 0);
            return [x, y];
        });

    const sysPts = buildPoints(sysArr);
    const diaPts = buildPoints(diaArr);
    const sysPath = sysPts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0] + ',' + p[1]).join(' ');
    const diaPath = diaPts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0] + ',' + p[1]).join(' ');

    return (
        <div style={{ overflowX: 'auto', marginBottom: '24px' }}>
            <h3 style={{ fontSize: '16px', color: '#c9b8ff', marginBottom: '8px' }}>Blood Pressure</h3>
            <svg width={width} height={height} style={{ display: 'block' }}>
                <rect width="100%" height="100%" fill="#12121a" />
                <path d={sysPath} fill="none" stroke={colors.systolic} strokeWidth="2" />
                <path d={diaPath} fill="none" stroke={colors.diastolic} strokeWidth="2" />
                {dates.map((date, i) => {
                    const x = padding + (i / (dates.length - 1)) * (width - 2 * padding);
                    return (
                        <text key={i} x={x} y={height - padding + 15} fontSize="10" fill="#888" textAnchor="middle">
                            {new Date(date).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}
                        </text>
                    );
                })}
                {/* y-axis ticks only for values actually recorded */}
                {(() => {
                    const vals = Array.from(new Set([...sysArr, ...diaArr].map(d => d.val))).sort((a, b) => a - b);
                    return vals.map(v => {
                        const y = height - padding - (max ? (v / max) * (height - 2 * padding) : 0);
                        return (
                            <text key={v} x={padding - 10} y={y + 4} fontSize="10" fill="#888" textAnchor="end">
                                {v}
                            </text>
                        );
                    });
                })()}
            </svg>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', marginTop: '8px' }}>
                <span style={{ color: colors.systolic, fontSize: '12px' }}>🟠 Systolic</span>
                <span style={{ color: colors.diastolic, fontSize: '12px' }}>🟢 Diastolic</span>
            </div>
        </div>
    );
}
