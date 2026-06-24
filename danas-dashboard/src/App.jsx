import { useState, useEffect, useCallback } from "react";
import logo from "./logo.png";

const SHEET_ID = "1NU0Ilz9wzMJIBZnRXTr4CmU1IjeB2Hcd2XDsg9botKE";
const API_KEY = "AIzaSyCZ0lWwt95tj3t-hjseB-LWEUgmDoRmyUo";
const GREEN = "#4ade80";
const BORDER = "#1a2e1a";
const BG = "#080b08";
const CARD_BG = "#0d110d";

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
  return data.map((row) => Object.fromEntries(headers.map((h, i) => [h, row[i] || ""])));
}

const INV_MAP = {
  "Mažiau nei €1,000": "<1k",
  "€1,000–€2,000": "1k-2k",
  "€2,000-€3,000": "2k-3k",
  "€3,000+": "3k+",
};
function normalizeInv(v) { return INV_MAP[v] || v; }

function isRealNoShow(r) {
  if (r.opportunity_status !== "No Show") return false;
  if (!r.closing_call_date) return true;
  const callTime = new Date(r.closing_call_date);
  if (isNaN(callTime)) return true;
  return new Date() > new Date(callTime.getTime() + 60 * 60 * 1000);
}

const BOOKED_STATUSES = [
  "Half-Qualified Booked","Qualified Booked","Showed up","No Show",
  "Nurture","Middleground","Closed Won","Closed Lost","Unqualified",
  "Pursuit: Pre-Call Confirm"
];
const SHOWED_STATUSES = ["Showed up","Nurture","Middleground","Closed Won","Closed Lost"];

function compute(leads, apps, scopes, filterSource, filterPeriod) {
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

  // === APPLICATIONS ===
  const totalApps = filteredApps.length;
  const fullApps = filteredApps.filter((r) => r.form_completion === "Full").length;
  const partialApps = filteredApps.filter((r) => r.form_completion === "Partial").length;
  const qualifiedApps = filteredApps.filter((r) => { const inv = normalizeInv(r.investment_capacity); return inv && inv !== "<1k"; }).length;
  const unqualifiedApps = filteredApps.filter((r) => normalizeInv(r.investment_capacity) === "<1k").length;
  const completionRate = totalApps ? ((fullApps / totalApps) * 100).toFixed(1) : "0.0";

  // === CALLS ===
  const booked = filteredLeads.filter((r) => BOOKED_STATUSES.includes(r.opportunity_status)).length;
  const showed = filteredLeads.filter((r) => SHOWED_STATUSES.includes(r.opportunity_status)).length;
  const won = opp("Closed Won");
  const noShow = filteredLeads.filter(isRealNoShow).length;

  // Confirmed = currently in Pre-Call Confirm (about to show)
  const confirmed = opp("Pursuit: Pre-Call Confirm");
  // Canceled = returned to No-Book after being booked
  const canceled = filteredLeads.filter((r) =>
    r.opportunity_status === "Half-Qualified No-Book" || r.lead_status === "Pursuit: No-Book"
  ).length;
  // Disqualified on call = were Qualified Booked → now Unqualified (lost)
  const disqualifiedOnCall = filteredLeads.filter((r) =>
    r.opportunity_status === "Unqualified"
  ).length;

  const qaToBookedRate = qualifiedApps ? ((booked / qualifiedApps) * 100).toFixed(1) : "0.0";
  const confirmedCallRate = booked ? ((confirmed / booked) * 100).toFixed(1) : "0.0";
  const canceledCallRate = booked ? ((canceled / booked) * 100).toFixed(1) : "0.0";
  const showRate = booked ? ((showed / booked) * 100).toFixed(1) : "0.0";
  const noShowRate = booked ? ((noShow / booked) * 100).toFixed(1) : "0.0";
  const closeRate = showed ? ((won / showed) * 100).toFixed(1) : "0.0";
  const disqualRate = showed ? ((disqualifiedOnCall / showed) * 100).toFixed(1) : "0.0";

  // === REVENUE ===
  const revenue = filteredLeads.filter((r) => r.opportunity_status === "Closed Won")
    .reduce((s, r) => s + (parseFloat(r.value) || 0), 0);
  const cash = filteredLeads.reduce((s, r) => s + (parseFloat(r.cash_collected) || 0), 0);
  const aov = won ? revenue / won : 0;
  const cashToCollect = revenue - cash;

  // === UNQUALIFIED PIPELINE ===
  const worthDialing = opp("Worth Dialing");
  const qualifiedForCall = opp("Qualified for Call");
  const bookedToSales = opp("Booked → Sales");
  const dead = opp("Dead");
  const unqualTotal = filteredLeads.filter((r) =>
    r.lead_status === "Unqualified - Budget" || r.opportunity_status === "Unqualified - Budget"
  ).length;

  // === PIPELINE BREAKDOWN ===
  const pipelineStatuses = [
    "Half-Qualified No-Book","Half-Qualified Booked","Qualified Booked",
    "Showed up","No Show","Nurture","Middleground",
    "Closed Won","Closed Lost","Unqualified",
  ];
  const pipelineBreakdown = pipelineStatuses.map((s) => ({
    label: s,
    count: s === "No Show" ? noShow : opp(s),
  }));

  // === INVESTMENT CAPACITY ===
  const invSplit = ["<1k","1k-2k","2k-3k","3k+"].map((tier) => ({
    tier,
    count: filteredLeads.filter((r) => normalizeInv(r.investment_capacity) === tier).length,
  }));

  // === BY SOURCE ===
  const scopeMap = {};
  scopes.forEach((row) => { if (row[0] && row[1]) scopeMap[row[0].trim()] = row[1].trim(); });

  const staticLabels = {
    instagram_story: "IG Story", instagram_bio: "IG Bio",
    lead_magnet: "Lead Magnet", tiktok: "TikTok",
    facebook: "Facebook", emails: "Emails", youtube: "YouTube (bendras)",
  };

  const allSourceKeys = [
    "instagram_story","instagram_bio","lead_magnet","tiktok","facebook","emails","youtube",
    ...Object.keys(scopeMap).filter((k) => k.startsWith("youtube") && k !== "youtube"),
  ];

  const bySource = allSourceKeys.map((key) => {
    const label = scopeMap[key] ? `YT: ${scopeMap[key]}` : (staticLabels[key] || key);
    const srcApps = filteredApps.filter((r) => r.lead_source === key);
    const srcLeads = filteredLeads.filter((r) => r.lead_source === key);
    const srcBooked = srcLeads.filter((r) => BOOKED_STATUSES.includes(r.opportunity_status)).length;
    const srcShowed = srcLeads.filter((r) => SHOWED_STATUSES.includes(r.opportunity_status)).length;
    const srcWon = srcLeads.filter((r) => r.opportunity_status === "Closed Won").length;
    const srcRevenue = srcLeads.filter((r) => r.opportunity_status === "Closed Won")
      .reduce((s, r) => s + (parseFloat(r.value) || 0), 0);
    const srcCash = srcLeads.reduce((s, r) => s + (parseFloat(r.cash_collected) || 0), 0);
    const srcQual = srcApps.filter((r) => normalizeInv(r.investment_capacity) !== "<1k").length;
    const srcQaToBooked = srcQual ? ((srcBooked / srcQual) * 100).toFixed(0) + "%" : "-";
    const srcShowRate = srcBooked ? ((srcShowed / srcBooked) * 100).toFixed(0) + "%" : "-";
    const srcCloseRate = srcShowed ? ((srcWon / srcShowed) * 100).toFixed(0) + "%" : "-";
    return {
      key, label,
      apps: srcApps.length,
      qualified: srcQual,
      booked: srcBooked,
      qaRate: srcQaToBooked,
      showed: srcShowed,
      showRate: srcShowRate,
      won: srcWon,
      closeRate: srcCloseRate,
      revenue: srcRevenue,
      cash: srcCash,
    };
  }).filter((r) => r.apps > 0 || r.booked > 0 || r.won > 0);

  return {
    totalApps, fullApps, partialApps, qualifiedApps, unqualifiedApps, completionRate,
    booked, showed, won, noShow, confirmed, canceled, disqualifiedOnCall,
    qaToBookedRate, confirmedCallRate, canceledCallRate, showRate, noShowRate, closeRate, disqualRate,
    revenue, cash, aov, cashToCollect,
    pipelineBreakdown, bySource, invSplit,
    unqualTotal, worthDialing, qualifiedForCall, bookedToSales, dead,
  };
}

const fmt = (n) => (n ?? 0).toLocaleString("lt-LT", { maximumFractionDigits: 0 });
const pct = (n) => `${n}%`;

function StatCard({ label, value, sub, accent, dim, highlight }) {
  return (
    <div style={{
      background: highlight ? "#0f1a0f" : CARD_BG,
      border: `1px solid ${accent ? accent + "44" : BORDER}`,
      borderRadius: 8, padding: "14px 16px", minWidth: 0,
    }}>
      <div style={{ fontSize: 10, color: "#3d5c3d", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 6, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: dim ? "#444" : (accent || "#d1fae5"), lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: "#2d4a2d", marginTop: 5 }}>{sub}</div>}
    </div>
  );
}

function Section({ title, color, children }) {
  const c = color || GREEN;
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{
        fontSize: 10, fontWeight: 700, letterSpacing: 3, color: c,
        textTransform: "uppercase", borderBottom: `1px solid ${c}22`,
        paddingBottom: 8, marginBottom: 14,
      }}>{title}</div>
      {children}
    </div>
  );
}

const PERIODS = [
  { v: "all", l: "Visi laikai" },
  { v: "7", l: "7 dienos" },
  { v: "30", l: "30 dienų" },
  { v: "90", l: "90 dienų" },
];

export default function App() {
  const [leads, setLeads] = useState([]);
  const [apps, setApps] = useState([]);
  const [scopes, setScopes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [filterSource, setFilterSource] = useState("all");
  const [filterPeriod, setFilterPeriod] = useState("all");

  const load = useCallback(async () => {
    try {
      setLoading(true); setError(null);
      const [leadRows, appRows, scopeRows] = await Promise.all([
        fetchRange("Raw_Leads!A:R"),
        fetchRange("Raw_Applications!A:M"),
        fetchRange("source-scopes!A:B"),
      ]);
      setLeads(rowsToObjects(leadRows));
      setApps(rowsToObjects(appRows));
      setScopes(scopeRows);
      setLastRefresh(new Date());
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const sourceOptions = [
    { v: "all", l: "Visi šaltiniai" },
    { v: "instagram_story", l: "IG Story" },
    { v: "instagram_bio", l: "IG Bio" },
    { v: "lead_magnet", l: "Lead Magnet" },
    { v: "youtube", l: "YouTube" },
    { v: "emails", l: "Emails" },
    { v: "tiktok", l: "TikTok" },
    { v: "facebook", l: "Facebook" },
    ...scopes.filter((r) => r[0]?.startsWith("youtube")).map((r) => ({ v: r[0], l: `YT: ${r[1] || r[0]}` })),
  ];

  const kpi = compute(leads, apps, scopes, filterSource, filterPeriod);

  const selStyle = {
    background: "#0d110d", border: `1px solid ${BORDER}`, color: "#6ee87a",
    borderRadius: 6, padding: "6px 10px", fontSize: 11, cursor: "pointer", outline: "none",
  };

  const grid = (cols) => ({
    display: "grid",
    gridTemplateColumns: `repeat(auto-fill, minmax(${cols}px, 1fr))`,
    gap: 10,
  });

  return (
    <div style={{ minHeight: "100vh", background: BG, color: "#d1fae5", fontFamily: "'Inter', system-ui, sans-serif", padding: "24px 20px", maxWidth: 1200, margin: "0 auto" }}>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 32, paddingBottom: 20, borderBottom: `1px solid ${BORDER}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <img src={logo} alt="PlugInfo" style={{ height: 36, width: 36, objectFit: "contain" }} />
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: GREEN, letterSpacing: 0.5 }}>Danas — Sales Dashboard</div>
            <div style={{ fontSize: 10, color: "#2d4a2d", marginTop: 2 }}>
              {lastRefresh ? `↻ ${lastRefresh.toLocaleTimeString("lt-LT")}` : "Kraunama..."}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <select style={selStyle} value={filterSource} onChange={(e) => setFilterSource(e.target.value)}>
            {sourceOptions.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}
          </select>
          <select style={selStyle} value={filterPeriod} onChange={(e) => setFilterPeriod(e.target.value)}>
            {PERIODS.map((p) => <option key={p.v} value={p.v}>{p.l}</option>)}
          </select>
          <button onClick={load} disabled={loading} style={{ ...selStyle, padding: "6px 14px", opacity: loading ? 0.5 : 1 }}>
            {loading ? "⟳" : "↻"}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: "#0f0500", border: "1px solid #3d1a00", borderRadius: 8, padding: 12, marginBottom: 20, color: "#f97316", fontSize: 12 }}>
          ⚠ {error}
        </div>
      )}

      {/* APPLICATIONS */}
      <Section title="Applications">
        <div style={grid(140)}>
          <StatCard label="Iš viso" value={fmt(kpi.totalApps)} accent={GREEN} />
          <StatCard label="Full" value={fmt(kpi.fullApps)} sub={`${kpi.completionRate}% completion`} />
          <StatCard label="Partial" value={fmt(kpi.partialApps)} />
          <StatCard label="Qualified ≥1k" value={fmt(kpi.qualifiedApps)} accent={GREEN} sub={`${kpi.qualifiedApps && kpi.totalApps ? ((kpi.qualifiedApps/kpi.totalApps)*100).toFixed(1) : 0}% of apps`} />
          <StatCard label="Unqualified <1k" value={fmt(kpi.unqualifiedApps)} accent="#f59e0b" />
        </div>
      </Section>

      {/* CALLS */}
      <Section title="Calls">
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10, color: "#2d4a2d", letterSpacing: 1, textTransform: "uppercase", marginBottom: 8 }}>Funnel</div>
          <div style={grid(145)}>
            <StatCard label="Booked" value={fmt(kpi.booked)} accent={GREEN} />
            <StatCard label="QA → Booked Rate" value={pct(kpi.qaToBookedRate)} sub="Booked / Qualified Apps" highlight />
            <StatCard label="Confirmed Call Rate" value={pct(kpi.confirmedCallRate)} sub="Pre-Call Confirm / Booked" highlight />
            <StatCard label="Canceled Call Rate" value={pct(kpi.canceledCallRate)} accent="#f59e0b" sub="No-Book / Booked" highlight />
            <StatCard label="Showed" value={fmt(kpi.showed)} />
            <StatCard label="Show Rate" value={pct(kpi.showRate)} sub="Showed / Booked" highlight />
            <StatCard label="No Show" value={fmt(kpi.noShow)} accent="#ef4444" sub="Praėjus 1h+ po callo" />
            <StatCard label="No Show Rate" value={pct(kpi.noShowRate)} accent="#ef4444" highlight />
          </div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: "#2d4a2d", letterSpacing: 1, textTransform: "uppercase", marginBottom: 8, marginTop: 14 }}>Sales Call Metrics</div>
          <div style={grid(145)}>
            <StatCard label="Close Rate" value={pct(kpi.closeRate)} accent={GREEN} sub="Won / Showed" highlight />
            <StatCard label="Disqualification Rate" value={pct(kpi.disqualRate)} accent="#f59e0b" sub="Unqualified / Showed" highlight />
          </div>
        </div>
      </Section>

      {/* REVENUE */}
      <Section title="Revenue">
        <div style={grid(145)}>
          <StatCard label="Closed Won" value={fmt(kpi.won)} accent={GREEN} />
          <StatCard label="Revenue" value={`€${fmt(kpi.revenue)}`} accent={GREEN} />
          <StatCard label="Cash Collected" value={`€${fmt(kpi.cash)}`} />
          <StatCard label="Cash to Collect" value={`€${fmt(kpi.cashToCollect)}`} />
          <StatCard label="AOV" value={`€${fmt(kpi.aov)}`} sub="Revenue / Won" />
        </div>
      </Section>

      {/* UNQUALIFIED PIPELINE */}
      <Section title="Unqualified Pipeline" color="#f59e0b">
        <div style={grid(155)}>
          <StatCard label="Iš viso <1k" value={fmt(kpi.unqualTotal)} accent="#f59e0b" />
          <StatCard label="💎 Worth Dialing" value={fmt(kpi.worthDialing)} accent="#f59e0b" sub="Skambinti" />
          <StatCard label="📋 Qualified for Call" value={fmt(kpi.qualifiedForCall)} accent="#eab308" />
          <StatCard label="🚀 Booked → Sales" value={fmt(kpi.bookedToSales)} accent={GREEN} sub="Perkelti į Sales" />
          <StatCard label="🗑 Dead" value={fmt(kpi.dead)} dim />
        </div>
        <div style={{ fontSize: 10, color: "#2d4a2d", marginTop: 10, fontStyle: "italic" }}>
          Konversija į Sales: {kpi.unqualTotal ? ((kpi.bookedToSales / kpi.unqualTotal) * 100).toFixed(1) : 0}%
        </div>
      </Section>

      {/* PIPELINE STATUS */}
      <Section title="Pipeline Status">
        <div style={grid(190)}>
          {kpi.pipelineBreakdown.map(({ label, count }) => (
            <div key={label} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 6, padding: "10px 14px",
            }}>
              <span style={{ fontSize: 11, color: "#3d5c3d" }}>{label}</span>
              <span style={{ fontSize: 18, fontWeight: 700, color: count > 0 ? (label === "No Show" ? "#ef4444" : label === "Closed Won" ? GREEN : "#d1fae5") : "#1a2e1a" }}>{count}</span>
            </div>
          ))}
        </div>
      </Section>

      {/* INVESTMENT CAPACITY */}
      <Section title="Investment Capacity">
        <div style={grid(130)}>
          {kpi.invSplit.map(({ tier, count }) => (
            <StatCard key={tier} label={tier} value={fmt(count)}
              accent={tier === "<1k" ? "#f59e0b" : tier === "3k+" ? GREEN : "#06b6d4"} />
          ))}
        </div>
      </Section>

      {/* BY SOURCE */}
      <Section title="By Source">
        {kpi.bySource.length === 0 ? (
          <div style={{ color: "#2d4a2d", fontSize: 12, fontStyle: "italic" }}>Nėra duomenų</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr>
                  {["Šaltinis","Apps","Qualified","Booked","QA→Booked","Showed","Show%","Won","Close%","Revenue","Cash"].map((h) => (
                    <th key={h} style={{
                      textAlign: h === "Šaltinis" ? "left" : "right",
                      padding: "8px 10px", color: "#2d4a2d", fontWeight: 600,
                      fontSize: 10, letterSpacing: 1, textTransform: "uppercase",
                      borderBottom: `1px solid ${BORDER}`, whiteSpace: "nowrap"
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {kpi.bySource.map((r) => (
                  <tr key={r.key} style={{ borderBottom: `1px solid ${BORDER}22` }}>
                    <td style={{ padding: "9px 10px", color: GREEN, fontWeight: 600, fontSize: 12 }}>{r.label}</td>
                    <td style={{ padding: "9px 10px", color: "#d1fae5", textAlign: "right" }}>{r.apps}</td>
                    <td style={{ padding: "9px 10px", color: r.qualified > 0 ? GREEN : "#2d4a2d", textAlign: "right" }}>{r.qualified}</td>
                    <td style={{ padding: "9px 10px", color: "#d1fae5", textAlign: "right" }}>{r.booked}</td>
                    <td style={{ padding: "9px 10px", color: r.qaRate !== "-" ? "#86efac" : "#2d4a2d", textAlign: "right", fontSize: 11 }}>{r.qaRate}</td>
                    <td style={{ padding: "9px 10px", color: "#d1fae5", textAlign: "right" }}>{r.showed}</td>
                    <td style={{ padding: "9px 10px", color: r.showRate !== "-" ? "#86efac" : "#2d4a2d", textAlign: "right", fontSize: 11 }}>{r.showRate}</td>
                    <td style={{ padding: "9px 10px", color: r.won > 0 ? GREEN : "#2d4a2d", textAlign: "right", fontWeight: r.won > 0 ? 700 : 400 }}>{r.won}</td>
                    <td style={{ padding: "9px 10px", color: r.closeRate !== "-" ? "#86efac" : "#2d4a2d", textAlign: "right", fontSize: 11 }}>{r.closeRate}</td>
                    <td style={{ padding: "9px 10px", color: r.revenue > 0 ? GREEN : "#2d4a2d", textAlign: "right" }}>€{fmt(r.revenue)}</td>
                    <td style={{ padding: "9px 10px", color: r.cash > 0 ? "#86efac" : "#2d4a2d", textAlign: "right" }}>€{fmt(r.cash)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <div style={{ textAlign: "center", fontSize: 10, color: "#1a2e1a", marginTop: 32, paddingTop: 16, borderTop: `1px solid ${BORDER}` }}>
        [PlugInfo] × Danas · Live data · Google Sheets
      </div>
    </div>
  );
}
