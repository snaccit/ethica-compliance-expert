"use client";
import { useEffect, useState } from "react";

/** Countdown bis zur Batteriepass-Pflicht. Datum laut Art. 77 Abs. 1 BattVO (18. Februar 2027). */
const DEADLINE = new Date("2027-02-18T00:00:00");

export default function Countdown() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  if (!now) return null;
  const days = Math.max(0, Math.ceil((DEADLINE.getTime() - now.getTime()) / 86_400_000));
  const total = Math.ceil((DEADLINE.getTime() - new Date("2023-08-17").getTime()) / 86_400_000); // Inkrafttreten BattVO
  const pct = Math.min(100, Math.max(0, 100 - (days / total) * 100));
  return (
    <div className="countdown">
      <div className="cd-num">
        {days}
        <span>Tage</span>
      </div>
      <div className="cd-text">
        <b>bis zur Batteriepass-Pflicht</b>
        <span className="muted">18. Februar 2027 · Art. 77 Abs. 1 Batterieverordnung</span>
        <div className="cd-bar">
          <i style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}
