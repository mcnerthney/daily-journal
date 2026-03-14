import React, { useState } from "react";

export default function BpChart({ entries }) {
    const [hoverIndex, setHoverIndex] = useState(null);
    const dates = Object.keys(entries)
        .sort()
        .filter((date) => {
            const sys = entries[date]?.systolic;
            const dia = entries[date]?.diastolic;
            return (sys != null && sys > 0) || (dia != null && dia > 0);
        });
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
    const min = diaArr.length > 0
        ? Math.min(...diaArr.map(d => d.val))
        : 0;
    const range = Math.max(max - min, 1);

    const width = 700, height = 240, padding = 40;
    const colors = { systolic: '#fb923c', diastolic: '#4ade80' };
    const indexDenominator = Math.max(dates.length - 1, 1);

    const getXForIndex = (i) => padding + (i / indexDenominator) * (width - 2 * padding);

    const getNearestIndexFromClientX = (clientX, svgEl) => {
        const rect = svgEl.getBoundingClientRect();
        const scaleX = rect.width > 0 ? width / rect.width : 1;
        const localX = (clientX - rect.left) * scaleX;
        const clampedX = Math.min(Math.max(localX, padding), width - padding);
        const ratio = (clampedX - padding) / (width - 2 * padding);
        return Math.round(ratio * indexDenominator);
    };

    const getYForValue = (value) =>
        height - padding - ((value - min) / range) * (height - 2 * padding);

    const buildPoints = (arr) =>
        arr.map((d) => {
            // determine index of this date in full series to place on correct x
            const i = dates.indexOf(d.date);
            const x = getXForIndex(i);
            const y = getYForValue(d.val);
            return [x, y];
        });

    const sysPts = buildPoints(sysArr);
    const diaPts = buildPoints(diaArr);
    const sysPath = sysPts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0] + ',' + p[1]).join(' ');
    const diaPath = diaPts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0] + ',' + p[1]).join(' ');
    const hoverDate = hoverIndex != null ? dates[hoverIndex] : null;
    const hoverEntry = hoverDate ? entries[hoverDate] : null;
    const hoverX = hoverIndex != null ? getXForIndex(hoverIndex) : null;
    const hoverSys = hoverEntry?.systolic;
    const hoverDia = hoverEntry?.diastolic;

    return (
        <div style={{ overflowX: 'auto', marginBottom: '24px' }}>
            <h3 style={{ fontSize: '16px', color: '#c9b8ff', marginBottom: '8px' }}>Blood Pressure</h3>
            <svg
                width={width}
                height={height}
                style={{ display: 'block', cursor: 'crosshair' }}
                onMouseMove={(e) => {
                    const idx = getNearestIndexFromClientX(e.clientX, e.currentTarget);
                    setHoverIndex(idx);
                }}
                onMouseLeave={() => setHoverIndex(null)}
            >
                <rect width="100%" height="100%" fill="#12121a" />
                <path d={sysPath} fill="none" stroke={colors.systolic} strokeWidth="2" />
                <path d={diaPath} fill="none" stroke={colors.diastolic} strokeWidth="2" />
                {sysArr.map((d) => {
                    const i = dates.indexOf(d.date);
                    const x = getXForIndex(i);
                    const y = getYForValue(d.val);
                    return (
                        <g key={`sys-${d.date}`}>
                            <circle cx={x} cy={y} r="2.5" fill={colors.systolic} />
                            <text x={x} y={y - 6} fontSize="10" fill={colors.systolic} textAnchor="middle">
                                {d.val}
                            </text>
                        </g>
                    );
                })}
                {diaArr.map((d) => {
                    const i = dates.indexOf(d.date);
                    const x = getXForIndex(i);
                    const y = getYForValue(d.val);
                    return (
                        <g key={`dia-${d.date}`}>
                            <circle cx={x} cy={y} r="2.5" fill={colors.diastolic} />
                            <text x={x} y={y + 12} fontSize="10" fill={colors.diastolic} textAnchor="middle">
                                {d.val}
                            </text>
                        </g>
                    );
                })}
                {dates.map((date, i) => {
                    const x = getXForIndex(i);
                    return (
                        <text key={i} x={x} y={height - padding + 15} fontSize="10" fill="#888" textAnchor="middle">
                            {new Date(date).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}
                        </text>
                    );
                })}
                {hoverX != null && (
                    <line
                        x1={hoverX}
                        y1={padding}
                        x2={hoverX}
                        y2={height - padding}
                        stroke="#6b7280"
                        strokeDasharray="4 4"
                        strokeWidth="1"
                    />
                )}
                {/* y-axis ticks only for values actually recorded */}
                {(() => {
                    const vals = Array.from(new Set([...sysArr, ...diaArr].map(d => d.val))).sort((a, b) => a - b);
                    return vals.map(v => {
                        const y = getYForValue(v);
                        return (
                            <text key={v} x={padding - 10} y={y + 4} fontSize="10" fill="#888" textAnchor="end">
                                {v}
                            </text>
                        );
                    });
                })()}
                {hoverDate && (
                    <g>
                        <rect x={padding + 6} y={6} width={220} height={44} rx={6} fill="#0b0b10" stroke="#2a2a3a" />
                        <text x={padding + 12} y={22} fontSize="11" fill="#b7b7c9">
                            {new Date(hoverDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </text>
                        <text x={padding + 12} y={38} fontSize="11" fill={colors.systolic}>
                            SYS: {hoverSys != null && hoverSys > 0 ? hoverSys : '—'}
                        </text>
                        <text x={padding + 98} y={38} fontSize="11" fill={colors.diastolic}>
                            DIA: {hoverDia != null && hoverDia > 0 ? hoverDia : '—'}
                        </text>
                    </g>
                )}
            </svg>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', marginTop: '8px' }}>
                <span style={{ color: colors.systolic, fontSize: '12px' }}>🟠 Systolic</span>
                <span style={{ color: colors.diastolic, fontSize: '12px' }}>🟢 Diastolic</span>
            </div>
        </div>
    );
}
