import { useState, useEffect, useCallback } from "react";

const SHEET_ID = "1NU0Ilz9wzMJIBZnRXTr4CmU1IjeB2Hcd2XDsg9botKE";
const API_KEY = "AIzaSyCZ0lWwt95tj3t-hjseB-LWEUgmDoRmyUo";

const SHEETS_URL = (range) =>
  `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}?key=${API_KEY}`;

// ─── FETCH HELPERS ────────────────────────────────────────────────────────
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

// ─── COMPUTE KPIs ─────────────────────────────────────────────────────────
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

  const booked = oppIn("Half-Qualified Booked","Qualified Booked","Showed up","No Show","Nurture","Middleground","Closed Won","Closed Lost");
  const showed = oppIn("Showed up","Nurture","Middleground","Closed Won","Closed Lost");
  const won = opp("Closed Won");
  const noShow = opp("No Show");

  const totalApps = filteredApps.length;
  const fullApps = filteredApps.filter((r) => r.form_completion === "Full").length;
  const partialApps = filteredApps.filter((r) => r.form_completion === "Partial").length;
  const qualifiedApps = filteredApps.filter((r) => r.investment_capacity && r.investment_capacity !== "Mažiau nei €1,000").length;
  const unqualifiedApps = filteredApps.filter((r) => r.investment_capacity === "Mažiau nei €1,000").length;

  const revenue = filteredLeads.filter((r) => r.opportunity_status === "Closed Won").reduce((s, r) => s + (parseFloat(r.value) || 0), 0);
  const cash = filteredLeads.reduce((s, r) => s + (parseFloat(r.cash_collected) || 0), 0);

  const pipeline = [
    "Half-Qualified No-Book","Half-Qualified Booked","Qualified Booked",
    "Showed up","No Show","Nurture","Middleground","Closed Won","Closed Lost","Unqualified"
  ].map((s) => ({ status: s, count: opp(s) }));

  const investment = [
    ["< €1k", "Mažiau nei €1,000"],
    ["€1k–€2k", "€1,000–€2,000"],
    ["€2k–€3k", "€2,000-€3,000"],
    ["€3k+", "€3,000+"],
  ].map(([tier, val]) => ({
    tier,
    count: filteredApps.filter((r) => r.investment_capacity === val).length,
    pct: totalApps ? filteredApps.filter((r) => r.investment_capacity === val).length / totalApps : 0,
  }));

  const sources = ["instagram_story","instagram_bio","lead_magnet","emails","youtube","youtube1","youtube2","youtube3","tiktok","facebook"];
  const sourceLabels = { instagram_story:"Instagram Story", instagram_bio:"Instagram Bio", lead_magnet:"Lead Magnet", emails:"Emails", youtube:"YouTube", youtube1:"YouTube (AI)", youtube2:"YouTube (Dovydas)", youtube3:"YouTube (AI Video)", tiktok:"TikTok", facebook:"Facebook" };

  const bySource = sources.map((src) => {
    const srcLeads = filteredLeads.filter((r) => r.lead_source === src);
    const srcApps = filteredApps.filter((r) => r.lead_source === src);
    const srcBooked = srcLeads.filter((r) => ["Half-Qualified Booked","Qualified Booked","Showed up","No Show","Nurture","Middleground","Closed Won","Closed Lost"].includes(r.opportunity_status)).length;
    const srcShowed = srcLeads.filter((r) => ["Showed up","Nurture","Middleground","Closed Won","Closed Lost"].includes(r.opportunity_status)).length;
    const srcWon = srcLeads.filter((r) => r.opportunity_status === "Closed Won").length;
    const srcRev = srcLeads.filter((r) => r.opportunity_status === "Closed Won").reduce((s, r) => s + (parseFloat(r.value) || 0), 0);
    const srcCash = srcLeads.reduce((s, r) => s + (parseFloat(r.cash_collected) || 0), 0);
    return {
      source: sourceLabels[src],
      apps: srcApps.length,
      qualified: srcApps.filter((r) => r.investment_capacity && r.investment_capacity !== "Mažiau nei €1,000").length,
      booked: srcBooked, showed: srcShowed, won: srcWon, revenue: srcRev, cash: srcCash,
    };
  }).filter((r) => r.apps > 0 || r.booked > 0 || r.won > 0);

  return { apps: { total: totalApps, full: fullApps, partial: partialApps, qualified: qualifiedApps, unqualified: unqualifiedApps }, calls: { booked, showed, noShow, won }, revenue: { won, revenue, cash, aov: won ? revenue / won : 0 }, pipeline, investment, bySource };
}

// ─── DESIGN TOKENS ────────────────────────────────────────────────────────
const C = { bg:"#0d0d0d", surface:"#161616", border:"#2a2a2a", borderAccent:"#3d1f00", accent:"#e85d00", accentGlow:"rgba(232,93,0,0.1)", green:"#22c55e", greenDim:"#14532d", red:"#ef4444", text:"#f0f0f0", textMuted:"#888", textDim:"#444" };
const pct = (n, d) => d ? `${((n / d) * 100).toFixed(1)}%` : "—";
const eur = (n) => n ? `€${Number(n).toLocaleString("de-DE")}` : "€0";

function StatCard({ label, value, sub, accent, green }) {
  return (
    <div style={{ background: accent ? C.accentGlow : green ? "rgba(34,197,94,0.06)" : C.surface, border: `1px solid ${accent ? C.borderAccent : green ? C.greenDim : C.border}`, borderRadius: 10, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ color: C.textMuted, fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 500 }}>{label}</div>
      <div style={{ color: accent ? C.accent : green ? C.green : C.text, fontSize: 26, fontWeight: 600, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ color: C.textDim, fontSize: 12, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function SectionHeader({ children }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, marginTop: 28 }}>
      <div style={{ width: 3, height: 16, background: C.accent, borderRadius: 2 }} />
      <div style={{ color: C.textMuted, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 600 }}>{children}</div>
    </div>
  );
}

function FunnelRow({ label, value, max, color = C.accent }) {
  const w = max ? Math.max(2, (value / max) * 100) : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
      <div style={{ color: C.textMuted, fontSize: 12, minWidth: 155, textAlign: "right" }}>{label}</div>
      <div style={{ flex: 1, background: "#1a1a1a", borderRadius: 3, height: 6, overflow: "hidden" }}>
        <div style={{ width: `${w}%`, height: "100%", background: color, borderRadius: 3, transition: "width 0.6s ease" }} />
      </div>
      <div style={{ color: C.text, fontSize: 13, fontWeight: 500, minWidth: 28, textAlign: "right" }}>{value}</div>
    </div>
  );
}

export default function Dashboard() {
  const [leads, setLeads] = useState([]);
  const [apps, setApps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [period, setPeriod] = useState("all");
  const [source, setSource] = useState("all");
  const [lastUpdated, setLastUpdated] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [leadsRaw, appsRaw] = await Promise.all([
        fetchRange("Raw_Leads!A:R"),
        fetchRange("Raw_Applications!A:M"),
      ]);
      setLeads(rowsToObjects(leadsRaw));
      setApps(rowsToObjects(appsRaw));
      setLastUpdated(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const d = (!loading && !error) ? compute(leads, apps, source, period) : null;

  const sel = { background: C.surface, border: `1px solid ${C.border}`, color: C.textMuted, padding: "5px 10px", borderRadius: 6, fontSize: 12, cursor: "pointer", outline: "none" };

  return (
    <div style={{ background: C.bg, minHeight: "100vh", color: C.text, fontFamily: "'Inter', system-ui, sans-serif", fontSize: 14 }}>
      {/* TOP BAR */}
      <div style={{ borderBottom: `1px solid ${C.border}`, padding: "0 24px", display: "flex", alignItems: "center", gap: 16, height: 52, position: "sticky", top: 0, background: C.bg, zIndex: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: loading ? C.textDim : C.green, boxShadow: loading ? "none" : `0 0 6px ${C.green}` }} />
          <span style={{ fontWeight: 600, fontSize: 15, letterSpacing: "-0.02em" }}>Danas</span>
          <span style={{ color: C.textDim, fontSize: 13 }}>/ Sales Dashboard</span>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <select style={sel} value={source} onChange={e => setSource(e.target.value)}>
            <option value="all">All sources</option>
            <option value="instagram_story">Instagram Story</option>
            <option value="instagram_bio">Instagram Bio</option>
            <option value="lead_magnet">Lead Magnet</option>
            <option value="emails">Emails</option>
            <option value="youtube">YouTube</option>
            <option value="tiktok">TikTok</option>
            <option value="facebook">Facebook</option>
          </select>
          <select style={sel} value={period} onChange={e => setPeriod(e.target.value)}>
            <option value="7">Last 7 days</option>
            <option value="14">Last 14 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="all">All time</option>
          </select>
          <button onClick={load} style={{ background: "transparent", border: `1px solid ${C.border}`, color: C.textMuted, padding: "5px 12px", borderRadius: 6, fontSize: 12, cursor: "pointer" }}>↻ Refresh</button>
          {lastUpdated && <div style={{ color: C.textDim, fontSize: 11, paddingLeft: 8, borderLeft: `1px solid ${C.border}` }}>Updated {lastUpdated.toLocaleTimeString("lt-LT", { hour: "2-digit", minute: "2-digit" })}</div>}
        </div>
      </div>

      <div style={{ padding: "20px 24px", maxWidth: 1200, margin: "0 auto" }}>
        {loading && <div style={{ color: C.textMuted, textAlign: "center", padding: 80, fontSize: 13 }}>Loading data from Google Sheets…</div>}
        {error && <div style={{ color: C.red, textAlign: "center", padding: 80, fontSize: 13 }}>Error: {error}<br/><span style={{ color: C.textDim, fontSize: 11 }}>Make sure the sheet is public (Share → Anyone with link → Viewer)</span></div>}

        {d && <>
          <SectionHeader>Applications</SectionHeader>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 10 }}>
            <StatCard label="Total" value={d.apps.total} accent sub="all submissions" />
            <StatCard label="Full submissions" value={d.apps.full} sub={pct(d.apps.full, d.apps.total)} />
            <StatCard label="Partial" value={d.apps.partial} sub={pct(d.apps.partial, d.apps.total)} />
            <StatCard label="Qualified" value={d.apps.qualified} green sub={`invest ≥ €1k · ${pct(d.apps.qualified, d.apps.total)}`} />
            <StatCard label="Unqualified" value={d.apps.unqualified} sub="invest < €1k" />
          </div>

          <SectionHeader>Calls</SectionHeader>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 10 }}>
            <StatCard label="Booked calls" value={d.calls.booked} accent sub="qualified → booked" />
            <StatCard label="Booked rate" value={pct(d.calls.booked, d.apps.qualified)} sub="Booked / Qualified" />
            <StatCard label="Show rate" value={pct(d.calls.showed, d.calls.booked)} green sub={`${d.calls.showed} showed up`} />
            <StatCard label="No-show rate" value={pct(d.calls.noShow, d.calls.booked)} sub={`${d.calls.noShow} no-shows`} />
            <StatCard label="Close rate" value={pct(d.revenue.won, d.calls.showed)} green sub="Won / Showed" />
          </div>

          <SectionHeader>Revenue</SectionHeader>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10 }}>
            <StatCard label="Revenue" value={eur(d.revenue.revenue)} accent sub={`${d.revenue.won} deals closed`} />
            <StatCard label="Cash collected" value={eur(d.revenue.cash)} green sub={pct(d.revenue.cash, d.revenue.revenue)} />
            <StatCard label="Cash to collect" value={eur(d.revenue.revenue - d.revenue.cash)} sub="outstanding" />
            <StatCard label="AOV" value={eur(d.revenue.aov)} sub="avg order value" />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 28 }}>
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20 }}>
              <div style={{ color: C.textMuted, fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600, marginBottom: 16 }}>Pipeline breakdown</div>
              {(() => {
                const pColors = { "Closed Won": C.green, "Showed up": C.accent, "Qualified Booked": "#f59e0b", "No Show": C.red, "Closed Lost": "#7f2020", "Unqualified": "#444" };
                const mx = Math.max(...d.pipeline.map(p => p.count), 1);
                return d.pipeline.map((p, i) => <FunnelRow key={i} label={p.status} value={p.count} max={mx} color={pColors[p.status] || "#7a3000"} />);
              })()}
            </div>
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20 }}>
              <div style={{ color: C.textMuted, fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600, marginBottom: 16 }}>Investment capacity</div>
              {d.investment.map((inv, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                  <div style={{ color: C.textMuted, fontSize: 12, minWidth: 58 }}>{inv.tier}</div>
                  <div style={{ flex: 1, background: "#1a1a1a", borderRadius: 3, height: 6, overflow: "hidden" }}>
                    <div style={{ width: `${inv.pct * 100}%`, height: "100%", background: i === 0 ? "#444" : C.accent, borderRadius: 3, opacity: 0.5 + i * 0.15 }} />
                  </div>
                  <div style={{ color: C.text, fontSize: 12, minWidth: 28, textAlign: "right" }}>{inv.count}</div>
                  <div style={{ color: C.textDim, fontSize: 11, minWidth: 40, textAlign: "right" }}>{(inv.pct * 100).toFixed(1)}%</div>
                </div>
              ))}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 20, paddingTop: 16, borderTop: `1px solid ${C.border}` }}>
                <div style={{ background: C.accentGlow, border: `1px solid ${C.borderAccent}`, borderRadius: 8, padding: "12px 14px" }}>
                  <div style={{ color: C.textMuted, fontSize: 11, marginBottom: 4 }}>QA → Booked</div>
                  <div style={{ color: C.accent, fontSize: 20, fontWeight: 600 }}>{pct(d.calls.booked, d.apps.qualified)}</div>
                </div>
                <div style={{ background: "rgba(34,197,94,0.06)", border: `1px solid ${C.greenDim}`, borderRadius: 8, padding: "12px 14px" }}>
                  <div style={{ color: C.textMuted, fontSize: 11, marginBottom: 4 }}>App → Closed</div>
                  <div style={{ color: C.green, fontSize: 20, fontWeight: 600 }}>{pct(d.revenue.won, d.apps.total)}</div>
                </div>
              </div>
            </div>
          </div>

          <SectionHeader>By source</SectionHeader>
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr>{["Source","Apps","Qualified","Booked","Showed","Won","Revenue","Cash"].map((h, i) => (
                  <th key={h} style={{ color: C.textMuted, fontWeight: 500, padding: "10px 12px", textAlign: i === 0 ? "left" : "right", fontSize: 11, letterSpacing: "0.05em", textTransform: "uppercase", borderBottom: `1px solid ${C.border}` }}>{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {d.bySource.length === 0 && <tr><td colSpan={8} style={{ color: C.textDim, textAlign: "center", padding: 24, fontSize: 12 }}>No source data yet</td></tr>}
                {d.bySource.map((row, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid #1a1a1a` }}>
                    <td style={{ padding: "10px 12px", color: C.text, fontWeight: 500 }}>{row.source}</td>
                    <td style={{ padding: "10px 12px", color: C.textMuted, textAlign: "right" }}>{row.apps}</td>
                    <td style={{ padding: "10px 12px", color: C.textMuted, textAlign: "right" }}>{row.qualified}</td>
                    <td style={{ padding: "10px 12px", color: C.textMuted, textAlign: "right" }}>{row.booked}</td>
                    <td style={{ padding: "10px 12px", color: C.textMuted, textAlign: "right" }}>{row.showed}</td>
                    <td style={{ padding: "10px 12px", textAlign: "right" }}>
                      <span style={{ background: row.won > 0 ? C.greenDim : "transparent", color: row.won > 0 ? C.green : C.textDim, padding: "2px 8px", borderRadius: 4, fontSize: 12, fontWeight: 600 }}>{row.won || "—"}</span>
                    </td>
                    <td style={{ padding: "10px 12px", textAlign: "right", color: row.revenue > 0 ? C.accent : C.textDim, fontWeight: row.revenue > 0 ? 600 : 400 }}>{eur(row.revenue)}</td>
                    <td style={{ padding: "10px 12px", textAlign: "right", color: C.textMuted }}>{eur(row.cash)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 32, paddingTop: 16, borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between" }}>
            <div style={{ color: C.textDim, fontSize: 11 }}>Live data · Danas – MAIN DATA · Raw_Leads + Raw_Applications</div>
            <div style={{ color: C.textDim, fontSize: 11 }}>Vabanque © 2026</div>
          </div>
        </>}
      </div>
    </div>
  );
}
