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
    if (dates.length === 0) return <div style={{ textAlign: 'center', color: 'var(--muted)' }}>No data</div>;



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
    const lowestDia = diaArr.length > 0
        ? Math.min(...diaArr.map(d => d.val))
        : Infinity;
    const min = Math.min(75, lowestDia);
    const range = Math.max(max - min, 1);

    const width = 200, height = 240, padding = 40;
    const xAxisLabelOffset = 16;
    const colors = { systolic: 'var(--accent-med)', diastolic: 'var(--accent-primary)' };
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

    const formatLocalDateLabel = (dateStr) => {
        const [year, month, day] = dateStr.split('-').map(Number);
        if (!year || !month || !day) return dateStr;
        const localDate = new Date(year, month - 1, day);
        return localDate.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
    };

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
    const hoverX = hoverIndex != null ? getXForIndex(hoverIndex) : null;
    const line120Y = Math.min(height - padding, Math.max(padding, getYForValue(120)));
    const line130Y = Math.min(height - padding, Math.max(padding, getYForValue(130)));
    const line80Y = Math.min(height - padding, Math.max(padding, getYForValue(80)));

    return (
        <div style={{ overflowX: 'auto', marginBottom: '24px' }}>
            <h3 style={{ fontSize: '16px', color: 'var(--heading)', marginBottom: '8px' }}>Blood Pressure</h3>
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
                <rect width="100%" height="100%" fill="var(--surface)" />
                <line
                    x1={padding}
                    y1={line120Y}
                    x2={width - padding}
                    y2={line120Y}
                    stroke="var(--accent-med)"
                    strokeWidth="1"
                    strokeDasharray="2 2"
                    opacity="0.9"
                />
                <line
                    x1={padding}
                    y1={line130Y}
                    x2={width - padding}
                    y2={line130Y}
                    stroke="var(--accent-med)"
                    strokeWidth="1"
                    strokeDasharray="4 4"
                    opacity="0.7"
                />
                <line
                    x1={padding}
                    y1={line80Y}
                    x2={width - padding}
                    y2={line80Y}
                    stroke="var(--accent-primary)"
                    strokeWidth="1"
                    strokeDasharray="4 4"
                    opacity="0.7"
                />
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
                            <text x={x} y={y - 6} fontSize="10" fill={colors.diastolic} textAnchor="middle">
                                {d.val}
                            </text>
                        </g>
                    );
                })}
                {dates.map((date, i) => {
                    const x = getXForIndex(i);
                    return (
                        <text key={i} x={x} y={height - padding + xAxisLabelOffset} fontSize="12" fill="var(--muted)" textAnchor="middle">
                            {formatLocalDateLabel(date)}
                        </text>
                    );
                })}
                {hoverX != null && (
                    <line
                        x1={hoverX}
                        y1={padding}
                        x2={hoverX}
                        y2={height - padding}
                        stroke="var(--muted)"
                        strokeDasharray="4 4"
                        strokeWidth="1"
                    />
                )}
            </svg>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-start', marginTop: '8px' }}>
                <span style={{ color: colors.systolic, fontSize: '12px' }}>🟠 Systolic</span>
                <span style={{ color: colors.diastolic, fontSize: '12px' }}>🟢 Diastolic</span>
            </div>
        </div>
    );
}
