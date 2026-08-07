import { useState, useEffect, useCallback, useRef, useMemo, Fragment } from "react";
import { UserButton } from "@clerk/clerk-react";
import { useAppRole, useNickname } from "./src/useAppRole.js";
import SalesPage, { computeOverview, computeWorkload } from "./src/SalesPage.jsx";

const MAX_ACTIVITY = 50;

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
  { id: "uploads",    label: "Uploads",    dot: "#22D3EE" },
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

/** Scroll inside a column only when it has enough cards; empty columns let the page scroll */
const COL_SCROLL_CARD_THRESHOLD = 3;

/** Preserve manual column order (boardOrder), then array position for legacy rows */
function orderProjectsForBoard(stageItems, allProjects) {
  const indexInList = new Map(allProjects.map((p, i) => [p.id, i]));
  return [...stageItems].sort((a, b) => {
    const oa = typeof a.boardOrder === "number" ? a.boardOrder : indexInList.get(a.id) ?? 0;
    const ob = typeof b.boardOrder === "number" ? b.boardOrder : indexInList.get(b.id) ?? 0;
    if (oa !== ob) return oa - ob;
    return (indexInList.get(a.id) ?? 0) - (indexInList.get(b.id) ?? 0);
  });
}

/** Re-number boardOrder for stages based on current global array order */
function applyBoardOrderForStages(projects, stageIds) {
  const counters = {};
  return projects.map(p => {
    if (!stageIds.has(p.stage)) return p;
    const n = counters[p.stage] ?? 0;
    counters[p.stage] = n + 1;
    return { ...p, boardOrder: n };
  });
}

const TEAM = [
  { name: "Candace O.", color: "#F472B6" },
  { name: "Anthony C.", color: "#34D399" },
  { name: "Flavia N.",  color: "#C084FC" },
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
const UNASSIGNED_FILTER = "__unassigned__";
const isUnassignedProject = (p) => projectAssignees(p).length === 0;
const projectMatchesAssigneeFilter = (p, filter) => {
  if (!filter) return true;
  if (filter === UNASSIGNED_FILTER) return isUnassignedProject(p);
  return projectHasAssignee(p, filter);
};
const assigneesLabel = (names) =>
  names.length <= 2 ? names.join(", ") : `${names[0]} +${names.length - 1}`;
const normalizeProjectForSave = (p) => {
  const assignees = projectAssignees(p);
  const { assignee: _legacy, ...rest } = p;
  return { ...rest, assignees };
};

const DRAWER_MERGE_FIELDS = [
  "title", "notes", "stage", "category", "season", "startDate", "dueDate",
  "assignees", "priority", "waitingOnSales", "waitingOnLicenses", "followUps",
  "styleNumbers", "projectType", "customer", "sourcePresId", "presentationId",
];

function cloneProjectSnapshot(p) {
  if (!p) return null;
  try {
    return JSON.parse(JSON.stringify(normalizeProjectForSave(p)));
  } catch {
    return normalizeProjectForSave({ ...p });
  }
}

function fieldValuesEqual(a, b) {
  if (a === b) return true;
  try {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  } catch {
    return false;
  }
}

function isDrawerDirty(form, base) {
  if (!base) return true;
  return DRAWER_MERGE_FIELDS.some(k => !fieldValuesEqual(form?.[k], base?.[k]));
}

/**
 * Apply only fields the user changed in the drawer onto the latest board
 * project — prevents a stale open drawer/autosave from wiping teammates' edits.
 */
function mergeDrawerOntoCurrent(current, form, base) {
  if (!current) return normalizeProjectForSave(form);
  if (!base) return normalizeProjectForSave({ ...current, ...form });
  const next = { ...current };
  for (const k of DRAWER_MERGE_FIELDS) {
    if (!fieldValuesEqual(form?.[k], base?.[k])) {
      next[k] = form?.[k];
    }
  }
  return normalizeProjectForSave(next);
}

/** Best-effort "how fresh is this project" for sync merges */
function projectSyncTime(p) {
  if (!p) return 0;
  return Math.max(
    Date.parse(p.updatedAt || "") || 0,
    Date.parse(p.activity?.[0]?.at || "") || 0,
    Date.parse(p.assignHighlightAt || "") || 0,
    Date.parse(p.highlightAt || "") || 0,
  );
}

/**
 * Merge local + remote boards so a stale cloud snapshot can't wipe
 * a move/create that already happened on this client.
 */
function mergeProjectsBoard(local, remote) {
  if (!Array.isArray(remote)) return { merged: Array.isArray(local) ? local : [], localWins: false };
  if (!Array.isArray(local) || !local.length) return { merged: remote, localWins: false };

  const byId = new Map();
  let localWins = false;

  for (const p of remote) {
    if (p?.id) byId.set(p.id, p);
  }

  for (const p of local) {
    if (!p?.id) continue;
    const r = byId.get(p.id);
    if (!r) {
      byId.set(p.id, p);
      localWins = true;
      continue;
    }
    if (projectSyncTime(p) > projectSyncTime(r)) {
      byId.set(p.id, p);
      localWins = true;
    }
  }

  const used = new Set();
  const merged = [];
  for (const p of remote) {
    if (!p?.id || used.has(p.id)) continue;
    merged.push(byId.get(p.id) || p);
    used.add(p.id);
  }
  for (const p of local) {
    if (!p?.id || used.has(p.id)) continue;
    merged.push(byId.get(p.id) || p);
    used.add(p.id);
  }
  return { merged, localWins };
}

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

const SEASONS = [
  "SS25", "FW25", "Resort 25",
  "SS26", "FW26", "Resort 26",
  "SS27", "FW27", "Resort 27",
  "SS28", "FW28", "Resort 28",
  "Evergreen",
];

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
  uploads: "review",
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
  return { ...next, activity, updatedAt: new Date().toISOString() };
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

const SALES_REQ_STATUS = {
  pending:  { id: "pending",  label: "Pending",  dot: "#FBBF24" },
  approved: { id: "approved", label: "Approved", dot: "#34D399" },
  rejected: { id: "rejected", label: "Rejected", dot: "#F87171" },
};
const SALES_REQ_COLUMNS = [
  { ...SALES_REQ_STATUS.pending, label: "Pending review", hint: "Waiting on art" },
  { ...SALES_REQ_STATUS.approved, label: "Approved", hint: "Art accepted" },
  { ...SALES_REQ_STATUS.rejected, label: "Rejected", hint: "Not taken on" },
];
const salesReqStatusOf = (id) => SALES_REQ_STATUS[id] || SALES_REQ_STATUS.pending;

function diffSalesReqActivity(prev, next, by, projects) {
  if (!prev) return [newActivityEntry(by, "Submitted request")];
  const entries = [];
  const prevSt = prev.status || "pending";
  const nextSt = next.status || "pending";
  if (prevSt !== nextSt) {
    entries.push(newActivityEntry(by, `${salesReqStatusOf(nextSt).label}`));
  }
  if ((prev.title || "").trim() !== (next.title || "").trim()) {
    entries.push(newActivityEntry(by, `Title → “${next.title}”`));
  }
  if ((prev.category || "") !== (next.category || "")) {
    entries.push(newActivityEntry(by, `Category → ${catLabel(next.category)}`));
  }
  if ((prev.season || "") !== (next.season || "")) {
    entries.push(newActivityEntry(by, `Season → ${next.season}`));
  }
  if ((prev.projectId || "") !== (next.projectId || "")) {
    const title = next.projectId ? (projects?.find(p => p.id === next.projectId)?.title || "a project") : "";
    entries.push(newActivityEntry(by, next.projectId ? `Linked to ${title}` : "Unlinked project"));
  }
  if ((prev.message || "").trim() !== (next.message || "").trim()) {
    entries.push(newActivityEntry(by, "Updated request details"));
  }
  if ((prev.reviewNote || "").trim() !== (next.reviewNote || "").trim()) {
    entries.push(newActivityEntry(by, "Updated art team note"));
  }
  if ((prev.createdProjectId || "") !== (next.createdProjectId || "")) {
    const title = next.createdProjectId
      ? (projects?.find(p => p.id === next.createdProjectId)?.title || "project")
      : "";
    entries.push(newActivityEntry(by, next.createdProjectId ? `Added to board: ${title}` : "Removed board link"));
  }
  if ((prev.createdBoardType || "") !== (next.createdBoardType || "") && next.createdBoardType) {
    entries.push(newActivityEntry(by, `Board → ${boardTypeLabel(next.createdBoardType)}`));
  }
  return entries;
}

function withSalesReqActivity(prev, next, by, projects) {
  const added = diffSalesReqActivity(prev, next, by, projects);
  if (!added.length) return next;
  const activity = [...added, ...(next.activity || prev?.activity || [])].slice(0, MAX_ACTIVITY);
  return { ...next, activity };
}

function defaultStageForSalesBoard(boardType) {
  return boardType === "presentation" ? "brief" : "concept";
}

function boardTypeLabel(boardType) {
  return boardType === "presentation" ? "Presentations" : "Products";
}

function buildProjectFromSalesRequest(req, boardType, projects, actor, teamProfile) {
  const projectType = boardType === "presentation" ? "presentation" : "product";
  const stage = defaultStageForSalesBoard(boardType);
  const now = new Date().toISOString();
  const inStage = projects.filter(p => p.stage === stage);
  const maxOrder = inStage.reduce((m, p) => Math.max(m, typeof p.boardOrder === "number" ? p.boardOrder : -1), -1);
  const assignees = [];
  const noteLines = [];
  if (req.message?.trim()) noteLines.push(`Sales request:\n${req.message.trim()}`);
  if (req.reviewNote?.trim()) noteLines.push(`Art note:\n${req.reviewNote.trim()}`);
  if (req.createdBy) noteLines.push(`Submitted by ${req.createdBy}`);
  const linked = req.projectId ? projects.find(p => p.id === req.projectId) : null;
  if (linked) noteLines.push(`Related project: ${linked.title}`);

  const base = {
    id: `p${Date.now()}`,
    title: (req.title || "").trim() || "Untitled",
    stage,
    projectType,
    category: req.category || "apparel",
    season: req.season || "SS26",
    assignees,
    dueDate: "",
    notes: noteLines.join("\n\n"),
    styleNumbers: [],
    activity: [],
    boardOrder: maxOrder + 1,
    salesRequestId: req.id,
    highlightAt: now,
    ...(assignees.length ? { assignHighlightAt: now, assignHighlightFor: assignees } : {}),
  };
  const withCreate = withActivity(null, base, actor);
  return {
    ...withCreate,
    activity: [
      newActivityEntry(actor, `Created from sales request (${req.createdBy || "Sales"})`),
      ...(withCreate.activity || []),
    ].slice(0, MAX_ACTIVITY),
  };
}

function upsertProjectForSalesRequest(req, boardType, projects, actor, teamProfile) {
  const targetType = boardType === "presentation" ? "presentation" : "product";
  let projectId = req.createdProjectId;
  let proj = projectId ? projects.find(p => p.id === projectId) : null;

  if (!proj) {
    const created = buildProjectFromSalesRequest(req, boardType, projects, actor, teamProfile);
    return { nextProjects: [...projects, created], projectId: created.id, created: true, title: created.title };
  }

  const currentType = proj.projectType === "presentation" ? "presentation" : "product";
  if (currentType !== targetType) {
    const moved = convertProjectBetweenBoards(proj, targetType);
    const updated = withActivity(proj, moved, actor);
    return {
      nextProjects: projects.map(p => p.id === proj.id ? updated : p),
      projectId: proj.id,
      created: false,
      title: updated.title,
      moved: true,
    };
  }

  return { nextProjects: projects, projectId: proj.id, created: false, title: proj.title };
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

function normalizeFollowUps(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter(f => f && String(f.title || "").trim())
    .map(f => ({
      id: f.id || `fu${Date.now()}`,
      title: String(f.title).trim(),
      summary: String(f.summary || "").trim(),
      createdAt: f.createdAt || new Date().toISOString(),
      createdBy: f.createdBy || "",
      status: f.status === "tasked" || f.status === "done" ? f.status : "open",
      productId: f.productId || "",
    }));
}

function openFollowUpCount(project) {
  if (!isPresentationProject(project)) return 0;
  return normalizeFollowUps(project.followUps).filter(f => f.status === "open").length;
}

function collectOpenFollowUps(projects) {
  const items = [];
  (projects || []).filter(isPresentationProject).forEach(p => {
    if (p.stage === "archived") return;
    normalizeFollowUps(p.followUps)
      .filter(f => f.status === "open")
      .forEach(f => {
        items.push({
          ...f,
          presentationId: p.id,
          presentationTitle: p.title,
          customerName: customerNameOf(p) || "",
        });
      });
  });
  return items.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

function customerNameOf(project) {
  return CUSTOMERS.find(c => c.id === project?.customer)?.name || "";
}

function buildProductFromFollowUp(pres, followUp, projects, actor, teamProfile) {
  const stage = "concept";
  const inStage = projects.filter(p => p.stage === stage && p.projectType !== "presentation");
  const maxOrder = inStage.reduce((m, p) => Math.max(m, typeof p.boardOrder === "number" ? p.boardOrder : -1), -1);
  const assignees = [];
  const now = new Date().toISOString();
  const cust = customerNameOf(pres);
  const noteLines = [
    `Buyer follow-up from presentation: ${pres.title}`,
    cust ? `Customer: ${cust}` : null,
    followUp.summary ? followUp.summary : null,
    followUp.createdBy ? `Logged by ${followUp.createdBy}` : null,
  ].filter(Boolean);

  const base = {
    id: `p${Date.now()}`,
    title: followUp.title,
    stage,
    projectType: "product",
    category: pres.category || "apparel",
    season: pres.season || "SS26",
    assignees,
    dueDate: "",
    notes: noteLines.join("\n\n"),
    styleNumbers: [],
    sourcePresId: pres.id,
    activity: [],
    boardOrder: maxOrder + 1,
    priority: "high",
    highlightAt: now,
    ...(assignees.length ? { assignHighlightAt: now, assignHighlightFor: assignees } : {}),
  };
  const withCreate = withActivity(null, base, actor);
  return {
    ...withCreate,
    activity: [
      newActivityEntry(actor, `Created from buyer follow-up on “${pres.title}”`),
      ...(withCreate.activity || []),
    ].slice(0, MAX_ACTIVITY),
  };
}

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
async function loadSalesReq() { try { const r = await window.storage.get("sales_req_v1"); return r ? JSON.parse(r.value) : []; } catch { return []; } }
async function saveSalesReq(reqs) { await window.storage.set("sales_req_v1", JSON.stringify(reqs)); }

function AssigneeAvatars({ project, size = "sm", maxShow = 3, compact = false, showUnassigned = false }) {
  const names = projectAssignees(project);
  if (!names.length) {
    if (!showUnassigned) return null;
    return <span className="card-unassigned">Unassigned</span>;
  }
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

function AssigneePicker({ assignees, onChange, readOnly, compact = false }) {
  const selected = projectAssignees({ assignees });
  const toggle = (name) => {
    if (readOnly) return;
    if (selected.includes(name)) {
      onChange(selected.filter(n => n !== name));
    } else {
      onChange([...selected, name]);
    }
  };
  return (
    <div className={`assignee-picker ${compact ? "assignee-picker--compact" : ""}`}>
      {TEAM.map(t => {
        const on = selected.includes(t.name);
        return (
          <button key={t.name} type="button" disabled={readOnly} title={t.name}
            className={`assignee-pick-btn ${on ? "on" : ""} ${compact ? "assignee-pick-btn--avatar" : ""}`}
            style={{ "--tc": t.color }}
            onClick={() => toggle(t.name)}>
            <span className="av av-sm" style={{ background: t.color }}>{initials(t.name)}</span>
            {!compact && t.name}
          </button>
        );
      })}
      {!readOnly && !compact && (
        <div className="field-hint">
          {selected.length ? "Tap to remove" : "Optional — tap to assign when ready"}
        </div>
      )}
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

function focusFilterLabel(boardTagFilter, boardMode) {
  if (boardTagFilter === "priority") return "priority";
  if (boardTagFilter === "licenses") return "needs licenses";
  if (boardTagFilter === "sales_info") return "awaiting sales info";
  if (boardTagFilter === "awaiting_sales" && boardMode === "presentations") return "blocked by sales";
  if (boardTagFilter === "awaiting_sales") return "awaiting sales";
  return "";
}

function FocusFilterBar({
  boardMode,
  boardTagFilter,
  setBoardTagFilter,
  priorityCount,
  awaitingSalesCount,
  licensesCount,
  presSalesInfoCount,
  presBlockedCount,
  filteredShownCount = 0,
  statusAside = false,
}) {
  const chips = (
    <div className={`filter-signal-group ${boardTagFilter ? "has-active-filter" : ""}`}>
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
              label="Awaiting sales info"
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
  );

  if (!statusAside) return chips;

  return (
    <div className="board-focus-wrap">
      <div
        className={`focus-filter-status ${boardTagFilter ? "is-visible" : ""}`}
        title={boardTagFilter ? `Filtered to ${focusFilterLabel(boardTagFilter, boardMode)}` : undefined}
      >
        <span className="focus-filter-count">{filteredShownCount} shown</span>
        <button type="button" className="focus-filter-clear" onClick={() => setBoardTagFilter(null)} tabIndex={boardTagFilter ? 0 : -1}>
          Clear
        </button>
      </div>
      {chips}
    </div>
  );
}

function BlockerToggle({ checked, onChange, disabled, tone, title, description, compact = false }) {
  if (compact) {
    return (
      <button
        type="button"
        className={`assignee-pick-btn blocker-pill ${tone} ${checked ? "on" : ""}`}
        onClick={() => !disabled && onChange(!checked)}
        disabled={disabled}
        aria-pressed={checked}
      >
        {title}
      </button>
    );
  }
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
function cardStatusHints(project) {
  const hints = [];
  const pr = priorityOf(project);
  if (pr.id === "urgent") hints.push({ key: "priority", label: "Urgent", tone: "urgent", flagClass: "flag-priority-urgent" });
  else if (pr.id === "high") hints.push({ key: "priority", label: "High", tone: "high", flagClass: "flag-priority-high" });
  if (isWaitingOnLicenses(project)) hints.push({ key: "licenses", label: "Licenses", tone: "licenses", flagClass: "flag-licenses" });
  if (isWaitingOnSalesInfo(project)) hints.push({ key: "sales-info", label: "Awaiting sales info", tone: "sales", flagClass: "flag-sales-info" });
  if (isWaitingOnSalesProduct(project)) hints.push({ key: "sales", label: "Awaiting sales", tone: "sales", flagClass: "flag-sales" });
  const fu = openFollowUpCount(project);
  if (fu > 0) hints.push({ key: "followup", label: `${fu} follow-up${fu !== 1 ? "s" : ""}`, tone: "followup", flagClass: "flag-followup" });
  return hints;
}

function ProjectFlags({ project, compact = false }) {
  const hints = cardStatusHints(project);
  if (!hints.length) return null;
  return (
    <div className={`card-flags ${compact ? "compact" : ""}`}>
      {hints.map(h => (
        <span key={h.key} className={`card-flag ${h.flagClass}`}>{h.label}</span>
      ))}
    </div>
  );
}

// ─── BOARD CARD ──────────────────────────────────────────────────────────────
function BoardCard({ project, isDragging, isDropTarget, onPointerDown, onOpen, onDelete, canEdit = true, isNewHighlight = false }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const days    = daysUntil(project.dueDate);
  const overdue = days !== null && days < 0;
  const dueSoon = days !== null && days >= 0 && days <= 14;
  const cc      = catColor(project.category);
  const pr       = priorityOf(project);
  const licenses = isWaitingOnLicenses(project);
  const salesHold = isWaitingOnSalesInfo(project) || isWaitingOnSalesProduct(project);
  const statusHints = cardStatusHints(project);

  return (
    <div
      className={`card ${isDragging ? "card-dragging" : ""} ${isDropTarget ? "card-drop-target" : ""} ${isNewHighlight ? "card-new" : ""} ${confirmDelete ? "card-confirm-delete" : ""} ${!canEdit ? "card-view-only" : ""} ${pr.id ? `card-priority-${pr.id}` : ""} ${licenses ? "card-waiting-licenses" : ""} ${salesHold ? "card-waiting-sales" : ""}`}
      onPointerDown={canEdit ? (e) => onPointerDown(e, project) : undefined}
      onClick={() => { if (!isDragging && !confirmDelete) onOpen(project); }}
      data-card-id={project.id}
      style={{ "--cc": cc }}
    >
      {isDropTarget && <div className="card-drop-bar" />}
      {canEdit && onDelete && (
        <div className="card-actions" onClick={e => e.stopPropagation()}>
          {!confirmDelete ? (
            <button
              type="button"
              className="card-delete-btn"
              onClick={() => setConfirmDelete(true)}
              title="Delete project"
              aria-label="Delete project"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
                <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                <path d="M10 11v6M14 11v6" />
              </svg>
            </button>
          ) : (
            <div className="card-delete-confirm">
              <span className="card-delete-prompt">Delete?</span>
              <button type="button" className="card-delete-yes" onClick={() => onDelete(project.id)}>Yes</button>
              <button type="button" className="card-delete-no" onClick={() => setConfirmDelete(false)}>No</button>
            </div>
          )}
        </div>
      )}
      <div className="card-stripe" />
      <div className="card-body">
        <div className="card-title">{project.title}</div>
        <div className="card-meta">{catLabel(project.category)} · {project.season}</div>
        {statusHints.length > 0 && (
          <div className="card-status-flags">
            {statusHints.map(h => (
              <span key={h.key} className={`card-meta-flag tone-${h.tone}`}>{h.label}</span>
            ))}
          </div>
        )}
        <div className="card-footer">
          <div className="card-assignee">
            <AssigneeAvatars project={project} size="sm" maxShow={2} showUnassigned />
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
function Board({ projects, onAssign, onReorder, onOpen, onQuickAdd, onDelete, stages = STAGES, canEdit = true, shouldGlowProject, focusBar = null }) {
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

  // Wheel: page scroll by default; horizontal pan only when the board overflows sideways
  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const onWheel = (e) => {
      if (isDraggingRef.current) return;
      if (!e.target.closest?.(".board")) return;

      const colBody = e.target.closest?.(".col-cards--scroll");
      if (colBody) {
        const canScrollY = colBody.scrollHeight > colBody.clientHeight + 2;
        if (canScrollY) {
          const atTop = colBody.scrollTop <= 0;
          const atBottom = colBody.scrollTop + colBody.clientHeight >= colBody.scrollHeight - 2;
          if ((e.deltaY < 0 && !atTop) || (e.deltaY > 0 && !atBottom)) return;
        }
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
      <div className="board-tools-row">
        <div className="team-strip">
          <span className="strip-label">Team</span>
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
          {(!canEdit || isDC || isDT) && (
            <span className="strip-hint">
              {!canEdit
                ? "View only — click a card for details"
                : isDC
                  ? "Drop on teammate to assign"
                  : "Drop on a card to assign"}
            </span>
          )}
        </div>
        {focusBar && <div className="board-tools-focus">{focusBar}</div>}
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
      <div className="board scroll-surface" ref={boardRef}>
        {stages.map((stage, si) => {
          const stageIds = new Set(stages.map(s => s.id));
          const items    = orderProjectsForBoard(
            projects.filter(p => p.stage === stage.id || (si === 0 && !stageIds.has(p.stage))),
            projects,
          );
          const isHov    = isDC && hover?.type === "stage" && hover.value === stage.id;
          const overdueCt = items.filter(p => { const d = daysUntil(p.dueDate); return d !== null && d < 0; }).length;
          const isColl   = collapsed.has(stage.id);
          const bodyScroll = !isColl && items.length >= COL_SCROLL_CARD_THRESHOLD;
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
                  <div className={`col-cards ${bodyScroll ? "col-cards--scroll scroll-surface" : ""}`}>
                    {items.length === 0 ? (
                      <div className={`col-empty ${isHov ? "col-empty-on" : ""}`}>{isHov ? "Drop here" : "No projects"}</div>
                    ) : items.map(p => {
                      const isBeforeMarker   = isHov && hover.beforeId === p.id;
                      const isTeamDropTarget = isDT && hover?.type === "card" && hover.id === p.id;
                      return (
                        <div key={p.id}>
                          {isBeforeMarker && <div className="drop-marker" />}
                          <BoardCard project={p} isDragging={isDC && drag.project.id === p.id} isDropTarget={isTeamDropTarget} onPointerDown={handleCardPointerDown} onOpen={onOpen} onDelete={onDelete} canEdit={canEdit} isNewHighlight={isHighlighted(p)} />
                        </div>
                      );
                    })}
                    {isHov && !hover.beforeId && items.length > 0 && <div className="drop-marker" />}
                  </div>
                  <div className="col-add">
                    <QuickAdd stageId={stage.id} onAdd={onQuickAdd} canEdit={canEdit} />
                  </div>
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
                <AssigneeAvatars project={p} maxShow={2} showUnassigned />
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
                        <AssigneeAvatars project={p} size="sm" maxShow={2} />
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

function ActivityLog({ activity, hideLabel = false }) {
  const items = activity || [];
  return (
    <div className="activity-log">
      {!hideLabel && <div className="field-label">Activity</div>}
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

// ─── BUYER FOLLOW-UPS (post-meeting handoff) ───────────────────────────────
function BuyerFollowUpSection({
  followUps,
  onChange,
  canAdd,
  canTask,
  onCreateProduct,
  projects,
}) {
  const items = normalizeFollowUps(followUps);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftSummary, setDraftSummary] = useState("");

  const add = () => {
    const title = draftTitle.trim();
    if (!title || !canAdd) return;
    const entry = {
      id: `fu${Date.now()}`,
      title,
      summary: draftSummary.trim(),
      createdAt: new Date().toISOString(),
      status: "open",
      productId: "",
    };
    onChange([...items, entry]);
    setDraftTitle("");
    setDraftSummary("");
  };

  const markDone = (id) => {
    onChange(items.map(f => f.id === id ? { ...f, status: "done" } : f));
  };

  if (!items.length && !canAdd) return null;

  return (
    <div className="fu-section">
      <div className="field-label">Buyer follow-ups</div>
      {canTask && items.some(f => f.status === "open") && (
        <p className="field-hint fu-hint">Use <strong>Create product</strong> to add work to the board.</p>
      )}
      {items.length > 0 && (
        <ul className="fu-list">
          {items.map(f => {
            const linked = f.productId ? projects.find(p => p.id === f.productId) : null;
            return (
              <li key={f.id} className={`fu-item fu-item--${f.status}`}>
                <div className="fu-item-head">
                  <span className="fu-item-title">{f.title}</span>
                  <span className={`fu-status-pill ${f.status}`}>
                    {f.status === "open" ? "Needs tasking" : f.status === "tasked" ? "On board" : "Done"}
                  </span>
                </div>
                {f.summary && <p className="fu-item-summary">{f.summary}</p>}
                <div className="fu-item-meta">
                  {f.createdBy && <span>{f.createdBy}</span>}
                  {f.createdAt && <span>{formatActivityTime(f.createdAt)}</span>}
                </div>
                {f.status === "open" && canTask && onCreateProduct && (
                  <button type="button" className="fu-task-btn" onClick={() => onCreateProduct(f.id)}>
                    Create product on board
                  </button>
                )}
                {f.status === "tasked" && linked && (
                  <div className="fu-linked">On board: <strong>{linked.title}</strong></div>
                )}
                {canTask && f.status !== "done" && (
                  <button type="button" className="fu-done-btn" onClick={() => markDone(f.id)}>Mark done</button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {canAdd && (
        <div className="fu-add">
          <Input
            value={draftTitle}
            onChange={e => setDraftTitle(e.target.value)}
            placeholder="What the buyer wants (e.g. More MLBPA for Giant Tiger)"
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          />
          <Textarea
            rows={2}
            value={draftSummary}
            onChange={e => setDraftSummary(e.target.value)}
            placeholder="Meeting summary, qty, timeline, refs…"
          />
          <button type="button" className="btn-add-sku" onClick={add} disabled={!draftTitle.trim()}>
            + Log follow-up
          </button>
        </div>
      )}
    </div>
  );
}

function LogBuyerFollowUpModal({ presentations, onSave, onClose }) {
  const activePres = (presentations || [])
    .filter(p => p.stage !== "archived")
    .sort((a, b) => a.title.localeCompare(b.title));
  const [presentationId, setPresentationId] = useState(activePres[0]?.id || "");
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");

  const submit = () => {
    if (!presentationId || !title.trim()) return;
    onSave({ presentationId, title: title.trim(), summary: summary.trim() });
  };

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="sales-gate-modal fu-log-modal" role="dialog" aria-labelledby="fu-log-title">
        <h3 id="fu-log-title" className="sales-gate-title">Log buyer follow-up</h3>
        <p className="sales-gate-body" style={{ marginBottom: 14 }}>
          After a buyer meeting, capture what they asked for. Art will see it on the presentation and can create product cards.
        </p>
        <div className="field" style={{ marginBottom: 12 }}>
          <div className="field-label">Presentation</div>
          <Select value={presentationId} onChange={e => setPresentationId(e.target.value)}>
            {activePres.length === 0 && <option value="">No presentations yet</option>}
            {activePres.map(p => (
              <option key={p.id} value={p.id}>
                {p.title}{customerNameOf(p) ? ` · ${customerNameOf(p)}` : ""}
              </option>
            ))}
          </Select>
        </div>
        <div className="field" style={{ marginBottom: 12 }}>
          <div className="field-label">What they want</div>
          <Input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="e.g. Expanded MLBPA range — 3 styles"
            autoFocus
          />
        </div>
        <div className="field" style={{ marginBottom: 16 }}>
          <div className="field-label">Meeting notes</div>
          <Textarea
            rows={3}
            value={summary}
            onChange={e => setSummary(e.target.value)}
            placeholder="Buyer feedback, timeline, which lines they liked…"
          />
        </div>
        <div className="sales-gate-actions">
          <button type="button" className="btn-cancel" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" onClick={submit} disabled={!presentationId || !title.trim()}>
            Log for art team
          </button>
        </div>
      </div>
    </>
  );
}

function DrawerSection({ title, defaultOpen = false, badge, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`drawer-section ${open ? "is-open" : ""}`}>
      <button type="button" className="drawer-section-toggle" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span className="drawer-section-title">{title}</span>
        {badge != null && badge !== 0 && badge !== "" && (
          <span className="drawer-section-badge">{badge}</span>
        )}
        <span className="drawer-section-chevron" aria-hidden>{open ? "▾" : "▸"}</span>
      </button>
      {open && <div className="drawer-section-body">{children}</div>}
    </div>
  );
}

// ─── DRAWER ──────────────────────────────────────────────────────────────────
function Drawer({ project, isNew, onSave, onClose, onDelete, onMoveBoard, presentations, readOnly = false, canLogFollowUps = false, canTaskFollowUps = false, onCreateProductFromFollowUp, allProjects = [] }) {
  const [form, setForm] = useState(() => {
    if (project) return { ...project, assignees: projectAssignees(project) };
    return {
      id: `p${Date.now()}`,
      title: "", category: "apparel", stage: "concept", projectType: "product",
      assignees: [], season: "SS26",
      startDate: "", dueDate: "", notes: "", styleNumbers: [], presentationId: "", sourcePresId: "",
      priority: "", waitingOnSales: false, waitingOnLicenses: false, followUps: [],
    };
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saveState, setSaveState] = useState("saved");
  const skipAutoSaveRef = useRef(true);
  const formRef = useRef(form);
  formRef.current = form;
  const baseRef = useRef(cloneProjectSnapshot(
    project ? { ...project, assignees: projectAssignees(project) } : null
  ));

  const buildPayload = useCallback(() => normalizeProjectForSave({
    ...formRef.current,
    id: formRef.current.id || `p${Date.now()}`,
    styleNumbers: normalizeStyleEntries(formRef.current.styleNumbers),
  }), []);

  const flushSave = useCallback(async (opts = {}) => {
    if (readOnly) return false;
    const title = formRef.current.title?.trim();
    if (!title) return false;
    if (!isNew && !isDrawerDirty(formRef.current, baseRef.current)) {
      setSaveState("saved");
      return true;
    }
    setSaveState("saving");
    try {
      const updated = await onSave(buildPayload(), {
        close: false,
        silent: opts.silent !== false,
        base: baseRef.current,
      });
      if (updated) {
        baseRef.current = cloneProjectSnapshot(updated);
        setForm(f => ({
          ...f,
          updatedAt: updated.updatedAt,
          activity: updated.activity,
        }));
      }
      setSaveState("saved");
      return true;
    } catch {
      setSaveState("error");
      return false;
    }
  }, [readOnly, onSave, buildPayload, isNew]);

  const handleManualSave = useCallback(() => {
    flushSave({ silent: false });
  }, [flushSave]);

  // Teammate updated this card and we have no local edits — refresh open drawer
  useEffect(() => {
    if (isNew || readOnly || !form.id) return;
    const live = allProjects.find(p => p.id === form.id);
    if (!live) return;
    if (isDrawerDirty(formRef.current, baseRef.current)) return;
    if (projectSyncTime(live) <= projectSyncTime(baseRef.current)) return;
    const snap = { ...live, assignees: projectAssignees(live) };
    baseRef.current = cloneProjectSnapshot(snap);
    skipAutoSaveRef.current = true;
    setForm(snap);
    setSaveState("saved");
  }, [allProjects, form.id, isNew, readOnly]);

  useEffect(() => {
    if (readOnly) return;
    if (skipAutoSaveRef.current) {
      skipAutoSaveRef.current = false;
      return;
    }
    if (!form.title?.trim()) {
      setSaveState("idle");
      return;
    }
    if (!isNew && !isDrawerDirty(form, baseRef.current)) {
      setSaveState("saved");
      return;
    }
    setSaveState("pending");
    const t = setTimeout(() => flushSave({ silent: true }), 800);
    return () => clearTimeout(t);
  }, [form, readOnly, flushSave, isNew]);
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
    void flushSave({ silent: true });
    setClosing(true);
    setTimeout(() => onClose?.(), 180);
  }, [closing, onClose, flushSave]);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [requestClose]);

  const followUpItems = normalizeFollowUps(form.followUps);
  const skuCount = normalizeStyleEntries(form.styleNumbers).length;
  const activityCount = (form.activity || []).length;
  const showFollowUps = isPresentation && (canLogFollowUps || canTaskFollowUps || followUpItems.length > 0);
  const showSkus = !isPresentation && (isAwaitingSales || skuCount > 0);
  const [showExtra, setShowExtra] = useState(isNew);

  return (
    <>
      <div className={`drawer-overlay ${closing ? "closing" : ""}`} onClick={requestClose} />
      <div className={`drawer drawer--focus ${closing ? "closing" : ""}`}>
        <div className="drawer-handle" />
        <div className="drawer-cat-bar" style={{ background: catColor(form.category) }} />
        <div className="drawer-inner">
          <div className="drawer-head drawer-head--focus">
            <span className="drawer-focus-eyebrow">{isPresentation ? "Presentation" : "Product"}</span>
            <button type="button" onClick={requestClose} className="close-btn" aria-label="Close">✕</button>
          </div>

          {isNew && !readOnly && (
            <div className="seg-toggle seg-toggle--2 drawer-type-toggle">
              <button type="button" onClick={() => { set("projectType","product"); set("stage","concept"); }} className={`seg-btn ${!isPresentation ? "active" : ""}`}>Product</button>
              <button type="button" onClick={() => { set("projectType","presentation"); set("stage","brief"); }} className={`seg-btn ${isPresentation ? "active pres" : ""}`}>Presentation</button>
            </div>
          )}

          <input value={form.title} onChange={e => set("title", e.target.value)} readOnly={readOnly}
            placeholder={isPresentation ? "Presentation name" : "Product name"}
            autoFocus={isNew && !readOnly} className="drawer-title drawer-title--focus" />

          <div className="drawer-focus-body">
            <Field label="Stage">
              <Select value={form.stage} onChange={e => setStage(e.target.value)} disabled={readOnly} className="drawer-stage-select">
                {stageOptions.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </Select>
            </Field>

            <div className="drawer-core-grid">
              <Field label="Start">
                <Input type="date" value={form.startDate} onChange={e => set("startDate", e.target.value)} disabled={readOnly} />
              </Field>
              <Field label="Due">
                <Input type="date" value={form.dueDate} onChange={e => set("dueDate", e.target.value)} disabled={readOnly} />
              </Field>
            </div>

            <Field label="Team">
              <AssigneePicker
                assignees={form.assignees}
                onChange={v => set("assignees", v)}
                readOnly={readOnly}
              />
            </Field>

            {!readOnly && (
              <div className="drawer-flag-row">
                {!isPresentation && (
                  <BlockerToggle
                    checked={!!form.waitingOnSales}
                    onChange={v => set("waitingOnSales", v)}
                    disabled={readOnly}
                    tone="sales"
                    title="Awaiting sales"
                    compact
                  />
                )}
                {isPresentation && (
                  <>
                    <BlockerToggle
                      checked={!!form.waitingOnLicenses}
                      onChange={v => set("waitingOnLicenses", v)}
                      disabled={readOnly}
                      tone="licenses"
                      title="Needs licenses"
                      compact
                    />
                    <BlockerToggle
                      checked={!!form.waitingOnSales}
                      onChange={v => set("waitingOnSales", v)}
                      disabled={readOnly}
                      tone="sales"
                      title="Awaiting sales info"
                      compact
                    />
                  </>
                )}
              </div>
            )}

            {!readOnly ? (
              <Field label="Notes">
                <Textarea rows={2} value={form.notes} onChange={e => set("notes", e.target.value)}
                  placeholder="What’s happening on this project?" />
              </Field>
            ) : form.notes?.trim() ? (
              <div className="drawer-posted-notes drawer-posted-notes--inline">
                <div className="field-label">Notes</div>
                <div className="notes-rendered"><LinkedText text={form.notes} /></div>
              </div>
            ) : null}

            {showFollowUps && (
              <BuyerFollowUpSection
                followUps={form.followUps}
                onChange={v => set("followUps", v)}
                canAdd={canLogFollowUps && !isNew}
                canTask={canTaskFollowUps && !isNew}
                onCreateProduct={canTaskFollowUps && onCreateProductFromFollowUp
                  ? (followUpId) => onCreateProductFromFollowUp(form.id, followUpId)
                  : null}
                projects={allProjects}
              />
            )}

            {showSkus && isAwaitingSales && (
              <StyleSkuSection
                value={form.styleNumbers}
                onChange={v => set("styleNumbers", v)}
                canEdit={!readOnly}
                label="Style numbers"
                emptyHint="Add SKU + Centric link"
              />
            )}

            {!isNew && (
              <button type="button" className="drawer-extra-toggle" onClick={() => setShowExtra(v => !v)} aria-expanded={showExtra}>
                {showExtra ? "Hide extra fields" : "Extra fields"}
                <span className="drawer-extra-hint">{catLabel(form.category)} · {form.season}</span>
              </button>
            )}

            {(showExtra || isNew) && (
              <div className="drawer-extra-panel">
                <div className="drawer-core-grid">
                  <Field label="Category">
                    <Select value={form.category} onChange={e => set("category", e.target.value)} disabled={readOnly}>
                      {CATEGORIES.filter(c => c.id !== "all").map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                    </Select>
                  </Field>
                  <Field label="Season">
                    <Select value={form.season} onChange={e => set("season", e.target.value)} disabled={readOnly}>
                      {SEASONS.map(s => <option key={s}>{s}</option>)}
                    </Select>
                  </Field>
                </div>
                <div className="drawer-core-grid">
                  <Field label="Priority">
                    <Select value={form.priority || ""} onChange={e => set("priority", e.target.value)} disabled={readOnly}>
                      {PRIORITIES.map(p => <option key={p.id || "none"} value={p.id}>{p.label}</option>)}
                    </Select>
                  </Field>
                  {isPresentation ? (
                    <Field label="Customer">
                      <Select value={form.customer || ""} onChange={e => set("customer", e.target.value)} disabled={readOnly}>
                        <option value="">— Select —</option>
                        {CUSTOMERS.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </Select>
                    </Field>
                  ) : presentations && presentations.length > 0 ? (
                    <Field label="Source pres.">
                      <Select value={form.sourcePresId || ""} onChange={e => set("sourcePresId", e.target.value)} disabled={readOnly}>
                        <option value="">None</option>
                        {presentations.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
                      </Select>
                    </Field>
                  ) : <div />}
                </div>

                {showSkus && !isAwaitingSales && (
                  <StyleSkuSection
                    value={form.styleNumbers}
                    onChange={v => set("styleNumbers", v)}
                    canEdit={!readOnly}
                  />
                )}

                {!isNew && activityCount > 0 && (
                  <ActivityLog activity={form.activity} hideLabel />
                )}

                {!readOnly && !isNew && onMoveBoard && (
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
            )}
          </div>

          <div className="drawer-footer drawer-footer--sticky">
            {!readOnly ? (
              <div className="drawer-footer-actions">
                <button
                  type="button"
                  onClick={handleManualSave}
                  disabled={!form.title.trim() || saveState === "saving"}
                  className="btn-primary"
                >
                  {saveState === "saving" ? "Saving…" : isNew && saveState !== "saved" ? "Create" : "Save"}
                </button>
                {form.title.trim() && (
                  <div className={`drawer-save-status drawer-save-status--${saveState}`} aria-live="polite">
                    {saveState === "saving" ? "Saving…"
                      : saveState === "pending" ? "Unsaved changes — autosaving…"
                      : saveState === "error" ? "Save failed — tap Save to retry"
                      : "Saved"}
                  </div>
                )}
                {!isNew && (
                  <div className="drawer-footer-delete-row">
                    {confirmDelete ? (
                      <div className="drawer-delete-confirm drawer-delete-confirm--compact">
                        <button type="button" onClick={() => onDelete(form.id)} className="btn-danger btn-danger--sm">Delete</button>
                        <button type="button" onClick={() => setConfirmDelete(false)} className="btn-cancel btn-cancel--sm">Cancel</button>
                      </div>
                    ) : (
                      <button type="button" onClick={() => setConfirmDelete(true)} className="btn-ghost-danger btn-ghost-danger--sm">Delete</button>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <button type="button" onClick={requestClose} className="btn-primary" style={{ width: "100%" }}>Close</button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

const Field    = ({ label, full, span, children }) => (
  <div className={`field ${full ? "field-full" : ""} ${span === 2 ? "field-span-2" : ""}`}>
    <div className="field-label">{label}</div>
    {children}
  </div>
);
const Input    = (p) => <input    {...p} className={`ui-input ${p.className || ""}`.trim()} />;
const Textarea = (p) => <textarea {...p} className={`ui-input ui-textarea ${p.className || ""}`.trim()} />;
const Select   = (p) => <select   {...p} className={`ui-input ui-select ${p.className || ""}`.trim()} />;

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
        <div className="ss-topbar-actions">
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

// ─── SALES REQUESTS (matches Licensing UX) ───────────────────────────────────
function SalesRequestDrawer({
  req,
  isNew,
  onSave,
  onClose,
  onDelete,
  onReview,
  readOnly = false,
  canCreate = false,
  canResolve = false,
  projects = [],
  workload = null,
}) {
  const [form, setForm] = useState(() => ({
    id: "",
    createdAt: "",
    updatedAt: "",
    createdBy: "",
    status: "pending",
    title: "",
    message: "",
    category: "apparel",
    season: "SS26",
    projectId: "",
    reviewNote: "",
    activity: [],
    ...(req || {}),
  }));
  const s = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [closing, setClosing] = useState(false);
  const [approveBoard, setApproveBoard] = useState(() => {
    const linked = req?.projectId ? projects.find(p => p.id === req.projectId) : null;
    if (linked) return linked.projectType === "presentation" ? "presentation" : "product";
    if (req?.createdBoardType) return req.createdBoardType;
    return "product";
  });
  const st = salesReqStatusOf(form.status);
  const linkedProject = form.projectId ? projects.find(p => p.id === form.projectId) : null;
  const createdProject = form.createdProjectId ? projects.find(p => p.id === form.createdProjectId) : null;
  const activity = form.activity || req?.activity || [];
  const isPending = (form.status || "pending") === "pending";
  const isApproved = (form.status || "pending") === "approved";
  const canEditRequest = !readOnly && canCreate && (isNew || isPending);
  const canEditReview = !readOnly && canResolve;

  const handleApprove = () => {
    onReview(form.id, "approved", form.reviewNote, approveBoard);
  };

  const requestClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
    setTimeout(() => onClose?.(), 180);
  }, [closing, onClose]);

  useEffect(() => {
    const onKeyDown = (e) => { if (e.key === "Escape") requestClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [requestClose]);

  return (
    <>
      <div className={`drawer-overlay ${closing ? "closing" : ""}`} onClick={requestClose} />
      <div className={`drawer ${closing ? "closing" : ""}`}>
        <div className="drawer-handle" />
        <div className="drawer-cat-bar" style={{ background: st.dot }} />
        <div className="drawer-inner">
          <div className="drawer-head">
            <span className="eyebrow">
              {readOnly ? "View" : isNew ? "New" : "Edit"} Sales Request
            </span>
            <button type="button" onClick={requestClose} className="close-btn">✕</button>
          </div>

          {isNew && canCreate && workload && workload.level !== "calm" && (
            <div className={`sales-drawer-workload sales-drawer-workload--${workload.level}`}>
              <strong>{workload.verdict?.title || workload.headline}</strong>
              <span>{workload.guidance || workload.body}</span>
              {workload.bullets?.length > 0 && (
                <ul className="sales-drawer-bullets">
                  {workload.bullets.slice(0, 2).map((b, i) => <li key={i}>{b}</li>)}
                </ul>
              )}
            </div>
          )}

          <input
            value={form.title || ""}
            readOnly={!canEditRequest}
            disabled={!canEditRequest}
            onChange={e => s("title", e.target.value)}
            placeholder="What should the art team work on?"
            autoFocus={isNew && canEditRequest}
            className="drawer-title"
          />

          <div className="field-grid lic-drawer-sections">
            <div className="lic-section-head">Sales</div>

            <Field label="Category">
              <Select value={form.category || "apparel"} disabled={!canEditRequest}
                onChange={e => s("category", e.target.value)}>
                {CATEGORIES.filter(c => c.id !== "all").map(c => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </Select>
            </Field>

            <Field label="Season">
              <Select value={form.season || "SS26"} disabled={!canEditRequest}
                onChange={e => s("season", e.target.value)}>
                {SEASONS.map(ss => <option key={ss} value={ss}>{ss}</option>)}
              </Select>
            </Field>

            <Field label="Linked project (optional)" span={2}>
              <Select value={form.projectId || ""} disabled={!canEditRequest}
                onChange={e => s("projectId", e.target.value)}>
                <option value="">None</option>
                {projects.filter(p => p.stage !== "archived").map(p => (
                  <option key={p.id} value={p.id}>{p.title}</option>
                ))}
              </Select>
              {linkedProject && <div className="field-hint">Linked to: {linkedProject.title}</div>}
            </Field>

            <Field label="Request details" full>
              <Textarea rows={4} value={form.message || ""} disabled={!canEditRequest}
                onChange={e => s("message", e.target.value)}
                placeholder="Timeline, customer, SKUs, references…" />
              {!canEditRequest && <div className="field-hint">From Sales — read only</div>}
            </Field>

            {(!isNew || canResolve || (form.reviewNote || "").trim()) && (
              <>
                <div className="lic-section-head art">Art team</div>

                <Field label="Review note" full>
                  <Textarea rows={3} value={form.reviewNote || ""} disabled={readOnly || !canEditReview}
                    onChange={e => s("reviewNote", e.target.value)}
                    placeholder="Optional note when approving or rejecting" />
                  {!canEditReview && <div className="field-hint">Art team adds this when reviewing</div>}
                </Field>

                {canResolve && (isPending || isApproved) && (
                  <Field label="Add to art board" full>
                    <p className="field-hint" style={{ marginTop: 0, marginBottom: 10 }}>
                      {isPending
                        ? "Approve creates a card on the board you choose."
                        : "Change which board this request lives on."}
                    </p>
                    <div className="seg-toggle seg-toggle--2 sales-board-pick">
                      <button
                        type="button"
                        className={`seg-btn ${approveBoard === "product" ? "active" : ""}`}
                        onClick={() => setApproveBoard("product")}
                      >
                        Products
                      </button>
                      <button
                        type="button"
                        className={`seg-btn ${approveBoard === "presentation" ? "active pres" : ""}`}
                        onClick={() => setApproveBoard("presentation")}
                      >
                        Presentations
                      </button>
                    </div>
                    {createdProject && (
                      <div className="sales-board-linked">
                        On board: <strong>{createdProject.title}</strong>
                        {form.createdBoardType && (
                          <span> · {boardTypeLabel(form.createdBoardType)}</span>
                        )}
                      </div>
                    )}
                  </Field>
                )}

                <Field label="Status" full>
                  <div className="lic-status-row">
                    <span className={`lic-status-pill sales-${form.status || "pending"}`}>
                      {st.label}
                    </span>
                    <span className="mono">
                      {form.createdBy ? `${form.createdBy} · ` : ""}
                      {form.createdAt ? formatActivityTime(form.createdAt) : ""}
                      {form.reviewedBy && form.status !== "pending"
                        ? ` · ${form.reviewedBy}`
                        : ""}
                    </span>
                  </div>
                  {!readOnly && canResolve && isPending && (
                    <div className="drawer-action-pair">
                      <button type="button" className="btn-primary btn-approve"
                        onClick={handleApprove}>
                        Approve & add to board
                      </button>
                      <button type="button" className="btn-danger"
                        onClick={() => onReview(form.id, "rejected", form.reviewNote)}>
                        Reject
                      </button>
                    </div>
                  )}
                  {!readOnly && canResolve && isApproved && (
                    <div className="drawer-action-pair drawer-action-pair--single">
                      <button type="button" className="btn-primary btn-approve"
                        onClick={handleApprove}>
                        {createdProject ? "Update board placement" : "Add to board"}
                      </button>
                    </div>
                  )}
                </Field>
              </>
            )}
          </div>

          {!isNew && <ActivityLog activity={activity} />}

          {!readOnly ? (
            <div className="drawer-actions">
              {canEditRequest && (
                <button
                  type="button"
                  onClick={() => onSave({
                    ...form,
                    id: form.id || `sr${Date.now()}`,
                    status: isPending ? "pending" : form.status,
                  })}
                  disabled={!String(form.title || "").trim()}
                  className="btn-primary"
                >
                  {isNew ? "Submit request" : "Save changes"}
                </button>
              )}
              {!isNew && canCreate && (
                confirmDelete
                  ? <div style={{ display: "flex", gap: 8, flex: 1 }}>
                      <button type="button" onClick={() => onDelete(form.id)} className="btn-danger" style={{ flex: 1 }}>Yes, delete</button>
                      <button type="button" onClick={() => setConfirmDelete(false)} className="btn-cancel">Cancel</button>
                    </div>
                  : <button type="button" onClick={() => setConfirmDelete(true)} className="btn-danger">Delete</button>
              )}
            </div>
          ) : (
            <div className="drawer-actions">
              <button type="button" onClick={requestClose} className="btn-primary" style={{ width: "100%" }}>Close</button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function SalesWorkloadGate({ workload, onContinue, onCancel }) {
  const color = workload.color || "#FBBF24";
  return (
    <>
      <div className="drawer-overlay" onClick={onCancel} />
      <div className="sales-gate-modal" role="dialog" aria-labelledby="sales-gate-title">
        <h3 id="sales-gate-title" className="sales-gate-title">Before you submit</h3>
        <span
          className="sales-gate-pill"
          style={{ color, borderColor: `${color}44`, background: `${color}14` }}
        >
          {workload.verdict?.pill || "Team load"}
        </span>
        <p className="sales-gate-verdict">{workload.verdict?.title || workload.headline}</p>
        <p className="sales-gate-body">{workload.guidance || workload.body}</p>
        {workload.bullets?.length > 0 && (
          <ul className="sales-gate-bullets">
            {workload.bullets.map((b, i) => <li key={i}>{b}</li>)}
          </ul>
        )}
        <p className="sales-gate-ask">Is this urgent and fully scoped — or can it wait / go on an existing project?</p>
        <div className="sales-gate-actions">
          <button type="button" className="btn-cancel" onClick={onCancel}>Not now</button>
          <button type="button" className="btn-primary" onClick={onContinue}>Continue to request</button>
        </div>
      </div>
    </>
  );
}

function SalesRequestsPage({
  requests,
  projects,
  onSave,
  onDelete,
  onReview,
  onOpenProject,
  canCreate = false,
  canEdit = false,
  canResolve = false,
  hideTopbar = false,
  search: searchProp = "",
  onSearchChange,
  newRequestTick = 0,
  workload = null,
  overview = null,
}) {
  const [searchLocal, setSearchLocal] = useState("");
  const search = hideTopbar ? searchProp : searchLocal;
  const setSearch = hideTopbar ? (onSearchChange || (() => {})) : setSearchLocal;
  const [drawer, setDrawer] = useState(null);
  const [gateOpen, setGateOpen] = useState(false);

  const norm = (v) => (v || "").toString().toLowerCase();
  const q = norm(search).trim();
  const projTitle = (id) => projects.find(p => p.id === id)?.title || "";

  const pendingCount = (requests || []).filter(r => (r.status || "pending") === "pending").length;
  const reviewedCount = (requests || []).filter(r => (r.status || "pending") !== "pending").length;
  const approvedCount = (requests || []).filter(r => r.status === "approved").length;
  const rejectedCount = (requests || []).filter(r => r.status === "rejected").length;

  const matchesSearch = (r) => {
    if (!q) return true;
    return (
      norm(r.title).includes(q) ||
      norm(r.message).includes(q) ||
      norm(r.category).includes(q) ||
      norm(r.season).includes(q) ||
      norm(r.createdBy).includes(q) ||
      norm(projTitle(r.projectId)).includes(q)
    );
  };

  const sortReqs = (list) => list.slice().sort((a, b) =>
    String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")),
  );

  const byColumn = SALES_REQ_COLUMNS.map(col => ({
    ...col,
    items: sortReqs((requests || []).filter(r => (r.status || "pending") === col.id && matchesSearch(r))),
  }));

  const anyVisible = byColumn.some(c => c.items.length > 0);

  const tryNewRequest = () => {
    if (canCreate && workload?.gateNewRequest) {
      setGateOpen(true);
      return;
    }
    setDrawer({ isNew: true });
  };

  useEffect(() => {
    if (!newRequestTick || !canCreate) return;
    if (workload?.gateNewRequest) setGateOpen(true);
    else setDrawer({ isNew: true });
  }, [newRequestTick, canCreate, workload?.gateNewRequest]);

  const body = (
    <>
      {!hideTopbar && (
        <div className="ss-topbar">
          <div>
            <h1 className="page-title">Sales Requests</h1>
            <p className="page-sub">{pendingCount} pending · {reviewedCount} reviewed</p>
          </div>
          <div className="ss-topbar-actions">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search requests, project…"
              className="ss-search"
            />
            {canCreate && (
              <button type="button" onClick={tryNewRequest} className="btn-new">+ New Request</button>
            )}
          </div>
        </div>
      )}

      {!hideTopbar && (
        <div className="stats-bar">
          <div className="stat" style={{ borderColor: "rgba(251,191,36,0.25)" }}>
            <div><div className="stat-val" style={{ color: C.amber }}>{pendingCount}</div><div className="stat-label">Pending</div></div>
          </div>
          <div className="stat" style={{ borderColor: "rgba(52,211,153,0.25)" }}>
            <div><div className="stat-val" style={{ color: C.green }}>{approvedCount}</div><div className="stat-label">Approved</div></div>
          </div>
          <div className="stat" style={{ borderColor: "rgba(248,113,113,0.25)" }}>
            <div><div className="stat-val" style={{ color: C.red }}>{rejectedCount}</div><div className="stat-label">Rejected</div></div>
          </div>
        </div>
      )}

      {!anyVisible ? (
        <div className="sales-req-board-panel">
          <div className="ss-zero" style={{ paddingTop: 48 }}>
            <div className="ss-zero-icon">◈</div>
            <div className="ss-zero-title">No requests found</div>
            <div className="ss-zero-sub">
              {search.trim()
                ? "Try a different search."
                : canCreate
                  ? "New requests start in Pending review for art to approve."
                  : "Sales submissions appear in Pending review."}
            </div>
            {canCreate && (
              <button type="button" onClick={tryNewRequest} className="btn-new" style={{ marginTop: 16 }}>+ New Request</button>
            )}
          </div>
        </div>
      ) : (
        <div className="sales-req-board-panel">
          <div className="sales-req-board board scroll-surface">
            {byColumn.map(col => (
              <div key={col.id} className="col sales-req-col" data-status={col.id}>
                <div className="col-head sales-req-col-head">
                  <span className="col-dot" style={{ background: col.dot }} />
                  <div className="sales-req-col-titles">
                    <span className="col-title">{col.label}</span>
                    <span className="sales-req-col-hint">{col.hint}</span>
                  </div>
                  <span className="col-count">{col.items.length}</span>
                </div>
                <div className="col-body">
                  <div className="col-cards col-cards--scroll scroll-surface sales-req-cards">
                    {col.items.length === 0 ? (
                      <div className="col-empty">{col.id === "pending" ? "No pending" : "None"}</div>
                    ) : col.items.map(r => {
                      const linked = r.projectId ? projects.find(p => p.id === r.projectId) : null;
                      const onBoard = r.createdProjectId ? projects.find(p => p.id === r.createdProjectId) : null;
                      const cc = catColor(r.category);
                      return (
                        <div
                          key={r.id}
                          className="sr-card"
                          onClick={() => setDrawer({ isNew: false, req: r })}
                        >
                          <div className="sr-card-title">{r.title || "Untitled"}</div>
                          <div className="sr-card-meta">
                            {r.createdBy || "Team member"} · {formatActivityTime(r.updatedAt || r.createdAt)}
                          </div>
                          <div className="sr-card-tags">
                            <span className="cat-chip sm" style={{ background: `${cc}22`, color: cc, border: `1px solid ${cc}44` }}>
                              {catLabel(r.category)}
                            </span>
                            {r.season && <span className="sr-card-season">{r.season}</span>}
                          </div>
                          {onBoard && (
                            <button
                              type="button"
                              className="sr-card-board-link"
                              onClick={(e) => { e.stopPropagation(); onOpenProject?.(onBoard.id); }}
                            >
                              ◈ {onBoard.title} · {boardTypeLabel(r.createdBoardType || (onBoard.projectType === "presentation" ? "presentation" : "product"))}
                            </button>
                          )}
                          {linked && !onBoard && (
                            <div className="sr-card-linked">Related: {linked.title}</div>
                          )}
                          {r.message?.trim() && (
                            <p className="sr-card-snippet">{r.message.trim().slice(0, 100)}{r.message.length > 100 ? "…" : ""}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {col.id === "pending" && canCreate && (
                    <div className="col-add">
                      <button type="button" className="sales-req-add-btn" onClick={tryNewRequest}>+ Add request</button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {gateOpen && workload && (
        <SalesWorkloadGate
          workload={workload}
          onCancel={() => setGateOpen(false)}
          onContinue={() => { setGateOpen(false); setDrawer({ isNew: true }); }}
        />
      )}

      {drawer && (
        <SalesRequestDrawer
          req={drawer.req}
          isNew={drawer.isNew}
          workload={drawer.isNew ? workload : null}
          onSave={(data) => { onSave(data); setDrawer(null); }}
          onDelete={(id) => { onDelete(id); setDrawer(null); }}
          onReview={(id, status, note, boardType) => { onReview(id, status, note, boardType); setDrawer(null); }}
          onOpenProject={onOpenProject}
          onClose={() => setDrawer(null)}
          readOnly={!canEdit && !canResolve}
          canCreate={canCreate}
          canResolve={canResolve}
          projects={projects}
        />
      )}
    </>
  );

  return hideTopbar ? body : <div className="lic-page">{body}</div>;
}

function SalesPageHost({
  projects,
  requests,
  pendingCount,
  onSave,
  onDelete,
  onReview,
  onOpenProject,
  canCreate,
  canEdit,
  canResolve,
  isSalesSubmit,
  onLogFollowUpClick,
  openFollowUps = [],
}) {
  const [requestSearch, setRequestSearch] = useState("");
  const [newRequestTick, setNewRequestTick] = useState(0);
  const workload = useMemo(
    () => computeWorkload(computeOverview(projects), pendingCount),
    [projects, pendingCount],
  );

  return (
    <SalesPage
      projects={projects}
      pendingCount={pendingCount}
      requestSearch={requestSearch}
      onRequestSearchChange={setRequestSearch}
      onNewRequestClick={() => setNewRequestTick(t => t + 1)}
      onLogFollowUpClick={onLogFollowUpClick}
      openFollowUps={openFollowUps}
      canCreateRequest={canCreate}
      workloadLevel={workload.level}
      isSalesSubmit={isSalesSubmit}
      renderRequests={({ overview, workload: wl }) => (
        <SalesRequestsPage
          hideTopbar
          search={requestSearch}
          onSearchChange={setRequestSearch}
          newRequestTick={newRequestTick}
          overview={overview}
          workload={wl}
          requests={requests}
          projects={projects}
          onSave={onSave}
          onDelete={onDelete}
          onReview={onReview}
          onOpenProject={onOpenProject}
          canCreate={canCreate}
          canEdit={canEdit}
          canResolve={canResolve}
        />
      )}
    />
  );
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
export default function StudioTracker() {
  const {
    canEdit, isMaster, isViewer, isLicensingTeam, hasLicensingAccess, boardName, user, isLoaded,
    canSubmitSalesRequests, canReviewSalesRequests, canViewSalesRequests,
  } = useAppRole();
  const boardProfile = resolveTeamProfile(boardName) || boardName;
  const { nickname } = useNickname(user?.id);
  const viewerAssigneeName = resolveViewerTeamName(boardName, nickname);
  const actor = activityActor(boardProfile, user);
  const canEditProjects = isMaster || (canEdit && !isLicensingTeam);
  const canEditSelectSets = isMaster || (canEdit && !isLicensingTeam);
  const canEditLicensing = canEdit;
  const canCreateLicensing = isMaster || (canEdit && hasLicensingAccess);
  const canResolveLicensing = isMaster || (canEdit && !isLicensingTeam);
  const [projects,       setProjects]       = useState([]);
  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  const savingRef = useRef(0);
  const lastLocalSaveAtRef = useRef(0);
  const saveFailProtectUntilRef = useRef(0);
  const saveChainRef = useRef(Promise.resolve());
  const saveProjectsRef = useRef(null);
  const [sets,           setSets]           = useState([]);
  const [licRequests,    setLicRequests]    = useState([]);
  const [salesRequests,  setSalesRequests]  = useState([]);
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
      if (v === "analytics") return "sales";
      if (v === "projects" || v === "selectsets" || v === "licensing" || v === "sales") return v;
    } catch {
      /* ignore */
    }
    return "projects";
  }); // "projects" | "selectsets" | "licensing" | "sales"
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [assigneeFilter, setAssigneeFilter] = useState(null);
  const [boardTagFilter, setBoardTagFilter] = useState(null); // null | "priority" | "awaiting_sales" | "licenses" | "sales_info"
  const [search,         setSearch]         = useState("");
  const [view,           setView]           = useState("board");
  const [boardMode,      setBoardMode]      = useState("products"); // "products" | "presentations"
  const [drawer,         setDrawer]         = useState(null);
  const [followUpModalOpen, setFollowUpModalOpen] = useState(false);
  const [projectHighlightSeen, setProjectHighlightSeen] = useState(() => loadProjectHighlightSeen(user?.id));
  const [toast,          setToast]          = useState(null); // { message, onUndo? }
  const toastTimerRef = useRef(null);
  const undoRef = useRef(null);

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

  const showUndoToast = useCallback((message, onUndo, ms = 8000) => {
    clearToastTimer();
    setToast({ message, onUndo });
    toastTimerRef.current = setTimeout(() => setToast(null), ms);
  }, []);

  const pushUndo = useCallback((snapshot, message) => {
    const undo = async () => {
      undoRef.current = null;
      setProjects(snapshot);
      try {
        await save(snapshot);
        flash("Undone");
      } catch (e) {
        console.error(e);
        flash("Could not undo — try again");
      }
    };
    undoRef.current = undo;
    if (message) showUndoToast(message, undo, 8000);
  }, [showUndoToast, flash]);

  const runUndo = useCallback(() => {
    if (!undoRef.current) return;
    clearToastTimer();
    setToast(null);
    undoRef.current();
  }, []);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== "z" || e.shiftKey) return;
      const el = e.target;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      if (!undoRef.current) return;
      e.preventDefault();
      runUndo();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [runUndo]);

  useEffect(() => () => {
    clearToastTimer();
  }, []);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        if (window.storage.migrate) await window.storage.migrate();
        const [p, s, l, sr] = await Promise.all([load(), loadSS(), loadLic(), loadSalesReq()]);
        if (!active) return;
        setProjects(p);
        setSets(s);
        setLicRequests(Array.isArray(l) ? l : []);
        setSalesRequests(Array.isArray(sr) ? sr : []);
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
        if (setter === setProjects) {
          if (savingRef.current > 0) return;
          if (Date.now() < saveFailProtectUntilRef.current) return;
        }
        let data = JSON.parse(raw);
        if (normalize && Array.isArray(data)) {
          data = data.map(normalizeProjectForSave);
          setProjects(prev => {
            const { merged } = mergeProjectsBoard(prev, data);
            const next = mergeProjectHighlights(merged, prev);
            projectsRef.current = next;
            // Only re-push if this client created cards the cloud doesn't have yet
            const remoteIds = new Set(data.map(p => p?.id).filter(Boolean));
            const hasLocalCreates = prev.some(p => p?.id && !remoteIds.has(p.id));
            if (hasLocalCreates && Date.now() - lastLocalSaveAtRef.current < 60000) {
              queueMicrotask(() => saveProjectsRef.current?.(next));
            }
            return next;
          });
          return;
        }
        setter(() => data);
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

    const unsubSalesReq =
      window.storage.subscribe?.("sales_req_v1", (value) => applyRemote(setSalesRequests, value)) ??
      (() => {});

    const reloadFromCloud = () => {
      if (savingRef.current > 0) return;
      if (Date.now() < saveFailProtectUntilRef.current) return;
      Promise.all([load(), loadSS(), loadLic(), loadSalesReq()]).then(([p, s, l, sr]) => {
        if (!active) return;
        if (savingRef.current > 0) return;
        setProjects(prev => {
          const remote = Array.isArray(p) ? p : [];
          const { merged } = mergeProjectsBoard(prev, remote);
          const next = mergeProjectHighlights(merged, prev);
          projectsRef.current = next;
          const remoteIds = new Set(remote.map(x => x?.id).filter(Boolean));
          const hasLocalCreates = prev.some(x => x?.id && !remoteIds.has(x.id));
          if (hasLocalCreates) queueMicrotask(() => saveProjectsRef.current?.(next));
          return next;
        });
        setSets(s);
        setLicRequests(Array.isArray(l) ? l : []);
        setSalesRequests(Array.isArray(sr) ? sr : []);
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
      unsubSalesReq();
      window.removeEventListener("focus", reloadFromCloud);
    };
  }, []);

  const saveProjects = useCallback((next, opts) => {
    const message = typeof opts === "string" ? opts : opts?.message;
    const undoSnapshot = typeof opts === "object" && opts?.undoSnapshot != null ? opts.undoSnapshot : null;
    projectsRef.current = next;
    setProjects(next);

    const run = async () => {
      savingRef.current += 1;
      let attempt = 0;
      try {
        while (true) {
          // Always persist the latest board — not a stale snapshot from when this save was queued
          const payload = projectsRef.current;
          try {
            await save(payload);
            lastLocalSaveAtRef.current = Date.now();
            saveFailProtectUntilRef.current = 0;
            if (undoSnapshot) pushUndo(undoSnapshot, message);
            else if (message) flash(message);
            return;
          } catch (e) {
            attempt += 1;
            console.error(e);
            if (attempt >= 3) {
              saveFailProtectUntilRef.current = Date.now() + 30000;
              flash("Could not save to team board — retrying kept your changes on screen. Check connection.");
              throw e;
            }
            await new Promise(r => setTimeout(r, 400 * attempt));
          }
        }
      } finally {
        savingRef.current = Math.max(0, savingRef.current - 1);
      }
    };

    const queued = saveChainRef.current.then(run, run);
    saveChainRef.current = queued.catch(() => {});
    return queued;
  }, [pushUndo, flash]);
  saveProjectsRef.current = saveProjects;

  const handleAssign = useCallback((id, name) => {
    if (!canEditProjects) return;
    const list = projectsRef.current;
    const proj = list.find(p => p.id === id);
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
    const next = list.map(p => p.id === id ? updated : p);
    saveProjects(next, { message: `Added ${name} to "${proj.title}"`, undoSnapshot: list });
  }, [saveProjects, actor, canEditProjects]);

  const handleReorder = useCallback((id, newStage, beforeId) => {
    if (!canEditProjects) return;
    const list = projectsRef.current;
    const proj = list.find(p => p.id === id);
    if (!proj) return;
    const prevStage = proj.stage;
    let next = list.filter(p => p.id !== id);
    const updated = withActivity(proj, { ...proj, stage: newStage }, actor);
    if (beforeId) { const i = next.findIndex(p => p.id === beforeId); next.splice(i >= 0 ? i : next.length, 0, updated); }
    else { const idxs = next.map((p, i) => p.stage === newStage ? i : -1).filter(i => i >= 0); next.splice(idxs.length ? idxs[idxs.length - 1] + 1 : next.length, 0, updated); }
    const stagesToRenumber = new Set([newStage]);
    if (prevStage !== newStage) stagesToRenumber.add(prevStage);
    next = applyBoardOrderForStages(next, stagesToRenumber);
    const msg = proj.stage !== newStage ? `Moved to ${stageOf(newStage).label}` : "Reordered";
    saveProjects(next, { message: msg, undoSnapshot: list });
  }, [saveProjects, actor, canEditProjects]);

  const handleQuickAdd = useCallback((stageId, title) => {
    if (!canEditProjects) return;
    const list = projectsRef.current;
    const assignees = assigneeFilter ? [assigneeFilter] : [];
    const now = new Date().toISOString();
    const inStage = list.filter(p => p.stage === stageId);
    const maxOrder = inStage.reduce((m, p) => Math.max(m, typeof p.boardOrder === "number" ? p.boardOrder : -1), -1);
    const p = {
      id: `p${Date.now()}`, title, stage: stageId,
      projectType: boardMode === "presentations" ? "presentation" : "product",
      category: categoryFilter !== "all" ? categoryFilter : "apparel",
      assignees, season: "SS26", dueDate: "", notes: "", styleNumbers: [], activity: [],
      boardOrder: maxOrder + 1,
      highlightAt: now,
      ...(assignees.length ? { assignHighlightAt: now, assignHighlightFor: assignees } : {}),
    };
    const created = withActivity(null, p, actor);
    saveProjects([...list, created], { message: `Added "${title}"`, undoSnapshot: list });
  }, [saveProjects, categoryFilter, assigneeFilter, boardMode, canEditProjects, actor]);

  const handleSave = (data, opts = {}) => {
    if (!canEditProjects) {
      return Promise.reject(new Error("You don’t have edit access on the team board"));
    }
    const { close = true, silent = false, base = null } = opts;
    const list = projectsRef.current;
    const exists = list.some(p => p.id === data.id);
    const prev = exists ? list.find(p => p.id === data.id) : null;
    // Overlay only drawer-dirty fields onto the latest board card (not a stale full form)
    const mergedForm = exists && prev
      ? mergeDrawerOntoCurrent(prev, data, base || prev)
      : data;
    const prevAs = prev ? projectAssignees(prev) : [];
    const nextAs = projectAssignees(mergedForm);
    const addedAssignees = nextAs.filter(n => !prevAs.includes(n));
    const now = new Date().toISOString();
    const highlightPatch = !exists
      ? {
          highlightAt: now,
          ...(nextAs.length ? { assignHighlightAt: now, assignHighlightFor: nextAs } : {}),
        }
      : addedAssignees.length
        ? { assignHighlightAt: now, assignHighlightFor: addedAssignees }
        : {};
    const payload = normalizeProjectForSave({
      ...mergedForm,
      ...highlightPatch,
      styleNumbers: normalizeStyleEntries(mergedForm.styleNumbers),
    });
    const updated = withActivity(prev, payload, actor);
    // No drawer edits vs base — skip cloud write (stops autosave undo ping-pong)
    if (exists && !isDrawerDirty(data, base || prev) && !addedAssignees.length) {
      return Promise.resolve(prev);
    }
    const next = exists ? list.map(p => p.id === data.id ? updated : p) : [...list, updated];
    const savePromise = (silent
      ? saveProjects(next)
      : saveProjects(next, { undoSnapshot: list })
    ).then(() => updated);
    if (close) {
      setDrawer(null);
    } else if (!exists) {
      setDrawer({ project: updated, isNew: false });
    }
    return savePromise;
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
    saveProjects(next, {
      message: targetType === "presentation" ? "Moved to Presentations" : "Moved to Products",
      undoSnapshot: projects,
    });
    setDrawer(null);
  };
  const handleDelete = (id) => {
    if (!canEditProjects) return;
    const removed = projects.find(p => p.id === id);
    if (!removed) return;
    const next = projects.filter(p => p.id !== id);
    setDrawer(null);
    saveProjects(next, { message: `Deleted “${removed.title}”`, undoSnapshot: projects });
  };

  const handleLogBuyerFollowUp = useCallback(({ presentationId, title, summary }) => {
    if (!canSubmitSalesRequests) return;
    const pres = projects.find(p => p.id === presentationId && isPresentationProject(p));
    if (!pres) return;
    const followUp = {
      id: `fu${Date.now()}`,
      title,
      summary,
      createdAt: new Date().toISOString(),
      createdBy: actor,
      status: "open",
      productId: "",
    };
    const followUps = [...normalizeFollowUps(pres.followUps), followUp];
    const now = new Date().toISOString();
    const nextStage = pres.stage === "archived" ? pres.stage : "picks_in";
    const base = withActivity(pres, {
      ...pres,
      followUps,
      stage: nextStage,
      highlightAt: now,
    }, actor);
    const updated = {
      ...base,
      activity: [
        newActivityEntry(actor, `Buyer follow-up logged: ${title}`),
        ...(base.activity || []),
      ].slice(0, MAX_ACTIVITY),
    };
    const next = projects.map(p => p.id === pres.id ? updated : p);
    saveProjects(next, {
      message: `Logged buyer follow-up on “${pres.title}”`,
      undoSnapshot: projects,
    });
    setFollowUpModalOpen(false);
  }, [projects, saveProjects, actor, canSubmitSalesRequests]);

  const handleCreateProductFromFollowUp = useCallback((presId, followUpId) => {
    if (!canEditProjects) return;
    const pres = projects.find(p => p.id === presId && isPresentationProject(p));
    if (!pres) return;
    const followUps = normalizeFollowUps(pres.followUps);
    const fu = followUps.find(f => f.id === followUpId);
    if (!fu || fu.status !== "open") return;

    const product = buildProductFromFollowUp(pres, fu, projects, actor, boardProfile);
    const updatedFollowUps = followUps.map(f =>
      f.id === followUpId ? { ...f, status: "tasked", productId: product.id } : f,
    );
    const updatedPres = withActivity(pres, { ...pres, followUps: updatedFollowUps }, actor);
    const next = projects.map(p => p.id === pres.id ? updatedPres : p);
    next.push(product);
    saveProjects(next, {
      message: `Created product “${product.title}” from buyer follow-up`,
      undoSnapshot: projects,
    });
    setDrawer(null);
    setBoardMode("products");
    setPage("projects");
    setDrawer({ project: product, isNew: false });
  }, [projects, saveProjects, actor, canEditProjects, boardProfile]);

  const presentationProjects = projects.filter(p => p.projectType === "presentation");
  const openFollowUps = useMemo(() => collectOpenFollowUps(projects), [projects]);
  const openFollowUpTotal = openFollowUps.length;
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
    const asnOk  = projectMatchesAssigneeFilter(p, assigneeFilter);
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
    const asnOk  = projectMatchesAssigneeFilter(p, assigneeFilter);
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
  const salesPendingCount = (salesRequests || []).filter(r => (r.status || "pending") === "pending").length;

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

  const handleSalesReqSave = (data) => {
    const isNew = !salesRequests.some(r => r.id === data.id);
    if (isNew && !canSubmitSalesRequests) return;
    if (!isNew && !canSubmitSalesRequests && !canReviewSalesRequests && !canEditProjects) return;
    const now = new Date().toISOString();
    setSalesRequests(prev => {
      const exists = prev.some(r => r.id === data.id);
      const prevRow = exists ? prev.find(r => r.id === data.id) : null;
      const base = {
        ...data,
        status: data.status === "approved" || data.status === "rejected" ? data.status : "pending",
        createdAt: data.createdAt || now,
        updatedAt: now,
        createdBy: data.createdBy || actor,
      };
      const row = withSalesReqActivity(prevRow, base, actor, projects);
      const next = exists ? prev.map(r => r.id === data.id ? row : r) : [row, ...prev];
      saveSalesReq(next);
      return next;
    });
    flash(isNew ? "Sales request submitted" : "Request saved");
  };

  const handleSalesReqReview = (id, status, reviewNote = "", boardType = null) => {
    if (!canReviewSalesRequests && !canEditProjects) return;
    const now = new Date().toISOString();
    const prevRow = salesRequests.find(r => r.id === id);
    if (!prevRow) return;

    let nextProjects = projects;
    let createdProjectId = prevRow.createdProjectId;
    let createdBoardType = prevRow.createdBoardType;

    if (status === "approved" && boardType) {
      const upsert = upsertProjectForSalesRequest(
        { ...prevRow, reviewNote: reviewNote ?? prevRow.reviewNote ?? "" },
        boardType,
        projects,
        actor,
        boardProfile,
      );
      nextProjects = upsert.nextProjects;
      createdProjectId = upsert.projectId;
      createdBoardType = boardType;
      const boardLabel = boardTypeLabel(boardType);
      saveProjects(nextProjects, {
        message: upsert.created
          ? `Added “${upsert.title}” to ${boardLabel}`
          : upsert.moved
            ? `Moved “${upsert.title}” to ${boardLabel}`
            : `Linked to ${boardLabel}`,
        undoSnapshot: projects,
      });
      setProjects(nextProjects);
    }

    const base = {
      ...prevRow,
      status,
      reviewNote: reviewNote ?? prevRow.reviewNote ?? "",
      reviewedAt: now,
      reviewedBy: actor,
      updatedAt: now,
      createdProjectId: status === "approved" ? createdProjectId : prevRow.createdProjectId,
      createdBoardType: status === "approved" ? createdBoardType : prevRow.createdBoardType,
    };
    const row = withSalesReqActivity(prevRow, base, actor, nextProjects);
    const nextReqs = salesRequests.map(r => r.id === id ? row : r);
    setSalesRequests(nextReqs);
    saveSalesReq(nextReqs);

    if (status === "approved") {
      flash(createdProjectId && boardType
        ? `Approved — on ${boardTypeLabel(boardType)} board`
        : "Request approved");
    } else {
      flash("Request rejected");
    }
  };

  const handleOpenProjectFromRequest = useCallback((projectId) => {
    const p = projects.find(x => x.id === projectId);
    if (!p) {
      flash("Project not found on board");
      return;
    }
    setPage("projects");
    setBoardMode(p.projectType === "presentation" ? "presentations" : "products");
    setDrawer({ project: p, isNew: false });
  }, [projects]);

  const handleSalesReqDelete = (id) => {
    if (!canSubmitSalesRequests) return;
    const removed = salesRequests.find(r => r.id === id);
    if (!removed) return;
    const snapshot = salesRequests;
    const next = salesRequests.filter(r => r.id !== id);
    setSalesRequests(next);
    saveSalesReq(next);
    showUndoToast(`Deleted “${removed.title || "request"}”`, () => {
      setSalesRequests(snapshot);
      saveSalesReq(snapshot);
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
        * {
          scrollbar-width: thin;
          scrollbar-color: rgba(148, 148, 176, 0.45) transparent;
        }
        ::-webkit-scrollbar { width: 8px; height: 8px; }
        ::-webkit-scrollbar-track {
          background: transparent;
          border-radius: 100px;
        }
        ::-webkit-scrollbar-thumb {
          background: rgba(148, 148, 176, 0.35);
          border-radius: 100px;
          border: 2px solid transparent;
          background-clip: padding-box;
          min-height: 48px;
        }
        ::-webkit-scrollbar-thumb:hover {
          background: rgba(139, 127, 255, 0.5);
          background-clip: padding-box;
        }
        ::-webkit-scrollbar-thumb:active {
          background: rgba(139, 127, 255, 0.75);
          background-clip: padding-box;
        }
        ::-webkit-scrollbar-corner { background: transparent; }
        .scroll-surface {
          scrollbar-width: thin;
          scrollbar-color: rgba(139, 127, 255, 0.45) rgba(255, 255, 255, 0.04);
        }
        .scroll-surface::-webkit-scrollbar { width: 7px; height: 7px; }
        .scroll-surface::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.04);
          border-radius: 100px;
          margin: 4px 0;
        }
        .scroll-surface::-webkit-scrollbar-thumb {
          background: rgba(148, 148, 176, 0.4);
          border-radius: 100px;
          border: 2px solid transparent;
          background-clip: padding-box;
          min-height: 44px;
          transition: background 0.2s ease;
        }
        .scroll-surface::-webkit-scrollbar-thumb:hover {
          background: rgba(139, 127, 255, 0.55);
          background-clip: padding-box;
        }
        .scroll-surface::-webkit-scrollbar-thumb:active {
          background: #8B7FFF;
          background-clip: padding-box;
        }
        input::placeholder, textarea::placeholder { color: #56566A; }
        .mono { font-family: monospace; font-size: 11px; color: #56566A; }
        .sep { color: #2A2A36; }
        .c-red { color: #F87171 !important; font-weight: 600; }
        .c-amber { color: #FBBF24 !important; font-weight: 500; }

        /* ── AVATARS ── */
        .av { border-radius: 50%; color: #fff; display: inline-flex; align-items: center; justify-content: center; font-weight: 700; flex-shrink: 0; }
        .av-sm { width: 24px; height: 24px; font-size: 10px; }
        .av-md { width: 30px; height: 30px; font-size: 11px; }
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
        .seg-toggle {
          display: grid; width: 100%; gap: 3px; box-sizing: border-box;
          background: #14141A; border: 1px solid #2A2A36; border-radius: 8px; padding: 3px;
        }
        .seg-toggle--2 { grid-template-columns: 1fr 1fr; }
        .seg-btn {
          width: 100%; min-width: 0; padding: 8px 10px;
          font-size: 12px; font-weight: 600; background: transparent; border: none; border-radius: 6px;
          color: #56566A; cursor: pointer; font-family: inherit; transition: all 0.15s;
          text-align: center; white-space: nowrap;
        }
        .seg-btn:hover:not(:disabled) { color: #9494B0; background: #1C1C24; }
        .seg-btn.active { background: #23232D; color: #F0F0F6; }
        .seg-btn.active.pres { background: rgba(139,127,255,0.22); color: #8B7FFF; }
        .drawer-type-toggle { margin-bottom: 14px; }
        .drawer-action-pair {
          display: grid; grid-template-columns: 1fr 1fr; gap: 8px;
          margin-top: 12px; margin-bottom: 4px; width: 100%;
        }
        .drawer-action-pair--single { grid-template-columns: 1fr; }
        .drawer-action-pair .btn-primary,
        .drawer-action-pair .btn-danger {
          flex: none; width: 100%; min-height: 38px; padding: 8px 10px; font-size: 12px;
          white-space: normal; line-height: 1.25;
        }
        .drawer-action-pair .btn-approve { background: #34D399; }
        .drawer-action-pair .btn-approve:hover { opacity: 0.9; }
        .btn-new { padding: 8px 16px; background: #8B7FFF; color: #fff; border: none; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; white-space: nowrap; transition: opacity 0.15s; }
        .btn-new:hover { opacity: 0.88; }
        .btn-new:active { transform: scale(0.97); }
        .btn-new--secondary {
          background: transparent; color: #8B7FFF;
          border: 1px solid rgba(139,127,255,0.45);
        }
        .btn-new--secondary:hover { background: rgba(139,127,255,0.1); opacity: 1; }

        /* ── MAIN ── */
        .main { padding: 24px 28px 60px; }
        .page-title { margin: 0 0 4px; font-size: 28px; font-weight: 700; color: #F0F0F6; }
        .page-sub { margin: 0 0 20px; color: #56566A; font-size: 13px; }

        /* ── STATS ── */
        .stats-bar { display: flex; gap: 10px; margin-bottom: 20px; flex-wrap: wrap; }
        .stat { background: #14141A; border: 1px solid #2A2A36; border-radius: 10px; padding: 12px 16px; display: flex; align-items: center; gap: 10px; min-width: 110px; transition: border-color 0.15s, background 0.15s; }
        .stat-val { font-size: 22px; font-weight: 700; color: #F0F0F6; line-height: 1; }
        .stat-label { font-size: 11px; color: #56566A; margin-top: 2px; font-weight: 500; }

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
        .asn-chip--unassigned { display: flex; align-items: center; justify-content: center; width: 30px; height: 30px; background: #1C1C24; border: 2px dashed #3A3A50; }
        .asn-chip--unassigned.asn-on { border-style: solid; border-color: #8B7FFF; }
        .asn-unassigned-mark { font-size: 14px; font-weight: 700; color: #56566A; line-height: 1; }
        .asn-chip--unassigned.asn-on .asn-unassigned-mark { color: #9494B0; }
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
        .filter-signal-group.has-active-filter {
          border-color: rgba(139,127,255,0.35);
          box-shadow: inset 0 0 0 1px rgba(139,127,255,0.08);
        }
        .board-focus-wrap {
          display: flex; align-items: center; gap: 10px;
          flex: 0 1 auto; max-width: 100%;
        }
        .focus-filter-status {
          flex: 0 0 96px;
          width: 96px;
          display: flex; align-items: center; justify-content: flex-end;
          gap: 6px; font-size: 10px; color: #56566A; white-space: nowrap;
          opacity: 0; pointer-events: none;
          transition: opacity 0.15s;
        }
        .focus-filter-status.is-visible { opacity: 1; pointer-events: auto; }
        .focus-filter-count { font-weight: 600; }
        .focus-filter-clear {
          background: none; border: none; padding: 0;
          font-size: 10px; font-weight: 700; color: #8B7FFF;
          cursor: pointer; font-family: inherit; line-height: 1;
        }
        .focus-filter-clear:hover { color: #F0F0F6; text-decoration: underline; }
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

        /* ── BOARD TOOLS (team + focus) ── */
        .board-tools-row {
          display: flex; align-items: center; justify-content: space-between;
          gap: 12px; flex-wrap: wrap; margin-bottom: 8px;
        }
        .board-tools-row .team-strip { margin-bottom: 0; }
        .board-tools-focus { margin-left: auto; flex: 0 1 auto; max-width: 100%; }
        .board-tools-focus .board-focus-wrap { margin: 0; }
        .board-tools-focus .filter-signal-group { margin: 0; }

        /* ── TEAM STRIP ── */
        .team-strip {
          display: inline-flex; align-items: center; flex-wrap: wrap; gap: 6px 8px;
          width: fit-content; max-width: 100%;
          background: #14141A; border: 1px solid #2A2A36; border-radius: 10px;
          padding: 6px 10px; margin-bottom: 8px;
        }
        .strip-label {
          font-size: 9px; letter-spacing: 0.08em; color: #56566A; text-transform: uppercase;
          font-weight: 700; flex-shrink: 0; padding-right: 2px;
        }
        .strip-hint {
          font-size: 10px; color: #56566A; line-height: 1.2;
          flex: 0 1 auto; max-width: 100%;
        }
        .team-row { display: flex; gap: 5px; flex-wrap: wrap; flex: 0 1 auto; }
        .team-strip .av-sm { width: 18px; height: 18px; font-size: 8px; }
        .team-chip {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 3px 8px 3px 3px; background: #1C1C24; border: 1px solid #2A2A36;
          border-radius: 100px; font-size: 11px; color: #9494B0; cursor: grab;
          transition: all 0.15s; user-select: none; -webkit-user-select: none; touch-action: none;
        }
        .team-chip:hover { border-color: #3A3A50; color: #F0F0F6; }
        .team-chip:active { cursor: grabbing; }
        .chip-on { border-color: var(--tc) !important; background: #1C1C24 !important; box-shadow: 0 0 0 2px color-mix(in srgb, var(--tc) 20%, transparent) !important; transform: scale(1.02); color: #F0F0F6 !important; }
        .chip-lifting { opacity: 0.25; transform: scale(0.95); }
        .chip-name { font-weight: 600; font-size: 11px; }
        .chip-grip { font-size: 9px; color: #3A3A50; line-height: 1; }

        /* ── BOARD ── */
        .board {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          padding-bottom: 20px;
          align-items: stretch;
          scrollbar-gutter: stable;
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
          display: flex; flex-direction: column;
          flex: 1; min-height: 0;
          gap: 8px; overflow: visible;
        }
        .col-cards {
          display: flex; flex-direction: column; gap: 8px;
          flex: 1 1 auto; min-height: 0;
          overflow: visible;
        }
        .col-cards--scroll {
          max-height: min(52vh, calc(100dvh - 380px));
          overflow-y: auto;
          overflow-x: hidden;
          overscroll-behavior: contain;
          -webkit-overflow-scrolling: touch;
          scrollbar-gutter: stable;
          padding-right: 6px;
          margin-right: -2px;
          box-sizing: border-box;
        }
        .col-add {
          flex-shrink: 0;
          padding-top: 6px;
          border-top: 1px solid #1E1E28;
        }
        .col-add:empty { display: none; padding: 0; border: none; }

        /* ── COLUMNS ── */
        .col { background: #14141A; border: 1px solid #1E1E28; border-radius: 12px; padding: 10px 12px 10px 10px; transition: background 0.15s, border-color 0.15s; overflow: visible; }
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
        .card:hover { border-color: #3A3A50; box-shadow: 0 4px 16px rgba(0,0,0,0.4); }
        .card:active { cursor: grabbing; }
        .card.card-dragging { touch-action: none; }
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
        .flag-followup { background: rgba(52,211,153,0.1); color: #34D399; border: 1px solid rgba(52,211,153,0.35); }
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
        .card-actions {
          position: absolute; top: 7px; right: 7px; z-index: 4;
          display: flex; align-items: center; pointer-events: auto;
        }
        .card-delete-btn {
          width: 26px; height: 26px; display: flex; align-items: center; justify-content: center;
          border-radius: 7px; border: 1px solid transparent;
          background: rgba(12, 12, 16, 0.72); color: #56566A;
          cursor: pointer; padding: 0; font-family: inherit;
          opacity: 0.65; transition: opacity 0.15s, color 0.15s, border-color 0.15s, background 0.15s;
        }
        @media (hover: hover) {
          .card-delete-btn { opacity: 0; }
          .card:hover .card-delete-btn, .card-confirm-delete .card-delete-btn { opacity: 1; }
        }
        .card-delete-btn:hover { color: #F87171; border-color: rgba(248,113,113,0.35); background: rgba(248,113,113,0.12); }
        .card-delete-confirm {
          display: flex; align-items: center; gap: 5px;
          padding: 4px 6px; border-radius: 8px;
          background: #14141A; border: 1px solid rgba(248,113,113,0.4);
          box-shadow: 0 4px 16px rgba(0,0,0,0.45);
        }
        .card-delete-prompt { font-size: 10px; font-weight: 700; color: #F87171; white-space: nowrap; }
        .card-delete-yes, .card-delete-no {
          border: none; border-radius: 5px; padding: 3px 7px;
          font-size: 10px; font-weight: 700; cursor: pointer; font-family: inherit;
        }
        .card-delete-yes { background: rgba(248,113,113,0.2); color: #F87171; }
        .card-delete-yes:hover { background: rgba(248,113,113,0.35); }
        .card-delete-no { background: #1C1C24; color: #9494B0; }
        .card-delete-no:hover { color: #F0F0F6; }
        .card-confirm-delete { border-color: rgba(248,113,113,0.45) !important; }
        .card-body { padding: 10px 28px 10px 11px; flex: 1; min-width: 0; }
        .card-view-only .card-body { padding-right: 11px; }
        .card-title { font-size: 13px; font-weight: 600; color: #F0F0F6; line-height: 1.35; margin-bottom: 5px; }
        .card-meta { font-size: 11px; color: #56566A; margin-bottom: 4px; }
        .card-status-flags { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
        .card-meta-flag {
          flex-shrink: 0; font-size: 9px; font-weight: 700; padding: 2px 6px; border-radius: 4px;
          text-transform: uppercase; letter-spacing: 0.03em; line-height: 1.3;
        }
        .card-meta-flag.tone-urgent { color: #F87171; background: rgba(248,113,113,0.12); }
        .card-meta-flag.tone-high { color: #FBBF24; background: rgba(251,191,36,0.12); }
        .card-meta-flag.tone-sales { color: #FBBF24; background: rgba(251,191,36,0.08); }
        .card-meta-flag.tone-licenses { color: #8B7FFF; background: rgba(139,127,255,0.12); }
        .card-meta-flag.tone-followup { color: #34D399; background: rgba(52,211,153,0.1); }
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
        .drawer-posted-notes { margin-top: 4px; margin-bottom: 20px; }
        .drawer-posted-notes--inline { margin-top: 0; margin-bottom: 0; }
        .drawer-posted-notes .field-label { margin-bottom: 8px; }
        .drawer-posted-notes .notes-rendered {
          padding: 12px 14px; border-radius: 10px;
          background: #14141A; border: 1px solid #2A2A36;
          font-size: 13px; line-height: 1.55; color: #9494B0;
        }
        .drawer-actions-after-notes { margin-top: 0; margin-bottom: 8px; padding-top: 0; border-top: none; }
        .drawer-actions-footer { margin-top: 20px; margin-bottom: 0; padding-top: 0; border-top: none; }
        .drawer-delete-confirm { display: flex; gap: 8px; flex: 1; }
        .notes-rendered { font-size: 13px; line-height: 1.55; color: #9494B0; }
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
        .card-footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; }
        .card-assignee { min-width: 0; flex: 1; }
        .card-assignee .assignee-avatars { min-width: 0; max-width: 100%; }
        .card-assignee .card-name { max-width: 80px; }
        .card-unassigned { font-size: 11px; color: #56566A; font-style: italic; }
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
        .qa-btn { width: 100%; padding: 8px 10px; background: transparent; border: 1px dashed #2A2A36; border-radius: 8px; font-size: 12px; color: #3A3A50; cursor: pointer; text-align: left; font-family: inherit; transition: all 0.15s; display: flex; align-items: center; gap: 6px; }
        .qa-btn:hover { background: rgba(139,127,255,0.06); color: #8B7FFF; border-color: rgba(139,127,255,0.3); }
        .qa-wrap { position: relative; }
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
        .drawer-actions { display: flex; flex-direction: column; gap: 12px; }
        .drawer-inner > .field-grid + .drawer-actions {
          margin-top: 28px;
          padding-top: 18px;
          border-top: 1px solid #2A2A36;
        }
        .drawer-inner > .activity-log + .drawer-actions {
          margin-top: 22px;
          padding-top: 0;
          border-top: none;
        }
        .drawer-actions-row {
          display: grid; grid-template-columns: 1fr auto; gap: 8px; width: 100%; align-items: stretch;
        }
        .drawer-actions-row .btn-primary { width: 100%; min-width: 0; }
        .drawer-actions-row .btn-danger,
        .drawer-actions-row .btn-cancel { min-width: 0; }
        .drawer-actions-row .drawer-delete-confirm {
          display: grid; grid-template-columns: 1fr auto; gap: 8px; min-width: 0;
        }
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
        .field-span-2 { grid-column: span 2; }
        .field-label { font-size: 11px; letter-spacing: 0.05em; color: #56566A; text-transform: uppercase; margin-bottom: 6px; font-weight: 700; }
        .drawer .field-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px 12px; }
        .drawer .field-grid.field-grid-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .drawer .field-label { font-size: 12px; letter-spacing: 0.02em; color: #787890; margin-bottom: 4px; }
        .drawer .field-hint { font-size: 12px; margin-top: 6px; line-height: 1.4; }
        .drawer .ui-input { min-height: 32px; padding: 6px 10px; font-size: 13px; border-radius: 6px; }
        .drawer .ui-textarea { min-height: 72px; padding: 8px 10px; line-height: 1.5; }
        .drawer .ui-select { background-position: right 9px center; padding-right: 28px; }
        .drawer .priority-pills {
          display: grid; grid-template-columns: repeat(3, 1fr); gap: 3px;
          padding: 3px; border-radius: 8px; width: 100%; box-sizing: border-box;
        }
        .drawer .priority-pill { padding: 6px 8px; min-width: 0; font-size: 12px; flex: none; width: 100%; }
        .drawer .blocker-toggles { gap: 6px; }
        .drawer .blocker-toggle { padding: 8px 10px; border-radius: 8px; gap: 8px; }
        .drawer .blocker-toggle-mark { width: 18px; height: 18px; border-radius: 5px; font-size: 10px; }
        .drawer .blocker-toggle-title { font-size: 12px; }
        .drawer .blocker-toggle-desc { font-size: 11px; }
        .drawer .assignee-pick-btn { padding: 6px 10px; font-size: 12px; border-radius: 8px; }
        .drawer .assignee-pick-btn .av-sm { width: 26px; height: 26px; font-size: 10px; }
        .drawer .assignee-picker { gap: 6px; }
        .drawer .drawer-inner { padding: 18px 20px 28px; }
        .drawer .drawer-title { font-size: 18px; margin-bottom: 14px; padding-bottom: 8px; }
        .drawer .drawer-head { margin-bottom: 10px; }
        .drawer-stage-pill {
          font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 100px;
          color: var(--sd, #9494B0); background: color-mix(in srgb, var(--sd, #56566A) 14%, #1C1C24);
          border: 1px solid color-mix(in srgb, var(--sd, #56566A) 35%, #2A2A36);
        }
        .drawer-essentials { display: flex; flex-direction: column; gap: 10px; margin-bottom: 12px; }
        .drawer-core-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .drawer-core-grid--3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        .drawer-action-block { margin-bottom: 12px; }
        .drawer-section { border-top: 1px solid #2A2A36; }
        .drawer-section-toggle {
          width: 100%; display: flex; align-items: center; gap: 8px;
          padding: 11px 0; background: none; border: none; cursor: pointer;
          font-family: inherit; text-align: left;
        }
        .drawer-section-title { font-size: 12px; font-weight: 700; color: #9494B0; flex: 1; }
        .drawer-section-badge {
          font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 100px;
          background: #1C1C24; border: 1px solid #2A2A36; color: #56566A;
        }
        .drawer-section-chevron { font-size: 11px; color: #56566A; }
        .drawer-section-body { padding-bottom: 12px; display: flex; flex-direction: column; gap: 10px; }
        .drawer-blocker-row { display: flex; flex-wrap: wrap; gap: 8px; }
        .drawer-footer { margin-top: 16px; padding-top: 14px; border-top: 1px solid #2A2A36; }
        .btn-ghost-danger {
          padding: 10px 14px; font-size: 12px; font-weight: 600;
          background: transparent; color: #F87171; border: 1px solid transparent;
          border-radius: 8px; cursor: pointer; font-family: inherit;
        }
        .btn-ghost-danger:hover { background: rgba(248,113,113,0.08); border-color: rgba(248,113,113,0.2); }
        .drawer .assignee-picker .field-hint { display: none; }
        .drawer .activity-log { margin-top: 0; margin-bottom: 0; padding-top: 0; border-top: none; }
        .drawer .fu-section { border-top: none; padding-top: 0; margin-top: 0; }
        .drawer .drawer-move-board { min-height: 38px; padding: 10px 14px; font-size: 12px; }
        .drawer--simple .drawer-inner { padding-bottom: 80px; }
        .drawer--focus .drawer-inner { padding: 16px 18px 88px; }
        .drawer-head--focus { margin-bottom: 4px; }
        .drawer-focus-eyebrow { font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #56566A; }
        .drawer-title--focus { font-size: 22px; margin-bottom: 16px; padding-bottom: 0; border-bottom: none; }
        .drawer-focus-body { display: flex; flex-direction: column; gap: 12px; }
        .drawer--focus .field-label { text-transform: none; letter-spacing: 0; font-size: 12px; color: #787890; font-weight: 600; }
        .drawer-stage-select { min-height: 40px; font-size: 14px; font-weight: 600; }
        .drawer-flag-row { display: flex; flex-wrap: wrap; gap: 6px; }
        .drawer-flag-row .blocker-pill { padding: 5px 10px; font-size: 12px; border-radius: 6px; }
        .drawer-flag-row .blocker-pill.sales.on {
          border-color: rgba(251,191,36,0.4); color: #FBBF24;
          background: rgba(251,191,36,0.1);
        }
        .drawer-flag-row .blocker-pill.licenses.on {
          border-color: rgba(139,127,255,0.4); color: #8B7FFF;
          background: rgba(139,127,255,0.1);
        }
        .drawer-flag-row .blocker-pill:hover:not(:disabled):not(.on) { border-color: #3A3A50; color: #C4C4D4; }
        .drawer-extra-toggle {
          width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 8px;
          padding: 10px 0; margin-top: 4px; background: none; border: none; border-top: 1px solid #2A2A36;
          cursor: pointer; font-family: inherit; font-size: 13px; font-weight: 600; color: #8B7FFF;
        }
        .drawer-extra-hint { font-size: 11px; font-weight: 600; color: #56566A; }
        .drawer-extra-panel {
          display: flex; flex-direction: column; gap: 10px;
          padding: 12px 0 4px; border-top: 1px solid #2A2A36;
        }
        .drawer-action-panel { display: flex; flex-direction: column; gap: 8px; }
        .drawer-action-panel-label { font-size: 11px; font-weight: 700; color: #34D399; text-transform: uppercase; letter-spacing: 0.05em; }
        .drawer-action-card {
          display: flex; align-items: flex-start; justify-content: space-between; gap: 10px;
          padding: 10px 12px; border-radius: 8px; background: #1C1C24; border: 1px solid #2A2A36;
        }
        .drawer-action-card-title { font-size: 13px; font-weight: 700; color: #F0F0F6; line-height: 1.35; }
        .drawer-action-card-sub { font-size: 12px; color: #787890; margin-top: 4px; line-height: 1.4; }
        .drawer-action-card-btn {
          flex-shrink: 0; padding: 7px 10px; border-radius: 6px; border: none;
          background: #8B7FFF; color: #fff; font-size: 11px; font-weight: 700;
          cursor: pointer; font-family: inherit; white-space: nowrap;
        }
        .drawer-action-card-btn:hover { background: #9d8fff; }
        .drawer-head--simple { margin-bottom: 8px; }
        .drawer-head-meta { display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1; flex-wrap: wrap; }
        .drawer-head-dot { color: #3A3A50; font-size: 12px; }
        .drawer-head-context { font-size: 12px; color: #56566A; font-weight: 600; }
        .drawer-callout {
          font-size: 12px; font-weight: 600; padding: 8px 10px; border-radius: 8px;
          margin-bottom: 10px; line-height: 1.35;
        }
        .drawer-callout--followup { color: #34D399; background: rgba(52,211,153,0.08); border: 1px solid rgba(52,211,153,0.2); }
        .drawer-callout--blocker { color: #FBBF24; background: rgba(251,191,36,0.08); border: 1px solid rgba(251,191,36,0.2); }
        .drawer-subgroup { padding-top: 4px; }
        .drawer-subgroup-label { font-size: 11px; font-weight: 700; color: #56566A; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 6px; }
        .drawer-footer--sticky {
          position: sticky; bottom: 0; z-index: 2;
          background: linear-gradient(to top, #14141A 70%, transparent);
          margin-top: 8px; padding-top: 12px; padding-bottom: 4px;
        }
        .drawer-footer--sticky .drawer-actions-row { grid-template-columns: 1fr; }
        .drawer-footer-actions { display: flex; flex-direction: column; gap: 6px; width: 100%; }
        .drawer-save-status { font-size: 11px; font-weight: 600; text-align: center; padding: 2px 0 0; color: #56566A; }
        .drawer-save-status--saved { color: #34D399; }
        .drawer-save-status--error { color: #F87171; }
        .drawer-save-status--saving, .drawer-save-status--pending { color: #9494B0; }
        .drawer-footer-delete-row { display: flex; justify-content: flex-end; min-height: 28px; }
        .drawer-delete-confirm--compact { display: flex; gap: 6px; justify-content: flex-end; }
        .btn-ghost-danger--sm, .btn-danger--sm, .btn-cancel--sm {
          min-height: 0; padding: 5px 10px; font-size: 11px; font-weight: 600; border-radius: 6px;
        }
        .btn-ghost-danger--sm { padding: 5px 8px; }
        .drawer-delete-link { width: 100%; text-align: left; margin-top: 4px; }
        .assignee-picker--compact { gap: 4px; }
        .assignee-pick-btn--avatar { padding: 4px; border-radius: 100px; min-width: 0; }
        .assignee-pick-btn--avatar .av { width: 28px; height: 28px; font-size: 10px; }
        .drawer-section-badge { max-width: 55%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .drawer .btn-primary, .drawer .btn-danger, .drawer .btn-cancel { min-height: 40px; padding-top: 10px; padding-bottom: 10px; }
        .drawer .lic-drawer-sections { gap: 10px; }
        .drawer .lic-section-head { font-size: 11px; padding-top: 10px; margin: 2px 0 0; }
        .drawer .lic-section-head:first-child { padding-top: 0; margin-top: 0; }
        .drawer .lic-status-row { gap: 8px; }
        .drawer .lic-status-pill { font-size: 11px; padding: 4px 9px; }
        .drawer .lic-status-row .mono { font-size: 11px; }
        .drawer .sales-drawer-workload { margin-bottom: 12px; padding: 8px 10px; gap: 4px; }
        .drawer .sales-drawer-workload strong { font-size: 12px; }
        .drawer .sales-drawer-workload span { font-size: 12px; }
        .drawer .sales-board-linked { font-size: 12px; margin-top: 8px; }
        .drawer .seg-toggle { padding: 2px; border-radius: 6px; gap: 2px; }
        .drawer .seg-btn { padding: 7px 8px; font-size: 12px; min-height: 34px; }
        .drawer .drawer-title:disabled { opacity: 0.9; cursor: default; }
        .ui-input { width: 100%; background: #1C1C24; border: 1px solid #2A2A36; border-radius: 8px; padding: 10px 12px; font-size: 14px; color: #F0F0F6; outline: none; font-family: inherit; box-sizing: border-box; transition: border-color 0.15s; min-height: 42px; }
        .ui-input:focus { border-color: #8B7FFF; }
        .ui-textarea { resize: vertical; line-height: 1.6; min-height: 90px; }
        .ui-select { cursor: pointer; appearance: none; background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path d='M1 1l4 4 4-4' stroke='%2356566A' fill='none' stroke-width='1.5'/></svg>"); background-repeat: no-repeat; background-position: right 12px center; padding-right: 30px; }
        .ui-select option { background: #1C1C24; }
        input[type="date"]::-webkit-calendar-picker-indicator { filter: invert(0.4); cursor: pointer; }
        .sync-toggle { display: flex; align-items: center; gap: 10px; margin-top: 20px; font-size: 13px; color: #9494B0; cursor: pointer; }
        .sync-toggle input { accent-color: #8B7FFF; width: 16px; height: 16px; }
        .activity-log { margin-top: 16px; margin-bottom: 4px; padding-top: 16px; border-top: 1px solid #2A2A36; }
        .drawer-inner > .activity-log { margin-bottom: 16px; }
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
        .ss-topbar-actions { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-left: auto; }
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
        .lic-status-pill.sales-pending { border-color: rgba(251,191,36,0.25); color: #FBBF24; background: rgba(251,191,36,0.10); }
        .lic-status-pill.sales-approved { border-color: rgba(52,211,153,0.25); color: #34D399; background: rgba(52,211,153,0.10); }
        .lic-status-pill.sales-rejected { border-color: rgba(248,113,113,0.25); color: #F87171; background: rgba(248,113,113,0.10); }
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

        /* ── SALES ── */
        .sales-lic-page { gap: 16px; }
        .sales-split {
          display: grid;
          grid-template-columns: 248px minmax(0, 1fr);
          gap: 16px;
          align-items: stretch;
          min-height: min(72vh, calc(100dvh - 200px));
        }
        .sales-split-widgets {
          min-width: 0;
          display: flex;
          flex-direction: column;
        }
        .sales-split-board {
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 10px;
          min-height: 0;
        }
        .sa-widgets { display: flex; flex-direction: column; gap: 10px; }
        .sa-widget {
          background: #14141A; border: 1px solid #2A2A36; border-radius: 12px;
          padding: 12px 14px;
        }
        .sa-widget-label {
          font-size: 9px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase;
          color: #56566A; margin-bottom: 8px;
        }
        .sa-verdict--heavy { border-color: rgba(248,113,113,0.28); }
        .sa-verdict--busy { border-color: rgba(251,191,36,0.22); }
        .sa-verdict--calm { border-color: rgba(52,211,153,0.2); }
        .sa-verdict-pill {
          display: inline-block; font-size: 10px; font-weight: 700; padding: 3px 8px;
          border-radius: 100px; border: 1px solid; margin-bottom: 8px;
        }
        .sa-verdict-title {
          font-size: 15px; font-weight: 800; color: #F0F0F6; margin: 0 0 6px; line-height: 1.25;
        }
        .sa-verdict-hint { font-size: 12px; color: #9494B0; margin: 0 0 10px; line-height: 1.45; }
        .sa-verdict-bullets {
          list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 5px;
        }
        .sa-verdict-bullets li {
          font-size: 11px; color: #9494B0; line-height: 1.4; padding-left: 12px; position: relative;
        }
        .sa-verdict-bullets li::before {
          content: ""; position: absolute; left: 0; top: 6px; width: 4px; height: 4px;
          border-radius: 50%; background: #56566A;
        }
        .sa-queue-grid {
          display: grid; grid-template-columns: 1fr; gap: 8px;
        }
        .sa-queue-cell {
          padding: 8px 10px; background: #1C1C24; border-radius: 8px; border: 1px solid #23232D;
        }
        .sa-queue-val { display: block; font-size: 20px; font-weight: 800; line-height: 1.1; color: #F0F0F6; }
        .sa-queue-lbl {
          display: block; font-size: 10px; font-weight: 700; color: #9494B0; margin-top: 2px;
          text-transform: uppercase; letter-spacing: 0.04em;
        }
        .sa-queue-desc { display: block; font-size: 10px; color: #56566A; margin-top: 2px; }
        .sa-deadline-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .sa-deadline-row {
          text-align: center; padding: 8px 6px; background: #1C1C24; border-radius: 8px;
        }
        .sa-deadline-val { display: block; font-size: 20px; font-weight: 800; color: #F0F0F6; line-height: 1.1; }
        .sa-deadline-lbl { display: block; font-size: 9px; color: #56566A; margin-top: 2px; text-transform: uppercase; letter-spacing: 0.05em; }
        .sa-busiest {
          display: flex; flex-direction: column; gap: 4px; font-size: 11px;
        }
        .sa-busiest-lbl { font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; color: #56566A; }
        .sa-busiest-val { color: #9494B0; font-weight: 600; }
        .sa-fu-queue { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
        .sa-fu-queue-item { padding: 8px 10px; background: #1C1C24; border-radius: 8px; border: 1px solid #23232D; }
        .sa-fu-queue-title { display: block; font-size: 12px; font-weight: 600; color: #F0F0F6; line-height: 1.3; }
        .sa-fu-queue-pres { display: block; font-size: 10px; color: #56566A; margin-top: 3px; }
        .fu-section { grid-column: 1 / -1; margin-top: 4px; padding-top: 14px; border-top: 1px solid #2A2A36; }
        .fu-list { list-style: none; margin: 0 0 12px; padding: 0; display: flex; flex-direction: column; gap: 8px; }
        .fu-item {
          padding: 10px 12px; background: #14141A; border: 1px solid #2A2A36; border-radius: 10px;
        }
        .fu-item--open { border-color: rgba(251,191,36,0.28); }
        .fu-item--tasked { border-color: rgba(52,211,153,0.22); }
        .fu-item-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; margin-bottom: 4px; }
        .fu-item-title { font-size: 13px; font-weight: 700; color: #F0F0F6; line-height: 1.3; }
        .fu-status-pill {
          font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;
          padding: 3px 7px; border-radius: 100px; flex-shrink: 0;
          background: #1C1C24; border: 1px solid #2A2A36; color: #9494B0;
        }
        .fu-status-pill.open { color: #FBBF24; border-color: rgba(251,191,36,0.35); background: rgba(251,191,36,0.1); }
        .fu-status-pill.tasked { color: #34D399; border-color: rgba(52,211,153,0.3); background: rgba(52,211,153,0.1); }
        .fu-item-summary { font-size: 12px; color: #9494B0; line-height: 1.45; margin: 0 0 6px; }
        .fu-item-meta { display: flex; gap: 8px; font-size: 10px; color: #56566A; margin-bottom: 8px; }
        .fu-task-btn {
          width: 100%; padding: 8px 12px; border-radius: 8px; border: none;
          background: #34D399; color: #0C0C10; font-size: 12px; font-weight: 700;
          cursor: pointer; font-family: inherit; margin-bottom: 6px;
        }
        .fu-task-btn:hover { opacity: 0.9; }
        .fu-done-btn {
          background: none; border: none; padding: 0; font-size: 11px; font-weight: 600;
          color: #56566A; cursor: pointer; font-family: inherit;
        }
        .fu-done-btn:hover { color: #9494B0; }
        .fu-linked { font-size: 11px; color: #34D399; margin-bottom: 6px; }
        .fu-add { display: flex; flex-direction: column; gap: 8px; }
        .fu-card-chip {
          font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 100px;
          background: rgba(251,191,36,0.12); border: 1px solid rgba(251,191,36,0.35); color: #FBBF24;
        }
        .fu-log-modal { max-width: min(480px, 92vw); }
        .sa-submit-note {
          font-size: 11px; color: #9494B0; margin: 0; padding: 8px 12px; flex-shrink: 0;
          background: rgba(251,191,36,0.06); border: 1px solid rgba(251,191,36,0.18); border-radius: 8px;
        }
        .sales-req-board-panel {
          flex: 1; min-height: 0; display: flex; flex-direction: column;
          background: #14141A; border: 1px solid #2A2A36; border-radius: 12px;
          padding: 12px; overflow: hidden;
        }
        .sales-req-board {
          flex: 1; min-height: 0; flex-wrap: nowrap; gap: 10px;
          padding-bottom: 0; align-items: stretch;
        }
        .sales-req-col {
          flex: 1 1 0; min-width: 0; max-width: none;
          min-height: 200px;
        }
        .sales-req-col-head { cursor: default; padding-bottom: 8px; }
        .sales-req-col-titles { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1; }
        .sales-req-col-hint { font-size: 10px; font-weight: 500; color: #56566A; text-transform: none; letter-spacing: 0; }
        .sales-req-cards { max-height: min(58vh, calc(100dvh - 280px)); }
        .sr-card {
          background: #1C1C24; border: 1px solid #2A2A36; border-radius: 10px;
          padding: 10px 11px; cursor: pointer; transition: border-color 0.15s, box-shadow 0.15s;
        }
        .sr-card:hover { border-color: #3A3A50; box-shadow: 0 4px 12px rgba(0,0,0,0.35); }
        .sr-card-title { font-size: 13px; font-weight: 700; color: #F0F0F6; line-height: 1.3; margin-bottom: 4px; }
        .sr-card-meta { font-size: 10px; color: #56566A; margin-bottom: 8px; }
        .sr-card-tags { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 6px; }
        .sr-card-season { font-size: 10px; color: #56566A; }
        .sr-card-linked { font-size: 11px; color: #8B7FFF; margin-bottom: 4px; }
        .sr-card-snippet { font-size: 11px; color: #9494B0; line-height: 1.4; margin: 0; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        .sales-req-add-btn {
          width: 100%; padding: 8px; border-radius: 8px; border: 1px dashed #2A2A36;
          background: transparent; color: #56566A; font-size: 12px; font-weight: 600;
          cursor: pointer; font-family: inherit; transition: border-color 0.15s, color 0.15s;
        }
        .sales-req-add-btn:hover { border-color: #8B7FFF55; color: #8B7FFF; }
        .sales-board-pick { margin-bottom: 0; }
        .sales-board-linked {
          font-size: 12px; color: #9494B0; margin-top: 10px; padding: 8px 10px;
          background: rgba(52,211,153,0.08); border: 1px solid rgba(52,211,153,0.22); border-radius: 8px;
        }
        .sales-board-linked strong { color: #34D399; }
        .sr-card-board-link {
          display: block; width: 100%; text-align: left; margin: 6px 0 4px; padding: 6px 8px;
          border-radius: 8px; border: 1px solid rgba(52,211,153,0.25); background: rgba(52,211,153,0.08);
          color: #34D399; font-size: 11px; font-weight: 600; cursor: pointer; font-family: inherit;
        }
        .sr-card-board-link:hover { background: rgba(52,211,153,0.14); border-color: rgba(52,211,153,0.4); }
        .sa-empty { font-size: 13px; color: #56566A; margin: 0; }
        .btn-new--caution {
          border-color: rgba(251,191,36,0.45) !important;
          box-shadow: 0 0 0 1px rgba(251,191,36,0.12);
        }
        .sales-gate-modal {
          position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%);
          z-index: 10001; width: min(440px, 92vw);
          background: #1C1C24; border: 1px solid #2A2A36; border-radius: 16px;
          padding: 24px; box-shadow: 0 24px 60px rgba(0,0,0,0.55);
        }
        .sales-gate-title { font-size: 18px; font-weight: 800; color: #F0F0F6; margin: 0 0 12px; }
        .sales-gate-pill {
          display: inline-block; font-size: 10px; font-weight: 700; padding: 4px 10px;
          border-radius: 100px; border: 1px solid; margin-bottom: 10px;
        }
        .sales-gate-verdict { font-size: 16px; font-weight: 800; color: #F0F0F6; margin: 0 0 8px; line-height: 1.25; }
        .sales-gate-body { font-size: 13px; color: #9494B0; line-height: 1.5; margin: 0 0 12px; }
        .sales-gate-bullets {
          list-style: none; margin: 0 0 14px; padding: 12px 14px; background: #14141A;
          border-radius: 10px; border: 1px solid #2A2A36;
          display: flex; flex-direction: column; gap: 6px;
        }
        .sales-gate-bullets li {
          font-size: 12px; color: #9494B0; line-height: 1.4; padding-left: 12px; position: relative;
        }
        .sales-gate-bullets li::before {
          content: ""; position: absolute; left: 0; top: 7px; width: 4px; height: 4px;
          border-radius: 50%; background: #8B7FFF;
        }
        .sales-gate-ask { font-size: 13px; color: #F0F0F6; margin: 0 0 18px; line-height: 1.45; }
        .sales-gate-actions { display: flex; gap: 10px; justify-content: flex-end; flex-wrap: wrap; }
        .sales-drawer-workload {
          margin-bottom: 16px; padding: 12px 14px; border-radius: 10px; font-size: 12px; line-height: 1.45;
          display: flex; flex-direction: column; gap: 6px;
        }
        .sales-drawer-workload strong { color: #F0F0F6; font-size: 13px; }
        .sales-drawer-workload span { color: #9494B0; }
        .sales-drawer-bullets {
          list-style: none; margin: 4px 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px;
        }
        .sales-drawer-bullets li {
          font-size: 11px; color: #9494B0; padding-left: 10px; position: relative;
        }
        .sales-drawer-bullets li::before {
          content: ""; position: absolute; left: 0; top: 6px; width: 3px; height: 3px;
          border-radius: 50%; background: #56566A;
        }
        .sales-drawer-workload--heavy {
          background: rgba(248,113,113,0.1); border: 1px solid rgba(248,113,113,0.28);
        }
        .sales-drawer-workload--busy {
          background: rgba(251,191,36,0.08); border: 1px solid rgba(251,191,36,0.25);
        }
        .sales-beta-banner {
          font-size: 12px; color: #9494B0; line-height: 1.5;
          padding: 10px 14px; margin-bottom: 12px;
          background: rgba(139,127,255,0.08); border: 1px solid rgba(139,127,255,0.25);
          border-radius: 10px;
        }
        .sales-beta-banner code { font-size: 11px; color: #8B7FFF; }
        .sales-pending-pill {
          display: inline-block; margin-left: 6px;
          padding: 2px 8px; border-radius: 100px; font-size: 10px; font-weight: 700;
          background: rgba(251,191,36,0.15); border: 1px solid rgba(251,191,36,0.35); color: #FBBF24;
        }
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

        @media (max-width: 1000px) {
          .sales-split { grid-template-columns: 1fr; min-height: 0; }
          .sales-req-board { flex-wrap: wrap; }
          .sales-req-col { flex: 1 1 100%; min-width: 240px; }
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
          .ss-topbar-actions { width: 100%; margin-left: 0; }
          .ss-topbar .ss-search { width: 100%; flex: 1; min-width: 0; }
          .board-tools-row { flex-direction: column; align-items: stretch; }
          .board-tools-focus { margin-left: 0; width: 100%; }
          .team-strip { gap: 5px 6px; padding: 6px 8px; }
          .strip-hint { flex: 1 1 100%; }
          .board {
            margin: 0 -16px;
            padding: 0 20px 28px 16px;
            flex-wrap: nowrap;
            overflow-x: auto;
            -webkit-overflow-scrolling: touch;
            scrollbar-gutter: stable;
          }
          .col { padding: 10px 12px; }
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
          .drawer .field-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .drawer .field-span-2 { grid-column: span 2; }
          .drawer .field-full { grid-column: 1 / -1; }
          .drawer-core-grid--3 { grid-template-columns: 1fr 1fr; }
          .ui-input { font-size: 16px; }
          .drawer-actions-row { grid-template-columns: 1fr; }
          .drawer-action-pair { grid-template-columns: 1fr; }
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
          {isMaster && <span className="sync-pill" style={{ borderColor: "rgba(139,127,255,0.35)", color: "#8B7FFF" }}>Master</span>}
          {isViewer && <span className="sync-pill viewer">View only</span>}
          {isLoaded && user?.id && (
            <HeaderNickname userId={user.id} colorName={boardProfile} />
          )}
        </div>
        <div className="nav-center">
          <div className="page-nav">
            <button className={`page-nav-btn ${page === "projects" ? "active" : ""}`} onClick={() => setPage("projects")}>
              Projects
              {canEditProjects && openFollowUpTotal > 0 ? (
                <span className="nav-badge" title="Buyer follow-ups waiting to be tasked">{openFollowUpTotal}</span>
              ) : null}
            </button>
            <button className={`page-nav-btn ${page === "selectsets" ? "active" : ""}`} onClick={() => setPage("selectsets")}>Select Sets</button>
            <button className={`page-nav-btn ${page === "licensing" ? "active" : ""}`} onClick={() => setPage("licensing")}>
              Licensing{licOpenCount > 0 ? <span className="nav-badge">{licOpenCount}</span> : null}
              {hasLicensingAccess && page !== "licensing" && licDoneUpdatedCount > 0 ? <span className="nav-dot" title="New completed updates" /> : null}
            </button>
            <button className={`page-nav-btn ${page === "sales" ? "active" : ""}`} onClick={() => setPage("sales")}>
              Sales
              {canReviewSalesRequests && salesPendingCount > 0 ? (
                <span className="nav-badge" title="Pending sales requests">{salesPendingCount}</span>
              ) : (
                <span className="nav-badge" style={{ background: "rgba(139,127,255,0.15)", borderColor: "rgba(139,127,255,0.35)", color: "#8B7FFF" }}>Beta</span>
              )}
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
      ) : page === "sales" ? (
        <main className="main">
          {canViewSalesRequests ? (
            <SalesPageHost
              projects={projects}
              requests={salesRequests}
              pendingCount={salesPendingCount}
              isSalesSubmit={canSubmitSalesRequests}
              onLogFollowUpClick={canSubmitSalesRequests ? () => setFollowUpModalOpen(true) : undefined}
              openFollowUps={openFollowUps}
              onSave={(data) => handleSalesReqSave({ ...data, createdBy: data.createdBy || actor })}
              onDelete={handleSalesReqDelete}
              onReview={handleSalesReqReview}
              onOpenProject={handleOpenProjectFromRequest}
              canCreate={canSubmitSalesRequests}
              canEdit={canSubmitSalesRequests || canReviewSalesRequests || canEditProjects}
              canResolve={canReviewSalesRequests || canEditProjects}
            />
          ) : (
            <div className="lic-page">
              <p className="sa-empty" style={{ paddingTop: 32 }}>You don’t have access to sales requests.</p>
            </div>
          )}
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
          {view !== "board" && (
            <>
              <div className="filter-div" />
              <FocusFilterBar
                boardMode={boardMode}
                boardTagFilter={boardTagFilter}
                setBoardTagFilter={setBoardTagFilter}
                priorityCount={priorityCount}
                awaitingSalesCount={awaitingSalesCount}
                licensesCount={licensesCount}
                presSalesInfoCount={presSalesInfoCount}
                presBlockedCount={presBlockedCount}
                filteredShownCount={activeCount}
              />
            </>
          )}
          <div className="filter-div" />
          <div className="filter-section" style={{ gap: 6 }}>
            {TEAM.map(t => (
              <div key={t.name} title={t.name} className={`asn-chip ${assigneeFilter === t.name ? "asn-on" : ""}`}
                onClick={() => setAssigneeFilter(f => f === t.name ? null : t.name)}>
                <span className="av av-md" style={{ background: t.color }}>{initials(t.name)}</span>
              </div>
            ))}
            <div
              title="Unassigned"
              className={`asn-chip asn-chip--unassigned ${assigneeFilter === UNASSIGNED_FILTER ? "asn-on" : ""}`}
              onClick={() => setAssigneeFilter(f => f === UNASSIGNED_FILTER ? null : UNASSIGNED_FILTER)}
            >
              <span className="asn-unassigned-mark" aria-hidden>—</span>
            </div>
          </div>
        </div>

        {view === "board" ? (
          <Board
            projects={filtered}
            onAssign={handleAssign}
            onReorder={handleReorder}
            onQuickAdd={handleQuickAdd}
            onDelete={handleDelete}
            onOpen={openProject}
            stages={activeStages}
            canEdit={canEditProjects}
            shouldGlowProject={shouldGlowProject}
            focusBar={
              <FocusFilterBar
                boardMode={boardMode}
                boardTagFilter={boardTagFilter}
                setBoardTagFilter={setBoardTagFilter}
                priorityCount={priorityCount}
                awaitingSalesCount={awaitingSalesCount}
                licensesCount={licensesCount}
                presSalesInfoCount={presSalesInfoCount}
                presBlockedCount={presBlockedCount}
                filteredShownCount={activeCount}
                statusAside
              />
            }
          />
        ) : view === "list" ? (
          <ListView projects={filtered.filter(p => p.stage !== "archived")} onOpen={openProject} shouldGlowProject={shouldGlowProject} />
        ) : (
          <CalendarView projects={filtered.filter(p => p.stage !== "archived")} onOpen={openProject} />
        )}
      </main>
      )} {/* end page conditional */}

      {drawer && (
        <Drawer
          project={drawer.project}
          isNew={drawer.isNew}
          onSave={handleSave}
          onDelete={handleDelete}
          onMoveBoard={handleMoveBoard}
          onClose={() => setDrawer(null)}
          presentations={presentationProjects}
          allProjects={projects}
          readOnly={!canEditProjects}
          canLogFollowUps={canSubmitSalesRequests}
          canTaskFollowUps={canEditProjects}
          onCreateProductFromFollowUp={handleCreateProductFromFollowUp}
        />
      )}
      {followUpModalOpen && (
        <LogBuyerFollowUpModal
          presentations={presentationProjects}
          onSave={handleLogBuyerFollowUp}
          onClose={() => setFollowUpModalOpen(false)}
        />
      )}
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
