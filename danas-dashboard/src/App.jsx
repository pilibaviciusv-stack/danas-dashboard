import { useState, useEffect, useCallback } from "react";

const SHEET_ID = "1NU0Ilz9wzMJIBZnRXTr4CmU1IjeB2Hcd2XDsg9botKE";
const API_KEY = "AIzaSyCZ0lWwt95tj3t-hjseB-LWEUgmDoRmyUo";

const SHEETS_URL = (range) =>
  `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}?key=${API_KEY}`;

async function fetchRange(range) {
  const res = await fetch(SHEETS_URL(range));
  if (!res.ok) throw new Error(`Sheets API error: ${res.status}`);
  const data = await res.json();
  return data.values || [];
}

function rowsToObjects(rows) {
  if (!rows.length) return [];
  const [headers, ...data] = rows;
  return data.map((row) =>
    Object.fromEntries(headers.map((h, i) => [h, row[i] || ""]))
  );
}

const INV_MAP = {
  "Mažiau nei €1,000": "<1k",
  "€1,000–€2,000": "1k-2k",
  "€2,000-€3,000": "2k-3k",
  "€3,000+": "3k+",
};

function normalizeInv(v) {
  return INV_MAP[v] || v;
}

function compute(leads, apps, filterSource, filterPeriod) {
  const now = new Date();
  const days = filterPeriod === "all" ? null : parseInt(filterPeriod);
  const cutoff = days ? new Date(now - days * 864e5) : null;

  const filterDate = (dateStr) => {
    if (!cutoff || !dateStr) return true;
    const d = new Date(dateStr);
    return !isNaN(d) && d >= cutoff;
  };

  const filteredLeads = leads.filter((r) => {
    if (filterSource !== "all" && r.lead_source !== filterSource) return false;
    if (!filterDate(r.created_date)) return false;
    return true;
  });

  const filteredApps = apps.filter((r) => {
    if (filterSource !== "all" && r.lead_source !== filterSource) return false;
    if (!filterDate(r.submitted_at)) return false;
    return true;
  });

  const opp = (s) => filteredLeads.filter((r) => r.opportunity_status === s).length;
  const oppIn = (...ss) => filteredLeads.filter((r) => ss.includes(r.opportunity_status)).length;

  // Sales funnel statuses
  const booked = oppIn(
    "Half-Qualified Booked", "Qualified Booked",
    "Showed up", "No Show", "Nurture", "Middleground",
    "Closed Won", "Closed Lost", "Unqualified",
    "Pursuit: Pre-Call Confirm"
  );
  const showed = oppIn("Showed up", "Nurture", "Middleground", "Closed Won", "Closed Lost");
  const won = opp("Closed Won");
  const noShow = opp("No Show");

  // Applications from Raw_Applications
  const totalApps = filteredApps.length;
  const fullApps = filteredApps.filter((r) => r.form_completion === "Full").length;
  const partialApps = filteredApps.filter((r) => r.form_completion === "Partial").length;

  const qualifiedApps = filteredApps.filter((r) => {
    const inv = normalizeInv(r.investment_capacity);
    return inv && inv !== "<1k";
  }).length;
  const unqualifiedApps = filteredApps.filter((r) => {
    const inv = normalizeInv(r.investment_capacity);
    return inv === "<1k";
  }).length;

  // Revenue
  const revenue = filteredLeads
    .filter((r) => r.opportunity_status === "Closed Won")
    .reduce((s, r) => s + (parseFloat(r.value) || 0), 0);
  const cash = filteredLeads.reduce((s, r) => s + (parseFloat(r.cash_collected) || 0), 0);
  const aov = won ? revenue / won : 0;

  // Rates
  const bookedRate = qualifiedApps ? ((booked / qualifiedApps) * 100).toFixed(1) : "0.0";
  const showRate = booked ? ((showed / booked) * 100).toFixed(1) : "0.0";
  const noShowRate = booked ? ((noShow / booked) * 100).toFixed(1) : "0.0";
  const closeRate = showed ? ((won / showed) * 100).toFixed(1) : "0.0";
  const completionRate = totalApps ? ((fullApps / totalApps) * 100).toFixed(1) : "0.0";

  // Pipeline status breakdown
  const statuses = [
    "Half-Qualified No-Book", "Half-Qualified Booked", "Qualified Booked",
    "Showed up", "No Show", "Nurture", "Middleground",
    "Closed Won", "Closed Lost", "Unqualified",
  ];
  const pipelineBreakdown = statuses.map((s) => ({ label: s, count: opp(s) }));

  // Unqualified pipeline
  const unqualLeads = filteredLeads.filter((r) =>
    ["Worth Dialing", "Qualified for Call", "Booked → Sales", "Dead",
     "Unqualified - Budget"].includes(r.opportunity_status) ||
    r.lead_status === "Unqualified - Budget"
  );

  // Count by unqual status from lead_status field  
  const unqualTotal = filteredLeads.filter((r) =>
    r.lead_status === "Unqualified - Budget" || r.opportunity_status === "Unqualified - Budget"
  ).length;

  const worthDialing = filteredLeads.filter((r) =>
    r.opportunity_status === "Worth Dialing"
  ).length;
  const qualifiedForCall = filteredLeads.filter((r) =>
    r.opportunity_status === "Qualified for Call"
  ).length;
  const bookedToSales = filteredLeads.filter((r) =>
    r.opportunity_status === "Booked → Sales"
  ).length;
  const dead = filteredLeads.filter((r) =>
    r.opportunity_status === "Dead"
  ).length;

  // Investment capacity split (from leads)
  const invSplit = ["<1k", "1k-2k", "2k-3k", "3k+"].map((tier) => ({
    tier,
    count: filteredLeads.filter((r) => normalizeInv(r.investment_capacity) === tier).length,
  }));

  // By source
  const sources = [
    { key: "instagram_story", label: "IG Story" },
    { key: "instagram_bio", label: "IG Bio" },
    { key: "lead_magnet", label: "Lead Magnet" },
    { key: "youtube", label: "YouTube" },
    { key: "youtube1", label: "YT (AI)" },
    { key: "youtube2", label: "YT (Dovydas)" },
    { key: "youtube3", label: "YT (AI Video)" },
    { key: "tiktok", label: "TikTok" },
    { key: "facebook", label: "Facebook" },
    { key: "emails", label: "Emails" },
  ];

  const bySource = sources.map(({ key, label }) => {
    const srcApps = filteredApps.filter((r) => r.lead_source === key);
    const srcLeads = filteredLeads.filter((r) => r.lead_source === key);
    const srcBooked = srcLeads.filter((r) =>
      ["Half-Qualified Booked","Qualified Booked","Showed up","No Show",
       "Nurture","Middleground","Closed Won","Closed Lost"].includes(r.opportunity_status)
    ).length;
    const srcShowed = srcLeads.filter((r) =>
      ["Showed up","Nurture","Middleground","Closed Won","Closed Lost"].includes(r.opportunity_status)
    ).length;
    const srcWon = srcLeads.filter((r) => r.opportunity_status === "Closed Won").length;
    const srcCash = srcLeads.reduce((s, r) => s + (parseFloat(r.cash_collected) || 0), 0);
    return {
      label,
      apps: srcApps.length,
      qualified: srcApps.filter((r) => normalizeInv(r.investment_capacity) !== "<1k").length,
      booked: srcBooked,
      showed: srcShowed,
      won: srcWon,
      cash: srcCash,
    };
  }).filter((r) => r.apps > 0 || r.booked > 0);

  return {
    totalApps, fullApps, partialApps, qualifiedApps, unqualifiedApps,
    completionRate, booked, showed, won, noShow,
    bookedRate, showRate, noShowRate, closeRate,
    revenue, cash, aov,
    pipelineBreakdown, bySource, invSplit,
    unqualTotal, worthDialing, qualifiedForCall, bookedToSales, dead,
  };
}

const fmt = (n) => n?.toLocaleString("lt-LT", { maximumFractionDigits: 0 }) ?? "0";
const pct = (n) => `${n}%`;

function StatCard({ label, value, sub, accent }) {
  return (
    <div style={{
      background: "#111", border: `1px solid ${accent || "#222"}`,
      borderRadius: 8, padding: "14px 18px", minWidth: 0,
    }}>
      <div style={{ fontSize: 11, color: "#666", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: accent || "#fff", lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "#555", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function Section({ title, color, children }) {
  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{
        fontSize: 11, fontWeight: 700, letterSpacing: 2,
        color: color || "#555", textTransform: "uppercase",
        borderBottom: `1px solid ${color || "#222"}`, paddingBottom: 6, marginBottom: 16,
      }}>{title}</div>
      {children}
    </div>
  );
}

const SOURCES = [
  "all","instagram_story","instagram_bio","lead_magnet","youtube",
  "youtube1","youtube2","youtube3","tiktok","facebook","emails",
];
const PERIODS = [
  { v: "all", l: "Visi laikai" },
  { v: "7", l: "7 dienos" },
  { v: "30", l: "30 dienų" },
  { v: "90", l: "90 dienų" },
];

export default function App() {
  const [leads, setLeads] = useState([]);
  const [apps, setApps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [filterSource, setFilterSource] = useState("all");
  const [filterPeriod, setFilterPeriod] = useState("all");

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [leadRows, appRows] = await Promise.all([
        fetchRange("Raw_Leads!A:R"),
        fetchRange("Raw_Applications!A:M"),
      ]);
      setLeads(rowsToObjects(leadRows));
      setApps(rowsToObjects(appRows));
      setLastRefresh(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const kpi = compute(leads, apps, filterSource, filterPeriod);

  const selStyle = {
    background: "#111", border: "1px solid #333", color: "#fff",
    borderRadius: 6, padding: "6px 10px", fontSize: 12, cursor: "pointer",
  };

  return (
    <div style={{
      minHeight: "100vh", background: "#0a0a0a", color: "#fff",
      fontFamily: "'Inter', system-ui, sans-serif", padding: "24px 20px",
      maxWidth: 1100, margin: "0 auto",
    }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 28 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#fff" }}>Danas — Sales Dashboard</div>
          <div style={{ fontSize: 11, color: "#444", marginTop: 2 }}>
            {lastRefresh ? `Atnaujinta: ${lastRefresh.toLocaleTimeString("lt-LT")}` : "Kraunama..."}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <select style={selStyle} value={filterSource} onChange={(e) => setFilterSource(e.target.value)}>
            {SOURCES.map((s) => <option key={s} value={s}>{s === "all" ? "Visi šaltiniai" : s}</option>)}
          </select>
          <select style={selStyle} value={filterPeriod} onChange={(e) => setFilterPeriod(e.target.value)}>
            {PERIODS.map((p) => <option key={p.v} value={p.v}>{p.l}</option>)}
          </select>
          <button onClick={load} style={{
            ...selStyle, background: "#1a1a1a", padding: "6px 14px",
            cursor: loading ? "not-allowed" : "pointer",
          }}>{loading ? "⟳" : "↻ Refresh"}</button>
        </div>
      </div>

      {error && (
        <div style={{ background: "#1a0000", border: "1px solid #500", borderRadius: 8, padding: 12, marginBottom: 20, color: "#f66", fontSize: 13 }}>
          ⚠ {error}
        </div>
      )}

      {/* APPLICATIONS */}
      <Section title="Applications" color="#3b82f6">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
          <StatCard label="Iš viso" value={fmt(kpi.totalApps)} accent="#3b82f6" />
          <StatCard label="Full" value={fmt(kpi.fullApps)} sub={pct(kpi.completionRate) + " completion"} />
          <StatCard label="Partial" value={fmt(kpi.partialApps)} />
          <StatCard label="Qualified ≥1k" value={fmt(kpi.qualifiedApps)} accent="#22c55e" />
          <StatCard label="Unqualified <1k" value={fmt(kpi.unqualifiedApps)} accent="#f59e0b" />
        </div>
      </Section>

      {/* CALLS */}
      <Section title="Calls" color="#8b5cf6">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
          <StatCard label="Booked" value={fmt(kpi.booked)} accent="#8b5cf6" />
          <StatCard label="Booked Rate" value={pct(kpi.bookedRate)} sub="Booked / Qualified" />
          <StatCard label="Showed" value={fmt(kpi.showed)} />
          <StatCard label="Show Rate" value={pct(kpi.showRate)} />
          <StatCard label="No Show" value={fmt(kpi.noShow)} accent="#ef4444" />
          <StatCard label="No Show Rate" value={pct(kpi.noShowRate)} accent="#ef4444" />
          <StatCard label="Close Rate" value={pct(kpi.closeRate)} accent="#22c55e" />
        </div>
      </Section>

      {/* REVENUE */}
      <Section title="Revenue" color="#22c55e">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
          <StatCard label="Closed Won" value={fmt(kpi.won)} accent="#22c55e" />
          <StatCard label="Revenue" value={`€${fmt(kpi.revenue)}`} accent="#22c55e" />
          <StatCard label="Cash Collected" value={`€${fmt(kpi.cash)}`} />
          <StatCard label="Cash to Collect" value={`€${fmt(kpi.revenue - kpi.cash)}`} />
          <StatCard label="AOV" value={`€${fmt(kpi.aov)}`} sub="Revenue / Won" />
        </div>
      </Section>

      {/* UNQUALIFIED PIPELINE */}
      <Section title="Unqualified Pipeline" color="#f59e0b">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 10, marginBottom: 16 }}>
          <StatCard label="Iš viso <1k" value={fmt(kpi.unqualTotal)} accent="#f59e0b" />
          <StatCard label="💎 Worth Dialing" value={fmt(kpi.worthDialing)} accent="#f59e0b" sub="Aktyvūs, skambinti" />
          <StatCard label="📋 Qualified for Call" value={fmt(kpi.qualifiedForCall)} accent="#eab308" sub="Perkvalifikuoti" />
          <StatCard label="🚀 Booked → Sales" value={fmt(kpi.bookedToSales)} accent="#22c55e" sub="Į Sales pipeline" />
          <StatCard label="🗑 Dead" value={fmt(kpi.dead)} accent="#555" sub="Nebeskambinti" />
        </div>
        <div style={{ fontSize: 11, color: "#444", fontStyle: "italic" }}>
          Konversija: {kpi.unqualTotal ? ((kpi.bookedToSales / kpi.unqualTotal) * 100).toFixed(1) : 0}% Unqual → Sales (Worth Dialing → Booked)
        </div>
      </Section>

      {/* PIPELINE BREAKDOWN */}
      <Section title="Pipeline Status" color="#6366f1">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
          {kpi.pipelineBreakdown.map(({ label, count }) => (
            <div key={label} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              background: "#111", border: "1px solid #222", borderRadius: 6, padding: "10px 14px",
            }}>
              <span style={{ fontSize: 12, color: "#999" }}>{label}</span>
              <span style={{ fontSize: 16, fontWeight: 700, color: count > 0 ? "#fff" : "#333" }}>{count}</span>
            </div>
          ))}
        </div>
      </Section>

      {/* INVESTMENT CAPACITY */}
      <Section title="Investment Capacity" color="#06b6d4">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 10 }}>
          {kpi.invSplit.map(({ tier, count }) => (
            <StatCard key={tier} label={tier} value={fmt(count)}
              accent={tier === "<1k" ? "#f59e0b" : tier === "3k+" ? "#22c55e" : "#06b6d4"} />
          ))}
        </div>
      </Section>

      {/* BY SOURCE */}
      {kpi.bySource.length > 0 && (
        <Section title="By Source" color="#ec4899">
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr>
                  {["Šaltinis","Apps","Qualified","Booked","Showed","Won","Cash"].map((h) => (
                    <th key={h} style={{ textAlign: "left", padding: "8px 12px", color: "#555", fontWeight: 600, borderBottom: "1px solid #222" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {kpi.bySource.map((r) => (
                  <tr key={r.label} style={{ borderBottom: "1px solid #1a1a1a" }}>
                    <td style={{ padding: "8px 12px", color: "#ec4899", fontWeight: 600 }}>{r.label}</td>
                    <td style={{ padding: "8px 12px", color: "#fff" }}>{r.apps}</td>
                    <td style={{ padding: "8px 12px", color: "#22c55e" }}>{r.qualified}</td>
                    <td style={{ padding: "8px 12px" }}>{r.booked}</td>
                    <td style={{ padding: "8px 12px" }}>{r.showed}</td>
                    <td style={{ padding: "8px 12px", color: r.won > 0 ? "#22c55e" : "#fff" }}>{r.won}</td>
                    <td style={{ padding: "8px 12px", color: r.cash > 0 ? "#22c55e" : "#fff" }}>€{fmt(r.cash)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      <div style={{ textAlign: "center", fontSize: 10, color: "#2a2a2a", marginTop: 32 }}>
        Vabanque × Danas · Live data from Google Sheets
      </div>
    </div>
  );
}
