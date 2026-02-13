"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Card } from "@/shared/components";

const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
        return (
            <div className="bg-surface border border-border p-3 rounded-lg shadow-lg text-xs">
                <p className="font-semibold mb-1">{new Date(label).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                {payload.map((entry, index) => (
                    <p key={index} style={{ color: entry.color }}>
                        {entry.name}: {entry.value.toLocaleString()}
                    </p>
                ))}
                <p className="font-medium mt-1 pt-1 border-t border-border/50">
                    Total: {payload.reduce((sum, entry) => sum + entry.value, 0).toLocaleString()}
                </p>
            </div>
        );
    }
    return null;
};

export default function TokenUsageChart({ data }) {
    // Format data for chart
    const chartData = data.map(item => ({
        time: item.timestamp,
        Input: item.promptTokens || 0,
        Output: item.completionTokens || 0,
    }));

    return (
        <Card className="p-4 h-[300px] flex flex-col">
            <div className="flex justify-between items-center mb-4">
                <h3 className="font-semibold text-sm uppercase text-text-muted">Token Usage (24h)</h3>
            </div>
            <div className="flex-1 w-full min-h-0">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" opacity={0.5} />
                        <XAxis
                            dataKey="time"
                            tickFormatter={(time) => new Date(time).getHours() + 'h'}
                            stroke="var(--text-muted)"
                            fontSize={10}
                            tickLine={false}
                            axisLine={false}
                            minTickGap={30}
                        />
                        <YAxis
                            stroke="var(--text-muted)"
                            fontSize={10}
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(value) => value >= 1000 ? `${(value / 1000).toFixed(1)}k` : value}
                        />
                        <Tooltip content={<CustomTooltip />} cursor={{ fill: 'var(--bg-subtle)', opacity: 0.5 }} />
                        <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                        <Bar dataKey="Input" stackId="a" fill="#3b82f6" radius={[0, 0, 4, 4]} maxBarSize={40} />
                        <Bar dataKey="Output" stackId="a" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={40} />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </Card>
    );
}
