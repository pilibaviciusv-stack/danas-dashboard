import { useState, useEffect, useCallback } from "react";
import logo from "./logo.png";

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

function compute(leads, apps, scopes, filterSource, filterPeriod, unquals = []) {
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

  const totalApps = filteredApps.length;
  const fullApps = filteredApps.filter((r) => r.form_completion === "Full").length;
  const partialApps = filteredApps.filter((r) => r.form_completion === "Partial").length;
  const qualifiedApps = filteredApps.filter((r) => { const inv = normalizeInv(r.investment_capacity); return inv && inv !== "<1k"; }).length;
  const unqualifiedApps = filteredApps.filter((r) => normalizeInv(r.investment_capacity) === "<1k").length;
  const completionRate = totalApps ? ((fullApps / totalApps) * 100).toFixed(1) : "0.0";

  const booked = filteredLeads.filter((r) => BOOKED_STATUSES.includes(r.opportunity_status)).length;
  // showed = post-call statuses WHERE closing_call_date + 1h has passed (or no date = already happened)
  const showed = filteredLeads.filter((r) => {
    if (!SHOWED_STATUSES.includes(r.opportunity_status)) return false;
    if (!r.closing_call_date) return true; // no date = definitely happened
    const callTime = new Date(r.closing_call_date);
    if (isNaN(callTime)) return true;
    return new Date() > new Date(callTime.getTime() + 60 * 60 * 1000);
  }).length;
  const won = opp("Closed Won");
  const noShow = filteredLeads.filter(isRealNoShow).length;
  const tookCall = showed + noShow; // total calls that actually happened
  const confirmed = opp("Pursuit: Pre-Call Confirm");
  const canceled = filteredLeads.filter((r) =>
    r.opportunity_status === "Half-Qualified No-Book" || r.lead_status === "Pursuit: No-Book"
  ).length;
  const disqualifiedOnCall = filteredLeads.filter((r) => r.opportunity_status === "Unqualified").length;

  const qaToBookedRate = qualifiedApps ? ((booked / qualifiedApps) * 100).toFixed(1) : "0.0";
  const confirmedCallRate = booked ? ((confirmed / booked) * 100).toFixed(1) : "0.0";
  const canceledCallRate = booked ? ((canceled / booked) * 100).toFixed(1) : "0.0";
  const showRate = tookCall ? ((showed / tookCall) * 100).toFixed(1) : "0.0";
  const noShowRate = tookCall ? ((noShow / tookCall) * 100).toFixed(1) : "0.0";
  const closeRate = showed ? ((won / showed) * 100).toFixed(1) : "0.0";
  const disqualRate = showed ? ((disqualifiedOnCall / showed) * 100).toFixed(1) : "0.0";

  const revenue = filteredLeads.filter((r) => r.opportunity_status === "Closed Won")
    .reduce((s, r) => s + (parseFloat(r.value) || 0), 0);
  const cash = filteredLeads.reduce((s, r) => s + (parseFloat(r.cash_collected) || 0), 0);
  const aov = won ? revenue / won : 0;
  const cashToCollect = revenue - cash;
  const ccAfterFees = cash * 0.965;
  const cashPerCall = showed > 0 ? cash / showed : 0;

  // Unqualified pipeline KPIs — from Raw_Unqualified sheet
  const filteredUnquals = unquals.filter((r) => {
    if (!filterDate(r.created_date)) return false;
    return true;
  });
  const unqualTotal = filteredUnquals.length;
  const worthDialing = filteredUnquals.filter((r) => r.opportunity_status === "Worth Dialing").length;
  const qualifiedForCall = filteredUnquals.filter((r) => r.opportunity_status === "Qualified for Call").length;
  const bookedToSales = filteredUnquals.filter((r) => r.opportunity_status === "Booked → Sales").length;
  const dead = filteredUnquals.filter((r) => r.opportunity_status === "Dead").length;

  const pipelineStatuses = [
    "Half-Qualified No-Book","Half-Qualified Booked","Qualified Booked",
    "Showed up","No Show","Nurture","Middleground",
    "Closed Won","Closed Lost","Unqualified",
  ];
  const pipelineBreakdown = pipelineStatuses.map((s) => ({
    label: s,
    count: s === "No Show" ? noShow : opp(s),
  }));

  const invSplit = ["<1k","1k-2k","2k-3k","3k+"].map((tier) => ({
    tier,
    count: filteredLeads.filter((r) => normalizeInv(r.investment_capacity) === tier).length,
  }));

  const scopeMap = {};
  scopes.forEach((row) => { if (row[0] && row[1]) scopeMap[row[0].trim()] = row[1].trim(); });

  const staticLabels = {
    instagram_story: "IG Story", instagram_bio: "IG Bio",
    lead_magnet: "Lead Magnet", tiktok: "TikTok",
    facebook: "Facebook", emails: "Email", youtube: "YouTube",
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
    const srcShowed = srcLeads.filter((r) => {
      if (!SHOWED_STATUSES.includes(r.opportunity_status)) return false;
      if (!r.closing_call_date) return true;
      const ct = new Date(r.closing_call_date);
      if (isNaN(ct)) return true;
      return new Date() > new Date(ct.getTime() + 60 * 60 * 1000);
    }).length;
    const srcNoShow = srcLeads.filter(isRealNoShow).length;
    const srcTookCall = srcShowed + srcNoShow;
    const srcWon = srcLeads.filter((r) => r.opportunity_status === "Closed Won").length;
    const srcRevenue = srcLeads.filter((r) => r.opportunity_status === "Closed Won")
      .reduce((s, r) => s + (parseFloat(r.value) || 0), 0);
    const srcCash = srcLeads.reduce((s, r) => s + (parseFloat(r.cash_collected) || 0), 0);
    const srcQual = srcApps.filter((r) => normalizeInv(r.investment_capacity) !== "<1k").length;
    const srcQaToBooked = srcQual ? ((srcBooked / srcQual) * 100).toFixed(0) + "%" : "-";
    const srcShowRate = srcTookCall ? ((srcShowed / srcTookCall) * 100).toFixed(0) + "%" : "-";
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

  // Pie chart data
  const appsBySource = [
    { label: "Instagram", value: filteredApps.filter(r => r.lead_source?.startsWith("instagram")).length, color: "#E1306C" },
    { label: "YouTube", value: filteredApps.filter(r => r.lead_source?.startsWith("youtube")).length, color: "#FF0000" },
    { label: "Email", value: filteredApps.filter(r => r.lead_source === "emails").length, color: "#4F46E5" },
    { label: "Other", value: filteredApps.filter(r => !r.lead_source?.startsWith("instagram") && !r.lead_source?.startsWith("youtube") && r.lead_source !== "emails").length, color: "#94A3B8" },
  ].filter(d => d.value > 0);

  const bookedBySource = [
    { label: "Instagram", value: filteredLeads.filter(r => r.lead_source?.startsWith("instagram") && BOOKED_STATUSES.includes(r.opportunity_status)).length, color: "#E1306C" },
    { label: "YouTube", value: filteredLeads.filter(r => r.lead_source?.startsWith("youtube") && BOOKED_STATUSES.includes(r.opportunity_status)).length, color: "#FF0000" },
    { label: "Email", value: filteredLeads.filter(r => r.lead_source === "emails" && BOOKED_STATUSES.includes(r.opportunity_status)).length, color: "#4F46E5" },
    { label: "Other", value: filteredLeads.filter(r => !r.lead_source?.startsWith("instagram") && !r.lead_source?.startsWith("youtube") && r.lead_source !== "emails" && BOOKED_STATUSES.includes(r.opportunity_status)).length, color: "#94A3B8" },
  ].filter(d => d.value > 0);

  // IG medium breakdown
  const igMediums = ["story", "bio", "dms", "profile"].map(m => ({
    label: `IG ${m.charAt(0).toUpperCase() + m.slice(1)}`,
    apps: filteredApps.filter(r => r.lead_source === `instagram_${m}`).length,
    booked: filteredLeads.filter(r => r.lead_source === `instagram_${m}` && BOOKED_STATUSES.includes(r.opportunity_status)).length,
    color: ["#E1306C","#F56040","#FCAF45","#833AB4"][["story","bio","dms","profile"].indexOf(m)],
  })).filter(d => d.apps > 0 || d.booked > 0);

  // YT video breakdown
  const ytVideos = Object.keys(scopeMap).filter(k => k.startsWith("youtube") && k !== "youtube").map(k => ({
    label: scopeMap[k],
    apps: filteredApps.filter(r => r.lead_source === k).length,
    booked: filteredLeads.filter(r => r.lead_source === k && BOOKED_STATUSES.includes(r.opportunity_status)).length,
  })).filter(d => d.apps > 0 || d.booked > 0).sort((a,b) => b.apps - a.apps);

  const postCallStatus = [
    { label: "Closed Won", value: opp("Closed Won"), color: "#22C55E" },
    { label: "Closed Lost", value: opp("Closed Lost"), color: "#EF4444" },
    { label: "Nurture", value: opp("Nurture"), color: "#F59E0B" },
    { label: "Middleground", value: opp("Middleground"), color: "#3B82F6" },
    { label: "No Show", value: noShow, color: "#6B7280" },
    { label: "Disqualified", value: disqualifiedOnCall, color: "#8B5CF6" },
  ].filter(d => d.value > 0);

  return {
    totalApps, fullApps, partialApps, qualifiedApps, unqualifiedApps, completionRate,
    booked, showed, won, noShow, confirmed, canceled, disqualifiedOnCall,
    qaToBookedRate, confirmedCallRate, canceledCallRate, showRate, noShowRate, closeRate, disqualRate,
    revenue, cash, aov, cashToCollect, ccAfterFees, cashPerCall,
    pipelineBreakdown, bySource, invSplit,
    unqualTotal, worthDialing, qualifiedForCall, bookedToSales, dead, filteredUnquals,
    appsBySource, bookedBySource, igMediums, ytVideos, postCallStatus,
  };
}

const fmt = (n) => (n ?? 0).toLocaleString("lt-LT", { maximumFractionDigits: 0 });
const pct = (n) => `${n}%`;

// ─── Design Tokens ────────────────────────────────────────────────────────────
const C = {
  bg: "#F8F9FA",
  surface: "#FFFFFF",
  border: "#E5E7EB",
  borderLight: "#F3F4F6",
  text: "#111827",
  textMid: "#6B7280",
  textLight: "#9CA3AF",
  green: "#16A34A",
  greenLight: "#DCFCE7",
  greenMid: "#86EFAC",
  red: "#DC2626",
  redLight: "#FEE2E2",
  amber: "#D97706",
  amberLight: "#FEF3C7",
  blue: "#2563EB",
  blueLight: "#DBEAFE",
  purple: "#7C3AED",
  purpleLight: "#EDE9FE",
  tabActive: "#111827",
  tabBorder: "#E5E7EB",
};

// ─── Donut Chart ──────────────────────────────────────────────────────────────
function DonutChart({ data, size = 120, thickness = 28, title, subtitle }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      {title && <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{title}</div>}
      <div style={{ width: size, height: size, borderRadius: "50%", background: C.border, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: 10, color: C.textLight }}>No data</span>
      </div>
    </div>
  );

  const r = (size - thickness) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circ = 2 * Math.PI * r;

  let offset = 0;
  const slices = data.map((d) => {
    const pct = d.value / total;
    const dash = pct * circ;
    const gap = circ - dash;
    const slice = { ...d, pct, dash, gap, offset };
    offset += dash;
    return slice;
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
      {title && <div style={{ fontSize: 12, fontWeight: 600, color: C.text, textAlign: "center" }}>{title}</div>}
      <div style={{ position: "relative", width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
          {slices.map((s, i) => (
            <circle
              key={i}
              cx={cx} cy={cy} r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={thickness}
              strokeDasharray={`${s.dash} ${s.gap}`}
              strokeDashoffset={-s.offset}
            />
          ))}
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: C.text, lineHeight: 1 }}>{total}</div>
          {subtitle && <div style={{ fontSize: 9, color: C.textLight, marginTop: 2 }}>{subtitle}</div>}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, width: "100%" }}>
        {data.map((d, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: d.color, flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: C.textMid }}>{d.label}</span>
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: C.text }}>{d.value}</span>
              <span style={{ fontSize: 10, color: C.textLight }}>{((d.value / total) * 100).toFixed(0)}%</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Metric Card ──────────────────────────────────────────────────────────────
function MetricCard({ label, value, sub, accent, tag, wide }) {
  const accentMap = {
    green: { text: C.green, bg: C.greenLight },
    red: { text: C.red, bg: C.redLight },
    amber: { text: C.amber, bg: C.amberLight },
    blue: { text: C.blue, bg: C.blueLight },
    purple: { text: C.purple, bg: C.purpleLight },
  };
  const a = accentMap[accent] || { text: C.text, bg: "transparent" };
  return (
    <div style={{
      background: C.surface,
      border: `1px solid ${C.border}`,
      borderRadius: 10,
      padding: "16px 18px",
      minWidth: 0,
      gridColumn: wide ? "span 2" : undefined,
    }}>
      <div style={{ fontSize: 11, color: C.textMid, fontWeight: 500, marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        {label}
        {tag && <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, background: a.bg, color: a.text, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>{tag}</span>}
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, color: a.text !== C.text ? a.text : C.text, lineHeight: 1, letterSpacing: -0.5 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: C.textLight, marginTop: 6 }}>{sub}</div>}
    </div>
  );
}

// ─── Section Label ────────────────────────────────────────────────────────────
function SectionLabel({ children }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, color: C.textMid, textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 12, marginTop: 4 }}>
      {children}
    </div>
  );
}

// ─── Card Container ───────────────────────────────────────────────────────────
function Card({ children, style }) {
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: "20px", ...style }}>
      {children}
    </div>
  );
}

const grid = (min) => ({
  display: "grid",
  gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))`,
  gap: 12,
});

// ─── TABS ─────────────────────────────────────────────────────────────────────
const TABS = [
  { id: "overview", label: "📊 Overview" },
  { id: "funnel", label: "🔁 Funnel" },
  { id: "sales", label: "💰 Sales" },
  { id: "unqualified", label: "❌ Unqualified" },
];

const PERIODS = [
  { v: "all", l: "Visi laikai" },
  { v: "7", l: "7 dienos" },
  { v: "30", l: "30 dienų" },
  { v: "90", l: "90 dienų" },
];

// ─── TAB: OVERVIEW ────────────────────────────────────────────────────────────
function OverviewTab({ kpi }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <SectionLabel>Applications</SectionLabel>
        <div style={grid(155)}>
          <MetricCard label="Iš viso" value={fmt(kpi.totalApps)} />
          <MetricCard label="Qualified ≥1k" value={fmt(kpi.qualifiedApps)} accent="green" sub={`${kpi.totalApps ? ((kpi.qualifiedApps/kpi.totalApps)*100).toFixed(1) : 0}% of total`} />
          <MetricCard label="Unqualified <1k" value={fmt(kpi.unqualifiedApps)} accent="amber" />
          <MetricCard label="Partial" value={fmt(kpi.partialApps)} sub={`${kpi.completionRate}% completion rate`} />
        </div>
      </div>

      <div>
        <SectionLabel>Calls</SectionLabel>
        <div style={grid(155)}>
          <MetricCard label="Booked Calls" value={fmt(kpi.booked)} />
          <MetricCard label="QA → Booked Rate" value={pct(kpi.qaToBookedRate)} accent="blue" tag="Key" sub="Booked / Qualified Apps" />
          <MetricCard label="Show Rate" value={pct(kpi.showRate)} accent={parseFloat(kpi.showRate) >= 60 ? "green" : "amber"} sub="Showed / Booked" />
          <MetricCard label="No Show Rate" value={pct(kpi.noShowRate)} accent="red" />
        </div>
      </div>

      <div>
        <SectionLabel>Revenue</SectionLabel>
        <div style={grid(155)}>
          <MetricCard label="Revenue" value={`€${fmt(kpi.revenue)}`} accent="green" />
          <MetricCard label="Cash Collected" value={`€${fmt(kpi.cash)}`} accent="green" />
          <MetricCard label="Close Rate" value={pct(kpi.closeRate)} accent={parseFloat(kpi.closeRate) >= 50 ? "green" : "red"} tag="Key" sub="Won / Showed" />
          <MetricCard label="Closed Won" value={fmt(kpi.won)} />
        </div>
      </div>

      <div>
        <SectionLabel>Pipeline Breakdown</SectionLabel>
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
          {kpi.pipelineBreakdown.map(({ label, count }, i) => (
            <div key={label} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "11px 18px",
              borderBottom: i < kpi.pipelineBreakdown.length - 1 ? `1px solid ${C.borderLight}` : "none",
            }}>
              <span style={{ fontSize: 13, color: C.textMid }}>{label}</span>
              <span style={{
                fontSize: 16, fontWeight: 700,
                color: label === "Closed Won" ? C.green : label === "No Show" ? C.red : label === "Closed Lost" ? C.red : C.text
              }}>{count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── TAB: FUNNEL ─────────────────────────────────────────────────────────────
function FunnelTab({ kpi }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <SectionLabel>Funnel Metrics</SectionLabel>
        <div style={grid(160)}>
          <MetricCard label="Applications" value={fmt(kpi.totalApps)} />
          <MetricCard label="Qualified Applications" value={`${kpi.totalApps ? ((kpi.qualifiedApps/kpi.totalApps)*100).toFixed(2) : 0}%`} accent="green" sub={`${fmt(kpi.qualifiedApps)} leads`} />
          <MetricCard label="Unqualified Applications" value={`${kpi.totalApps ? ((kpi.unqualifiedApps/kpi.totalApps)*100).toFixed(2) : 0}%`} accent="red" sub={`${fmt(kpi.unqualifiedApps)} leads`} />
          <MetricCard label="Partial Submissions" value={`${kpi.completionRate}%`} sub={`${fmt(kpi.partialApps)} partial`} />
          <MetricCard label="Booked Calls" value={fmt(kpi.booked)} />
          <MetricCard label="QA → Booked Rate" value={pct(kpi.qaToBookedRate)} accent="blue" sub="Booked / Qualified Apps" />

        </div>
      </div>

      <div>
        <SectionLabel>Funnel Source Tracking</SectionLabel>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <Card>
            <DonutChart
              data={kpi.appsBySource}
              size={140}
              thickness={30}
              title="Application Source"
              subtitle="apps"
            />
          </Card>
          <Card>
            <DonutChart
              data={kpi.bookedBySource}
              size={140}
              thickness={30}
              title="Booked Call Source"
              subtitle="booked"
            />
          </Card>
        </div>
      </div>

      <div>
        <SectionLabel>Instagram Breakdown</SectionLabel>
        {kpi.igMediums.length > 0 ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <Card>
              <DonutChart
                data={kpi.igMediums.map(d => ({ label: d.label, value: d.apps, color: d.color }))}
                size={140}
                thickness={30}
                title="IG Apps by Medium"
              />
            </Card>
            <Card>
              <DonutChart
                data={kpi.igMediums.map(d => ({ label: d.label, value: d.booked, color: d.color }))}
                size={140}
                thickness={30}
                title="IG Booked by Medium"
              />
            </Card>
          </div>
        ) : (
          <Card><div style={{ color: C.textLight, fontSize: 13, textAlign: "center", padding: "16px 0" }}>Nėra Instagram duomenų</div></Card>
        )}
      </div>

      {kpi.ytVideos.length > 0 && (
        <div>
          <SectionLabel>YouTube Video Breakdown</SectionLabel>
          <Card>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                    {["Video", "Apps", "Booked"].map(h => (
                      <th key={h} style={{ textAlign: h === "Video" ? "left" : "right", padding: "8px 12px", color: C.textMid, fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {kpi.ytVideos.map((v, i) => (
                    <tr key={i} style={{ borderBottom: `1px solid ${C.borderLight}` }}>
                      <td style={{ padding: "10px 12px", color: C.text, fontWeight: 500 }}>{v.label}</td>
                      <td style={{ padding: "10px 12px", textAlign: "right", color: C.text }}>{v.apps}</td>
                      <td style={{ padding: "10px 12px", textAlign: "right", color: v.booked > 0 ? C.green : C.textLight, fontWeight: v.booked > 0 ? 700 : 400 }}>{v.booked}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      <div>
        <SectionLabel>By Source — Full Breakdown</SectionLabel>
        {kpi.bySource.length === 0 ? (
          <Card><div style={{ color: C.textLight, fontSize: 13, textAlign: "center", padding: "16px 0" }}>Nėra duomenų</div></Card>
        ) : (
          <Card style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${C.border}`, background: C.bg }}>
                    {["Šaltinis","Apps","Qualified","Booked","QA→Booked","Showed","Show%"].map((h) => (
                      <th key={h} style={{ textAlign: h === "Šaltinis" ? "left" : "right", padding: "10px 14px", color: C.textMid, fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {kpi.bySource.map((r) => (
                    <tr key={r.key} style={{ borderBottom: `1px solid ${C.borderLight}` }}>
                      <td style={{ padding: "11px 14px", color: C.text, fontWeight: 600 }}>{r.label}</td>
                      <td style={{ padding: "11px 14px", color: C.text, textAlign: "right" }}>{r.apps}</td>
                      <td style={{ padding: "11px 14px", color: r.qualified > 0 ? C.green : C.textLight, textAlign: "right", fontWeight: r.qualified > 0 ? 600 : 400 }}>{r.qualified}</td>
                      <td style={{ padding: "11px 14px", color: C.text, textAlign: "right" }}>{r.booked}</td>
                      <td style={{ padding: "11px 14px", color: r.qaRate !== "-" ? C.blue : C.textLight, textAlign: "right", fontWeight: 600 }}>{r.qaRate}</td>
                      <td style={{ padding: "11px 14px", color: C.text, textAlign: "right" }}>{r.showed}</td>
                      <td style={{ padding: "11px 14px", color: r.showRate !== "-" ? C.green : C.textLight, textAlign: "right", fontWeight: 600 }}>{r.showRate}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

// ─── TAB: SALES ───────────────────────────────────────────────────────────────
function SalesTab({ kpi }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <SectionLabel>Revenue</SectionLabel>
        <div style={grid(160)}>
          <MetricCard label="Revenue Generated" value={`€${fmt(kpi.revenue)}`} accent="green" />
          <MetricCard label="Cash Collected" value={`€${fmt(kpi.cash)}`} accent="green" />
          <MetricCard label="Cash per Call Taken" value={`€${fmt(kpi.cashPerCall)}`} sub="Cash / Showed" />
          <MetricCard label="Average Order Value" value={`€${fmt(kpi.aov)}`} sub="Revenue / Won" />
          <MetricCard label="Cash to Collect" value={`€${fmt(kpi.cashToCollect)}`} accent={kpi.cashToCollect > 0 ? "amber" : undefined} />
        </div>
      </div>

      <div>
        <SectionLabel>Sales Call Metrics</SectionLabel>
        <div style={grid(160)}>
          <MetricCard label="Total Calls Confirmed" value={fmt(kpi.confirmed)} />
          <MetricCard label="Showed Up" value={fmt(kpi.showed)} />
          <MetricCard label="Total Close Rate" value={pct(kpi.closeRate)} accent={parseFloat(kpi.closeRate) >= 50 ? "green" : "red"} tag="Key" />
          <MetricCard label="Disqualification Rate" value={pct(kpi.disqualRate)} accent="amber" />
          <MetricCard label="No Show Rate" value={pct(kpi.noShowRate)} accent="red" />
          <MetricCard label="Show Rate" value={pct(kpi.showRate)} accent={parseFloat(kpi.showRate) >= 60 ? "green" : "amber"} />
        </div>
      </div>

      <div>
        <SectionLabel>Appointment Status Post Call</SectionLabel>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <Card>
            <DonutChart
              data={kpi.postCallStatus}
              size={140}
              thickness={30}
              title="Appointment Status"
              subtitle="calls"
            />
          </Card>
          <Card>
            <DonutChart
              data={kpi.bookedBySource}
              size={140}
              thickness={30}
              title="Confirmed Calls Source"
              subtitle="booked"
            />
          </Card>
        </div>
      </div>

      <div>
        <SectionLabel>Revenue by Source</SectionLabel>
        {kpi.bySource.length === 0 ? (
          <Card><div style={{ color: C.textLight, fontSize: 13, textAlign: "center", padding: "16px 0" }}>Nėra duomenų</div></Card>
        ) : (
          <Card style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${C.border}`, background: C.bg }}>
                    {["Šaltinis","Won","Close%","Revenue","Cash"].map((h) => (
                      <th key={h} style={{ textAlign: h === "Šaltinis" ? "left" : "right", padding: "10px 14px", color: C.textMid, fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {kpi.bySource.map((r) => (
                    <tr key={r.key} style={{ borderBottom: `1px solid ${C.borderLight}` }}>
                      <td style={{ padding: "11px 14px", color: C.text, fontWeight: 600 }}>{r.label}</td>
                      <td style={{ padding: "11px 14px", color: r.won > 0 ? C.green : C.textLight, textAlign: "right", fontWeight: 700 }}>{r.won}</td>
                      <td style={{ padding: "11px 14px", color: r.closeRate !== "-" ? C.green : C.textLight, textAlign: "right", fontWeight: 600 }}>{r.closeRate}</td>
                      <td style={{ padding: "11px 14px", color: r.revenue > 0 ? C.green : C.textLight, textAlign: "right", fontWeight: r.revenue > 0 ? 700 : 400 }}>€{fmt(r.revenue)}</td>
                      <td style={{ padding: "11px 14px", color: r.cash > 0 ? C.text : C.textLight, textAlign: "right" }}>€{fmt(r.cash)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      <div>
        <SectionLabel>Investment Capacity</SectionLabel>
        <div style={grid(130)}>
          {kpi.invSplit.map(({ tier, count }) => (
            <MetricCard
              key={tier}
              label={`Investicija: ${tier}`}
              value={fmt(count)}
              accent={tier === "<1k" ? "amber" : tier === "3k+" ? "green" : "blue"}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── TAB: UNQUALIFIED ────────────────────────────────────────────────────────
function UnqualifiedTab({ kpi }) {
  const convRate = kpi.unqualTotal ? ((kpi.bookedToSales / kpi.unqualTotal) * 100).toFixed(1) : "0.0";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <SectionLabel>Unqualified Pipeline Overview</SectionLabel>
        <div style={grid(160)}>
          <MetricCard label="Iš viso <1k" value={fmt(kpi.unqualTotal)} accent="amber" />
          <MetricCard label="💎 Worth Dialing" value={fmt(kpi.worthDialing)} accent="amber" sub="Reikia skambinti" />
          <MetricCard label="📋 Qualified for Call" value={fmt(kpi.qualifiedForCall)} accent="blue" sub="Patvirtinti" />
          <MetricCard label="🚀 Booked → Sales" value={fmt(kpi.bookedToSales)} accent="green" sub="Perkelti į main" />
          <MetricCard label="🗑 Dead" value={fmt(kpi.dead)} />
          <MetricCard label="Konversija į Sales" value={`${convRate}%`} accent={parseFloat(convRate) >= 10 ? "green" : "amber"} sub="Booked → Sales / Total" />
        </div>
      </div>

      <div>
        <SectionLabel>Funnel vizualizacija</SectionLabel>
        <Card>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[
              { label: "Iš viso <1k", value: kpi.unqualTotal, color: C.amber, max: kpi.unqualTotal },
              { label: "Worth Dialing", value: kpi.worthDialing, color: "#F59E0B", max: kpi.unqualTotal },
              { label: "Qualified for Call", value: kpi.qualifiedForCall, color: C.blue, max: kpi.unqualTotal },
              { label: "Booked → Sales", value: kpi.bookedToSales, color: C.green, max: kpi.unqualTotal },
            ].map((row) => (
              <div key={row.label}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 12, color: C.textMid }}>{row.label}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: row.color }}>{row.value}</span>
                </div>
                <div style={{ height: 8, background: C.borderLight, borderRadius: 4, overflow: "hidden" }}>
                  <div style={{
                    height: "100%",
                    width: `${row.max > 0 ? (row.value / row.max) * 100 : 0}%`,
                    background: row.color,
                    borderRadius: 4,
                    transition: "width 0.4s ease",
                  }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div>
        <SectionLabel>Instrukcijos</SectionLabel>
        <Card>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {[
              { step: "1", label: "Worth Dialing", desc: "Skambink, bandyk perrašyti prieštaravimą dėl kainos. Jei parodo potencialo — perkelk į Qualified for Call.", color: C.amber },
              { step: "2", label: "Qualified for Call", desc: "Suderintas konkretus laikas. Išsiuntė pre-call content. Laukia skambučio.", color: C.blue },
              { step: "3", label: "Booked → Sales", desc: "Rezervuotas laikas main sales pipeline. Jei uždaro — Closed Won šiame pipeline. Jei ne — grąžink atgal.", color: C.green },
              { step: "4", label: "Dead", desc: "Nebesusisiekiama, kategoriška 'ne', finansiškai neįmanoma. Archyvuojama.", color: C.textLight },
            ].map((s) => (
              <div key={s.step} style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                <div style={{ width: 28, height: 28, borderRadius: 8, background: s.color + "22", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: s.color }}>{s.step}</span>
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 2 }}>{s.label}</div>
                  <div style={{ fontSize: 12, color: C.textMid, lineHeight: 1.5 }}>{s.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

// ─── APP ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [leads, setLeads] = useState([]);
  const [apps, setApps] = useState([]);
  const [scopes, setScopes] = useState([]);
  const [unquals, setUnquals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [filterSource, setFilterSource] = useState("all");
  const [filterPeriod, setFilterPeriod] = useState("all");
  const [activeTab, setActiveTab] = useState("overview");

  const load = useCallback(async () => {
    try {
      setLoading(true); setError(null);
      const [leadRows, appRows, scopeRows, unqualRows] = await Promise.all([
        fetchRange("Raw_Leads!A:R"),
        fetchRange("Raw_Applications!A:M"),
        fetchRange("source-scopes!A:B"),
        fetchRange("Raw_Unqualified!A:L").catch(() => []),
      ]);
      setLeads(rowsToObjects(leadRows));
      setApps(rowsToObjects(appRows));
      setScopes(scopeRows);
      setUnquals(rowsToObjects(unqualRows));
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

  const kpi = compute(leads, apps, scopes, filterSource, filterPeriod, unquals);

  const selStyle = {
    background: C.surface,
    border: `1px solid ${C.border}`,
    color: C.text,
    borderRadius: 8,
    padding: "7px 12px",
    fontSize: 13,
    cursor: "pointer",
    outline: "none",
    fontFamily: "inherit",
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "'Inter', system-ui, sans-serif" }}>
      {/* Top Header */}
      <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: "0 24px" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 16, paddingBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <img src={logo} alt="PlugInfo" style={{ height: 32, width: 32, objectFit: "contain" }} />
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>Danas — Sales Dashboard</div>
                <div style={{ fontSize: 11, color: C.textLight }}>
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
              <button onClick={load} disabled={loading} style={{ ...selStyle, padding: "7px 16px", opacity: loading ? 0.5 : 1, fontWeight: 600 }}>
                {loading ? "⟳" : "↻ Refresh"}
              </button>
            </div>
          </div>

          {/* Tab Bar */}
          <div style={{ display: "flex", gap: 0 }}>
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  background: "none",
                  border: "none",
                  borderBottom: activeTab === tab.id ? `2px solid ${C.tabActive}` : "2px solid transparent",
                  padding: "10px 20px",
                  fontSize: 13,
                  fontWeight: activeTab === tab.id ? 700 : 500,
                  color: activeTab === tab.id ? C.text : C.textMid,
                  cursor: "pointer",
                  transition: "all 0.15s",
                  fontFamily: "inherit",
                  whiteSpace: "nowrap",
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px" }}>
        {error && (
          <div style={{ background: "#FEF3C7", border: "1px solid #FCD34D", borderRadius: 8, padding: "12px 16px", marginBottom: 20, color: C.amber, fontSize: 13 }}>
            ⚠ {error}
          </div>
        )}

        {loading && (
          <div style={{ textAlign: "center", padding: 60, color: C.textLight, fontSize: 13 }}>
            Kraunami duomenys...
          </div>
        )}

        {!loading && !error && (
          <>
            {activeTab === "overview" && <OverviewTab kpi={kpi} />}
            {activeTab === "funnel" && <FunnelTab kpi={kpi} />}
            {activeTab === "sales" && <SalesTab kpi={kpi} />}
            {activeTab === "unqualified" && <UnqualifiedTab kpi={kpi} />}
          </>
        )}
      </div>

      <div style={{ textAlign: "center", fontSize: 11, color: C.textLight, padding: "16px 0 24px", borderTop: `1px solid ${C.border}` }}>
        [PlugInfo] × Danas · Live data · Google Sheets
      </div>
    </div>
  );
}


