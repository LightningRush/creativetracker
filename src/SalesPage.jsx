import { useMemo } from "react";

const C = {
  amber: "#FBBF24",
  green: "#34D399",
  red: "#F87171",
  accent: "#8B7FFF",
  muted: "#56566A",
};

const VERDICTS = {
  calm: {
    title: "Good time to submit",
    hint: "Include clear scope, customer, and timeline.",
    pill: "Lower load",
  },
  busy: {
    title: "Submit only if important",
    hint: "Art has a full queue — check existing projects before adding new work.",
    pill: "Moderate load",
  },
  heavy: {
    title: "Avoid new requests",
    hint: "Unless urgent, wait or add work to an existing project on the board.",
    pill: "High load",
  },
};

const LOAD_COLORS = {
  calm: C.green,
  busy: C.amber,
  heavy: C.red,
};

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + "T00:00:00");
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return Math.round((d - t) / 86400000);
}

/** Past due no longer counts once sent / done */
const OVERDUE_EXEMPT_STAGES = new Set(["sent", "picks_in", "prod_ready", "archived"]);

function isOverdueProject(p) {
  if (!p || OVERDUE_EXEMPT_STAGES.has(p.stage)) return false;
  const d = daysUntil(p.dueDate);
  return d !== null && d < 0;
}

function projectAssigneeNames(p) {
  if (Array.isArray(p.assignees) && p.assignees.length) return [...new Set(p.assignees.filter(Boolean))];
  if (p.assignee) return [p.assignee];
  return [];
}

function busiestAssignee(active) {
  const counts = {};
  active.forEach(p => {
    projectAssigneeNames(p).forEach(name => {
      counts[name] = (counts[name] || 0) + 1;
    });
  });
  let top = null;
  let max = 0;
  Object.entries(counts).forEach(([name, n]) => {
    if (n > max) {
      max = n;
      top = name;
    }
  });
  return top ? { name: top, count: max } : null;
}

export function computeOverview(projects) {
  const active = projects.filter(p => p.stage !== "archived");
  const byStage = {};
  const byPriority = { none: 0, high: 0, urgent: 0 };
  const due = { overdue: 0, thisWeek: 0, next14: 0, later: 0, noDate: 0 };

  active.forEach(p => {
    const s = p.stage || "unknown";
    byStage[s] = (byStage[s] || 0) + 1;
    const pr = p.priority || "";
    if (pr === "urgent") byPriority.urgent += 1;
    else if (pr === "high") byPriority.high += 1;
    else byPriority.none += 1;
    const d = daysUntil(p.dueDate);
    if (d === null) due.noDate += 1;
    else if (isOverdueProject(p)) due.overdue += 1;
    else if (d < 0) { /* Sent / done — past due ignored */ }
    else if (d <= 7) due.thisWeek += 1;
    else if (d <= 14) due.next14 += 1;
    else due.later += 1;
  });

  const isAtRisk = (p) => {
    return (
      isOverdueProject(p) ||
      p.priority === "urgent" ||
      p.priority === "high" ||
      p.waitingOnSales ||
      p.stage === "awaiting_sales" ||
      p.waitingOnLicenses
    );
  };

  const needsSalesAction = active.filter(p =>
    p.waitingOnSales || p.stage === "awaiting_sales" || p.waitingOnLicenses,
  ).length;

  const inDesign = (byStage.design_dev || 0) + (byStage.sampling || 0) + (byStage.revision || 0)
    + (byStage.building || 0) + (byStage.review || 0);

  const artPipeline = inDesign
    + (byStage.concept || 0)
    + (byStage.tech_pack || 0)
    + (byStage.brief || 0);

  const atRisk = active.filter(isAtRisk).length;

  return {
    total: active.length,
    overdue: due.overdue,
    priority: byPriority.high + byPriority.urgent,
    atRisk,
    healthy: Math.max(0, active.length - atRisk),
    inDesign,
    artPipeline,
    needsSalesAction,
    busiest: busiestAssignee(active),
    byStage: Object.entries(byStage).sort((a, b) => b[1] - a[1]),
    byPriority,
    due,
  };
}

function buildWorkloadBullets(overview, pendingRequests) {
  const bullets = [];
  const total = overview.total || 0;
  bullets.push(`${total} active project${total !== 1 ? "s" : ""} on the board`);

  const dueParts = [];
  if (overview.due.thisWeek > 0) {
    dueParts.push(`${overview.due.thisWeek} due this week`);
  }
  if (overview.overdue > 0) {
    dueParts.push(`${overview.overdue} overdue`);
  }
  if (dueParts.length) bullets.push(dueParts.join(" · "));
  else if (total > 0) bullets.push("No overdue deadlines right now");

  if (pendingRequests > 0) {
    bullets.push(
      `${pendingRequests} sales request${pendingRequests !== 1 ? "s" : ""} waiting for art review`,
    );
  } else if (overview.priority > 0) {
    bullets.push(`${overview.priority} marked high or urgent priority`);
  }

  return bullets;
}

export function computeWorkload(overview, pendingRequests = 0) {
  const total = overview.total || 0;
  const atRiskPct = total ? overview.atRisk / total : 0;
  let score = 0;

  if (total >= 24) score += 3;
  else if (total >= 14) score += 2;
  else if (total >= 8) score += 1;
  if (atRiskPct >= 0.55) score += 3;
  else if (atRiskPct >= 0.38) score += 2;
  else if (atRiskPct >= 0.22) score += 1;
  if (overview.overdue >= 4) score += 3;
  else if (overview.overdue >= 2) score += 2;
  else if (overview.overdue >= 1) score += 1;
  if (overview.priority >= 6) score += 2;
  else if (overview.priority >= 3) score += 1;
  if (overview.due.thisWeek >= 5) score += 2;
  else if (overview.due.thisWeek >= 3) score += 1;
  if (pendingRequests >= 4) score += 3;
  else if (pendingRequests >= 2) score += 2;
  else if (pendingRequests >= 1) score += 1;

  const level = score >= 7 ? "heavy" : score >= 3 ? "busy" : "calm";
  const verdict = VERDICTS[level];
  const bullets = buildWorkloadBullets(overview, pendingRequests);
  const guidance = verdict.hint;

  return {
    level,
    color: LOAD_COLORS[level],
    verdict,
    bullets,
    guidance,
    headline: verdict.title,
    body: [verdict.title, guidance, ...bullets].join(" "),
    gateNewRequest: level !== "calm",
  };
}

function WorkloadWidgets({ overview, workload, pendingRequests, openFollowUps = [] }) {
  const { verdict, bullets, level } = workload;
  const color = workload.color;

  return (
    <div className="sa-widgets">
      <div className={`sa-widget sa-verdict sa-verdict--${level}`}>
        <span
          className="sa-verdict-pill"
          style={{ color, borderColor: `${color}44`, background: `${color}14` }}
        >
          {verdict.pill}
        </span>
        <h2 className="sa-verdict-title">{verdict.title}</h2>
        <p className="sa-verdict-hint">{workload.guidance}</p>
        <ul className="sa-verdict-bullets">
          {bullets.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      </div>

      <div className="sa-widget sa-queue-split">
        <div className="sa-widget-label">Where work sits</div>
        <div className="sa-queue-grid">
          <div className="sa-queue-cell">
            <span className="sa-queue-val" style={{ color: C.amber }}>{overview.needsSalesAction}</span>
            <span className="sa-queue-lbl">Needs sales</span>
            <span className="sa-queue-desc">Brief, SKUs, or licenses</span>
          </div>
          <div className="sa-queue-cell">
            <span className="sa-queue-val" style={{ color: C.accent }}>{overview.artPipeline}</span>
            <span className="sa-queue-lbl">Art pipeline</span>
            <span className="sa-queue-desc">Concept through design</span>
          </div>
          <div className="sa-queue-cell">
            <span className="sa-queue-val" style={{ color: pendingRequests > 0 ? C.accent : C.muted }}>
              {pendingRequests}
            </span>
            <span className="sa-queue-lbl">Request queue</span>
            <span className="sa-queue-desc">Awaiting art review</span>
          </div>
        </div>
      </div>

      <div className="sa-widget sa-deadlines">
        <div className="sa-widget-label">Deadlines</div>
        <div className="sa-deadline-grid">
          <div className="sa-deadline-row">
            <span className="sa-deadline-val">{overview.due.thisWeek}</span>
            <span className="sa-deadline-lbl">Due this week</span>
          </div>
          <div className="sa-deadline-row">
            <span className="sa-deadline-val" style={{ color: overview.overdue > 0 ? C.red : undefined }}>
              {overview.overdue}
            </span>
            <span className="sa-deadline-lbl">Overdue</span>
          </div>
        </div>
      </div>

      {overview.busiest && overview.busiest.count >= 3 && (
        <div className="sa-widget sa-busiest">
          <span className="sa-busiest-lbl">Busiest assignee</span>
          <span className="sa-busiest-val">
            {overview.busiest.name.split(" ")[0]} · {overview.busiest.count} active
          </span>
        </div>
      )}

      {openFollowUps.length > 0 && (
        <div className="sa-widget sa-fu-widget">
          <div className="sa-widget-label">Waiting for art to task</div>
          <ul className="sa-fu-queue">
            {openFollowUps.slice(0, 5).map(f => (
              <li key={f.id} className="sa-fu-queue-item">
                <span className="sa-fu-queue-title">{f.title}</span>
                <span className="sa-fu-queue-pres">{f.presentationTitle}</span>
              </li>
            ))}
          </ul>
          {openFollowUps.length > 5 && (
            <p className="sa-widget-hint" style={{ margin: "8px 0 0" }}>
              +{openFollowUps.length - 5} more on the presentations board
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function SalesPage({
  projects,
  pendingCount = 0,
  requestSearch = "",
  onRequestSearchChange,
  onNewRequestClick,
  onLogFollowUpClick,
  openFollowUps = [],
  canCreateRequest = false,
  workloadLevel = "calm",
  renderRequests,
  isSalesSubmit = false,
}) {
  const overview = useMemo(() => computeOverview(projects), [projects]);
  const workload = useMemo(
    () => computeWorkload(overview, pendingCount),
    [overview, pendingCount],
  );

  const subParts = [
    `${overview.total} active on board`,
    pendingCount > 0 ? `${pendingCount} pending requests` : null,
  ].filter(Boolean);

  return (
    <div className="lic-page sales-lic-page">
      <div className="ss-topbar">
        <div>
          <h1 className="page-title">Sales</h1>
          <p className="page-sub">{subParts.join(" · ")}</p>
        </div>
        <div className="ss-topbar-actions">
          <input
            value={requestSearch}
            onChange={e => onRequestSearchChange?.(e.target.value)}
            placeholder="Search requests, project…"
            className="ss-search"
          />
          {canCreateRequest && onLogFollowUpClick && (
            <button type="button" onClick={onLogFollowUpClick} className="btn-new btn-new--secondary">
              Log buyer follow-up
            </button>
          )}
          {canCreateRequest && (
            <button
              type="button"
              onClick={onNewRequestClick}
              className={`btn-new ${workloadLevel === "heavy" ? "btn-new--caution" : ""}`}
            >
              + New Request
            </button>
          )}
        </div>
      </div>

      <div className="sales-split">
        <aside className="sales-split-widgets">
          <WorkloadWidgets
            overview={overview}
            workload={workload}
            pendingRequests={pendingCount}
            openFollowUps={openFollowUps}
          />
        </aside>

        <section className="sales-split-board">
          {isSalesSubmit && workload.gateNewRequest && (
            <p className="sa-submit-note">
              <strong>{workload.verdict.title}</strong> — {workload.guidance}
            </p>
          )}
          {renderRequests?.({ overview, workload }) ?? null}
        </section>
      </div>
    </div>
  );
}
