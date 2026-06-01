import { useState, useEffect, useCallback, useRef, Fragment } from "react";
import { UserButton } from "@clerk/clerk-react";
import { useAppRole, useNickname } from "./src/useAppRole.js";

const MAX_ACTIVITY = 50;

const defaultAssignee = (teamProfile) => {
  const resolved = resolveTeamProfile(teamProfile);
  return resolved && TEAM.some(t => t.name === resolved) ? resolved : TEAM[0].name;
};

// ─── PALETTE ─────────────────────────────────────────────────────────────────
const C = {
  bg:          "#0C0C10",
  surface:     "#14141A",
  surfaceUp:   "#1C1C24",
  surfaceHigh: "#23232D",
  border:      "#2A2A36",
  borderSub:   "#222230",
  text:        "#F0F0F6",
  textMid:     "#9494B0",
  textDim:     "#56566A",
  accent:      "#8B7FFF",
  accentBg:    "rgba(139,127,255,0.14)",
  accentBord:  "rgba(139,127,255,0.35)",
  green:       "#34D399",
  red:         "#F87171",
  amber:       "#FBBF24",
};

// ─── DATA ────────────────────────────────────────────────────────────────────
const STAGES = [
  { id: "concept",    label: "Concept",    dot: "#6B7280" },
  { id: "design_dev", label: "Design",     dot: "#818CF8" },
  { id: "awaiting_sales", label: "Awaiting Sales", dot: "#FBBF24" },
  { id: "tech_pack",  label: "Tech Pack",  dot: "#60A5FA" },
  { id: "sampling",   label: "Sampling",   dot: "#C084FC" },
  { id: "revision",   label: "Revision",   dot: "#FB923C" },
  { id: "prod_ready", label: "Prod Ready", dot: "#34D399" },
  { id: "archived",   label: "Archived",   dot: "#374151" },
];

const PRES_STAGES = [
  { id: "brief",    label: "Brief",          dot: "#6B7280" },
  { id: "building", label: "Building",       dot: "#FBBF24" },
  { id: "review",   label: "Int. Review",    dot: "#8B7FFF" },
  { id: "sent",     label: "Sent",           dot: "#60A5FA" },
  { id: "picks_in", label: "Picks In",       dot: "#34D399" },
  { id: "archived", label: "Archived",       dot: "#374151" },
];

const CATEGORIES = [
  { id: "all",         label: "All",        color: null },
  { id: "apparel",     label: "Apparel",    color: "#FF7A52" },
  { id: "accessories", label: "Accessories",color: "#C084FC" },
  { id: "bags",        label: "Bags",       color: "#34D399" },
  { id: "home_goods",  label: "Home Goods", color: "#60A5FA" },
];
const catColor = (id) => CATEGORIES.find(c => c.id === id)?.color || "#56566A";
const catLabel = (id) => CATEGORIES.find(c => c.id === id)?.label || id;

const PRIORITIES = [
  { id: "", label: "None", color: null },
  { id: "high", label: "High", color: "#FBBF24" },
  { id: "urgent", label: "Urgent", color: "#F87171" },
];
const priorityOf = (p) => PRIORITIES.find(x => x.id === (p?.priority || "")) || PRIORITIES[0];
const hasPriority = (p) => p?.priority === "high" || p?.priority === "urgent";
const isPresentationProject = (p) => p?.projectType === "presentation";
const isWaitingOnSalesProduct = (p) => !isPresentationProject(p) && (!!p?.waitingOnSales || p?.stage === "awaiting_sales");
const isWaitingOnLicenses = (p) => isPresentationProject(p) && !!p?.waitingOnLicenses;
const isWaitingOnSalesInfo = (p) => isPresentationProject(p) && !!p?.waitingOnSales;
const isBlockedBySales = (p) => isWaitingOnSalesProduct(p) || isWaitingOnLicenses(p) || isWaitingOnSalesInfo(p);
const prioritySortKey = (p) => (p?.priority === "urgent" ? 2 : p?.priority === "high" ? 1 : 0);

function sortProjectsForBoard(items) {
  return [...items].sort((a, b) => {
    const pd = prioritySortKey(b) - prioritySortKey(a);
    if (pd !== 0) return pd;
    return (a.title || "").localeCompare(b.title || "", undefined, { sensitivity: "base" });
  });
}

const TEAM = [
  { name: "Candace O.", color: "#F472B6" },
  { name: "Anthony C.", color: "#34D399" },
  { name: "Flavia N.",  color: "#C084FC" },
  { name: "Angel S.",   color: "#60A5FA" },
  { name: "Rafa C.",    color: "#8B7FFF" },
];
const teamColor = (name) => TEAM.find(t => t.name === name)?.color || "#9494B0";

/** Match Clerk teamName to board name (exact, case, or first name e.g. "Flavia" → "Flavia N.") */
const resolveTeamProfile = (raw) => {
  if (!raw?.trim()) return null;
  const t = raw.trim();
  const exact = TEAM.find(m => m.name === t);
  if (exact) return exact.name;
  const lower = t.toLowerCase();
  const ci = TEAM.find(m => m.name.toLowerCase() === lower);
  if (ci) return ci.name;
  const first = lower.split(/\s+/)[0];
  const fuzzy = TEAM.find(m => {
    const mn = m.name.toLowerCase();
    return mn === lower || mn.startsWith(`${first} `) || mn.split(" ")[0] === first;
  });
  return fuzzy ? fuzzy.name : t;
};

/** Who is viewing the board — must match a TEAM strip name for assignee glow */
function resolveViewerTeamName(boardName, nickname) {
  for (const raw of [nickname, boardName]) {
    if (!raw?.trim()) continue;
    const resolved = resolveTeamProfile(raw.trim());
    if (TEAM.some(t => t.name === resolved)) return resolved;
  }
  return null;
}

const projectAssignees = (p) => {
  if (!p) return [];
  if (Array.isArray(p.assignees) && p.assignees.length) {
    return [...new Set(p.assignees.filter(n => TEAM.some(t => t.name === n)))];
  }
  if (p.assignee && TEAM.some(t => t.name === p.assignee)) return [p.assignee];
  return [];
};
const projectHasAssignee = (p, name) => projectAssignees(p).includes(name);
const assigneesLabel = (names) =>
  names.length <= 2 ? names.join(", ") : `${names[0]} +${names.length - 1}`;
const normalizeProjectForSave = (p) => {
  const assignees = projectAssignees(p);
  const { assignee: _legacy, ...rest } = p;
  return { ...rest, assignees: assignees.length ? assignees : [TEAM[0].name] };
};

const PROJ_HIGHLIGHT_SEEN_PREFIX = "st_proj_highlight_seen_";

function loadProjectHighlightSeen(userId) {
  if (!userId) return {};
  try {
    const raw = localStorage.getItem(`${PROJ_HIGHLIGHT_SEEN_PREFIX}${userId}`);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveProjectHighlightSeen(userId, map) {
  if (!userId) return;
  try {
    localStorage.setItem(`${PROJ_HIGHLIGHT_SEEN_PREFIX}${userId}`, JSON.stringify(map));
  } catch {
    /* ignore quota / private mode */
  }
}

/** Glow only for assignees — until they click to acknowledge */
function shouldGlowProjectForViewer(p, seenMap, viewerName) {
  if (!p?.id || !viewerName) return false;
  const assignees = projectAssignees(p);
  if (!assignees.includes(viewerName)) return false;

  const assignSeen = seenMap[`${p.id}:assign`];
  if (p.assignHighlightAt && assignSeen !== p.assignHighlightAt) {
    const forNames = Array.isArray(p.assignHighlightFor) ? p.assignHighlightFor : null;
    if (forNames === null) return true;
    if (forNames.includes(viewerName)) return true;
  }
  const highlightSeen = seenMap[p.id];
  if (p.highlightAt && highlightSeen !== p.highlightAt) return true;
  return false;
}

function projectHighlightSeenKeys(project) {
  const keys = {};
  if (project?.highlightAt) keys[project.id] = project.highlightAt;
  if (project?.assignHighlightAt) keys[`${project.id}:assign`] = project.assignHighlightAt;
  return keys;
}

const SEASONS = ["SS25", "FW25", "SS26", "FW26", "Resort 26", "Evergreen"];

const SEED = [];

const ALL_STAGES = [...STAGES, ...PRES_STAGES.filter(s => s.id !== "archived")];
const stageOf   = (id) => ALL_STAGES.find(s => s.id === id) || STAGES[0];
const isPresStage = (id) => PRES_STAGES.some(s => s.id === id);
const isProdStage = (id) => STAGES.some(s => s.id === id);

/** Rough stage mapping when moving between Products and Presentations boards */
const STAGE_CROSS_MAP = {
  concept: "brief",
  design_dev: "building",
  awaiting_sales: "building",
  tech_pack: "review",
  sampling: "review",
  revision: "review",
  prod_ready: "picks_in",
  archived: "archived",
  brief: "concept",
  building: "design_dev",
  review: "tech_pack",
  sent: "sampling",
  picks_in: "prod_ready",
};

function mapStageForBoardChange(stage, targetType) {
  if (targetType === "presentation") {
    if (isPresStage(stage)) return stage;
    return STAGE_CROSS_MAP[stage] || "brief";
  }
  if (isProdStage(stage)) return stage;
  return STAGE_CROSS_MAP[stage] || "concept";
}

function convertProjectBetweenBoards(p, targetType) {
  const current = p.projectType === "presentation" ? "presentation" : "product";
  if (current === targetType) return p;
  const nextStage = mapStageForBoardChange(p.stage, targetType);
  if (targetType === "presentation") {
    const { sourcePresId: _s, ...rest } = p;
    return {
      ...rest,
      projectType: "presentation",
      stage: nextStage,
      styleNumbers: [],
    };
  }
  const { customer: _c, presentationId: _p, ...rest } = p;
  return {
    ...rest,
    projectType: "product",
    stage: nextStage,
  };
}
const initials  = (name) => name.split(" ").map(w => w[0]).join("");
// Date inputs are YYYY-MM-DD — parse as local midnight (not UTC) to match calendar view
const parseLocalDate = (d) => {
  if (!d) return null;
  const s = String(d).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T00:00:00`);
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};
const fmt       = (d) => {
  const x = parseLocalDate(d);
  return x ? x.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—";
};
const daysUntil = (d) => {
  const due = parseLocalDate(d);
  if (!due) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  return Math.round((due - today) / 86400000);
};

const stopCardClick = (e) => e.stopPropagation();

const normalizeStyleEntries = (v) => {
  if (!v) return [];
  const raw = Array.isArray(v) ? v : String(v).split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    let entry;
    if (typeof item === "string") entry = { label: item, url: "" };
    else if (item && typeof item === "object") {
      entry = {
        label: String(item.label ?? item.sku ?? "").trim(),
        url: String(item.url ?? item.link ?? "").trim(),
      };
    } else continue;
    if (!entry.label || seen.has(entry.label)) continue;
    seen.add(entry.label);
    out.push(entry);
  }
  return out;
};
const styleNumbersOf = (p) =>
  normalizeStyleEntries(p?.styleNumbers).flatMap(e => [e.label, e.url].filter(Boolean));

const skuLabels = (p) => normalizeStyleEntries(p?.styleNumbers).map(e => e.label);

function activityActor(teamProfile, user) {
  if (teamProfile) return teamProfile;
  if (user?.fullName?.trim()) return user.fullName.trim();
  const email = user?.primaryEmailAddress?.emailAddress;
  if (email) return email.split("@")[0];
  return "Team member";
}

function formatActivityTime(iso) {
  const d = new Date(iso);
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString("en-US", {
    month: "short", day: "numeric",
    year: d.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
  });
}

function newActivityEntry(by, text) {
  return {
    id: `a${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    at: new Date().toISOString(),
    by,
    text,
  };
}

function diffProjectActivity(prev, next, by) {
  if (!prev) return [newActivityEntry(by, "Created project")];
  const entries = [];
  if (prev.stage !== next.stage) {
    entries.push(newActivityEntry(by, `Moved to ${stageOf(next.stage).label}`));
  }
  const prevAs = projectAssignees(prev);
  const nextAs = projectAssignees(next);
  if (prevAs.join("\0") !== nextAs.join("\0")) {
    const added = nextAs.filter(n => !prevAs.includes(n));
    const removed = prevAs.filter(n => !nextAs.includes(n));
    if (added.length) entries.push(newActivityEntry(by, `Added to team: ${added.join(", ")}`));
    if (removed.length) entries.push(newActivityEntry(by, `Removed from team: ${removed.join(", ")}`));
  }
  if (prev.title !== next.title) {
    entries.push(newActivityEntry(by, `Renamed to “${next.title}”`));
  }
  if (prev.category !== next.category) {
    entries.push(newActivityEntry(by, `Category → ${catLabel(next.category)}`));
  }
  if (prev.season !== next.season) {
    entries.push(newActivityEntry(by, `Season → ${next.season}`));
  }
  if ((prev.priority || "") !== (next.priority || "")) {
    const label = priorityOf(next).label;
    entries.push(newActivityEntry(by, label === "None" ? "Cleared priority" : `Priority → ${label}`));
  }
  if (!!prev.waitingOnSales !== !!next.waitingOnSales) {
    const salesLabel = next.projectType === "presentation"
      ? (next.waitingOnSales ? "Marked awaiting sales info" : "Cleared awaiting sales info")
      : (next.waitingOnSales ? "Marked waiting on sales" : "Cleared waiting on sales");
    entries.push(newActivityEntry(by, salesLabel));
  }
  if (!!prev.waitingOnLicenses !== !!next.waitingOnLicenses) {
    entries.push(newActivityEntry(by, next.waitingOnLicenses ? "Marked needs licenses from sales" : "Cleared license hold"));
  }
  if ((prev.dueDate || "") !== (next.dueDate || "")) {
    entries.push(newActivityEntry(by, next.dueDate ? `Due date → ${fmt(next.dueDate)}` : "Cleared due date"));
  }
  if ((prev.startDate || "") !== (next.startDate || "")) {
    entries.push(newActivityEntry(by, next.startDate ? `Start date → ${fmt(next.startDate)}` : "Cleared start date"));
  }
  if ((prev.notes || "") !== (next.notes || "")) {
    entries.push(newActivityEntry(by, "Updated status notes"));
  }
  const prevSku = skuLabels(prev).join("|");
  const nextSku = skuLabels(next).join("|");
  if (prevSku !== nextSku) {
    const prevSet = new Set(skuLabels(prev));
    const nextSet = new Set(skuLabels(next));
    const added = skuLabels(next).filter(l => !prevSet.has(l));
    const removed = skuLabels(prev).filter(l => !nextSet.has(l));
    if (added.length) {
      entries.push(newActivityEntry(by, `Added SKU${added.length > 1 ? "s" : ""}: ${added.join(", ")}`));
    }
    if (removed.length) {
      entries.push(newActivityEntry(by, `Removed SKU${removed.length > 1 ? "s" : ""}: ${removed.join(", ")}`));
    }
  }
  if ((prev.sourcePresId || "") !== (next.sourcePresId || "")) {
    if (!next.sourcePresId) entries.push(newActivityEntry(by, "Unlinked source presentation"));
    else entries.push(newActivityEntry(by, "Linked to a source presentation"));
  }
  const prevType = prev.projectType === "presentation" ? "presentation" : "product";
  const nextType = next.projectType === "presentation" ? "presentation" : "product";
  if (prevType !== nextType) {
    entries.push(newActivityEntry(by, nextType === "presentation" ? "Moved to Presentations board" : "Moved to Products board"));
  }
  return entries;
}

function withActivity(prev, next, by) {
  const added = diffProjectActivity(prev, next, by);
  if (!added.length) return next;
  const activity = [...added, ...(next.activity || prev?.activity || [])].slice(0, MAX_ACTIVITY);
  return { ...next, activity };
}

function diffLicActivity(prev, next, by, projects) {
  if (!prev) return [newActivityEntry(by, "Created request")];
  const entries = [];

  const prevType = prev.type || "general";
  const nextType = next.type || "general";
  if (prevType !== nextType) {
    entries.push(newActivityEntry(by, `Type → ${licTypeOf(nextType).label}`));
  }

  const prevStatus = prev.status || "open";
  const nextStatus = next.status || "open";
  if (prevStatus !== nextStatus) {
    entries.push(newActivityEntry(by, nextStatus === "done" ? "Marked done" : "Reopened"));
  }

  const prevProjectId = prev.projectId || "";
  const nextProjectId = next.projectId || "";
  if (prevProjectId !== nextProjectId) {
    const title = nextProjectId ? (projects?.find(p => p.id === nextProjectId)?.title || "a project") : "";
    entries.push(newActivityEntry(by, nextProjectId ? `Linked to ${title}` : "Unlinked project"));
  }

  if ((prev.skuText || "").trim() !== (next.skuText || "").trim()) {
    entries.push(newActivityEntry(by, "Updated requested SKU(s)"));
  }

  const prevArtSku = skuLabels({ styleNumbers: prev.styleNumbers }).join("|");
  const nextArtSku = skuLabels({ styleNumbers: next.styleNumbers }).join("|");
  if (prevArtSku !== nextArtSku) {
    const prevSet = new Set(skuLabels({ styleNumbers: prev.styleNumbers }));
    const nextSet = new Set(skuLabels({ styleNumbers: next.styleNumbers }));
    const added = skuLabels({ styleNumbers: next.styleNumbers }).filter(l => !prevSet.has(l));
    const removed = skuLabels({ styleNumbers: prev.styleNumbers }).filter(l => !nextSet.has(l));
    if (added.length) {
      entries.push(newActivityEntry(by, `Art added SKU${added.length > 1 ? "s" : ""}: ${added.join(", ")}`));
    }
    if (removed.length) {
      entries.push(newActivityEntry(by, `Art removed SKU${removed.length > 1 ? "s" : ""}: ${removed.join(", ")}`));
    }
  }

  if ((prev.message || "").trim() !== (next.message || "").trim()) {
    entries.push(newActivityEntry(by, "Updated request message"));
  }

  if ((prev.resolutionNote || "").trim() !== (next.resolutionNote || "").trim()) {
    entries.push(newActivityEntry(by, "Updated resolution note"));
  }

  return entries;
}

function withLicActivity(prev, next, by, projects) {
  const added = diffLicActivity(prev, next, by, projects);
  if (!added.length) return next;
  const activity = [...added, ...(next.activity || prev?.activity || [])].slice(0, MAX_ACTIVITY);
  return { ...next, activity };
}

const LINK_MARKDOWN_RE = /\[([^\]]+)\]\(([^)]+)\)|(https?:\/\/[^\s<>"{}|\\^`[\]]+)/g;

function LinkedText({ text, className = "" }) {
  if (!text?.trim()) return null;
  const nodes = [];
  let last = 0;
  let m;
  const re = new RegExp(LINK_MARKDOWN_RE.source, "g");
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(<span key={`t-${last}`}>{text.slice(last, m.index)}</span>);
    const label = m[1] ?? m[3];
    const url = (m[2] ?? m[3]).trim();
    nodes.push(
      <a key={`l-${m.index}`} href={url} target="_blank" rel="noopener noreferrer"
        className="text-link" onClick={stopCardClick}>{label}</a>
    );
    last = re.lastIndex;
  }
  if (last < text.length) nodes.push(<span key={`t-${last}`}>{text.slice(last)}</span>);
  return <span className={`linked-text ${className}`.trim()}>{nodes}</span>;
}

function StyleSkuSection({ value, onChange, canEdit, label = "Style numbers", emptyHint = "Add SKUs with Centric links below" }) {
  const entries = normalizeStyleEntries(value);
  const [draftLabel, setDraftLabel] = useState("");
  const [draftUrl, setDraftUrl] = useState("");
  const add = () => {
    const label = draftLabel.trim();
    const url = draftUrl.trim();
    if (!label || !url || entries.some(e => e.label === label)) {
      setDraftLabel("");
      setDraftUrl("");
      return;
    }
    onChange([...entries, { label, url }]);
    setDraftLabel("");
    setDraftUrl("");
  };
  if (!canEdit && !entries.length) return null;
  return (
    <div className="sku-below-comments">
      <div className="field-label">{label}</div>
      {entries.length > 0 ? (
        <ul className="sku-link-list">
          {entries.map((e, i) => (
            <li key={`${e.label}-${i}`} className="sku-link-item">
              <a href={e.url} target="_blank" rel="noopener noreferrer" className="sku-hyperlink">{e.label}</a>
              {canEdit && (
                <button type="button" className="sku-remove-text"
                  onClick={() => onChange(entries.filter((_, j) => j !== i))}>Remove</button>
              )}
            </li>
          ))}
        </ul>
      ) : canEdit ? (
        <div className="sku-empty-hint">{emptyHint}</div>
      ) : null}
      {canEdit && (
        <div className="sku-add-row">
          <input value={draftLabel} onChange={e => setDraftLabel(e.target.value)} className="ui-input"
            placeholder="SKU" onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
          <input value={draftUrl} onChange={e => setDraftUrl(e.target.value)} className="ui-input"
            placeholder="Centric URL" onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
          <button type="button" className="btn-add-sku" onClick={add} disabled={!draftLabel.trim() || !draftUrl.trim()}>Add</button>
        </div>
      )}
    </div>
  );
}

function StyleSkuCardLinks({ numbers, max = 3 }) {
  const entries = normalizeStyleEntries(numbers).filter(e => e.url);
  if (!entries.length) return null;
  const shown = entries.slice(0, max);
  const extra = entries.length - shown.length;
  return (
    <div className="card-sku-chips">
      {shown.map((e, i) => (
        <a key={`${e.label}-${i}`} href={e.url} target="_blank" rel="noopener noreferrer"
          className="sku-chip sku-chip-link" onClick={stopCardClick} title={e.url}>{e.label}</a>
      ))}
      {extra > 0 && <span className="sku-chip sku-chip-more">+{extra}</span>}
    </div>
  );
}

async function load() {
  try {
    const r = await window.storage.get("st_v10");
    const raw = r ? JSON.parse(r.value) : SEED;
    return Array.isArray(raw) ? raw.map(normalizeProjectForSave) : SEED;
  } catch { return SEED; }
}
async function save(p) {
  const next = Array.isArray(p) ? p.map(normalizeProjectForSave) : p;
  await window.storage.set("st_v10", JSON.stringify(next));
}

// ─── SELECT SETS DATA ────────────────────────────────────────────────────────
const CUSTOMERS = [
  { id: "walmart",  name: "Walmart",           color: "#0071CE" },
  { id: "tjx",      name: "TJX",               color: "#CC2929" },
  { id: "costco",   name: "Costco",             color: "#E8232A" },
  { id: "gt",       name: "Giant Tiger",        color: "#F5A00A" },
  { id: "amazon",   name: "Amazon",             color: "#FF9900" },
  { id: "marks",    name: "Marks",              color: "#1E4FA3" },
  { id: "shoppers", name: "Shoppers Drug Mart", color: "#C8006C" },
];
const SS_STATUS = [
  { id: "active",   label: "Active",    dot: "#34D399" },
  { id: "review",   label: "In Review", dot: "#FBBF24" },
  { id: "approved", label: "Approved",  dot: "#8B7FFF" },
  { id: "hold",     label: "On Hold",   dot: "#F87171" },
];
const ssStatusOf = (id) => SS_STATUS.find(s => s.id === id) || SS_STATUS[0];
async function loadSS() { try { const r = await window.storage.get("ss_v1"); return r ? JSON.parse(r.value) : []; } catch { return []; } }
async function saveSS(s) { await window.storage.set("ss_v1", JSON.stringify(s)); }

// ─── LICENSING REQUESTS ───────────────────────────────────────────────────────
const LIC_TYPES = [
  { id: "resubmit_sku", label: "Resubmit SKU", dot: "#FBBF24" },
  { id: "new_sku",      label: "New SKU",      dot: "#60A5FA" },
  { id: "general",      label: "General",      dot: "#8B7FFF" },
];
const licTypeOf = (id) => LIC_TYPES.find(t => t.id === id) || LIC_TYPES[0];

async function loadLic() { try { const r = await window.storage.get("lic_v1"); return r ? JSON.parse(r.value) : []; } catch { return []; } }
async function saveLic(reqs) { await window.storage.set("lic_v1", JSON.stringify(reqs)); }

function AssigneeAvatars({ project, size = "sm", maxShow = 3, compact = false }) {
  const names = projectAssignees(project);
  if (!names.length) return null;
  const shown = names.slice(0, maxShow);
  const extra = names.length - shown.length;
  return (
    <div className={`assignee-avatars ${compact ? "compact" : ""}`}>
      <div className="av-stack">
        {shown.map(n => (
          <span key={n} className={`av av-${size}`} style={{ background: teamColor(n) }} title={n}>
            {initials(n)}
          </span>
        ))}
        {extra > 0 && <span className={`av av-${size} av-more`} title={names.slice(maxShow).join(", ")}>+{extra}</span>}
      </div>
      {!compact && <span className="card-name" title={names.join(", ")}>{assigneesLabel(names)}</span>}
    </div>
  );
}

function AssigneePicker({ assignees, onChange, readOnly }) {
  const selected = projectAssignees({ assignees });
  const toggle = (name) => {
    if (readOnly) return;
    if (selected.includes(name)) {
      if (selected.length <= 1) return;
      onChange(selected.filter(n => n !== name));
    } else {
      onChange([...selected, name]);
    }
  };
  return (
    <div className="assignee-picker">
      {TEAM.map(t => {
        const on = selected.includes(t.name);
        return (
          <button key={t.name} type="button" disabled={readOnly}
            className={`assignee-pick-btn ${on ? "on" : ""}`}
            style={{ "--tc": t.color }}
            onClick={() => toggle(t.name)}>
            <span className="av av-xs" style={{ background: t.color }}>{initials(t.name)}</span>
            {t.name}
          </button>
        );
      })}
      {!readOnly && <div className="field-hint">Select everyone working on this project</div>}
    </div>
  );
}

// ─── HEADER NICKNAME (local, per user) ───────────────────────────────────────
function HeaderNickname({ userId, colorName }) {
  const { nickname, setNickname } = useNickname(userId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const display = nickname.trim();
  const open = () => {
    setDraft(nickname);
    setEditing(true);
  };
  const save = () => {
    setNickname(draft);
    setEditing(false);
  };
  const color = teamColor(colorName) || "#8B7FFF";
  return (
    <div className="header-profile-wrap">
      <button type="button" className="header-profile" onClick={open} title="Click to set your nickname">
        <span className="av av-sm" style={{ background: color }}>{initials(display || "?")}</span>
        <span className={`header-profile-name ${display ? "" : "muted"}`}>
          {display || "Add nickname"}
        </span>
      </button>
      {editing && (
        <>
          <div className="nick-pop-backdrop" onClick={() => setEditing(false)} />
          <div className="nick-pop">
            <div className="nick-pop-title">Your nickname</div>
            <input
              className="ui-input"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              placeholder="e.g. Anthony C. (match Team strip)"
              autoFocus
              maxLength={32}
              onKeyDown={e => {
                if (e.key === "Enter") { e.preventDefault(); save(); }
                if (e.key === "Escape") setEditing(false);
              }}
            />
            <div className="nick-pop-actions">
              <button type="button" className="btn-primary nick-save" onClick={save}>Save</button>
              <button type="button" className="btn-cancel" onClick={() => setEditing(false)}>Cancel</button>
            </div>
            <p className="nick-pop-hint">Only you see this — saved on this device</p>
          </div>
        </>
      )}
    </div>
  );
}

// ─── HEATMAP CARD ────────────────────────────────────────────────────────────
function HeatmapCard({ projects }) {
  const active = projects.filter(p => p.stage !== "archived");
  const loadColor = (n) => n === 0 ? "#3A3A50" : n <= 2 ? "#34D399" : n <= 4 ? "#FBBF24" : "#F87171";

  return (
    <div className="stat heatmap-card" style={{ marginLeft: "auto" }}>
      <div className="stat-label" style={{ marginBottom: 10 }}>Team Load</div>
      <div className="hm-chips">
        {TEAM.map(t => {
          const count = active.filter(p => projectHasAssignee(p, t.name)).length;
          const color = loadColor(count);
          return (
            <div key={t.name} className="hm-chip"
              title={`${t.name} · ${count} active project${count !== 1 ? "s" : ""}`}>
              <span className="av av-sm" style={{ background: t.color }}>{initials(t.name)}</span>
              <span className="hm-chip-count" style={{ color }}>{count}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── SIGNAL FILTERS & DRAWER TOGGLES ─────────────────────────────────────────
function SignalFilterChip({ active, tone, label, count, onClick, title }) {
  return (
    <button
      type="button"
      className={`signal-chip ${tone} ${active ? "on" : ""}`}
      onClick={onClick}
      title={title}
    >
      <span className="signal-dot" aria-hidden />
      <span className="signal-label">{label}</span>
      {count != null && count > 0 && <span className="signal-count">{count}</span>}
    </button>
  );
}

function BlockerToggle({ checked, onChange, disabled, tone, title, description }) {
  return (
    <button
      type="button"
      className={`blocker-toggle ${tone} ${checked ? "on" : ""}`}
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      aria-pressed={checked}
    >
      <span className="blocker-toggle-mark" aria-hidden>{checked ? "✓" : ""}</span>
      <span className="blocker-toggle-body">
        <span className="blocker-toggle-title">{title}</span>
        <span className="blocker-toggle-desc">{description}</span>
      </span>
    </button>
  );
}

function PriorityPills({ value, onChange, readOnly }) {
  return (
    <div className="priority-pills" role="group" aria-label="Priority">
      {PRIORITIES.map(p => (
        <button
          key={p.id || "none"}
          type="button"
          disabled={readOnly}
          className={`priority-pill ${p.id ? `tone-${p.id}` : "tone-none"} ${(value || "") === p.id ? "on" : ""}`}
          onClick={() => onChange(p.id)}
        >
          {p.id === "urgent" && <span className="priority-pill-dot" aria-hidden />}
          {p.id === "high" && <span className="priority-pill-dot" aria-hidden />}
          {p.label}
        </button>
      ))}
    </div>
  );
}

// ─── PROJECT FLAGS (priority + sales blockers) ───────────────────────────────
function ProjectFlags({ project, compact = false }) {
  const pr = priorityOf(project);
  const licenses = isWaitingOnLicenses(project);
  const salesInfo = isWaitingOnSalesInfo(project);
  const salesProduct = isWaitingOnSalesProduct(project);
  if (!pr.id && !licenses && !salesInfo && !salesProduct) return null;
  return (
    <div className={`card-flags ${compact ? "compact" : ""}`}>
      {pr.id && (
        <span className={`card-flag flag-priority flag-priority-${pr.id}`}>{pr.label}</span>
      )}
      {licenses && (
        <span className="card-flag flag-licenses">Needs licenses</span>
      )}
      {salesInfo && (
        <span className="card-flag flag-sales-info">Awaiting sales info</span>
      )}
      {salesProduct && (
        <span className="card-flag flag-sales">Awaiting sales</span>
      )}
    </div>
  );
}

// ─── BOARD CARD ──────────────────────────────────────────────────────────────
function BoardCard({ project, isDragging, isDropTarget, onPointerDown, onOpen, canEdit = true, isNewHighlight = false }) {
  const days    = daysUntil(project.dueDate);
  const overdue = days !== null && days < 0;
  const dueSoon = days !== null && days >= 0 && days <= 14;
  const cc      = catColor(project.category);
  const pr       = priorityOf(project);
  const licenses = isWaitingOnLicenses(project);
  const salesHold = isWaitingOnSalesInfo(project) || isWaitingOnSalesProduct(project);

  return (
    <div
      className={`card ${isDragging ? "card-dragging" : ""} ${isDropTarget ? "card-drop-target" : ""} ${isNewHighlight ? "card-new" : ""} ${!canEdit ? "card-view-only" : ""} ${pr.id ? `card-priority-${pr.id}` : ""} ${licenses ? "card-waiting-licenses" : ""} ${salesHold ? "card-waiting-sales" : ""}`}
      onPointerDown={canEdit ? (e) => onPointerDown(e, project) : undefined}
      onClick={() => { if (!isDragging) onOpen(project); }}
      data-card-id={project.id}
      style={{ "--cc": cc }}
    >
      {isDropTarget && <div className="card-drop-bar" />}
      <div className="card-stripe" />
      <div className="card-body">
        <ProjectFlags project={project} />
        <div className="card-title">{project.title}</div>
        <div className="card-tags">
          <span className="cat-chip" style={{ background: `${cc}22`, color: cc, border: `1px solid ${cc}44` }}>
            {catLabel(project.category)}
          </span>
          <span className="card-season">{project.season}</span>
        </div>
        <StyleSkuCardLinks numbers={project.styleNumbers} />
        <div className="card-footer">
          <div className="card-assignee">
            <AssigneeAvatars project={project} />
          </div>
          <div className="card-right">
            {project.dueDate && (
              <span className={`card-due ${overdue ? "c-red" : dueSoon ? "c-amber" : ""}`}>
                {overdue ? `${Math.abs(days)}d late` : fmt(project.dueDate)}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── QUICK ADD ───────────────────────────────────────────────────────────────
function QuickAdd({ stageId, onAdd, canEdit = true }) {
  if (!canEdit) return null;
  const [active, setActive] = useState(false);
  const [value,  setValue]  = useState("");
  const inputRef = useRef(null);
  const activate = () => { setActive(true); setTimeout(() => inputRef.current?.focus(), 50); };
  const commit   = () => { if (value.trim()) { onAdd(stageId, value.trim()); setValue(""); } setActive(false); };
  const onKey    = (e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } if (e.key === "Escape") { setValue(""); setActive(false); } };

  if (!active) return (
    <button className="qa-btn" onClick={activate}>+ Add project</button>
  );
  return (
    <div className="qa-wrap">
      <input ref={inputRef} className="qa-input" value={value}
        onChange={e => setValue(e.target.value)} onKeyDown={onKey} onBlur={commit}
        placeholder="Project title…" />
      <span className="qa-hint">↵</span>
    </div>
  );
}

// ─── BOARD ───────────────────────────────────────────────────────────────────
function Board({ projects, onAssign, onReorder, onOpen, onQuickAdd, stages = STAGES, canEdit = true, shouldGlowProject }) {
  const isHighlighted = (p) => shouldGlowProject?.(p) ?? false;
  const [drag,      _setDrag]  = useState(null);
  const [hover,     _setHover] = useState(null);
  const [collapsed, setCollapsed] = useState(new Set(["archived"]));

  // Refs mirror state so mount-once listeners always read fresh values
  const dragRef        = useRef(null);
  const hoverRef       = useRef(null);
  const longPressTimer = useRef(null);
  const startPos       = useRef(null);
  const isDraggingRef  = useRef(false);
  const pendingDrag    = useRef(null);
  const boardRef       = useRef(null);
  const cbRef          = useRef({ onAssign, onReorder });
  useEffect(() => { cbRef.current = { onAssign, onReorder }; }, [onAssign, onReorder]);

  const setDrag  = (v) => { dragRef.current  = v; _setDrag(v);  };
  const setHover = (v) => { hoverRef.current = v; _setHover(v); };

  // Touchmove scroll blocker
  useEffect(() => {
    const block = (e) => { if (isDraggingRef.current) e.preventDefault(); };
    document.addEventListener("touchmove", block, { passive: false });
    return () => document.removeEventListener("touchmove", block);
  }, []);

  // Wheel → horizontal scroll only when the board actually scrolls sideways (mobile)
  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const onWheel = (e) => {
      if (isDraggingRef.current) return;

      const colBody = e.target.closest?.(".col-body");
      if (colBody && colBody.scrollHeight > colBody.clientHeight + 2) {
        const atTop = colBody.scrollTop <= 0;
        const atBottom = colBody.scrollTop + colBody.clientHeight >= colBody.scrollHeight - 2;
        if ((e.deltaY < 0 && !atTop) || (e.deltaY > 0 && !atBottom)) return;
      }

      const canScrollX = el.scrollWidth > el.clientWidth + 2;
      if (!canScrollX) return;
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY * 1.5;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Pointer move + up — registered ONCE at mount, reads refs directly
  useEffect(() => {
    const onMove = (ev) => {
      // Touch: cancel long press if finger scrolls
      if (longPressTimer.current && !dragRef.current && !pendingDrag.current) {
        if (Math.hypot(ev.clientX - startPos.current.x, ev.clientY - startPos.current.y) > 10) {
          clearTimeout(longPressTimer.current); longPressTimer.current = null;
        }
        return;
      }
      // Mouse: activate drag once movement exceeds threshold
      if (pendingDrag.current && !dragRef.current) {
        if (Math.hypot(ev.clientX - startPos.current.x, ev.clientY - startPos.current.y) > 6) {
          const pd = pendingDrag.current;
          pendingDrag.current = null;
          isDraggingRef.current = true;
          const nd = { kind: "card", project: pd.project, offsetX: pd.offsetX, offsetY: pd.offsetY, width: pd.width, height: pd.height, x: ev.clientX, y: ev.clientY };
          dragRef.current = nd; _setDrag(nd);
          if (navigator.vibrate) navigator.vibrate(15);
        }
        return;
      }
      if (!dragRef.current) return;
      ev.preventDefault?.();

      // Update position
      const d = { ...dragRef.current, x: ev.clientX, y: ev.clientY };
      dragRef.current = d; _setDrag(d);

      // Hit-test drop target
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      if (!el) { setHover(null); return; }

      if (d.kind === "card") {
        const asnEl = el.closest("[data-assignee]");
        if (asnEl) { setHover({ type: "assignee", value: asnEl.dataset.assignee }); return; }
        const stageEl = el.closest("[data-stage]");
        if (stageEl) {
          const cardEl = el.closest("[data-card-id]");
          setHover({ type: "stage", value: stageEl.dataset.stage, beforeId: cardEl && cardEl.dataset.cardId !== d.project.id ? cardEl.dataset.cardId : null });
          return;
        }
        setHover(null);
      } else if (d.kind === "team") {
        const cardEl = el.closest("[data-card-id]");
        if (cardEl) { setHover({ type: "card", id: cardEl.dataset.cardId }); return; }
        setHover(null);
      }
    };

    const onUp = () => {
      if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
      pendingDrag.current = null;
      isDraggingRef.current = false;
      const d = dragRef.current, h = hoverRef.current;
      if (d && h) {
        if (d.kind === "card") {
          if (h.type === "assignee") cbRef.current.onAssign(d.project.id, h.value);
          else if (h.type === "stage") cbRef.current.onReorder(d.project.id, h.value, h.beforeId);
        } else if (d.kind === "team" && h.type === "card") {
          cbRef.current.onAssign(h.id, d.name);
        }
        if (navigator.vibrate) navigator.vibrate([10, 20, 10]);
      }
      dragRef.current = null; hoverRef.current = null;
      _setDrag(null); _setHover(null);
    };

    document.addEventListener("pointermove", onMove, { passive: false });
    document.addEventListener("pointerup",     onUp);
    document.addEventListener("pointercancel", onUp);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup",     onUp);
      document.removeEventListener("pointercancel", onUp);
    };
  }, []); // ← empty: register once, read refs for fresh values

  const handleCardPointerDown = (e, project) => {
    if (!canEdit) return;
    if (e.target.closest("button, a, input, select")) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    startPos.current = { x: e.clientX, y: e.clientY, offsetX: e.clientX - rect.left, offsetY: e.clientY - rect.top, width: rect.width, height: rect.height };
    if (e.pointerType === "touch") {
      longPressTimer.current = setTimeout(() => {
        isDraggingRef.current = true;
        const nd = { kind: "card", project, ...startPos.current, x: startPos.current.x, y: startPos.current.y };
        dragRef.current = nd; _setDrag(nd);
        if (navigator.vibrate) navigator.vibrate(15);
      }, 220);
    } else {
      // Mouse: store pending, pointermove will activate after threshold
      pendingDrag.current = { project, ...startPos.current };
    }
  };

  const handleTeamPointerDown = (e, member) => {
    if (!canEdit) return;
    e.preventDefault(); e.stopPropagation();
    isDraggingRef.current = true;
    const nd = { kind: "team", name: member.name, color: member.color, x: e.clientX, y: e.clientY };
    dragRef.current = nd; _setDrag(nd);
    if (navigator.vibrate) navigator.vibrate(15);
  };

  const toggleCollapse = (id) => setCollapsed(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const isDC = drag?.kind === "card", isDT = drag?.kind === "team";

  return (
    <>
      {/* Team strip */}
      <div className="team-strip">
        <div className="team-strip-top">
          <span className="strip-label">Team</span>
          <span className="strip-hint">{!canEdit ? "View only — click a card for details" : isDC ? "Drop on teammate to add them to the project" : isDT ? "Drop onto a card to add teammate" : "Drag cards to move · drop on teammate to add to project"}</span>
        </div>
        <div className="team-row">
          {TEAM.map(t => {
            const isChipDrop    = isDC && hover?.type === "assignee" && hover.value === t.name;
            const isBeingDragged = isDT && drag.name === t.name;
            return (
              <div key={t.name} data-assignee={t.name}
                onPointerDown={canEdit ? (e) => handleTeamPointerDown(e, t) : undefined}
                className={`team-chip ${isChipDrop ? "chip-on" : ""} ${isBeingDragged ? "chip-lifting" : ""} ${!canEdit ? "team-chip-view" : ""}`}
                style={{ "--tc": t.color }}
              >
                <span className="av av-sm" style={{ background: t.color }}>{initials(t.name)}</span>
                <span className="chip-name">{t.name}</span>
                <span className="chip-grip">⠿</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Category legend */}
      <div className="cat-legend">
        {CATEGORIES.filter(c => c.id !== "all").map(c => (
          <div key={c.id} className="legend-item">
            <span className="legend-dot" style={{ background: c.color }} />
            <span>{c.label}</span>
          </div>
        ))}
      </div>

      {/* Board */}
      <div className="board" ref={boardRef}>
        {stages.map((stage, si) => {
          const stageIds = new Set(stages.map(s => s.id));
          const items    = sortProjectsForBoard(projects.filter(p => p.stage === stage.id || (si === 0 && !stageIds.has(p.stage))));
          const isHov    = isDC && hover?.type === "stage" && hover.value === stage.id;
          const overdueCt = items.filter(p => { const d = daysUntil(p.dueDate); return d !== null && d < 0; }).length;
          const isColl   = collapsed.has(stage.id);
          return (
            <div key={stage.id} className={`col ${isHov ? "col-on" : ""} ${isColl ? "col-collapsed" : ""}`} data-stage={stage.id}>
              <div className="col-head" onClick={() => toggleCollapse(stage.id)}>
                <span className="col-dot" style={{ background: stage.dot }} />
                <span className="col-title">{stage.label}</span>
                <span className="col-count">{items.length}</span>
                <div style={{ flex: 1 }} />
                {overdueCt > 0 && !isColl && <span className="col-late">{overdueCt} late</span>}
                <span className="col-chev">{isColl ? "›" : "‹"}</span>
              </div>
              {!isColl && (
                <div className="col-body">
                  {items.length === 0 ? (
                    <div className={`col-empty ${isHov ? "col-empty-on" : ""}`}>{isHov ? "Drop here" : "No projects"}</div>
                  ) : items.map(p => {
                    const isBeforeMarker   = isHov && hover.beforeId === p.id;
                    const isTeamDropTarget = isDT && hover?.type === "card" && hover.id === p.id;
                    return (
                      <div key={p.id}>
                        {isBeforeMarker && <div className="drop-marker" />}
                        <BoardCard project={p} isDragging={isDC && drag.project.id === p.id} isDropTarget={isTeamDropTarget} onPointerDown={handleCardPointerDown} onOpen={onOpen} canEdit={canEdit} isNewHighlight={isHighlighted(p)} />
                      </div>
                    );
                  })}
                  {isHov && !hover.beforeId && items.length > 0 && <div className="drop-marker" />}
                  <QuickAdd stageId={stage.id} onAdd={onQuickAdd} canEdit={canEdit} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {isDC && (
        <div className="ghost ghost-card" style={{ left: drag.x - drag.offsetX, top: drag.y - drag.offsetY, width: drag.width }}>
          <BoardCard project={drag.project} isDragging={false} isDropTarget={false} onPointerDown={() => {}} onOpen={() => {}} />
        </div>
      )}
      {isDT && (
        <div className="ghost ghost-team" style={{ left: drag.x - 20, top: drag.y - 20 }}>
          <span className="av av-lg" style={{ background: drag.color }}>{initials(drag.name)}</span>
          <span className="ghost-name">{drag.name.split(" ")[0]}</span>
        </div>
      )}
    </>
  );
}

// ─── LIST VIEW ───────────────────────────────────────────────────────────────
function ListView({ projects, onOpen, shouldGlowProject }) {
  return (
    <div className="list">
      {projects.length === 0
        ? <div className="list-empty">No projects to show.</div>
        : projects.map(p => {
          const stage = stageOf(p.stage);
          const days = daysUntil(p.dueDate);
          const overdue = days !== null && days < 0;
          const cc = catColor(p.category);
          const isNew = shouldGlowProject?.(p) ?? false;
          return (
            <div key={p.id} className={`list-row ${isNew ? "list-row-new" : ""}`} onClick={() => onOpen(p)} style={{ "--cc": cc }}>
              <div className="list-stripe" />
              <div className="list-main">
                <div className="list-title">{p.title}</div>
                <ProjectFlags project={p} compact />
                <div className="list-meta">
                  <span className="cat-chip sm" style={{ background: `${cc}22`, color: cc, border: `1px solid ${cc}44` }}>{catLabel(p.category)}</span>
                  <span className="sep">·</span><span>{p.season}</span>
                </div>
                <StyleSkuCardLinks numbers={p.styleNumbers} max={5} />
              </div>
              <div className="list-stage-pill">
                <span className="stage-dot" style={{ background: stage.dot }} />
                {stage.label}
              </div>
              <div className="list-assignee">
                <AssigneeAvatars project={p} maxShow={2} />
              </div>
              <div className={`list-due ${overdue ? "c-red" : ""}`}>
                {p.dueDate ? (overdue ? `${Math.abs(days)}d late` : fmt(p.dueDate)) : "—"}
              </div>
            </div>
          );
        })}
    </div>
  );
}

// ─── CALENDAR VIEW ───────────────────────────────────────────────────────────
const DAYS   = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function CalendarView({ projects, onOpen }) {
  const now = new Date();
  const [cur, setCur] = useState({ year: now.getFullYear(), month: now.getMonth() });
  const { year, month } = cur;

  const firstDow    = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const allDays     = Array(firstDow).fill(null).concat(Array.from({ length: daysInMonth }, (_, i) => i + 1));
  while (allDays.length % 7 !== 0) allDays.push(null);
  const weeks = [];
  for (let i = 0; i < allDays.length; i += 7) weeks.push(allDays.slice(i, i + 7));

  const getRange = (p) => {
    const s = p.startDate ? new Date(p.startDate + "T00:00:00") : (p.dueDate ? new Date(p.dueDate + "T00:00:00") : null);
    const e = p.dueDate   ? new Date(p.dueDate   + "T00:00:00") : s;
    return { s, e };
  };
  const isActive = (p, day) => {
    if (!day) return false;
    const { s, e } = getRange(p);
    if (!s) return false;
    const d = new Date(year, month, day);
    return d >= s && d <= e;
  };
  const isToday = (day) => day && year === now.getFullYear() && month === now.getMonth() && day === now.getDate();
  const isPast  = (day) => day && new Date(year, month, day) < new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const monthProjects = projects.filter(p => {
    const { s, e } = getRange(p);
    if (!s && !e) return false;
    return (!s || s <= new Date(year, month + 1, 0)) && (!e || e >= new Date(year, month, 1));
  });
  const noDates = projects.filter(p => !p.startDate && !p.dueDate);

  return (
    <div className="cal-wrap">
      <div className="cal-nav-row">
        <button className="cal-nav-btn" onClick={() => setCur(c => { const d = new Date(c.year, c.month - 1); return { year: d.getFullYear(), month: d.getMonth() }; })}>‹</button>
        <span className="cal-month-label">{MONTHS[month]} {year}</span>
        <button className="cal-nav-btn" onClick={() => setCur(c => { const d = new Date(c.year, c.month + 1); return { year: d.getFullYear(), month: d.getMonth() }; })}>›</button>
        <button className="cal-today-btn" onClick={() => setCur({ year: now.getFullYear(), month: now.getMonth() })}>Today</button>
      </div>

      <div className="cal-dow-row">
        {DAYS.map(d => <div key={d} className="cal-dow">{d}</div>)}
      </div>

      <div className="cal-body">
        {weeks.map((week, wi) => {
          const weekProjects = monthProjects.filter(p => week.some(day => isActive(p, day)));
          return (
            <div key={wi} className="cal-week">
              <div className="cal-days-row">
                {week.map((day, di) => (
                  <div key={di} className={`cal-day ${!day ? "cal-day-empty" : ""} ${isToday(day) ? "cal-day-today" : ""} ${day && isPast(day) && !isToday(day) ? "cal-day-past" : ""}`}>
                    {day && <span className="cal-day-num">{day}</span>}
                  </div>
                ))}
              </div>
              {weekProjects.length > 0 && (
                <div className="cal-events-row">
                  {weekProjects.map(p => {
                    const activeCols = week.map((day, i) => (day && isActive(p, day) ? i + 1 : null)).filter(Boolean);
                    if (!activeCols.length) return null;
                    const sc = activeCols[0], ec = activeCols[activeCols.length - 1];
                    const { s, e } = getRange(p);
                    const firstDay = week[sc - 1], lastDay = week[ec - 1];
                    const capL = s && s.getFullYear() === year && s.getMonth() === month && s.getDate() === firstDay;
                    const capR = e && e.getFullYear() === year && e.getMonth() === month && e.getDate() === lastDay;
                    const dur  = s && e ? Math.round((e - s) / 86400000) : null;
                    const cc   = catColor(p.category);
                    return (
                      <div key={p.id} className="cal-bar"
                        style={{
                          gridColumn: `${sc} / ${ec + 1}`,
                          "--cc": cc,
                          borderRadius: `${capL?"5px":"0"} ${capR?"5px":"0"} ${capR?"5px":"0"} ${capL?"5px":"0"}`,
                          borderLeft:  capL ? `1px solid ${cc}55` : "none",
                          borderRight: capR ? `1px solid ${cc}55` : "none",
                          marginLeft:  capL ? "2px" : "0",
                          marginRight: capR ? "2px" : "0",
                        }}
                        onClick={() => onOpen(p)}
                        title={`${p.title} · ${projectAssignees(p).join(", ")}${dur ? ` · ${dur} days` : ""}`}
                      >
                        <AssigneeAvatars project={p} size="xs" maxShow={2} compact />
                        <span className="bar-title">{p.title}</span>
                        {capR && dur && <span className="bar-dur">{dur}d</span>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {noDates.length > 0 && (
        <div className="cal-nodue">
          <span className="cal-nodue-label">No dates set</span>
          <div className="cal-nodue-items">
            {noDates.map(p => (
              <div key={p.id} className="cal-item" style={{ "--cc": catColor(p.category) }} onClick={() => onOpen(p)}>
                <span className="cal-item-dot" /><span className="cal-item-title">{p.title}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ActivityLog({ activity }) {
  const items = activity || [];
  return (
    <div className="activity-log">
      <div className="field-label">Activity</div>
      {items.length === 0 ? (
        <div className="activity-empty">No activity yet — moves, edits, and SKUs will show here.</div>
      ) : (
        <ul className="activity-list">
          {items.map(a => (
            <li key={a.id} className="activity-item">
              <div className="activity-text">{a.text}</div>
              <div className="activity-meta">{a.by} · {formatActivityTime(a.at)}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── DRAWER ──────────────────────────────────────────────────────────────────
function Drawer({ project, isNew, onSave, onClose, onDelete, onMoveBoard, presentations, readOnly = false, defaultAssigneeName = TEAM[0].name }) {
  const [form, setForm] = useState(() => {
    if (project) return { ...project, assignees: projectAssignees(project) };
    return {
      title: "", category: "apparel", stage: "concept", projectType: "product",
      assignees: [defaultAssigneeName], season: "SS26",
      startDate: "", dueDate: "", notes: "", styleNumbers: [], presentationId: "", sourcePresId: "",
      priority: "", waitingOnSales: false, waitingOnLicenses: false,
    };
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isPresentation = form.projectType === "presentation";
  const setStage = (stageId) => {
    setForm(f => ({
      ...f,
      stage: stageId,
      waitingOnSales: f.projectType !== "presentation" && stageId === "awaiting_sales" ? true : f.waitingOnSales,
    }));
  };
  const isAwaitingSales = !isPresentation && form.stage === "awaiting_sales";
  const stageOptions   = isPresentation ? PRES_STAGES : STAGES;
  const [closing, setClosing] = useState(false);

  const requestClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
    setTimeout(() => onClose?.(), 180);
  }, [closing, onClose]);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [requestClose]);

  return (
    <>
      <div className={`drawer-overlay ${closing ? "closing" : ""}`} onClick={requestClose} />
      <div className={`drawer ${closing ? "closing" : ""}`}>
        <div className="drawer-handle" />
        <div className="drawer-cat-bar" style={{ background: catColor(form.category) }} />
        <div className="drawer-inner">
          <div className="drawer-head">
            <span className="eyebrow">{readOnly ? "View" : isNew ? "New" : "Edit"} {isPresentation ? "Presentation" : "Project"}</span>
            <button onClick={requestClose} className="close-btn">✕</button>
          </div>

          {isNew && !readOnly && (
            <div className="ss-type-toggle" style={{ marginBottom: 16 }}>
              <button onClick={() => { set("projectType","product"); set("stage","concept"); }} className={`ss-type-btn ${!isPresentation ? "active" : ""}`}>Product</button>
              <button onClick={() => { set("projectType","presentation"); set("stage","brief"); }} className={`ss-type-btn ${isPresentation ? "active" : ""}`}>Presentation</button>
            </div>
          )}

          <input value={form.title} onChange={e => set("title", e.target.value)} readOnly={readOnly}
            placeholder={isPresentation ? "e.g. Costco FW26 Home Goods Pitch" : "Product name"}
            autoFocus={isNew && !readOnly} className="drawer-title" />

          <div className="field-grid">
            <Field label="Stage">
              <Select value={form.stage} onChange={e => setStage(e.target.value)} disabled={readOnly}>
                {stageOptions.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </Select>
            </Field>
            <Field label="Priority" full>
              <PriorityPills value={form.priority || ""} onChange={v => set("priority", v)} readOnly={readOnly} />
            </Field>
            <Field label="Category"><Select value={form.category} onChange={e => set("category", e.target.value)} disabled={readOnly}>{CATEGORIES.filter(c => c.id !== "all").map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</Select></Field>
            {!isPresentation && (
              <Field label="Blocked by sales" full>
                <div className="blocker-toggles">
                  <BlockerToggle
                    checked={!!form.waitingOnSales}
                    onChange={v => set("waitingOnSales", v)}
                    disabled={readOnly}
                    tone="sales"
                    title="Awaiting sales"
                    description="Waiting on info or SKUs from sales — shows on the board in any column."
                  />
                </div>
              </Field>
            )}
            {isPresentation && (
              <Field label="Blocked by sales" full>
                <div className="blocker-toggles">
                  <BlockerToggle
                    checked={!!form.waitingOnLicenses}
                    onChange={v => set("waitingOnLicenses", v)}
                    disabled={readOnly}
                    tone="licenses"
                    title="Needs licenses"
                    description="Sales must provide licenses before art can start."
                  />
                  <BlockerToggle
                    checked={!!form.waitingOnSales}
                    onChange={v => set("waitingOnSales", v)}
                    disabled={readOnly}
                    tone="sales"
                    title="Awaiting sales info"
                    description="Meeting held but brief or details aren’t ready yet."
                  />
                </div>
                <p className="field-hint">Tags appear on the card so the team knows why work is paused.</p>
              </Field>
            )}
            {isPresentation && (
              <Field label="Customer"><Select value={form.customer || ""} onChange={e => set("customer", e.target.value)} disabled={readOnly}><option value="">— Select —</option>{CUSTOMERS.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
            )}
            <Field label="Season"><Select value={form.season} onChange={e => set("season", e.target.value)} disabled={readOnly}>{SEASONS.map(s => <option key={s}>{s}</option>)}</Select></Field>
            <Field label="Art team" full>
              <AssigneePicker
                assignees={form.assignees}
                onChange={v => set("assignees", v)}
                readOnly={readOnly}
              />
            </Field>
            <Field label="Start Date"><Input type="date" value={form.startDate} onChange={e => set("startDate", e.target.value)} disabled={readOnly} /></Field>
            <Field label="End / Due Date"><Input type="date" value={form.dueDate} onChange={e => set("dueDate", e.target.value)} disabled={readOnly} /></Field>
            {!isPresentation && presentations && presentations.length > 0 && (
              <Field label="Source Presentation" full>
                <Select value={form.sourcePresId || ""} onChange={e => set("sourcePresId", e.target.value)} disabled={readOnly}>
                  <option value="">None — design-led</option>
                  {presentations.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
                </Select>
              </Field>
            )}
            <Field label="Status Notes" full>
              <Textarea rows={4} value={form.notes} onChange={e => set("notes", e.target.value)} disabled={readOnly}
                placeholder="Latest updates, blockers, next steps…" />
              {form.notes?.trim() && (
                <div className="notes-rendered"><LinkedText text={form.notes} /></div>
              )}
            </Field>
            {!isPresentation && (isAwaitingSales || normalizeStyleEntries(form.styleNumbers).length > 0) && (
              <StyleSkuSection
                value={form.styleNumbers}
                onChange={v => set("styleNumbers", v)}
                canEdit={isAwaitingSales && !readOnly}
              />
            )}
          </div>
          {!isNew && <ActivityLog activity={form.activity} />}
          {!readOnly ? (
          <div className="drawer-actions">
            <div className="drawer-actions-row">
              <button onClick={() => onSave(normalizeProjectForSave({
                ...form,
                id: form.id || `p${Date.now()}`,
                styleNumbers: normalizeStyleEntries(form.styleNumbers),
              }))} disabled={!form.title.trim()} className="btn-primary">
                {isNew ? "Create project" : "Save changes"}
              </button>
              {!isNew && (
                confirmDelete
                  ? <div style={{ display:"flex", gap:8, flex:1 }}>
                      <button onClick={() => onDelete(form.id)} className="btn-danger" style={{ flex:1 }}>Yes, delete</button>
                      <button onClick={() => setConfirmDelete(false)} className="btn-cancel">Cancel</button>
                    </div>
                  : <button onClick={() => setConfirmDelete(true)} className="btn-danger">Delete</button>
              )}
            </div>
            {!isNew && onMoveBoard && (
              <button
                type="button"
                className="drawer-move-board"
                onClick={() => onMoveBoard(normalizeProjectForSave({
                  ...form,
                  id: form.id,
                  styleNumbers: normalizeStyleEntries(form.styleNumbers),
                }), isPresentation ? "product" : "presentation")}
              >
                {isPresentation ? "Move to Products board" : "Move to Presentations board"}
              </button>
            )}
          </div>
          ) : (
            <div className="drawer-actions">
              <button onClick={requestClose} className="btn-primary" style={{ width: "100%" }}>Close</button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

const Field    = ({ label, full, children }) => <div className={`field ${full ? "field-full" : ""}`}><div className="field-label">{label}</div>{children}</div>;
const Input    = (p) => <input    {...p} className="ui-input" />;
const Textarea = (p) => <textarea {...p} className="ui-input ui-textarea" />;
const Select   = (p) => <select   {...p} className="ui-input ui-select" />;

// ─── SELECT SET DRAWER ───────────────────────────────────────────────────────
function SSDrawer({ set, isNew, onSave, onClose, onDelete, readOnly = false }) {
  const [form, setForm] = useState(set || {
    name: "", customerId: CUSTOMERS[0].id, link: "",
    category: "apparel", season: "SS26", status: "active", notes: "",
  });
  const s = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const cust = CUSTOMERS.find(c => c.id === form.customerId);
  const [closing, setClosing] = useState(false);

  const requestClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
    setTimeout(() => onClose?.(), 180);
  }, [closing, onClose]);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [requestClose]);

  return (
    <>
      <div className={`drawer-overlay ${closing ? "closing" : ""}`} onClick={requestClose} />
      <div className={`drawer ${closing ? "closing" : ""}`}>
        <div className="drawer-handle" />
        <div className="drawer-cat-bar" style={{ background: cust?.color || "#8B7FFF" }} />
        <div className="drawer-inner">
          <div className="drawer-head">
            <span className="eyebrow">{readOnly ? "View Select Set" : isNew ? "New Select Set" : "Edit Select Set"}</span>
            <button onClick={requestClose} className="close-btn">✕</button>
          </div>
          <input value={form.name} onChange={e => s("name", e.target.value)} readOnly={readOnly}
            placeholder="e.g. Costco Hydration"
            autoFocus={isNew && !readOnly} className="drawer-title" />
          <div className="field-grid">
            <Field label="Customer" full>
              <div className="ss-customer-picker">
                {CUSTOMERS.map(c => (
                  <button key={c.id} onClick={() => !readOnly && s("customerId", c.id)} disabled={readOnly}
                    className={`ss-cust-btn ${form.customerId === c.id ? "ss-cust-active" : ""}`}
                    style={{ "--cc": c.color }}>
                    {c.name}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Link" full>
              <input value={form.link} onChange={e => s("link", e.target.value)} readOnly={readOnly}
                placeholder="Paste select set URL…" className="ui-input" />
            </Field>
            <Field label="Category">
              <Select value={form.category} onChange={e => s("category", e.target.value)} disabled={readOnly}>
                {CATEGORIES.filter(c => c.id !== "all").map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </Select>
            </Field>
            <Field label="Season">
              <Select value={form.season} onChange={e => s("season", e.target.value)} disabled={readOnly}>
                {SEASONS.map(ss => <option key={ss}>{ss}</option>)}
              </Select>
            </Field>
            <Field label="Status" full>
              <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                {SS_STATUS.map(st => (
                  <button key={st.id} onClick={() => !readOnly && s("status", st.id)} disabled={readOnly}
                    className={`ss-status-btn ${form.status === st.id ? "ss-status-active" : ""}`}>
                    <span className="ss-dot" style={{ background: st.dot }} />{st.label}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Notes" full>
              <Textarea rows={3} value={form.notes} onChange={e => s("notes", e.target.value)} disabled={readOnly}
                placeholder="Notes… [label](https://…) or paste a URL for links" />
              {form.notes?.trim() && (
                <div className="linked-text-preview">
                  <span className="preview-label">Preview</span>
                  <LinkedText text={form.notes} />
                </div>
              )}
            </Field>
          </div>
          {!readOnly ? (
          <div className="drawer-actions">
            <button onClick={() => onSave({ ...form, id: form.id || `ss${Date.now()}` })}
              disabled={!form.name.trim() || !form.customerId} className="btn-primary">
              {isNew ? "Add Set" : "Save"}
            </button>
            {!isNew && (
              confirmDelete
                ? <div style={{ display:"flex", gap:8, flex:1 }}>
                    <button onClick={() => onDelete(form.id)} className="btn-danger" style={{ flex:1 }}>Yes, delete</button>
                    <button onClick={() => setConfirmDelete(false)} className="btn-cancel">Cancel</button>
                  </div>
                : <button onClick={() => setConfirmDelete(true)} className="btn-danger">Delete</button>
            )}
          </div>
          ) : (
            <div className="drawer-actions">
              <button onClick={requestClose} className="btn-primary" style={{ width: "100%" }}>Close</button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ─── SELECT SETS PAGE ─────────────────────────────────────────────────────────
function SelectSetsPage({ sets, projects, onSave, onDelete, canEdit = true }) {
  const [custFilter, setCustFilter] = useState("all");
  const [search, setSearch]         = useState("");
  const [drawer, setDrawer]         = useState(null);

  const filtered = sets.filter(s =>
    (custFilter === "all" || s.customerId === custFilter) &&
    (!search || s.name.toLowerCase().includes(search.toLowerCase()) ||
     CUSTOMERS.find(c => c.id === s.customerId)?.name.toLowerCase().includes(search.toLowerCase()))
  );

  const custCounts = CUSTOMERS.reduce((a, c) => {
    a[c.id] = sets.filter(s => s.customerId === c.id).length;
    return a;
  }, {});

  const visibleCustomers = custFilter === "all"
    ? CUSTOMERS.filter(c => custCounts[c.id] > 0 || true)
    : CUSTOMERS.filter(c => c.id === custFilter);

  const presentationStatuses = [];
  const presStatusOf = (id) => SS_STATUS[0];
  const linkedCount = (presId) => projects.filter(p => p.presentationId === presId).length;

  return (
    <div className="ss-page">
      <div className="ss-topbar">
        <div>
          <h1 className="page-title">Select Sets</h1>
          <p className="page-sub">{sets.length} sets across {CUSTOMERS.filter(c => custCounts[c.id] > 0).length} customers</p>
        </div>
        <div style={{ display:"flex", gap:10, alignItems:"center", flexWrap:"wrap" }}>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search sets…" className="ss-search" />
          {canEdit && <button onClick={() => setDrawer({ isNew: true })} className="btn-new">+ New Set</button>}
        </div>
      </div>

      <div className="ss-cust-tabs">
        <button onClick={() => setCustFilter("all")} className={`ss-ctab ${custFilter === "all" ? "active" : ""}`}>
          All <span className="tab-ct">{sets.length}</span>
        </button>
        {CUSTOMERS.map(c => (
          <button key={c.id} onClick={() => setCustFilter(c.id)}
            className={`ss-ctab ${custFilter === c.id ? "active" : ""}`}
            style={{ "--cc": c.color }}>
            {c.name}<span className="tab-ct">{custCounts[c.id] || 0}</span>
          </button>
        ))}
      </div>

      <div className="ss-sections">
        {visibleCustomers.map(cust => {
          const custSets = filtered.filter(s => s.customerId === cust.id);
          if (custFilter === "all" && custSets.length === 0 && !search) return null;
          return (
            <div key={cust.id} className="ss-section">
              <div className="ss-section-head">
                <div className="ss-section-label">
                  <span className="ss-cust-dot" style={{ background: cust.color }} />
                  <span className="ss-cust-name">{cust.name}</span>
                  <span className="ss-cust-count">{custSets.length}</span>
                </div>
                {canEdit && <button onClick={() => setDrawer({ isNew: true, prefill: { customerId: cust.id } })}
                  className="ss-add-btn">+ Add Set</button>}
              </div>
              {custSets.length === 0 ? (
                <div className="ss-empty">No select sets yet — add one above</div>
              ) : (
                <div className="ss-grid">
                  {custSets.map(set => {
                    const st = ssStatusOf(set.status);
                    const cc = catColor(set.category);
                    return (
                      <div key={set.id} className="ss-card">
                        <div className="ss-card-top">
                          <div style={{ flex:1, minWidth:0 }}>
                            <div className="ss-card-name">{set.name}</div>
                            <div className="ss-card-meta">
                              <span className="cat-chip" style={{ background:`${cc}22`, color:cc, border:`1px solid ${cc}44` }}>{catLabel(set.category)}</span>
                              <span className="ss-card-season">{set.season}</span>
                              <span className="ss-status-pill">
                                <span style={{ width:6, height:6, borderRadius:"50%", background:st.dot, display:"inline-block" }} />
                                {st.label}
                              </span>
                            </div>
                          </div>
                          <div style={{ display:"flex", gap:6, flexShrink:0 }}>
                            {set.link
                              ? <a href={set.link} target="_blank" rel="noopener noreferrer" className="ss-open-btn">Open link ↗</a>
                              : <span className="ss-no-link">No link</span>}
                            <button onClick={() => setDrawer({ isNew: false, set })} className="ss-edit-btn">{canEdit ? "Edit" : "View"}</button>
                          </div>
                        </div>
                        {set.notes && <div className="ss-card-notes"><LinkedText text={set.notes} /></div>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        {sets.length === 0 && (
          <div className="ss-zero">
            <div className="ss-zero-icon">◈</div>
            <div className="ss-zero-title">No select sets yet</div>
            <div className="ss-zero-sub">Add your first set and optional link</div>
            {canEdit && <button onClick={() => setDrawer({ isNew: true })} className="btn-new" style={{ marginTop:16 }}>+ New Set</button>}
          </div>
        )}
      </div>

      {drawer && (
        <SSDrawer
          readOnly={!canEdit}
          set={drawer.set || (drawer.prefill ? { ...drawer.prefill } : undefined)}
          isNew={drawer.isNew}
          onSave={(data) => { onSave(data); setDrawer(null); }}
          onDelete={(id) => { onDelete(id); setDrawer(null); }}
          onClose={() => setDrawer(null)}
        />
      )}
    </div>
  );
}

// ─── LICENSING PAGE ───────────────────────────────────────────────────────────
function LicensingDrawer({
  req,
  isNew,
  onSave,
  onClose,
  onDelete,
  readOnly = false,
  canCreate = false,
  canResolve = false,
  projects = [],
}) {
  const [form, setForm] = useState(() => {
    const base = req || {
      id: "",
      createdAt: "",
      updatedAt: "",
      createdBy: "",
      status: "open",
      type: "resubmit_sku",
      projectId: "",
      skuText: "",
      styleNumbers: [],
      message: "",
      resolutionNote: "",
    };
    return {
      ...base,
      styleNumbers: normalizeStyleEntries(base.styleNumbers),
      skuText: base.skuText || "",
    };
  });
  const s = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const [confirmDelete, setConfirmDelete] = useState(false);

  const linkedProject = form.projectId ? projects.find(p => p.id === form.projectId) : null;
  const type = licTypeOf(form.type);
  const activity = form.activity || req?.activity || [];
  const canEditRequestedSkus = !readOnly && (!canResolve || canCreate);
  const canEditArtSkus = !readOnly && canResolve;
  const artSkuEntries = normalizeStyleEntries(form.styleNumbers);
  const [closing, setClosing] = useState(false);

  const requestClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
    setTimeout(() => onClose?.(), 180);
  }, [closing, onClose]);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [requestClose]);

  return (
    <>
      <div className={`drawer-overlay ${closing ? "closing" : ""}`} onClick={requestClose} />
      <div className={`drawer ${closing ? "closing" : ""}`}>
        <div className="drawer-handle" />
        <div className="drawer-cat-bar" style={{ background: type.dot }} />
        <div className="drawer-inner">
          <div className="drawer-head">
            <span className="eyebrow">
              {readOnly ? "View" : isNew ? "New" : "Edit"} Licensing Request
            </span>
            <button onClick={requestClose} className="close-btn">✕</button>
          </div>

          <div className="field-grid lic-drawer-sections">
            <div className="lic-section-head">Licensing</div>

            <Field label="Type" full>
              <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                {LIC_TYPES.map(t => (
                  <button key={t.id} type="button" disabled={!canEditRequestedSkus}
                    onClick={() => canEditRequestedSkus && s("type", t.id)}
                    className={`ss-status-btn ${form.type === t.id ? "ss-status-active" : ""}`}>
                    <span className="ss-dot" style={{ background: t.dot }} />{t.label}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="Linked project (optional)" full>
              <Select value={form.projectId || ""} disabled={!canEditRequestedSkus}
                onChange={e => s("projectId", e.target.value)}>
                <option value="">None</option>
                {projects
                  .filter(p => p.stage !== "archived")
                  .map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
              </Select>
              {linkedProject && (
                <div className="field-hint">Linked to: {linkedProject.title}</div>
              )}
            </Field>

            <Field label="Request" full>
              <Textarea rows={4} value={form.message || ""} disabled={!canEditRequestedSkus}
                onChange={e => s("message", e.target.value)}
                placeholder="What does Licensing need from Art?" />
              {!canEditRequestedSkus && <div className="field-hint">From Licensing — read only</div>}
            </Field>

            {(canEditRequestedSkus || (form.skuText || "").trim()) && (
              <Field label="Requested SKU(s)" full>
                <Textarea rows={3} value={form.skuText || ""} disabled={!canEditRequestedSkus}
                  onChange={e => s("skuText", e.target.value)}
                  placeholder={"One SKU per line\nExample: ABC-123\nXYZ-987"} />
                {!canEditRequestedSkus && <div className="field-hint">From Licensing — read only</div>}
              </Field>
            )}

            {(!isNew || canResolve || (form.resolutionNote || "").trim() || artSkuEntries.length > 0) && (
              <>
                <div className="lic-section-head art">Art team</div>

                <Field label="Resolution note" full>
                  <Textarea rows={3} value={form.resolutionNote || ""} disabled={readOnly || !canResolve}
                    onChange={e => s("resolutionNote", e.target.value)}
                    placeholder="What was changed / what was resubmitted" />
                  {!canResolve && <div className="field-hint">Art completes this when closing the request</div>}
                </Field>

                {(canEditArtSkus || artSkuEntries.length > 0) && (
                  <div className="field field-full">
                    <StyleSkuSection
                      value={form.styleNumbers}
                      onChange={v => s("styleNumbers", v)}
                      canEdit={canEditArtSkus}
                      label="SKUs with links"
                      emptyHint="Add SKU + Centric link (optional)"
                    />
                    {!canEditArtSkus && <div className="field-hint">Added by Art when completing the request</div>}
                  </div>
                )}

                <Field label="Status" full>
                  <div className="lic-status-row">
                    <span className={`lic-status-pill ${form.status === "done" ? "done" : "open"}`}>
                      {form.status === "done" ? "Done" : "Open"}
                    </span>
                    <span className="mono">
                      {form.createdBy ? `${form.createdBy} · ` : ""}{form.createdAt ? formatActivityTime(form.createdAt) : ""}
                    </span>
                  </div>
                  {!readOnly && canResolve && (
                    <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginTop:8 }}>
                      {form.status !== "done" ? (
                        <button type="button" className="btn-primary" onClick={() => s("status", "done")}>Mark done</button>
                      ) : (
                        <button type="button" className="btn-cancel" onClick={() => s("status", "open")}>Reopen</button>
                      )}
                    </div>
                  )}
                </Field>
              </>
            )}
          </div>

          {!isNew && <ActivityLog activity={activity} />}

          {!readOnly ? (
            <div className="drawer-actions">
              <button
                onClick={() => onSave({
                  ...form,
                  id: form.id || `lic${Date.now()}`,
                  status: form.status === "done" ? "done" : "open",
                  styleNumbers: normalizeStyleEntries(form.styleNumbers),
                })}
                disabled={!String(form.message || "").trim()}
                className="btn-primary"
              >
                {isNew ? "Create request" : "Save changes"}
              </button>
              {!isNew && (
                confirmDelete
                  ? <div style={{ display:"flex", gap:8, flex:1 }}>
                      <button onClick={() => onDelete(form.id)} className="btn-danger" style={{ flex:1 }}>Yes, delete</button>
                      <button onClick={() => setConfirmDelete(false)} className="btn-cancel">Cancel</button>
                    </div>
                  : <button onClick={() => setConfirmDelete(true)} className="btn-danger">Delete</button>
              )}
            </div>
          ) : (
            <div className="drawer-actions">
              <button onClick={requestClose} className="btn-primary" style={{ width: "100%" }}>Close</button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function LicensingPage({
  requests,
  projects,
  onSave,
  onDelete,
  canCreate = false,
  canEdit = false,
  canResolve = false,
}) {
  const [statusTab, setStatusTab] = useState("open"); // "open" | "done"
  const [search, setSearch] = useState("");
  const [drawer, setDrawer] = useState(null); // { isNew, req }

  const norm = (v) => (v || "").toString().toLowerCase();
  const q = norm(search).trim();
  const projTitle = (id) => projects.find(p => p.id === id)?.title || "";

  const openCount = requests.filter(r => (r.status || "open") !== "done").length;
  const doneCount = requests.filter(r => (r.status || "open") === "done").length;
  const typeCounts = LIC_TYPES.reduce((a, t) => {
    a[t.id] = (requests || []).filter(r => (r.status || "open") !== "done" && (r.type || "general") === t.id).length;
    return a;
  }, {});

  const visible = (requests || [])
    .slice()
    .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")))
    .filter(r => (statusTab === "done" ? (r.status === "done") : (r.status !== "done")))
    .filter(r => {
      if (!q) return true;
      return (
        norm(r.skuText).includes(q) ||
        styleNumbersOf({ styleNumbers: r.styleNumbers }).some(s => norm(s).includes(q)) ||
        norm(r.message).includes(q) ||
        norm(r.type).includes(q) ||
        norm(projTitle(r.projectId)).includes(q)
      );
    });

  return (
    <div className="lic-page">
      <div className="ss-topbar">
        <div>
          <h1 className="page-title">Licensing Requests</h1>
          <p className="page-sub">{openCount} open · {doneCount} done</p>
        </div>
        <div style={{ display:"flex", gap:10, alignItems:"center", flexWrap:"wrap" }}>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search SKUs, requests, project…" className="ss-search" />
          {canCreate && <button onClick={() => setDrawer({ isNew: true })} className="btn-new">+ New Request</button>}
        </div>
      </div>

      <div className="stats-bar">
        <div className="stat" style={{ borderColor: "rgba(251,191,36,0.25)" }}>
          <div><div className="stat-val" style={{ color: C.amber }}>{openCount}</div><div className="stat-label">Open</div></div>
        </div>
        <div className="stat" style={{ borderColor: "rgba(52,211,153,0.25)" }}>
          <div><div className="stat-val" style={{ color: C.green }}>{doneCount}</div><div className="stat-label">Done</div></div>
        </div>
        {LIC_TYPES.map(t => (
          <div key={t.id} className="stat" style={{ borderColor: "rgba(148,148,176,0.18)" }}>
            <div><div className="stat-val" style={{ color: t.dot }}>{typeCounts[t.id] || 0}</div><div className="stat-label">{t.label}</div></div>
          </div>
        ))}
      </div>

      <div className="ss-cust-tabs">
        <button onClick={() => setStatusTab("open")} className={`ss-ctab ${statusTab === "open" ? "active" : ""}`}>
          Open <span className="tab-ct">{openCount}</span>
        </button>
        <button onClick={() => setStatusTab("done")} className={`ss-ctab ${statusTab === "done" ? "active" : ""}`}>
          Done <span className="tab-ct">{doneCount}</span>
        </button>
      </div>

      {visible.length === 0 ? (
        <div className="ss-zero" style={{ paddingTop: 64 }}>
          <div className="ss-zero-icon">◈</div>
          <div className="ss-zero-title">No requests found</div>
          <div className="ss-zero-sub">{search.trim() ? "Try a different search." : "Create your first request to track SKU resubmissions and notes."}</div>
          {canCreate && <button onClick={() => setDrawer({ isNew: true })} className="btn-new" style={{ marginTop:16 }}>+ New Request</button>}
        </div>
      ) : (
        <div className="lic-grid">
          {visible.map(r => {
            const t = licTypeOf(r.type);
            const linked = r.projectId ? projects.find(p => p.id === r.projectId) : null;
            const editable = canEdit;
            return (
              <div key={r.id} className="lic-card" onClick={() => setDrawer({ isNew: false, req: r })}>
                <div className="lic-card-top">
                  <div style={{ display:"flex", alignItems:"center", gap:8, minWidth:0 }}>
                    <span className="ss-dot" style={{ background: t.dot }} />
                    <span className="lic-type">{t.label}</span>
                    <span className={`lic-status-pill ${r.status === "done" ? "done" : "open"}`}>
                      {r.status === "done" ? "Done" : "Open"}
                    </span>
                  </div>
                  <div className="lic-meta">{r.createdBy || "Team member"} · {formatActivityTime(r.updatedAt || r.createdAt)}</div>
                </div>
                {linked && <div className="lic-linked">Project: <span className="lic-linked-title">{linked.title}</span></div>}
                {r.message?.trim() && <div className="lic-msg">{r.message.trim()}</div>}
                {r.skuText?.trim() && <div className="lic-skus"><span className="lic-skus-label">Requested</span><pre className="lic-skus-pre">{r.skuText.trim()}</pre></div>}
                <StyleSkuCardLinks numbers={r.styleNumbers} max={4} />
                {!editable && <div className="field-hint" style={{ marginTop: 10 }}>View only</div>}
              </div>
            );
          })}
        </div>
      )}

      {drawer && (
        <LicensingDrawer
          req={drawer.req}
          isNew={drawer.isNew}
          onSave={(data) => { onSave(data); setDrawer(null); }}
          onDelete={(id) => { onDelete(id); setDrawer(null); }}
          onClose={() => setDrawer(null)}
          readOnly={!canEdit}
          canCreate={canCreate}
          canResolve={canResolve}
          projects={projects}
        />
      )}
    </div>
  );
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
export default function StudioTracker() {
  const { canEdit, isViewer, isLicensingTeam, hasLicensingAccess, boardName, user, isLoaded } = useAppRole();
  const boardProfile = resolveTeamProfile(boardName) || boardName;
  const { nickname } = useNickname(user?.id);
  const viewerAssigneeName = resolveViewerTeamName(boardName, nickname);
  const actor = activityActor(boardProfile, user);
  const canEditProjects = canEdit && !isLicensingTeam;
  const canEditSelectSets = canEdit && !isLicensingTeam;
  const canEditLicensing = canEdit;
  const canCreateLicensing = canEdit && hasLicensingAccess;
  const canResolveLicensing = canEdit && !isLicensingTeam;
  const [projects,       setProjects]       = useState([]);
  const [sets,           setSets]           = useState([]);
  const [licRequests,    setLicRequests]    = useState([]);
  const licSeenKey = user?.id ? `lic_seen_${user.id}` : null;
  const licSeenAt = (() => {
    if (!licSeenKey) return 0;
    try {
      const v = localStorage.getItem(licSeenKey);
      return v ? Date.parse(v) || 0 : 0;
    } catch {
      return 0;
    }
  })();
  const [loading,        setLoading]        = useState(true);
  const pageKey = user?.id ? `st_page_${user.id}` : "st_page";
  const [page, setPage] = useState(() => {
    try {
      const v = localStorage.getItem(pageKey);
      if (v === "projects" || v === "selectsets" || v === "licensing") return v;
    } catch {
      /* ignore */
    }
    return "projects";
  }); // "projects" | "selectsets" | "licensing"
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [assigneeFilter, setAssigneeFilter] = useState(null);
  const [boardTagFilter, setBoardTagFilter] = useState(null); // null | "priority" | "awaiting_sales" | "licenses" | "sales_info"
  const [search,         setSearch]         = useState("");
  const [view,           setView]           = useState("board");
  const [boardMode,      setBoardMode]      = useState("products"); // "products" | "presentations"
  const [drawer,         setDrawer]         = useState(null);
  const [projectHighlightSeen, setProjectHighlightSeen] = useState(() => loadProjectHighlightSeen(user?.id));
  const [toast,          setToast]          = useState(null); // { message, onUndo? }
  const toastTimerRef = useRef(null);

  useEffect(() => {
    if (user?.id) setProjectHighlightSeen(loadProjectHighlightSeen(user.id));
  }, [user?.id]);

  const markProjectSeen = useCallback((project) => {
    if (!user?.id || !project?.id) return;
    const keys = projectHighlightSeenKeys(project);
    if (!Object.keys(keys).length) return;
    setProjectHighlightSeen(prev => {
      let changed = false;
      const next = { ...prev };
      for (const [k, v] of Object.entries(keys)) {
        if (next[k] !== v) {
          next[k] = v;
          changed = true;
        }
      }
      if (!changed) return prev;
      saveProjectHighlightSeen(user.id, next);
      return next;
    });
  }, [user?.id]);

  const shouldGlowProject = useCallback(
    (p) => shouldGlowProjectForViewer(p, projectHighlightSeen, viewerAssigneeName),
    [projectHighlightSeen, viewerAssigneeName],
  );

  const openProject = useCallback((p) => {
    markProjectSeen(p);
    setDrawer({ isNew: false, project: p });
  }, [markProjectSeen]);

  const clearToastTimer = () => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
  };

  const flash = useCallback((msg) => {
    clearToastTimer();
    setToast({ message: msg });
    toastTimerRef.current = setTimeout(() => setToast(null), 2400);
  }, []);

  const showUndoToast = useCallback((message, onUndo, ms = 5000) => {
    clearToastTimer();
    setToast({ message, onUndo });
    toastTimerRef.current = setTimeout(() => setToast(null), ms);
  }, []);

  const runUndo = useCallback(() => {
    if (!toast?.onUndo) return;
    const undo = toast.onUndo;
    clearToastTimer();
    setToast(null);
    undo();
  }, [toast]);

  useEffect(() => () => {
    clearToastTimer();
  }, []);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        if (window.storage.migrate) await window.storage.migrate();
        const [p, s, l] = await Promise.all([load(), loadSS(), loadLic()]);
        if (!active) return;
        setProjects(p);
        setSets(s);
        setLicRequests(Array.isArray(l) ? l : []);
      } catch (e) {
        console.error("Failed to load team data:", e);
        if (active) flash("Could not load team board — check Supabase settings");
      } finally {
        if (active) setLoading(false);
      }
    })();

    const mergeProjectHighlights = (incoming, prev) => {
      if (!Array.isArray(prev) || !prev.length) return incoming;
      const prevById = new Map(prev.map(p => [p.id, p]));
      return incoming.map(p => {
        const loc = prevById.get(p.id);
        if (!loc) return p;
        return {
          ...p,
          highlightAt: p.highlightAt || loc.highlightAt,
          assignHighlightAt: p.assignHighlightAt || loc.assignHighlightAt,
          assignHighlightFor: (Array.isArray(p.assignHighlightFor) && p.assignHighlightFor.length)
            ? p.assignHighlightFor
            : loc.assignHighlightFor,
        };
      });
    };

    const applyRemote = (setter, raw, normalize) => {
      try {
        let data = JSON.parse(raw);
        if (normalize && Array.isArray(data)) data = data.map(normalizeProjectForSave);
        setter(prev => (normalize ? mergeProjectHighlights(data, prev) : data));
      } catch {
        /* ignore malformed payloads */
      }
    };

    const unsubProjects =
      window.storage.subscribe?.("st_v10", (value) => applyRemote(setProjects, value, true)) ??
      (() => {});

    const unsubSets =
      window.storage.subscribe?.("ss_v1", (value) => applyRemote(setSets, value)) ??
      (() => {});

    const unsubLic =
      window.storage.subscribe?.("lic_v1", (value) => applyRemote(setLicRequests, value)) ??
      (() => {});

    const reloadFromCloud = () => {
      Promise.all([load(), loadSS(), loadLic()]).then(([p, s, l]) => {
        if (!active) return;
        setProjects(p);
        setSets(s);
        setLicRequests(Array.isArray(l) ? l : []);
      }).catch(() => {});
    };

    window.addEventListener("focus", reloadFromCloud);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") reloadFromCloud();
    });

    return () => {
      active = false;
      unsubProjects();
      unsubSets();
      unsubLic();
      window.removeEventListener("focus", reloadFromCloud);
    };
  }, []);

  const saveProjects = useCallback(async (next, msg) => {
    setProjects(next);
    try {
      await save(next);
      if (msg) flash(msg);
    } catch (e) {
      console.error(e);
      flash("Could not save — team may not see this change");
    }
  }, []);

  const handleAssign = useCallback((id, name) => {
    if (!canEditProjects) return;
    const proj = projects.find(p => p.id === id);
    if (!proj) return;
    const current = projectAssignees(proj);
    if (current.includes(name)) return;
    const assignees = [...current, name];
    const updated = withActivity(proj, normalizeProjectForSave({
      ...proj,
      assignees,
      assignHighlightAt: new Date().toISOString(),
      assignHighlightFor: [name],
    }), actor);
    const next = projects.map(p => p.id === id ? updated : p);
    saveProjects(next, `Added ${name} to "${proj.title}"`);
  }, [projects, saveProjects, actor, canEditProjects]);

  const handleReorder = useCallback((id, newStage, beforeId) => {
    if (!canEditProjects) return;
    const proj = projects.find(p => p.id === id);
    if (!proj) return;
    let next = projects.filter(p => p.id !== id);
    const updated = withActivity(proj, { ...proj, stage: newStage }, actor);
    if (beforeId) { const i = next.findIndex(p => p.id === beforeId); next.splice(i >= 0 ? i : next.length, 0, updated); }
    else { const idxs = next.map((p, i) => p.stage === newStage ? i : -1).filter(i => i >= 0); next.splice(idxs.length ? idxs[idxs.length - 1] + 1 : next.length, 0, updated); }
    const msg = proj.stage !== newStage ? `Moved to ${stageOf(newStage).label}` : null;
    saveProjects(next, msg);
  }, [projects, saveProjects, actor, canEditProjects]);

  const handleQuickAdd = useCallback((stageId, title) => {
    if (!canEditProjects) return;
    const assignees = assigneeFilter
      ? [assigneeFilter]
      : [defaultAssignee(boardProfile)];
    const now = new Date().toISOString();
    const p = {
      id: `p${Date.now()}`, title, stage: stageId,
      projectType: boardMode === "presentations" ? "presentation" : "product",
      category: categoryFilter !== "all" ? categoryFilter : "apparel",
      assignees, season: "SS26", dueDate: "", notes: "", styleNumbers: [], activity: [],
      highlightAt: now,
      assignHighlightAt: now,
      assignHighlightFor: assignees,
    };
    const created = withActivity(null, p, actor);
    saveProjects([...projects, created], `Added "${title}"`);
  }, [projects, saveProjects, categoryFilter, assigneeFilter, boardMode, canEditProjects, actor]);

  const handleSave = (data) => {
    if (!canEditProjects) return;
    const exists = projects.some(p => p.id === data.id);
    const prev = exists ? projects.find(p => p.id === data.id) : null;
    const prevAs = prev ? projectAssignees(prev) : [];
    const nextAs = projectAssignees(data);
    const addedAssignees = nextAs.filter(n => !prevAs.includes(n));
    const now = new Date().toISOString();
    const highlightPatch = !exists
      ? {
          highlightAt: now,
          assignHighlightAt: now,
          assignHighlightFor: nextAs,
        }
      : addedAssignees.length
        ? { assignHighlightAt: now, assignHighlightFor: addedAssignees }
        : {};
    const payload = normalizeProjectForSave({
      ...data,
      ...highlightPatch,
      styleNumbers: normalizeStyleEntries(data.styleNumbers),
    });
    const updated = withActivity(prev, payload, actor);
    const next = exists ? projects.map(p => p.id === data.id ? updated : p) : [updated, ...projects];
    saveProjects(next);
    setDrawer(null);
  };

  const handleMoveBoard = (data, targetType) => {
    if (!canEditProjects) return;
    const prev = projects.find(p => p.id === data.id);
    if (!prev) return;
    const payload = normalizeProjectForSave({
      ...data,
      styleNumbers: normalizeStyleEntries(data.styleNumbers),
    });
    const converted = convertProjectBetweenBoards(payload, targetType);
    const updated = withActivity(prev, converted, actor);
    const next = projects.map(p => p.id === data.id ? updated : p);
    setBoardMode(targetType === "presentation" ? "presentations" : "products");
    saveProjects(next, targetType === "presentation" ? "Moved to Presentations" : "Moved to Products");
    setDrawer(null);
  };
  const handleDelete = (id) => {
    if (!canEditProjects) return;
    const removed = projects.find(p => p.id === id);
    if (!removed) return;
    const snapshot = projects;
    const next = projects.filter(p => p.id !== id);
    setDrawer(null);
    saveProjects(next);
    showUndoToast(`Deleted “${removed.title}”`, () => saveProjects(snapshot));
  };

  const presentationProjects = projects.filter(p => p.projectType === "presentation");
  const licOpenCount = (licRequests || []).filter(r => (r?.status || "open") !== "done").length;
  const licDoneUpdatedCount = (licRequests || []).filter(r => {
    if (!r) return false;
    if ((r.status || "open") !== "done") return false;
    const t = Date.parse(r.updatedAt || r.createdAt || "") || 0;
    return t > licSeenAt;
  }).length;

  useEffect(() => {
    if (page !== "licensing") return;
    if (!hasLicensingAccess) return;
    if (!licSeenKey) return;
    try {
      localStorage.setItem(licSeenKey, new Date().toISOString());
    } catch {
      /* ignore */
    }
  }, [page, hasLicensingAccess, licSeenKey]);

  useEffect(() => {
    try {
      localStorage.setItem(pageKey, page);
    } catch {
      /* ignore */
    }
  }, [pageKey, page]);
  const catPool = projects.filter(p => {
    const typeOk = boardMode === "presentations" ? p.projectType === "presentation" : p.projectType !== "presentation";
    const asnOk  = !assigneeFilter || projectHasAssignee(p, assigneeFilter);
    const q = search.toLowerCase();
    const txtOk  = !search || p.title.toLowerCase().includes(q) || styleNumbersOf(p).some(s => s.toLowerCase().includes(q));
    return typeOk && asnOk && txtOk && p.stage !== "archived";
  });
  const catCounts = CATEGORIES.reduce((a, c) => {
    a[c.id] = c.id === "all" ? catPool.length : catPool.filter(p => p.category === c.id).length;
    return a;
  }, {});
  const filtered = projects.filter(p => {
    const typeOk = boardMode === "presentations" ? p.projectType === "presentation" : p.projectType !== "presentation";
    const catOk  = categoryFilter === "all" || p.category === categoryFilter;
    const asnOk  = !assigneeFilter || projectHasAssignee(p, assigneeFilter);
    const tagOk  = !boardTagFilter
      || (boardTagFilter === "priority" && hasPriority(p))
      || (boardTagFilter === "awaiting_sales" && isBlockedBySales(p))
      || (boardTagFilter === "licenses" && isWaitingOnLicenses(p))
      || (boardTagFilter === "sales_info" && isWaitingOnSalesInfo(p));
    const q = search.toLowerCase();
    const txtOk  = !search || p.title.toLowerCase().includes(q) || styleNumbersOf(p).some(s => s.toLowerCase().includes(q));
    return typeOk && catOk && asnOk && tagOk && txtOk;
  });
  const activeStages  = boardMode === "presentations" ? PRES_STAGES : STAGES;
  const visibleNonArchived = filtered.filter(p => p.stage !== "archived");
  const activeCount   = visibleNonArchived.length;
  const presCountGlobal = presentationProjects.filter(p => p.stage !== "archived").length;
  const presCount     = boardMode === "presentations" ? activeCount : presCountGlobal;
  const prodCount     = filtered.filter(p => p.stage === "prod_ready").length;
  const overdueCount  = visibleNonArchived.filter(p => { const d = daysUntil(p.dueDate); return d !== null && d < 0; }).length;
  const productPool = projects.filter(p => p.projectType !== "presentation" && p.stage !== "archived");
  const presPool = projects.filter(p => p.projectType === "presentation" && p.stage !== "archived");
  const activePool = boardMode === "presentations" ? presPool : productPool;
  const priorityCount = activePool.filter(hasPriority).length;
  const awaitingSalesCount = productPool.filter(isWaitingOnSalesProduct).length;
  const licensesCount = presPool.filter(isWaitingOnLicenses).length;
  const presSalesInfoCount = presPool.filter(isWaitingOnSalesInfo).length;
  const presBlockedCount = presPool.filter(p => isWaitingOnLicenses(p) || isWaitingOnSalesInfo(p)).length;

  const handleSSave = (data) => {
    if (!canEditSelectSets) return;
    setSets(prev => {
      const exists = prev.some(s => s.id === data.id);
      const next = exists ? prev.map(s => s.id === data.id ? data : s) : [data, ...prev];
      saveSS(next); return next;
    });
  };
  const handleSDelete = (id) => {
    if (!canEditSelectSets) return;
    const removed = sets.find(s => s.id === id);
    if (!removed) return;
    const snapshot = sets;
    const next = sets.filter(s => s.id !== id);
    setSets(next);
    saveSS(next);
    showUndoToast(`Deleted “${removed.name}”`, () => {
      setSets(snapshot);
      saveSS(snapshot);
    });
  };

  const handleLicSave = (data) => {
    if (!canEditLicensing) return;
    setLicRequests(prev => {
      const now = new Date().toISOString();
      const exists = prev.some(r => r.id === data.id);
      const prevRow = exists ? prev.find(r => r.id === data.id) : null;
      const createdAt = exists ? (prevRow?.createdAt || now) : (data.createdAt || now);
      const basePreActivity = {
        ...data,
        createdAt,
        updatedAt: now,
        status: data.status === "done" ? "done" : "open",
      };
      const payload = {
        ...basePreActivity,
        styleNumbers: normalizeStyleEntries(basePreActivity.styleNumbers),
      };
      const base = withLicActivity(prevRow, payload, actor, projects);
      const next = exists ? prev.map(r => r.id === data.id ? base : r) : [base, ...prev];
      saveLic(next);
      return next;
    });
  };

  const handleLicDelete = (id) => {
    if (!canEditLicensing) return;
    const removed = licRequests.find(r => r.id === id);
    if (!removed) return;
    const snapshot = licRequests;
    const next = licRequests.filter(r => r.id !== id);
    setLicRequests(next);
    saveLic(next);
    showUndoToast("Deleted licensing request", () => {
      setLicRequests(snapshot);
      saveLic(snapshot);
    });
  };

  if (loading) return <div style={{ minHeight:"100vh", background:"#0C0C10", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"Open Sans,sans-serif", color:"#56566A" }}>Loading…</div>;

  return (
    <div className="app">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;500;600;700;800&display=swap');
        *, *::before, *::after { box-sizing: border-box; }
        body { margin: 0; }
        .app { min-height: 100vh; background: #0C0C10; color: #F0F0F6; font-family: 'Open Sans', sans-serif; -webkit-font-smoothing: antialiased; }
        html { scroll-behavior: smooth; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #2A2A36; border-radius: 4px; }
        input::placeholder, textarea::placeholder { color: #56566A; }
        .mono { font-family: monospace; font-size: 11px; color: #56566A; }
        .sep { color: #2A2A36; }
        .c-red { color: #F87171 !important; font-weight: 600; }
        .c-amber { color: #FBBF24 !important; font-weight: 500; }

        /* ── AVATARS ── */
        .av { border-radius: 50%; color: #fff; display: inline-flex; align-items: center; justify-content: center; font-weight: 700; flex-shrink: 0; }
        .av-sm { width: 22px; height: 22px; font-size: 9px; }
        .av-md { width: 28px; height: 28px; font-size: 11px; }
        .av-lg { width: 42px; height: 42px; font-size: 15px; box-shadow: 0 6px 20px rgba(0,0,0,0.5); }

        /* ── HEADER ── */
        .header {
          position: sticky; top: 0; z-index: 50;
          background: rgba(12,12,16,0.92); backdrop-filter: blur(12px);
          border-bottom: 1px solid #1E1E28;
          padding: 0 28px; height: 58px;
          display: flex; align-items: center; justify-content: space-between;
        }
        .brand { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; min-width: 0; }
        .header-profile-wrap { position: relative; margin-left: 2px; }
        .brand .header-profile { margin-left: 0; cursor: pointer; border: none; font-family: inherit; }
        .brand .header-profile:hover { border-color: #8B7FFF55; background: #1C1C28; }
        .header-profile-name.muted { color: #56566A; font-weight: 500; }
        .brand .header-profile-name { max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .nick-pop-backdrop { position: fixed; inset: 0; z-index: 200; }
        .nick-pop { position: absolute; top: calc(100% + 8px); left: 0; z-index: 201; min-width: 220px; padding: 14px; background: #1C1C24; border: 1px solid #2A2A36; border-radius: 12px; box-shadow: 0 16px 40px rgba(0,0,0,0.5); }
        .nick-pop-title { font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #56566A; margin-bottom: 8px; }
        .nick-pop-actions { display: flex; gap: 8px; margin-top: 10px; }
        .nick-save { flex: 1; padding: 8px 12px; font-size: 13px; }
        .nick-pop-hint { font-size: 11px; color: #56566A; margin: 10px 0 0; line-height: 1.4; }
        .brand-mark {
          width: 30px; height: 30px;
          background: linear-gradient(135deg, #8B7FFF, #6055CC);
          border-radius: 8px; display: flex; align-items: center; justify-content: center;
          font-size: 14px; color: #fff;
        }
        .brand-name { font-size: 16px; font-weight: 700; color: #F0F0F6; }
        .brand-tag { font-size: 11px; color: #56566A; }
        .sync-pill {
          font-size: 10px; font-weight: 600; letter-spacing: 0.02em;
          padding: 3px 8px; border-radius: 100px; margin-left: 4px;
          background: rgba(52,211,153,0.12); color: #34D399; border: 1px solid rgba(52,211,153,0.3);
        }
        .sync-pill.viewer { background: rgba(96,165,250,0.12); color: #60A5FA; border-color: rgba(96,165,250,0.35); }
        .sync-pill.local {
          background: rgba(251,191,36,0.12); color: #FBBF24; border-color: rgba(251,191,36,0.35);
        }
        .nav-center {
          position: absolute;
          left: 50%;
          transform: translateX(-50%);
          display: flex;
          justify-content: center;
          pointer-events: none;
        }
        .nav-center > * { pointer-events: auto; }
        .header-right { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
        .header-profile { display: flex; align-items: center; gap: 8px; padding: 4px 10px 4px 4px; border-radius: 20px; background: #1C1C24; border: 1px solid #2A2A36; }
        .header-profile-name { font-size: 12px; font-weight: 500; color: #F0F0F6; }
        .view-toggle { display: flex; gap: 2px; background: #14141A; border: 1px solid #2A2A36; border-radius: 8px; padding: 3px; }
        .view-btn { padding: 6px 12px; font-size: 12px; font-weight: 600; background: transparent; border: none; border-radius: 6px; color: #56566A; cursor: pointer; font-family: inherit; transition: all 0.15s; }
        .view-btn.active { background: #23232D; color: #F0F0F6; }
        .btn-new { padding: 8px 16px; background: #8B7FFF; color: #fff; border: none; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; white-space: nowrap; transition: opacity 0.15s; }
        .btn-new:hover { opacity: 0.88; }
        .btn-new:active { transform: scale(0.97); }

        /* ── MAIN ── */
        .main { padding: 24px 28px 60px; }
        .page-title { margin: 0 0 4px; font-size: 28px; font-weight: 700; color: #F0F0F6; }
        .page-sub { margin: 0 0 20px; color: #56566A; font-size: 13px; }

        /* ── STATS ── */
        .stats-bar { display: flex; gap: 10px; margin-bottom: 20px; flex-wrap: wrap; }
        .stat { background: #14141A; border: 1px solid #2A2A36; border-radius: 10px; padding: 12px 16px; display: flex; align-items: center; gap: 10px; min-width: 110px; transition: border-color 0.15s, background 0.15s; }
        .stat-val { font-size: 22px; font-weight: 700; color: #F0F0F6; line-height: 1; }
        .stat-label { font-size: 11px; color: #56566A; margin-top: 2px; font-weight: 500; }
        .stat-clickable { cursor: pointer; }
        .stat-clickable:hover { background: #1C1C24; }
        .stat-tone-priority .stat-val { color: #FBBF24; }
        .stat-tone-priority.on { border-color: rgba(248,113,113,0.5); background: rgba(248,113,113,0.06); }
        .stat-tone-sales .stat-val { color: #FBBF24; }
        .stat-tone-sales.on { border-color: rgba(251,191,36,0.5); background: rgba(251,191,36,0.06); }
        .stat-tone-licenses .stat-val { color: #8B7FFF; }
        .stat-tone-licenses.on { border-color: rgba(139,127,255,0.5); background: rgba(139,127,255,0.08); }

        /* ── FILTER BAR ── */
        .filter-bar { display: flex; align-items: center; gap: 8px; margin-bottom: 18px; flex-wrap: wrap; }
        .filter-section { display: flex; align-items: center; gap: 4px; }
        .filter-div { width: 1px; height: 22px; background: #2A2A36; margin: 0 4px; }
        .cat-tab { padding: 7px 13px; font-size: 12px; font-weight: 600; background: transparent; border: 1px solid transparent; border-radius: 100px; cursor: pointer; font-family: inherit; color: #56566A; transition: all 0.15s; white-space: nowrap; }
        .cat-tab:hover { background: #14141A; border-color: #2A2A36; color: #9494B0; }
        .cat-tab.active { background: #8B7FFF22; color: #8B7FFF; border-color: #8B7FFF44; }
        .tab-ct { opacity: 0.5; font-size: 10px; margin-left: 3px; }
        .asn-chip { position: relative; cursor: pointer; transition: transform 0.15s; border-radius: 50%; border: 2px solid transparent; }
        .asn-chip:hover { transform: scale(1.1); }
        .asn-chip.asn-on { border-color: #8B7FFF; box-shadow: 0 0 0 2px #0C0C10, 0 0 0 4px #8B7FFF; }
        .filter-signal-group {
          display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
          background: #14141A; border: 1px solid #1E1E28; border-radius: 10px;
          padding: 6px 12px 6px 14px;
        }
        .filter-group-label {
          font-size: 10px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase;
          color: #56566A; flex-shrink: 0; padding-right: 2px;
        }
        .signal-chip-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
        .signal-chip {
          display: inline-flex; align-items: center; gap: 7px;
          padding: 6px 11px; border-radius: 8px;
          border: 1px solid #2A2A36; background: #1C1C24;
          color: #9494B0; font-size: 11px; font-weight: 600;
          cursor: pointer; font-family: inherit; transition: all 0.15s; white-space: nowrap;
        }
        .signal-chip:hover { border-color: #3A3A50; color: #F0F0F6; background: #23232D; }
        .signal-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; background: #56566A; }
        .signal-chip.priority .signal-dot { background: #F87171; }
        .signal-chip.sales .signal-dot { background: #FBBF24; }
        .signal-chip.licenses .signal-dot { background: #8B7FFF; }
        .signal-chip.blocked .signal-dot { background: linear-gradient(135deg, #8B7FFF 50%, #FBBF24 50%); }
        .signal-chip.on { color: #F0F0F6; border-color: #3A3A50; background: #23232D; box-shadow: inset 0 0 0 1px rgba(139,127,255,0.12); }
        .signal-chip.on.priority { border-color: rgba(248,113,113,0.45); background: rgba(248,113,113,0.1); }
        .signal-chip.on.sales { border-color: rgba(251,191,36,0.45); background: rgba(251,191,36,0.1); }
        .signal-chip.on.licenses { border-color: rgba(139,127,255,0.45); background: rgba(139,127,255,0.12); }
        .signal-chip.on.blocked { border-color: rgba(139,127,255,0.35); background: rgba(139,127,255,0.08); }
        .signal-count {
          font-size: 10px; font-weight: 700; line-height: 1;
          padding: 2px 6px; border-radius: 100px;
          background: #2A2A36; color: #9494B0; min-width: 18px; text-align: center;
        }
        .signal-chip.on .signal-count { background: rgba(255,255,255,0.1); color: #F0F0F6; }
        .board-callout {
          display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap;
          margin-bottom: 14px; padding: 12px 16px; border-radius: 10px;
          background: #14141A; border: 1px solid #2A2A36;
          font-size: 13px; color: #9494B0;
        }
        .board-callout-text { display: flex; align-items: center; gap: 10px; min-width: 0; }
        .board-callout-dot {
          width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
          background: #8B7FFF; box-shadow: 0 0 0 3px rgba(139,127,255,0.2);
        }
        .board-callout strong { color: #F0F0F6; font-weight: 600; }
        .board-callout-count { display: block; font-size: 11px; color: #56566A; margin-top: 2px; font-weight: 500; }
        .board-callout-clear {
          padding: 7px 14px; border-radius: 8px; border: 1px solid #2A2A36; background: #1C1C24;
          color: #9494B0; font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit;
          transition: all 0.15s; flex-shrink: 0;
        }
        .board-callout-clear:hover { border-color: #8B7FFF55; color: #F0F0F6; background: #23232D; }
        .priority-pills {
          display: flex; gap: 6px; flex-wrap: wrap;
          background: #14141A; border: 1px solid #2A2A36; border-radius: 10px; padding: 4px;
        }
        .priority-pill {
          flex: 1; min-width: 72px; padding: 8px 12px; border-radius: 7px;
          border: 1px solid transparent; background: transparent;
          color: #56566A; font-size: 12px; font-weight: 600; cursor: pointer;
          font-family: inherit; transition: all 0.15s;
          display: inline-flex; align-items: center; justify-content: center; gap: 6px;
        }
        .priority-pill:hover:not(:disabled) { color: #9494B0; background: #1C1C24; }
        .priority-pill.on { color: #F0F0F6; background: #23232D; border-color: #3A3A50; }
        .priority-pill.tone-high.on { border-color: rgba(251,191,36,0.4); background: rgba(251,191,36,0.1); color: #FBBF24; }
        .priority-pill.tone-urgent.on { border-color: rgba(248,113,113,0.45); background: rgba(248,113,113,0.1); color: #F87171; }
        .priority-pill-dot { width: 6px; height: 6px; border-radius: 50%; }
        .priority-pill.tone-high .priority-pill-dot { background: #FBBF24; }
        .priority-pill.tone-urgent .priority-pill-dot { background: #F87171; }
        .blocker-toggles { display: flex; flex-direction: column; gap: 8px; }
        .blocker-toggle {
          display: flex; align-items: flex-start; gap: 12px; width: 100%; text-align: left;
          padding: 12px 14px; border-radius: 10px; border: 1px solid #2A2A36; background: #14141A;
          cursor: pointer; font-family: inherit; transition: all 0.15s;
        }
        .blocker-toggle:hover:not(:disabled) { border-color: #3A3A50; background: #1C1C24; }
        .blocker-toggle:disabled { cursor: default; opacity: 0.85; }
        .blocker-toggle-mark {
          width: 22px; height: 22px; border-radius: 6px; flex-shrink: 0;
          border: 1px solid #3A3A50; background: #1C1C24;
          display: flex; align-items: center; justify-content: center;
          font-size: 12px; font-weight: 700; color: #F0F0F6;
        }
        .blocker-toggle-body { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
        .blocker-toggle-title { font-size: 13px; font-weight: 600; color: #F0F0F6; line-height: 1.3; }
        .blocker-toggle-desc { font-size: 11px; color: #56566A; line-height: 1.45; font-weight: 400; }
        .blocker-toggle.on.sales { border-color: rgba(251,191,36,0.4); background: rgba(251,191,36,0.08); }
        .blocker-toggle.on.sales .blocker-toggle-mark { border-color: #FBBF24; background: rgba(251,191,36,0.2); color: #FBBF24; }
        .blocker-toggle.on.licenses { border-color: rgba(139,127,255,0.45); background: rgba(139,127,255,0.08); }
        .blocker-toggle.on.licenses .blocker-toggle-mark { border-color: #8B7FFF; background: rgba(139,127,255,0.2); color: #8B7FFF; }

        /* ── CAT LEGEND ── */
        .cat-legend { display: flex; gap: 14px; margin-bottom: 12px; flex-wrap: wrap; }
        .legend-item { display: flex; align-items: center; gap: 5px; font-size: 11px; color: #9494B0; font-weight: 500; }
        .legend-dot { width: 8px; height: 8px; border-radius: 2px; }

        /* ── CAT CHIP (shared) ── */
        .cat-chip { font-size: 10px; font-weight: 700; letter-spacing: 0.04em; padding: 2px 7px; border-radius: 4px; }
        .cat-chip.sm { font-size: 10px; }

        /* ── TEAM STRIP ── */
        .team-strip { background: #14141A; border: 1px solid #2A2A36; border-radius: 12px; padding: 12px 16px; margin-bottom: 12px; }
        .team-strip-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
        .strip-label { font-size: 10px; letter-spacing: 0.1em; color: #56566A; text-transform: uppercase; font-weight: 700; }
        .strip-hint { font-size: 11px; color: #56566A; }
        .team-row { display: flex; gap: 8px; flex-wrap: wrap; }
        .team-chip { display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px 5px 5px; background: #1C1C24; border: 1px solid #2A2A36; border-radius: 100px; font-size: 12px; color: #9494B0; cursor: grab; transition: all 0.15s; user-select: none; -webkit-user-select: none; touch-action: none; }
        .team-chip:hover { border-color: #3A3A50; color: #F0F0F6; }
        .team-chip:active { cursor: grabbing; }
        .chip-on { border-color: var(--tc) !important; background: #1C1C24 !important; box-shadow: 0 0 0 3px color-mix(in srgb, var(--tc) 20%, transparent) !important; transform: scale(1.04); color: #F0F0F6 !important; }
        .chip-lifting { opacity: 0.25; transform: scale(0.95); }
        .chip-name { font-weight: 600; font-size: 12px; }
        .chip-grip { font-size: 11px; color: #3A3A50; }

        /* ── BOARD ── */
        .board {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          padding-bottom: 16px;
          align-items: stretch;
        }
        .col {
          flex: 0 0 calc(25% - 9px);
          min-width: 240px;
          min-height: 220px;
          display: flex;
          flex-direction: column;
        }
        .col-collapsed {
          flex: 0 0 auto;
          min-width: 130px;
          max-width: 160px;
          min-height: 0;
        }
        .col-body {
          display: flex; flex-direction: column; gap: 8px;
          flex: 1;
          min-height: 0;
          max-height: min(70vh, calc(100dvh - 300px));
          overflow-y: auto;
          overflow-x: hidden;
          overscroll-behavior: contain;
          -webkit-overflow-scrolling: touch;
          scrollbar-gutter: stable;
        }

        /* ── COLUMNS ── */
        .col { background: #14141A; border: 1px solid #1E1E28; border-radius: 12px; padding: 10px; transition: background 0.15s, border-color 0.15s; overflow: visible; }
        .col-on { background: #1C1C28; border-color: #8B7FFF44; box-shadow: inset 0 0 0 1px #8B7FFF44; }
        .col-collapsed { flex: 0 0 auto; min-width: 140px; }
        .col-head { display: flex; align-items: center; gap: 7px; padding: 5px 6px 10px; cursor: pointer; user-select: none; }
        .col-collapsed .col-head { padding-bottom: 5px; }
        .col-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
        .col-title { font-size: 12px; font-weight: 700; color: #9494B0; white-space: nowrap; letter-spacing: 0.04em; text-transform: uppercase; }
        .col-count { background: #1E1E28; color: #56566A; padding: 2px 7px; border-radius: 10px; font-size: 11px; font-weight: 600; flex-shrink: 0; }
        .col-late { background: rgba(248,113,113,0.12); color: #F87171; border: 1px solid rgba(248,113,113,0.25); border-radius: 10px; padding: 2px 7px; font-size: 10px; font-weight: 700; flex-shrink: 0; }
        .col-chev { font-size: 16px; color: #3A3A50; flex-shrink: 0; }
        .col-empty { padding: 20px 0; text-align: center; color: #3A3A50; font-size: 12px; border-radius: 8px; transition: all 0.15s; }
        .col-empty-on { color: #8B7FFF; background: rgba(139,127,255,0.06); border: 1px dashed rgba(139,127,255,0.3); padding: 20px; }

        /* ── CARDS ── */
        .card-view-only { cursor: pointer; }
        .team-chip-view { cursor: default; }
        .team-chip-view .chip-grip { display: none; }
        .ui-input:disabled, .ui-select:disabled, .ui-textarea:disabled { opacity: 0.85; cursor: default; }
        .card { background: #1C1C24; border: 1px solid #2A2A36; border-radius: 10px; position: relative; cursor: grab; display: flex; width: 100%; transition: box-shadow 0.15s, border-color 0.15s, opacity 0.15s, transform 0.1s; user-select: none; -webkit-user-select: none; touch-action: pan-y; }
        .card.card-dragging { touch-action: none; }
        .card:hover { border-color: #3A3A50; box-shadow: 0 4px 16px rgba(0,0,0,0.4); }
        .card:active { cursor: grabbing; }
        .card-dragging { opacity: 0.2; transform: scale(0.97); }
        .card-drop-target { border-color: #8B7FFF !important; box-shadow: 0 0 0 2px rgba(139,127,255,0.4) !important; }
        .card-flags { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 7px; }
        .card-flags.compact { margin-bottom: 5px; }
        .card-flag {
          font-size: 9px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase;
          padding: 3px 7px; border-radius: 5px; line-height: 1.2;
        }
        .flag-priority-high { background: rgba(251,191,36,0.18); color: #FBBF24; border: 1px solid rgba(251,191,36,0.4); }
        .flag-priority-urgent { background: rgba(248,113,113,0.15); color: #F87171; border: 1px solid rgba(248,113,113,0.45); }
        .flag-sales { background: rgba(251,191,36,0.1); color: #FBBF24; border: 1px dashed rgba(251,191,36,0.45); }
        .flag-sales-info { background: rgba(251,191,36,0.08); color: #FBBF24; border: 1px solid rgba(251,191,36,0.35); }
        .flag-licenses { background: rgba(139,127,255,0.14); color: #8B7FFF; border: 1px solid rgba(139,127,255,0.45); }
        .card-waiting-licenses:not(.card-priority-urgent):not(.card-priority-high) {
          background: linear-gradient(135deg, #1C1C24 0%, rgba(139,127,255,0.08) 100%);
          border-color: rgba(139,127,255,0.4) !important;
        }
        .card-priority-high { border-color: rgba(251,191,36,0.45) !important; }
        .card-priority-urgent {
          border-color: rgba(248,113,113,0.55) !important;
          box-shadow: 0 0 0 1px rgba(248,113,113,0.2), 0 4px 16px rgba(0,0,0,0.4);
        }
        .card-waiting-sales:not(.card-priority-urgent):not(.card-priority-high) {
          background: linear-gradient(135deg, #1C1C24 0%, rgba(251,191,36,0.06) 100%);
        }
        .card-new {
          border-color: color-mix(in srgb, var(--cc) 55%, #2A2A36) !important;
          animation: cardNewPulse 2.4s ease-in-out infinite;
        }
        @keyframes cardNewPulse {
          0%, 100% {
            box-shadow:
              0 0 0 2px color-mix(in srgb, var(--cc) 45%, transparent),
              0 0 12px color-mix(in srgb, var(--cc) 28%, transparent),
              0 4px 16px rgba(0,0,0,0.4);
          }
          50% {
            box-shadow:
              0 0 0 2px color-mix(in srgb, var(--cc) 70%, transparent),
              0 0 20px color-mix(in srgb, var(--cc) 42%, transparent),
              0 4px 16px rgba(0,0,0,0.4);
          }
        }
        .card-stripe { width: 3px; flex-shrink: 0; background: var(--cc); border-radius: 9px 0 0 9px; }
        .card-drop-bar { position: absolute; top: 0; left: 0; right: 0; height: 2px; background: #8B7FFF; border-radius: 9px 9px 0 0; pointer-events: none; }
        .card-body { padding: 11px 12px; flex: 1; min-width: 0; }
        .card-title { font-size: 13px; font-weight: 600; color: #F0F0F6; line-height: 1.4; margin-bottom: 7px; }
        .card-tags { display: flex; align-items: center; gap: 6px; margin-bottom: 10px; flex-wrap: wrap; }
        .card-sku-chips { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
        .sku-chip { font-size: 10px; font-weight: 600; font-family: ui-monospace, monospace; padding: 3px 7px; border-radius: 4px; background: rgba(251,191,36,0.12); color: #FBBF24; border: 1px solid rgba(251,191,36,0.28); line-height: 1.3; }
        a.sku-chip-link { text-decoration: none; cursor: pointer; transition: background 0.15s, border-color 0.15s, color 0.15s; }
        a.sku-chip-link:hover { color: #FDE68A; border-color: rgba(251,191,36,0.55); background: rgba(251,191,36,0.22); }
        .sku-chip-more { background: #1E1E28; color: #56566A; border-color: #2A2A36; cursor: default; }
        .card-season { font-size: 11px; color: #56566A; }
        .sku-below-comments { grid-column: 1 / -1; margin-top: 4px; padding-top: 14px; border-top: 1px solid #2A2A36; }
        .sku-link-list { list-style: none; margin: 0 0 12px; padding: 0; display: flex; flex-direction: column; gap: 6px; }
        .sku-link-item { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
        .sku-hyperlink { font-size: 13px; font-weight: 600; color: #8B7FFF; text-decoration: underline; text-underline-offset: 2px; font-family: ui-monospace, monospace; }
        .sku-hyperlink:hover { color: #A89FFF; }
        .sku-plain { font-size: 13px; color: #9494B0; font-family: ui-monospace, monospace; }
        .sku-remove-text { background: none; border: none; color: #56566A; font-size: 11px; cursor: pointer; flex-shrink: 0; }
        .sku-remove-text:hover { color: #F87171; }
        .sku-add-row { display: grid; grid-template-columns: 1fr 1fr auto; gap: 8px; }
        .sku-add-row .ui-input { min-width: 0; }
        .sku-empty-hint { font-size: 12px; color: #56566A; margin-bottom: 10px; }
        .notes-rendered { margin-top: 10px; padding-top: 10px; border-top: 1px solid #2A2A36; font-size: 13px; line-height: 1.55; color: #9494B0; }
        .text-link { color: #8B7FFF; text-decoration: underline; text-underline-offset: 2px; }
        .text-link:hover { color: #A89FFF; }
        .linked-text { white-space: pre-wrap; word-break: break-word; }
        .linked-text-preview { margin-top: 8px; padding: 10px 12px; background: #14141A; border: 1px solid #2A2A36; border-radius: 8px; font-size: 12px; line-height: 1.55; color: #9494B0; }
        .preview-label { display: block; font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #56566A; margin-bottom: 6px; }
        .btn-add-sku { flex-shrink: 0; padding: 8px 12px; background: #23232D; border: 1px solid #2A2A36; border-radius: 8px; color: #9494B0; font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit; }
        .btn-add-sku:hover:not(:disabled) { border-color: #8B7FFF; color: #8B7FFF; }
        .btn-add-sku:disabled { opacity: 0.4; cursor: default; }
        .style-numbers-empty { font-size: 12px; color: #56566A; }
        .field-hint { font-size: 11px; color: #56566A; margin-top: 8px; }
        .card-footer { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
        .card-assignee { display: flex; align-items: center; gap: 5px; min-width: 0; }
        .assignee-avatars { display: flex; align-items: center; gap: 6px; min-width: 0; }
        .assignee-avatars.compact { gap: 4px; }
        .av-stack { display: flex; align-items: center; flex-shrink: 0; }
        .av-stack .av { margin-left: -6px; border: 1.5px solid #1C1C24; box-sizing: border-box; }
        .av-stack .av:first-child { margin-left: 0; }
        .av-more { background: #2A2A36 !important; color: #9494B0; font-size: 9px; font-weight: 700; display: flex; align-items: center; justify-content: center; font-family: inherit; }
        .assignee-picker { display: flex; flex-wrap: wrap; gap: 8px; }
        .assignee-pick-btn { display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 8px; border: 1px solid #2A2A36; background: #14141A; color: #9494B0; font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit; transition: all 0.15s; }
        .assignee-pick-btn.on { background: color-mix(in srgb, var(--tc) 18%, #14141A); border-color: color-mix(in srgb, var(--tc) 50%, #2A2A36); color: #F0F0F6; }
        .assignee-pick-btn:hover:not(:disabled) { border-color: var(--tc); }
        .assignee-pick-btn:disabled { cursor: default; opacity: 0.85; }
        .card-name { font-size: 11px; color: #9494B0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .card-right { display: flex; align-items: center; gap: 5px; flex-shrink: 0; }
        .card-due { font-size: 11px; color: #56566A; }
        .unsync-dot { width: 5px; height: 5px; border-radius: 50%; background: #FB923C; }

        /* ── QUICK ADD ── */
        .qa-btn { width: 100%; margin-top: auto; padding: 8px 10px; background: transparent; border: 1px dashed #2A2A36; border-radius: 8px; font-size: 12px; color: #3A3A50; cursor: pointer; text-align: left; font-family: inherit; transition: all 0.15s; display: flex; align-items: center; gap: 6px; }
        .qa-btn:hover { background: rgba(139,127,255,0.06); color: #8B7FFF; border-color: rgba(139,127,255,0.3); }
        .qa-wrap { margin-top: auto; position: relative; }
        .qa-input { width: 100%; background: #23232D; border: 2px solid #8B7FFF; border-radius: 8px; padding: 8px 36px 8px 10px; font-size: 13px; color: #F0F0F6; outline: none; font-family: 'Open Sans', sans-serif; font-weight: 600; box-sizing: border-box; }
        .qa-hint { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); font-size: 10px; color: #56566A; pointer-events: none; }

        /* ── DROP MARKER ── */
        .drop-marker { height: 2px; background: #8B7FFF; border-radius: 2px; margin: 2px 0; animation: mp 0.5s ease-in-out infinite alternate; }
        @keyframes mp { from { opacity: 0.4; } to { opacity: 1; } }

        /* ── GHOST ── */
        .ghost { position: fixed; z-index: 9999; pointer-events: none; }
        .ghost-card { transform: rotate(1.5deg) scale(1.03); box-shadow: 0 24px 60px rgba(0,0,0,0.7); border-radius: 10px; }
        .ghost-team { display: flex; flex-direction: column; align-items: center; gap: 5px; transform: translate(-50%, -50%); }
        .ghost-name { font-size: 11px; font-weight: 700; color: #fff; background: #8B7FFF; padding: 2px 9px; border-radius: 100px; white-space: nowrap; box-shadow: 0 4px 12px rgba(139,127,255,0.5); }

        /* ── LIST ── */
        .list { background: #14141A; border: 1px solid #2A2A36; border-radius: 12px; overflow: hidden; }
        .list-row { display: grid; grid-template-columns: 3px 1fr 130px 160px 90px; align-items: center; border-bottom: 1px solid #1E1E28; cursor: pointer; transition: background 0.12s; }
        .list-row:last-child { border-bottom: none; }
        .list-row:hover { background: #1C1C24; }
        .list-row-new {
          animation: listRowNewPulse 2.4s ease-in-out infinite;
          background: color-mix(in srgb, var(--cc) 10%, #14141A);
        }
        @keyframes listRowNewPulse {
          0%, 100% { box-shadow: inset 3px 0 0 color-mix(in srgb, var(--cc) 50%, transparent); }
          50% { box-shadow: inset 3px 0 0 color-mix(in srgb, var(--cc) 85%, transparent), inset 0 0 24px color-mix(in srgb, var(--cc) 12%, transparent); }
        }
        .list-stripe { width: 3px; height: 100%; background: var(--cc); align-self: stretch; }
        .list-main { padding: 14px 16px 14px 14px; }
        .list-title { font-size: 14px; font-weight: 600; color: #F0F0F6; margin-bottom: 4px; }
        .list-meta { font-size: 11px; color: #9494B0; display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
        .list-stage-pill { display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px; background: #1C1C24; border-radius: 100px; font-size: 11px; color: #9494B0; font-weight: 600; }
        .stage-dot { width: 6px; height: 6px; border-radius: 50%; }
        .list-assignee { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 0 8px; }
        .list-name { font-size: 12px; color: #9494B0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .list-due { font-size: 12px; color: #56566A; padding-right: 16px; }
        .list-empty { padding: 60px 40px; text-align: center; color: #3A3A50; font-size: 14px; }

        /* ── DRAWER ── */
        .drawer-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); backdrop-filter: blur(4px); z-index: 200; animation: fadeIn 0.18s ease-out; }
        .drawer-overlay.closing { animation: fadeOut 0.18s ease-in forwards; }
        .drawer { position: fixed; top: 0; right: 0; bottom: 0; width: 100%; max-width: 460px; background: #14141A; border-left: 1px solid #2A2A36; z-index: 201; overflow-y: auto; display: flex; flex-direction: column; animation: slideInRight 0.25s ease-out; }
        .drawer.closing { animation: slideOutRight 0.18s ease-in forwards; }
        @keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @keyframes slideOutRight { from { transform: translateX(0); } to { transform: translateX(100%); } }
        @keyframes slideInUp    { from { transform: translateY(100%); } to { transform: translateY(0); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes fadeOut { from { opacity: 1; } to { opacity: 0; } }
        .drawer-handle { display: none; flex-shrink: 0; }
        .drawer-cat-bar { height: 4px; width: 100%; flex-shrink: 0; }
        .drawer-inner { padding: 22px 28px 36px; flex: 1; overflow-y: auto; }
        .drawer-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
        .eyebrow { font-size: 10px; letter-spacing: 0.12em; color: #56566A; text-transform: uppercase; font-weight: 700; }
        .close-btn { background: none; border: none; font-size: 18px; color: #56566A; cursor: pointer; width: 36px; height: 36px; border-radius: 8px; display: flex; align-items: center; justify-content: center; }
        .close-btn:hover { background: #1C1C24; color: #F0F0F6; }
        .drawer-actions { display: flex; flex-direction: column; gap: 10px; margin-top: 24px; }
        .drawer-actions-row { display: flex; gap: 10px; width: 100%; }
        .drawer-move-board {
          width: 100%; padding: 13px 18px;
          background: #1C1C24; border: 1px solid #2A2A36; border-radius: 8px;
          color: #9494B0; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit;
          min-height: 46px; transition: all 0.15s;
        }
        .drawer-move-board:hover { background: #23232D; border-color: #3A3A50; color: #F0F0F6; }
        .drawer-title { width: 100%; background: transparent; border: none; border-bottom: 2px solid #2A2A36; outline: none; font-family: 'Open Sans', sans-serif; font-size: 20px; font-weight: 700; color: #F0F0F6; margin-bottom: 22px; padding: 0 0 10px; box-sizing: border-box; transition: border-color 0.2s; }
        .drawer-title:focus { border-bottom-color: #8B7FFF; }
        .drawer-title::placeholder { color: #3A3A50; }
        .field-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
        .field-full { grid-column: 1 / -1; }
        .field-label { font-size: 11px; letter-spacing: 0.05em; color: #56566A; text-transform: uppercase; margin-bottom: 6px; font-weight: 700; }
        .ui-input { width: 100%; background: #1C1C24; border: 1px solid #2A2A36; border-radius: 8px; padding: 10px 12px; font-size: 14px; color: #F0F0F6; outline: none; font-family: inherit; box-sizing: border-box; transition: border-color 0.15s; min-height: 42px; }
        .ui-input:focus { border-color: #8B7FFF; }
        .ui-textarea { resize: vertical; line-height: 1.6; min-height: 90px; }
        .ui-select { cursor: pointer; appearance: none; background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path d='M1 1l4 4 4-4' stroke='%2356566A' fill='none' stroke-width='1.5'/></svg>"); background-repeat: no-repeat; background-position: right 12px center; padding-right: 30px; }
        .ui-select option { background: #1C1C24; }
        input[type="date"]::-webkit-calendar-picker-indicator { filter: invert(0.4); cursor: pointer; }
        .sync-toggle { display: flex; align-items: center; gap: 10px; margin-top: 20px; font-size: 13px; color: #9494B0; cursor: pointer; }
        .sync-toggle input { accent-color: #8B7FFF; width: 16px; height: 16px; }
        .activity-log { margin-top: 20px; padding-top: 16px; border-top: 1px solid #2A2A36; }
        .activity-list { list-style: none; margin: 0; padding: 0; max-height: 200px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }
        .activity-item { padding: 8px 10px; background: #14141A; border-radius: 8px; border: 1px solid #1E1E28; }
        .activity-text { font-size: 12px; color: #F0F0F6; line-height: 1.4; }
        .activity-meta { font-size: 10px; color: #56566A; margin-top: 4px; }
        .activity-empty { font-size: 12px; color: #56566A; line-height: 1.45; }
        .btn-primary { flex: 1; padding: 13px 0; font-size: 14px; font-weight: 700; background: #8B7FFF; color: #fff; border: none; border-radius: 8px; cursor: pointer; font-family: inherit; min-height: 46px; transition: opacity 0.15s; }
        .btn-primary:hover { opacity: 0.88; }
        .btn-primary:disabled { background: #2A2A36; color: #56566A; cursor: not-allowed; opacity: 1; }
        .btn-danger { padding: 13px 18px; font-size: 13px; font-weight: 600; background: transparent; color: #F87171; border: 1px solid rgba(248,113,113,0.25); border-radius: 8px; cursor: pointer; font-family: inherit; min-height: 46px; transition: background 0.15s; }
        .btn-danger:hover { background: rgba(248,113,113,0.08); }
        .btn-cancel { padding: 13px 18px; font-size: 13px; font-weight: 600; background: transparent; color: #9494B0; border: 1px solid #2A2A36; border-radius: 8px; cursor: pointer; font-family: inherit; min-height: 46px; }
        .btn-cancel:hover { background: #1C1C24; }

        /* ── CALENDAR ── */
        .cal-wrap { display: flex; flex-direction: column; gap: 12px; }
        .cal-nav-row { display: flex; align-items: center; gap: 10px; }
        .cal-nav-btn { background: #1C1C24; border: 1px solid #2A2A36; color: #9494B0; width: 32px; height: 32px; border-radius: 8px; font-size: 18px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.15s; }
        .cal-nav-btn:hover { background: #23232D; color: #F0F0F6; }
        .cal-month-label { font-size: 18px; font-weight: 700; color: #F0F0F6; flex: 1; }
        .cal-today-btn { padding: 6px 12px; background: transparent; border: 1px solid #2A2A36; color: #9494B0; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit; transition: all 0.15s; }
        .cal-today-btn:hover { background: #1C1C24; color: #F0F0F6; }

        .cal-dow-row { display: grid; grid-template-columns: repeat(7, 1fr); border-bottom: 1px solid #2A2A36; }
        .cal-dow { padding: 8px; font-size: 11px; font-weight: 700; color: #3A3A50; text-transform: uppercase; letter-spacing: 0.06em; text-align: center; }

        .cal-body { display: flex; flex-direction: column; border: 1px solid #2A2A36; border-radius: 12px; overflow: hidden; }
        .cal-week { border-bottom: 1px solid #1E1E28; }
        .cal-week:last-child { border-bottom: none; }

        .cal-days-row { display: grid; grid-template-columns: repeat(7, 1fr); }
        .cal-day { min-height: 52px; padding: 6px 8px; border-right: 1px solid #1A1A24; background: #14141A; position: relative; }
        .cal-day:last-child { border-right: none; }
        .cal-day-empty { background: #0E0E14; }
        .cal-day-past { opacity: 0.45; }
        .cal-day-today { background: #18182A; }
        .cal-day-today .cal-day-num { color: #8B7FFF; font-weight: 700; }
        .cal-day-num { font-size: 12px; font-weight: 600; color: #56566A; }

        .cal-events-row {
          display: grid; grid-template-columns: repeat(7, 1fr);
          grid-auto-rows: 22px; grid-auto-flow: row;
          gap: 2px; padding: 3px 0 5px; background: #0F0F14;
          border-top: 1px solid #1A1A24;
        }
        .cal-bar {
          height: 22px; display: flex; align-items: center; gap: 4px;
          padding: 0 6px; overflow: hidden; cursor: pointer;
          background: color-mix(in srgb, var(--cc) 18%, #1C1C28);
          border-top: 1px solid color-mix(in srgb, var(--cc) 45%, transparent);
          border-bottom: 1px solid color-mix(in srgb, var(--cc) 45%, transparent);
          transition: filter 0.12s;
        }
        .cal-bar:hover { filter: brightness(1.25); }
        .av-xs { width: 14px; height: 14px; font-size: 6px; flex-shrink: 0; }
        .bar-title { font-size: 10px; font-weight: 600; color: #D0D0E8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; }
        .bar-dur { font-size: 9px; color: #9494B0; white-space: nowrap; flex-shrink: 0; margin-left: 2px; }

        .cal-nodue { background: #14141A; border: 1px solid #2A2A36; border-radius: 12px; padding: 14px 16px; }
        .cal-nodue-label { font-size: 10px; font-weight: 700; color: #56566A; text-transform: uppercase; letter-spacing: 0.08em; display: block; margin-bottom: 10px; }
        .cal-nodue-items { display: flex; flex-wrap: wrap; gap: 6px; }
        .cal-item { display: flex; align-items: center; gap: 5px; padding: 4px 8px; border-radius: 6px; background: color-mix(in srgb, var(--cc) 15%, #1C1C24); border: 1px solid color-mix(in srgb, var(--cc) 30%, transparent); cursor: pointer; transition: all 0.12s; }
        .cal-item:hover { background: color-mix(in srgb, var(--cc) 25%, #1C1C24); }
        .cal-item-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--cc); flex-shrink: 0; }
        .cal-item-title { font-size: 11px; font-weight: 600; color: #D0D0E4; white-space: nowrap; }

        /* ── HEATMAP ── */
        .heatmap-card { flex-shrink: 0; }
        .hm-chips { display: flex; gap: 6px; }
        .hm-chip {
          display: flex; flex-direction: column; align-items: center;
          gap: 5px; padding: 10px 12px; min-width: 52px;
          background: #1C1C24; border: 1px solid #2A2A36; border-radius: 10px;
          transition: border-color 0.15s;
        }
        .hm-chip:hover { border-color: #3A3A50; }
        .hm-chip-count { font-size: 16px; font-weight: 700; line-height: 1; }

        .ss-type-toggle { display: flex; gap: 4px; background: #1C1C24; border: 1px solid #2A2A36; border-radius: 8px; padding: 3px; margin-bottom: 16px; }
        .ss-type-btn { flex: 1; padding: 8px; font-size: 12px; font-weight: 600; background: transparent; border: none; border-radius: 6px; color: #56566A; cursor: pointer; font-family: inherit; transition: all 0.15s; }
        .ss-type-btn.active { background: #8B7FFF; color: #fff; }
        .ss-sub-label { font-size: 10px; font-weight: 700; color: #56566A; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 8px; }
        .ss-card-pres { border-color: rgba(139,127,255,0.2); }
        .ss-pres-icon { font-size: 12px; color: #8B7FFF; flex-shrink: 0; }
        .ss-linked-count { font-size: 11px; color: #8B7FFF; font-weight: 600; }

        /* ── BOARD MODE TOGGLE ── */
        .bm-toggle { display: flex; gap: 2px; background: #14141A; border: 1px solid #2A2A36; border-radius: 8px; padding: 3px; }
        .bm-btn { padding: 6px 14px; font-size: 12px; font-weight: 600; background: transparent; border: none; border-radius: 6px; color: #56566A; cursor: pointer; font-family: inherit; transition: all 0.15s; white-space: nowrap; }
        .bm-btn:hover:not(.active) { color: #9494B0; }
        .bm-btn.active { background: #23232D; color: #F0F0F6; }
        .bm-btn.active.pres { background: rgba(139,127,255,0.2); color: #8B7FFF; }

        /* ── PAGE NAV ── */
        .page-nav { display: flex; gap: 2px; background: #14141A; border: 1px solid #2A2A36; border-radius: 8px; padding: 3px; }
        .page-nav-btn { padding: 6px 14px; font-size: 12px; font-weight: 600; background: transparent; border: none; border-radius: 6px; color: #56566A; cursor: pointer; font-family: inherit; transition: all 0.15s; white-space: nowrap; }
        .page-nav-btn.active { background: #23232D; color: #F0F0F6; }
        .page-nav-btn:hover:not(.active) { color: #9494B0; }
        .nav-badge {
          margin-left: 8px;
          display: inline-flex; align-items: center; justify-content: center;
          min-width: 18px; height: 18px; padding: 0 6px;
          border-radius: 999px;
          font-size: 10px; font-weight: 800;
          background: rgba(251,191,36,0.12);
          border: 1px solid rgba(251,191,36,0.30);
          color: #FBBF24;
        }
        .nav-dot {
          width: 8px; height: 8px;
          border-radius: 50%;
          background: rgba(52,211,153,0.95);
          box-shadow: 0 0 0 2px rgba(12,12,16,0.92);
          display: inline-block;
          margin-left: 6px;
          vertical-align: middle;
        }

        /* ── SELECT SETS PAGE ── */
        .ss-page { display: flex; flex-direction: column; gap: 20px; }
        .ss-topbar { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
        .ss-search { width: 200px; background: #14141A; border: 1px solid #2A2A36; border-radius: 8px; padding: 8px 12px; font-size: 13px; color: #F0F0F6; outline: none; font-family: inherit; transition: border-color 0.15s; }
        .ss-search:focus { border-color: #8B7FFF; }

        .ss-cust-tabs { display: flex; gap: 6px; flex-wrap: wrap; }
        .ss-ctab { padding: 7px 14px; font-size: 12px; font-weight: 600; background: #14141A; border: 1px solid #2A2A36; border-radius: 100px; cursor: pointer; font-family: inherit; color: #56566A; transition: all 0.15s; white-space: nowrap; }
        .ss-ctab:hover { color: #9494B0; border-color: #3A3A50; }
        .ss-ctab.active { background: color-mix(in srgb, var(--cc, #8B7FFF) 15%, #14141A); color: var(--cc, #8B7FFF); border-color: color-mix(in srgb, var(--cc, #8B7FFF) 40%, transparent); }

        .ss-sections { display: flex; flex-direction: column; gap: 24px; }
        .ss-section { display: flex; flex-direction: column; gap: 10px; }
        .ss-section-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
        .ss-section-label { display: flex; align-items: center; gap: 8px; }
        .ss-cust-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
        .ss-cust-name { font-size: 15px; font-weight: 700; color: #F0F0F6; }
        .ss-cust-count { font-size: 11px; color: #56566A; background: #1C1C24; border: 1px solid #2A2A36; padding: 2px 8px; border-radius: 10px; }
        .ss-add-btn { padding: 6px 12px; background: transparent; border: 1px dashed #2A2A36; border-radius: 8px; font-size: 12px; color: #56566A; cursor: pointer; font-family: inherit; transition: all 0.15s; }
        .ss-add-btn:hover { color: #8B7FFF; border-color: rgba(139,127,255,0.4); background: rgba(139,127,255,0.06); }

        .ss-empty { padding: 16px; background: #14141A; border: 1px dashed #2A2A36; border-radius: 10px; text-align: center; font-size: 13px; color: #3A3A50; }

        .ss-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 10px; }
        .ss-card { background: #14141A; border: 1px solid #2A2A36; border-radius: 12px; padding: 16px; display: flex; flex-direction: column; gap: 10px; transition: border-color 0.15s; }
        .ss-card:hover { border-color: #3A3A50; }
        .ss-card-top { display: flex; align-items: flex-start; gap: 12px; }
        .ss-card-name { font-size: 14px; font-weight: 700; color: #F0F0F6; margin-bottom: 6px; }
        .ss-card-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .ss-card-season { font-size: 11px; color: #56566A; }
        .ss-status-pill { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: #9494B0; font-weight: 600; }
        .ss-card-notes { font-size: 12px; color: #56566A; line-height: 1.5; padding-top: 8px; border-top: 1px solid #1E1E28; }
        .ss-open-btn { display: inline-flex; align-items: center; gap: 4px; padding: 7px 12px; background: #8B7FFF22; border: 1px solid #8B7FFF44; border-radius: 8px; color: #8B7FFF; font-size: 12px; font-weight: 600; text-decoration: none; cursor: pointer; transition: all 0.15s; white-space: nowrap; font-family: inherit; }
        .ss-open-btn:hover { background: #8B7FFF33; }
        .ss-no-link { font-size: 11px; color: #3A3A50; padding: 7px 12px; }
        .ss-edit-btn { padding: 7px 12px; background: transparent; border: 1px solid #2A2A36; border-radius: 8px; font-size: 12px; color: #56566A; cursor: pointer; font-family: inherit; transition: all 0.15s; }
        .ss-edit-btn:hover { background: #1C1C24; color: #F0F0F6; }

        .ss-zero { text-align: center; padding: 80px 40px; }
        .ss-zero-icon { font-size: 40px; color: #2A2A36; margin-bottom: 16px; }
        .ss-zero-title { font-size: 18px; font-weight: 700; color: #56566A; margin-bottom: 8px; }
        .ss-zero-sub { font-size: 13px; color: #3A3A50; }

        /* SS Drawer extras */
        .ss-customer-picker { display: flex; flex-wrap: wrap; gap: 8px; }
        .ss-cust-btn { padding: 7px 14px; background: #1C1C24; border: 1px solid #2A2A36; border-radius: 100px; font-size: 12px; font-weight: 600; color: #56566A; cursor: pointer; font-family: inherit; transition: all 0.15s; }
        .ss-cust-btn:hover { border-color: #3A3A50; color: #9494B0; }
        .ss-cust-active { background: color-mix(in srgb, var(--cc) 15%, #1C1C24) !important; color: var(--cc) !important; border-color: color-mix(in srgb, var(--cc) 40%, transparent) !important; }
        .ss-status-btn { display: inline-flex; align-items: center; gap: 7px; padding: 7px 14px; background: #1C1C24; border: 1px solid #2A2A36; border-radius: 100px; font-size: 12px; font-weight: 600; color: #56566A; cursor: pointer; font-family: inherit; transition: all 0.15s; }
        .ss-status-btn:hover { border-color: #3A3A50; color: #9494B0; }
        .ss-status-active { background: #23232D !important; color: #F0F0F6 !important; border-color: #3A3A50 !important; }
        .ss-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }

        /* ── LICENSING REQUESTS ── */
        .lic-page { display: flex; flex-direction: column; gap: 20px; }
        .lic-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 10px; }
        .lic-card {
          background: #14141A; border: 1px solid #2A2A36; border-radius: 12px;
          padding: 16px; display: flex; flex-direction: column; gap: 10px;
          cursor: pointer; transition: border-color 0.15s;
        }
        .lic-card:hover { border-color: #3A3A50; }
        .lic-card-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
        .lic-type { font-size: 12px; font-weight: 700; color: #F0F0F6; white-space: nowrap; }
        .lic-meta { font-size: 11px; color: #56566A; white-space: nowrap; flex-shrink: 0; }
        .lic-status-pill {
          display: inline-flex; align-items: center;
          padding: 2px 8px; border-radius: 999px;
          font-size: 10px; font-weight: 700; letter-spacing: 0.02em;
          border: 1px solid #2A2A36; color: #9494B0; background: #1C1C24;
        }
        .lic-status-pill.open { border-color: rgba(251,191,36,0.25); color: #FBBF24; background: rgba(251,191,36,0.10); }
        .lic-status-pill.done { border-color: rgba(52,211,153,0.25); color: #34D399; background: rgba(52,211,153,0.10); }
        .lic-linked { font-size: 12px; color: #56566A; }
        .lic-linked-title { color: #F0F0F6; font-weight: 600; }
        .lic-msg { font-size: 12px; color: #9494B0; line-height: 1.5; }
        .lic-skus { background: #1C1C24; border: 1px solid #2A2A36; border-radius: 10px; padding: 10px 12px; }
        .lic-skus-label { display: block; font-size: 10px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: #56566A; margin-bottom: 6px; }
        .lic-skus-pre { margin: 0; white-space: pre-wrap; font-size: 11px; color: #F0F0F6; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
        .lic-drawer-sections { gap: 14px; }
        .lic-section-head {
          grid-column: 1 / -1;
          font-size: 10px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase;
          color: #FBBF24; margin: 4px 0 2px; padding-top: 14px; border-top: 1px solid #2A2A36;
        }
        .lic-section-head:first-child { border-top: none; padding-top: 0; margin-top: 0; }
        .lic-section-head.art { color: #8B7FFF; }
        .lic-status-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }

        /* ── TOAST ── */
        .toast {
          position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
          background: #23232D; border: 1px solid #2A2A36; color: #F0F0F6;
          padding: 10px 14px 10px 18px; border-radius: 100px; font-size: 13px; font-weight: 500;
          box-shadow: 0 8px 30px rgba(0,0,0,0.5); z-index: 9998; animation: ti 0.2s ease-out;
          display: inline-flex; align-items: center; gap: 12px; max-width: min(92vw, 520px);
        }
        .toast-msg { line-height: 1.35; }
        .toast-undo {
          flex-shrink: 0; padding: 5px 12px; border-radius: 100px; border: 1px solid #8B7FFF55;
          background: #8B7FFF22; color: #8B7FFF; font-size: 12px; font-weight: 700;
          cursor: pointer; font-family: inherit; transition: background 0.15s;
        }
        .toast-undo:hover { background: #8B7FFF33; }
        @keyframes ti { from { opacity:0; transform:translate(-50%,6px); } to { opacity:1; transform:translate(-50%,0); } }

        /* ── MOBILE ── */
        @media (max-width: 900px) {
          .header { flex-wrap: wrap; height: auto; padding-top: 10px; padding-bottom: 10px; row-gap: 10px; }
          .nav-center { position: static; transform: none; order: 2; width: 100%; }
          .header-right { order: 3; width: 100%; justify-content: flex-end; }
        }

        @media (max-width: 768px) {
          .header { padding: 0 16px; height: auto; padding-top: 10px; padding-bottom: 10px; }
          .brand-tag { display: none; }
          .nav-center { position: static; transform: none; order: 2; width: 100%; margin-top: 0; }
          .main { padding: 16px 16px 80px; }
          .stats-bar { gap: 8px; }
          .stat { padding: 10px 14px; min-width: 0; flex: 1; }
          .stat-val { font-size: 20px; }
          .filter-bar { gap: 8px; }
          .filter-signal-group { width: 100%; flex-direction: column; align-items: flex-start; gap: 8px; padding: 10px 12px; }
          .signal-chip-row { width: 100%; }
          .board-callout { flex-direction: column; align-items: stretch; }
          .board-callout-clear { width: 100%; text-align: center; }
          .ss-topbar .ss-search { width: 100%; }
          .team-strip-top { flex-direction: column; align-items: flex-start; gap: 4px; }
          .board { margin: 0 -16px; padding: 0 16px 16px; flex-wrap: nowrap; overflow-x: auto; -webkit-overflow-scrolling: touch; }
          .col { flex: 0 0 252px; }
          .list-row { grid-template-columns: 3px 1fr auto; grid-template-rows: auto auto; }
          .list-main { grid-column: 2; grid-row: 1; }
          .list-stage-pill { grid-column: 3; grid-row: 1; align-self: center; }
          .list-assignee { grid-column: 2; grid-row: 2; padding: 0 16px 12px 14px; }
          .list-due { grid-column: 3; grid-row: 2; align-self: center; padding: 0 16px 12px 0; text-align: right; }
          .drawer { top: auto; left: 0; right: 0; bottom: 0; max-width: 100%; border-left: none; border-top: 1px solid #2A2A36; border-top-left-radius: 18px; border-top-right-radius: 18px; max-height: 92vh; animation: slideInUp 0.28s ease-out; }
          .drawer.closing { animation: slideOutDown 0.18s ease-in forwards; }
          @keyframes slideOutDown { from { transform: translateY(0); } to { transform: translateY(100%); } }
          .drawer-handle { display: flex; width: 36px; height: 4px; background: #2A2A36; border-radius: 2px; margin: 10px auto 0; }
          .drawer-inner { padding: 16px 20px max(28px, env(safe-area-inset-bottom)); }
          .drawer-title { font-size: 18px; }
          .field-grid { grid-template-columns: 1fr; gap: 12px; }
          .ui-input { font-size: 16px; }
          .drawer-actions-row { flex-direction: column; }
          .btn-primary, .btn-danger, .drawer-move-board { width: 100%; }
          .toast { font-size: 12px; max-width: calc(100vw - 32px); white-space: normal; text-align: center; }
        }
      `}</style>

      {/* HEADER */}
      <header className="header">
        <div className="brand">
          <div className="brand-mark">◈</div>
          <span className="brand-name">Studio</span>
          <span className={`sync-pill ${window.storage?.mode === "shared" ? "" : "local"}`}>
            {window.storage?.mode === "shared" ? "Team board" : "This device only"}
          </span>
          {isViewer && <span className="sync-pill viewer">View only</span>}
          {isLoaded && user?.id && (
            <HeaderNickname userId={user.id} colorName={boardProfile} />
          )}
        </div>
        <div className="nav-center">
          <div className="page-nav">
            <button className={`page-nav-btn ${page === "projects" ? "active" : ""}`} onClick={() => setPage("projects")}>Projects</button>
            <button className={`page-nav-btn ${page === "selectsets" ? "active" : ""}`} onClick={() => setPage("selectsets")}>Select Sets</button>
            <button className={`page-nav-btn ${page === "licensing" ? "active" : ""}`} onClick={() => setPage("licensing")}>
              Licensing{licOpenCount > 0 ? <span className="nav-badge">{licOpenCount}</span> : null}
              {hasLicensingAccess && page !== "licensing" && licDoneUpdatedCount > 0 ? <span className="nav-dot" title="New completed updates" /> : null}
            </button>
          </div>
        </div>
        <div className="header-right">
          {page === "projects" && <>
            <div className="view-toggle">
              <button className={`view-btn ${view === "board"    ? "active" : ""}`} onClick={() => setView("board")}>Board</button>
              <button className={`view-btn ${view === "list"     ? "active" : ""}`} onClick={() => setView("list")}>List</button>
              <button className={`view-btn ${view === "calendar" ? "active" : ""}`} onClick={() => setView("calendar")}>Calendar</button>
            </div>
            {canEditProjects && <button onClick={() => setDrawer({ isNew: true })} className="btn-new">+ New</button>}
          </>}
          <UserButton
            afterSignOutUrl="/"
            appearance={{
              elements: { avatarBox: { width: 32, height: 32 } },
            }}
          />
        </div>
      </header>

      {page === "selectsets" ? (
        <main className="main">
          <SelectSetsPage sets={sets} projects={projects} onSave={handleSSave} onDelete={handleSDelete} canEdit={canEditSelectSets} />
        </main>
      ) : page === "licensing" ? (
        <main className="main">
          <LicensingPage
            requests={licRequests}
            projects={projects}
            onSave={(data) => handleLicSave({
              ...data,
              createdBy: data.createdBy || actor,
            })}
            onDelete={handleLicDelete}
            canCreate={canCreateLicensing}
            canEdit={canEditLicensing}
            canResolve={canResolveLicensing}
          />
        </main>
      ) : (
      <main className="main">
        <div className="ss-topbar">
          <div>
            <h1 className="page-title">{boardMode === "presentations" ? "Presentations" : "Projects"}</h1>
            <p className="page-sub">{activeCount} {boardMode === "presentations" ? "presentations" : "products"} · drag to move or reassign</p>
          </div>
          <input
            className="ss-search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search projects…"
          />
        </div>

        {/* Stats */}
        <div className="stats-bar">
          <div className="stat">
            <div><div className="stat-val">{activeCount}</div><div className="stat-label">Active</div></div>
          </div>
          {licOpenCount > 0 && (
            <div className="stat" style={{ borderColor: "rgba(251,191,36,0.25)", cursor:"pointer" }} onClick={() => setPage("licensing")}>
              <div><div className="stat-val" style={{ color: C.amber }}>{licOpenCount}</div><div className="stat-label">Licensing open</div></div>
            </div>
          )}
          <div className="stat" style={{ borderColor: "rgba(52,211,153,0.25)" }}>
            <div><div className="stat-val" style={{ color: C.green }}>{prodCount}</div><div className="stat-label">Prod Ready</div></div>
          </div>
          {presCountGlobal > 0 && (
            <div className="stat" style={{ borderColor:"rgba(139,127,255,0.25)", cursor:"pointer" }} onClick={() => setBoardMode(m => m === "presentations" ? "products" : "presentations")}>
              <div><div className="stat-val" style={{ color:"#8B7FFF" }}>{presCountGlobal}</div><div className="stat-label">Presentations</div></div>
            </div>
          )}
          {overdueCount > 0 && (
            <div className="stat" style={{ borderColor: "rgba(248,113,113,0.25)" }}>
              <div><div className="stat-val" style={{ color: C.red }}>{overdueCount}</div><div className="stat-label">Overdue</div></div>
            </div>
          )}
          {priorityCount > 0 && (
            <div
              className={`stat stat-clickable stat-tone-priority ${boardTagFilter === "priority" ? "on" : ""}`}
              onClick={() => setBoardTagFilter(f => f === "priority" ? null : "priority")}
              title="Filter: priority only"
            >
              <div><div className="stat-val">{priorityCount}</div><div className="stat-label">Priority</div></div>
            </div>
          )}
          {boardMode === "products" && awaitingSalesCount > 0 && (
            <div
              className={`stat stat-clickable stat-tone-sales ${boardTagFilter === "awaiting_sales" ? "on" : ""}`}
              onClick={() => setBoardTagFilter(f => f === "awaiting_sales" ? null : "awaiting_sales")}
              title="Filter: awaiting sales"
            >
              <div><div className="stat-val">{awaitingSalesCount}</div><div className="stat-label">Awaiting sales</div></div>
            </div>
          )}
          {boardMode === "presentations" && licensesCount > 0 && (
            <div
              className={`stat stat-clickable stat-tone-licenses ${boardTagFilter === "licenses" ? "on" : ""}`}
              onClick={() => setBoardTagFilter(f => f === "licenses" ? null : "licenses")}
              title="Filter: needs licenses"
            >
              <div><div className="stat-val">{licensesCount}</div><div className="stat-label">Needs licenses</div></div>
            </div>
          )}
          {boardMode === "presentations" && presSalesInfoCount > 0 && (
            <div
              className={`stat stat-clickable stat-tone-sales ${boardTagFilter === "sales_info" ? "on" : ""}`}
              onClick={() => setBoardTagFilter(f => f === "sales_info" ? null : "sales_info")}
              title="Filter: awaiting sales info"
            >
              <div><div className="stat-val">{presSalesInfoCount}</div><div className="stat-label">Awaiting info</div></div>
            </div>
          )}
          <HeatmapCard projects={projects} />
        </div>

        {/* Filters */}
        <div className="filter-bar">
          {/* Board mode toggle */}
          <div className="bm-toggle">
            <button onClick={() => { setBoardMode("products"); setBoardTagFilter(null); }} className={`bm-btn ${boardMode === "products" ? "active" : ""}`}>Products</button>
            <button onClick={() => { setBoardMode("presentations"); setBoardTagFilter(null); }} className={`bm-btn ${boardMode === "presentations" ? "active pres" : ""}`}>Presentations</button>
          </div>
          <div className="filter-div" />
          {/* Category filter */}
          <div className="filter-section">
            {CATEGORIES.map(c => (
              <button key={c.id} onClick={() => setCategoryFilter(c.id)} className={`cat-tab ${categoryFilter === c.id ? "active" : ""}`}>
                {c.label}<span className="tab-ct">{catCounts[c.id]}</span>
              </button>
            ))}
          </div>
          <div className="filter-div" />
          <div className="filter-signal-group">
            <span className="filter-group-label">Focus</span>
            <div className="signal-chip-row">
              {priorityCount > 0 && (
                <SignalFilterChip
                  tone="priority"
                  label="Priority"
                  count={priorityCount}
                  active={boardTagFilter === "priority"}
                  onClick={() => setBoardTagFilter(f => f === "priority" ? null : "priority")}
                  title="Show priority projects only"
                />
              )}
              {boardMode === "products" && (
                <SignalFilterChip
                  tone="sales"
                  label="Awaiting sales"
                  count={awaitingSalesCount}
                  active={boardTagFilter === "awaiting_sales"}
                  onClick={() => setBoardTagFilter(f => f === "awaiting_sales" ? null : "awaiting_sales")}
                  title="Show products waiting on sales"
                />
              )}
              {boardMode === "presentations" && (
                <>
                  <SignalFilterChip
                    tone="licenses"
                    label="Needs licenses"
                    count={licensesCount}
                    active={boardTagFilter === "licenses"}
                    onClick={() => setBoardTagFilter(f => f === "licenses" ? null : "licenses")}
                    title="Waiting on licenses from sales"
                  />
                  <SignalFilterChip
                    tone="sales"
                    label="Awaiting info"
                    count={presSalesInfoCount}
                    active={boardTagFilter === "sales_info"}
                    onClick={() => setBoardTagFilter(f => f === "sales_info" ? null : "sales_info")}
                    title="Waiting on sales brief or details"
                  />
                  {presBlockedCount > 0 && (
                    <SignalFilterChip
                      tone="blocked"
                      label="All blocked"
                      count={presBlockedCount}
                      active={boardTagFilter === "awaiting_sales"}
                      onClick={() => setBoardTagFilter(f => f === "awaiting_sales" ? null : "awaiting_sales")}
                      title="Any sales blocker"
                    />
                  )}
                </>
              )}
            </div>
          </div>
          <div className="filter-div" />
          <div className="filter-section" style={{ gap: 6 }}>
            {TEAM.map(t => (
              <div key={t.name} title={t.name} className={`asn-chip ${assigneeFilter === t.name ? "asn-on" : ""}`}
                onClick={() => setAssigneeFilter(f => f === t.name ? null : t.name)}>
                <span className="av av-md" style={{ background: t.color }}>{initials(t.name)}</span>
              </div>
            ))}
          </div>
        </div>

        {boardTagFilter && (
          <div className="board-callout">
            <div className="board-callout-text">
              <span className="board-callout-dot" aria-hidden />
              <span>
                Filtered to <strong>{
                  boardTagFilter === "priority" ? "priority"
                    : boardTagFilter === "licenses" ? "needs licenses"
                      : boardTagFilter === "sales_info" ? "awaiting sales info"
                        : boardTagFilter === "awaiting_sales" && boardMode === "presentations" ? "blocked by sales"
                          : "awaiting sales"
                }</strong>
                <span className="board-callout-count">{filtered.filter(p => p.stage !== "archived").length} shown</span>
              </span>
            </div>
            <button type="button" className="board-callout-clear" onClick={() => setBoardTagFilter(null)}>Clear filter</button>
          </div>
        )}

        {view === "board" ? (
          <Board projects={filtered} onAssign={handleAssign} onReorder={handleReorder} onQuickAdd={handleQuickAdd} onOpen={openProject} stages={activeStages} canEdit={canEditProjects} shouldGlowProject={shouldGlowProject} />
        ) : view === "list" ? (
          <ListView projects={filtered.filter(p => p.stage !== "archived")} onOpen={openProject} shouldGlowProject={shouldGlowProject} />
        ) : (
          <CalendarView projects={filtered.filter(p => p.stage !== "archived")} onOpen={openProject} />
        )}
      </main>
      )} {/* end page conditional */}

      {drawer && <Drawer project={drawer.project} isNew={drawer.isNew} onSave={handleSave} onDelete={handleDelete} onMoveBoard={handleMoveBoard} onClose={() => setDrawer(null)} presentations={presentationProjects} readOnly={!canEditProjects} defaultAssigneeName={defaultAssignee(boardProfile)} />}
      {toast && (
        <div className="toast">
          <span className="toast-msg">{toast.message}</span>
          {toast.onUndo && (
            <button type="button" className="toast-undo" onClick={runUndo}>Undo</button>
          )}
        </div>
      )}
    </div>
  );
}
