import PropTypes from "prop-types";

export default function BarChart({ data, colorClass = "bg-primary", height = "h-8", showTooltip = true }) {
    const max = Math.max(...data, 1);
    return (
        <div className={`flex items-end gap-[1px] ${height} w-full`}>
            {data.map((val, idx) => (
                <div
                    key={`bar-${idx}`}
                    className={`flex-1 rounded-t-[1px] transition-all duration-500 ${colorClass}`}
                    style={{ height: `${Math.max((val / max) * 100, 5)}%`, opacity: val === 0 ? 0.2 : 1 }}
                    title={showTooltip ? String(val) : undefined}
                />
            ))}
        </div>
    );
}

BarChart.propTypes = {
    data: PropTypes.arrayOf(PropTypes.number).isRequired,
    colorClass: PropTypes.string,
    height: PropTypes.string,
    showTooltip: PropTypes.bool,
};
