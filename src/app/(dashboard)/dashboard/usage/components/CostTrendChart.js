"use client";

import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Card } from "@/shared/components";

const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
        return (
            <div className="bg-surface border border-border p-3 rounded-lg shadow-lg text-xs">
                <p className="font-semibold mb-1">{new Date(label).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                <p className="text-green-500 font-medium">
                    Cost: ${payload[0].value.toFixed(4)}
                </p>
            </div>
        );
    }
    return null;
};

export default function CostTrendChart({ data }) {
    return (
        <Card className="p-4 h-[300px] flex flex-col">
            <div className="flex justify-between items-center mb-4">
                <h3 className="font-semibold text-sm uppercase text-text-muted">Estimated Cost (24h)</h3>
                <p className="text-xl font-bold text-green-600 dark:text-green-400">
                    ${data.reduce((sum, item) => sum + (item.cost || 0), 0).toFixed(4)}
                </p>
            </div>
            <div className="flex-1 w-full min-h-0">
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                        <defs>
                            <linearGradient id="colorCost" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" opacity={0.5} />
                        <XAxis
                            dataKey="timestamp"
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
                            tickFormatter={(value) => `$${value.toFixed(2)}`}
                        />
                        <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'var(--border)', strokeWidth: 1 }} />
                        <Area
                            type="monotone"
                            dataKey="cost"
                            stroke="#10b981"
                            strokeWidth={2}
                            fillOpacity={1}
                            fill="url(#colorCost)"
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </Card>
    );
}
