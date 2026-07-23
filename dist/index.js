// src/Annotate.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { domToBlob } from "modern-screenshot";
import {
  X,
  Trash2,
  Copy,
  Download,
  Crosshair,
  MessageSquarePlus,
  Camera,
  ListChecks,
  CornerDownRight,
  Target,
  Eraser,
  Check,
  MapPin,
  Square,
  ArrowUpRight,
  Circle,
  Spline,
  Undo2,
  Eye,
  EyeOff,
  GripVertical,
  Maximize2,
  Lock,
  Globe,
  Settings,
  Pencil,
  Keyboard,
  Send,
  Filter,
  Monitor,
  TerminalSquare,
  Trash
} from "lucide-react";

// src/constants.ts
var ANN_MODES = [
  { key: "pin", label: "Pin", kbd: "P" },
  { key: "rect", label: "Box", kbd: "B" },
  { key: "arrow", label: "Arrow", kbd: "A" },
  { key: "circle", label: "Circle", kbd: "C" },
  { key: "freehand", label: "Draw", kbd: "D" }
];
var ANN_COLORS = ["#6366f1", "#e11d48", "#0369a1", "#ca8a04", "#15803d", "#7c3aed"];
var annShapeLabel = (s) => s === "rect" ? "Box" : s === "arrow" ? "Arrow" : s === "circle" ? "Circle" : s === "freehand" ? "Draw" : "Shape";
var ANN_TYPES = [
  { key: "change", label: "Change", dot: "#6366f1" },
  { key: "add", label: "Add", dot: "#10b981" },
  { key: "remove", label: "Remove", dot: "#f43f5e" },
  { key: "bug", label: "Bug", dot: "#ef4444" },
  { key: "style", label: "Style", dot: "#f59e0b" },
  { key: "question", label: "Question", dot: "#64748b" }
];
var ANN_PRIORITIES = [
  { key: "high", label: "High" },
  { key: "med", label: "Medium" },
  { key: "low", label: "Low" }
];
var ANN_STATUSES = [
  { key: "open", label: "Open" },
  { key: "in_progress", label: "In progress" },
  { key: "done", label: "Done" },
  { key: "dismissed", label: "Dismissed" }
];
var OPEN_STATUSES = ["open", "in_progress"];
var annDot = (t) => ANN_TYPES.find((x) => x.key === t)?.dot ?? "#6366f1";
var annTypeLabel = (t) => ANN_TYPES.find((x) => x.key === t)?.label ?? "Change";
var annStatusLabel = (s) => ANN_STATUSES.find((x) => x.key === s)?.label ?? "Open";
var PRIORITY_RANK = { high: 0, med: 1, low: 2 };

// src/prompt.ts
function buildClaudePrompt(items, opts) {
  const title = opts?.title || "Live-site annotations \u2014 feedback to implement";
  if (!items.length) return `# ${title}

_(no annotations selected)_
`;
  const byPage = /* @__PURE__ */ new Map();
  for (const a of items) {
    const k = a.page_route || "(unknown page)";
    if (!byPage.has(k)) byPage.set(k, []);
    byPage.get(k).push(a);
  }
  const lines = [
    `# ${title}`,
    "",
    "These are pinpointed change requests captured directly on the live site. Each item names the page, the exact element, and what to do. Implement them precisely.",
    ""
  ];
  let n = 0;
  for (const [page, arr] of byPage) {
    arr.sort((a, b) => (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1));
    lines.push(`## Page: \`${page}\``, "");
    for (const a of arr) {
      n++;
      const shape = a.kind === "shape" ? ` \xB7 ${annShapeLabel(a.shape_type)} mark` : "";
      lines.push(`### ${n}. [${annTypeLabel(a.type).toUpperCase()} \xB7 ${(a.priority || "med").toUpperCase()}] ${a.page_title || page}${shape}`);
      if (a.target_text?.trim()) lines.push(`- **Element:** \`${a.target_selector || "\u2014"}\` \u2014 \u201C${a.target_text.trim().slice(0, 100)}\u201D`);
      else if (a.target_selector) lines.push(`- **Element:** \`${a.target_selector}\``);
      if (a.el_context?.length) lines.push(`- **Where:** ${a.el_context.join(" \u203A ")}`);
      if (a.created_by_name || a.created_by) lines.push(`- **By:** ${[a.created_by_name || a.created_by, a.created_by_role].filter(Boolean).join(" \xB7 ")}`);
      if (a.meta) {
        const m = a.meta;
        const env = [m.browser, m.os, m.device, m.viewport && `viewport ${m.viewport}`].filter(Boolean).join(" \xB7 ");
        if (env) lines.push(`- **Env:** ${env}`);
      }
      lines.push(`- **Request:** ${(a.note || "").trim() || "(marked \u2014 no note)"}`);
      for (const r of a.replies ?? []) lines.push(`  - \u21B3 ${r.note.trim()}`);
      if (a.console_logs?.length) {
        lines.push("- **Console at mark time:**");
        for (const l of a.console_logs.slice(-6)) lines.push(`  - \`[${l.level}]\` ${String(l.text).replace(/\n/g, " ").slice(0, 200)}`);
      }
      if (a.screenshot_url) lines.push("- _(screenshot attached)_");
      lines.push("");
    }
  }
  lines.push("---", `Total: ${n} item(s). I'll mark each Done in the Annotate panel as you implement it.`);
  return lines.join("\n");
}

// src/Annotate.tsx
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
var MODE_ICON = { pin: MapPin, rect: Square, arrow: ArrowUpRight, circle: Circle, freehand: Spline };
var cn = (...a) => a.filter(Boolean).join(" ");
var errMsg = (e) => e instanceof Error ? e.message : String(e);
function captureEnv() {
  const ua = navigator.userAgent;
  const browser = /edg/i.test(ua) ? "Edge" : /opr|opera/i.test(ua) ? "Opera" : /chrome/i.test(ua) ? "Chrome" : /firefox/i.test(ua) ? "Firefox" : /safari/i.test(ua) ? "Safari" : "Browser";
  const os = /windows/i.test(ua) ? "Windows" : /mac os|macintosh/i.test(ua) ? "macOS" : /android/i.test(ua) ? "Android" : /iphone|ipad|ios/i.test(ua) ? "iOS" : /linux/i.test(ua) ? "Linux" : "OS";
  const device = /mobi/i.test(ua) ? "Mobile" : /tablet|ipad/i.test(ua) ? "Tablet" : "Desktop";
  return { browser, os, device, viewport: `${window.innerWidth}\xD7${window.innerHeight}`, screen: `${window.screen?.width}\xD7${window.screen?.height}`, dpr: Math.round((window.devicePixelRatio || 1) * 100) / 100, url: window.location.href, ua: ua.slice(0, 200) };
}
var _logBuf = [];
var _logHooked = false;
function hookConsole() {
  if (_logHooked || typeof window === "undefined") return;
  _logHooked = true;
  const fmt = (args) => args.map((a) => typeof a === "string" ? a : a instanceof Error ? a.stack || a.message : (() => {
    try {
      return JSON.stringify(a);
    } catch {
      return String(a);
    }
  })()).join(" ").slice(0, 500);
  const push = (level, args) => {
    try {
      _logBuf.push({ level, text: fmt(args), at: (/* @__PURE__ */ new Date()).toISOString() });
      if (_logBuf.length > 50) _logBuf.shift();
    } catch {
    }
  };
  const orig = { error: console.error, warn: console.warn };
  console.error = (...a) => {
    push("error", a);
    orig.error(...a);
  };
  console.warn = (...a) => {
    push("warn", a);
    orig.warn(...a);
  };
  window.addEventListener("error", (e) => push("error", [e.message + (e.filename ? ` @ ${e.filename}:${e.lineno}:${e.colno}` : "")]));
  window.addEventListener("unhandledrejection", (e) => push("error", ["Unhandled promise rejection: " + String(e.reason)]));
}
if (typeof window !== "undefined") hookConsole();
var recentLogs = () => _logBuf.slice(-8);
function cssSelector(el) {
  if (!el || el === document.body) return "body";
  const parts = [];
  let node = el;
  let depth = 0;
  while (node && node.nodeType === 1 && node !== document.body && depth < 6) {
    const h = node;
    if (h.id) {
      parts.unshift(`#${CSS.escape(h.id)}`);
      break;
    }
    const stable = h.getAttribute("data-testid") || h.getAttribute("name") || h.getAttribute("aria-label");
    if (stable) {
      parts.unshift(`${node.tagName.toLowerCase()}[${h.getAttribute("data-testid") ? "data-testid" : h.getAttribute("name") ? "name" : "aria-label"}="${CSS.escape(stable)}"]`);
      break;
    }
    let part = node.tagName.toLowerCase();
    const cls = (node.getAttribute("class") || "").trim().split(/\s+/).filter(Boolean).slice(0, 2).map((c) => CSS.escape(c));
    if (cls.length) part += "." + cls.join(".");
    const parent = node.parentElement;
    if (parent) {
      const sibs = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
      if (sibs.length > 1) part += `:nth-of-type(${sibs.indexOf(node) + 1})`;
    }
    parts.unshift(part);
    node = node.parentElement;
    depth++;
  }
  return parts.join(" > ");
}
var isVisible = (el) => {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
};
function findEl(a) {
  if (a.target_selector) {
    try {
      const el = document.querySelector(a.target_selector);
      if (isVisible(el)) return el;
    } catch {
    }
  }
  const txt = (a.target_text || "").trim();
  if (txt && txt.length >= 2 && txt.length <= 80) {
    const els = Array.from(document.querySelectorAll("button, a, h1, h2, h3, span, p, td, th, label, div"));
    for (const el of els) {
      if ((el.textContent || "").replace(/\s+/g, " ").trim() === txt && isVisible(el) && !el.closest("[data-annot-ui]")) return el;
    }
  }
  return null;
}
var elLabel = (el) => {
  const tag = el.tagName.toLowerCase();
  const txt = (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 36);
  return txt ? `${tag} \xB7 \u201C${txt}\u201D` : tag;
};
var rgbToHex = (v) => {
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(v || "");
  if (!m) return v || "";
  if (m[4] !== void 0 && Number(m[4]) === 0) return "transparent";
  const h = (n) => Number(n).toString(16).padStart(2, "0");
  return `#${h(m[1])}${h(m[2])}${h(m[3])}`.toUpperCase();
};
function captureStyles(el) {
  try {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return { color: rgbToHex(cs.color), background: rgbToHex(cs.backgroundColor), fontSize: cs.fontSize, fontWeight: cs.fontWeight, radius: cs.borderRadius, padding: cs.padding, size: `${Math.round(r.width)}\xD7${Math.round(r.height)}` };
  } catch {
    return null;
  }
}
function captureContext(el) {
  const out = [];
  let node = el.parentElement;
  let i = 0;
  const own = (el.textContent || "").trim();
  while (node && node.tagName !== "BODY" && out.length < 3 && i < 12) {
    if (!node.closest("[data-annot-ui]")) {
      const aria = node.getAttribute("aria-label");
      let lbl = aria || "";
      if (!lbl) {
        const first = (node.textContent || "").trim().split("\n")[0].trim();
        if (first.length >= 3 && first.length <= 52) lbl = first;
      }
      if (lbl && lbl !== own && !out.includes(lbl)) out.push(lbl);
    }
    node = node.parentElement;
    i++;
  }
  return out;
}
function Highlight({ el, tone = "#6366f1", label }) {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return /* @__PURE__ */ jsx("div", { "data-annot-ui": true, className: "pointer-events-none fixed z-[9996] rounded-md", style: { left: r.left - 3, top: r.top - 3, width: r.width + 6, height: r.height + 6, boxShadow: `0 0 0 2px ${tone}, 0 0 0 6px ${tone}22`, transition: "all .08s" }, children: label && /* @__PURE__ */ jsx("span", { className: "absolute -top-5 left-0 whitespace-nowrap rounded bg-fg px-1.5 py-0.5 text-[10px] font-medium text-white", children: label }) });
}
function ShapeSvg({ s, dash }) {
  const stroke = s.color || "#6366f1";
  const sw = 2.5;
  const d = dash ? "5 4" : void 0;
  const x = s.pos_x, y = s.pos_y, x2 = s.x2 ?? s.pos_x, y2 = s.y2 ?? s.pos_y;
  if (s.shape_type === "rect") return /* @__PURE__ */ jsx("rect", { x: Math.min(x, x2), y: Math.min(y, y2), width: Math.abs(x2 - x), height: Math.abs(y2 - y), rx: "5", fill: "none", stroke, strokeWidth: sw, strokeDasharray: d });
  if (s.shape_type === "circle") return /* @__PURE__ */ jsx("ellipse", { cx: (x + x2) / 2, cy: (y + y2) / 2, rx: Math.abs(x2 - x) / 2, ry: Math.abs(y2 - y) / 2, fill: "none", stroke, strokeWidth: sw, strokeDasharray: d });
  if (s.shape_type === "arrow") {
    const mid = `annarr-${Math.round(x)}-${Math.round(y)}`;
    return /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsx("defs", { children: /* @__PURE__ */ jsx("marker", { id: mid, markerWidth: "9", markerHeight: "9", refX: "6", refY: "3", orient: "auto", children: /* @__PURE__ */ jsx("path", { d: "M0,0 L6,3 L0,6 Z", fill: stroke }) }) }),
      /* @__PURE__ */ jsx("line", { x1: x, y1: y, x2, y2, stroke, strokeWidth: sw + 0.5, strokeDasharray: d, markerEnd: `url(#${mid})` })
    ] });
  }
  return /* @__PURE__ */ jsx("polyline", { points: (s.points || []).map((p) => `${p.x},${p.y}`).join(" "), fill: "none", stroke, strokeWidth: sw, strokeLinejoin: "round", strokeLinecap: "round", strokeDasharray: d });
}
var chip = "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium";
function Annotate({ adapter, route, onNavigate, user, onToast, pollMs = 15e3 }) {
  const [browserPath, setBrowserPath] = useState(() => typeof window !== "undefined" ? window.location.pathname : "/");
  useEffect(() => {
    if (route !== void 0) return;
    const on = () => setBrowserPath(window.location.pathname);
    window.addEventListener("popstate", on);
    return () => window.removeEventListener("popstate", on);
  }, [route]);
  const pathname = route ?? browserPath;
  const navigate = useCallback((p) => {
    if (onNavigate) onNavigate(p);
    else window.location.assign(p);
  }, [onNavigate]);
  const [toasts, setToasts] = useState([]);
  const toastSeq = useRef(0);
  const toast = useCallback((kind, msg) => {
    if (onToast) {
      onToast(kind, msg);
      return;
    }
    const id = ++toastSeq.current;
    setToasts((t) => [...t, { id, kind, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600);
  }, [onToast]);
  const [access, setAccessData] = useState(null);
  const [accessLoading, setAccessLoading] = useState(true);
  const [accessBusy, setAccessBusy] = useState(false);
  const refreshAccess = useCallback(async () => {
    try {
      setAccessData(await adapter.getAccess());
    } catch (e) {
      console.warn("[annotate] getAccess failed", e);
    } finally {
      setAccessLoading(false);
    }
  }, [adapter]);
  useEffect(() => {
    refreshAccess();
  }, [refreshAccess]);
  const canUse = !!access?.canUse;
  const isAdmin = !!access?.isAdmin;
  const seeAll = !!access?.seeAll;
  const enabled = !!access?.enabled;
  const me = user ?? access?.me ?? {};
  const meEmail = me.email || "";
  const meName = me.name || me.email || "me";
  const [tool, setTool] = useState(null);
  const [color, setColor] = useState(ANN_COLORS[0]);
  const [panel, setPanel] = useState(false);
  const [draft, setDraft] = useState(null);
  const [drawing, setDrawing] = useState(null);
  const [active, setActive] = useState(null);
  const [busy, setBusy] = useState(false);
  const [, setTick] = useState(0);
  const [flashId, setFlashId] = useState(null);
  const [hoverEl, setHoverEl] = useState(null);
  const [filter, setFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("");
  const [prioFilter, setPrioFilter] = useState("");
  const [thisPageOnly, setThisPageOnly] = useState(false);
  const [authorFilter, setAuthorFilter] = useState("");
  const [search, setSearch] = useState("");
  const [reply, setReply] = useState("");
  const [peek, setPeek] = useState(false);
  const [shotBusy, setShotBusy] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [editRow, setEditRow] = useState(null);
  const [hintSeen, setHintSeen] = useState(() => {
    try {
      return localStorage.getItem("annot-hint") === "1";
    } catch {
      return true;
    }
  });
  const [pos, setPos] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("annot-pos") || "null");
    } catch {
      return null;
    }
  });
  const draftElRef = useRef(null);
  const hoverRef = useRef(null);
  const drawRef = useRef(null);
  const undoStackRef = useRef([]);
  const [all, setAll] = useState([]);
  const refresh = useCallback(async () => {
    try {
      setAll(await adapter.list());
    } catch (e) {
      console.warn("[annotate] list failed", e);
    }
  }, [adapter]);
  const invalidate = refresh;
  useEffect(() => {
    if (canUse) refresh();
  }, [canUse, refresh]);
  useEffect(() => {
    if (!canUse || !(tool || panel)) return;
    const id = setInterval(refresh, pollMs);
    return () => clearInterval(id);
  }, [canUse, tool, panel, pollMs, refresh]);
  const openCount = all.filter((a) => OPEN_STATUSES.includes(a.status)).length;
  const marksShown = !peek && (!!tool || panel || flashId != null);
  const pageMarks = useMemo(() => all.filter((a) => a.page_route === pathname && (OPEN_STATUSES.includes(a.status) || a.id === flashId)), [all, pathname, flashId]);
  const dismissHint = () => {
    setHintSeen(true);
    try {
      localStorage.setItem("annot-hint", "1");
    } catch {
    }
  };
  useEffect(() => {
    if (tool !== "pin") {
      if (tool === null) {
        setHoverEl(null);
        hoverRef.current = null;
      }
      return;
    }
    document.body.style.cursor = "crosshair";
    const onMove = (e) => {
      if (draftElRef.current) return;
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const t = el && !el.closest("[data-annot-ui]") ? el : null;
      if (t !== hoverRef.current) {
        hoverRef.current = t;
        setHoverEl(t);
      }
    };
    const onClick = (e) => {
      const t = e.target;
      if (t.closest("[data-annot-ui]")) return;
      e.preventDefault();
      e.stopPropagation();
      const el = t;
      draftElRef.current = el;
      setHoverEl(el);
      setActive(null);
      setDraft({
        kind: "pin",
        page_route: pathname,
        page_title: document.title || pathname,
        target_selector: cssSelector(el),
        target_text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120),
        pos_x: Math.round(e.pageX),
        pos_y: Math.round(e.pageY),
        viewport_w: window.innerWidth,
        viewport_h: window.innerHeight,
        note: "",
        type: "change",
        priority: "med",
        color,
        visibility: isAdmin ? "private" : "public",
        shot: false,
        styles: captureStyles(el),
        el_context: captureContext(el),
        meta: captureEnv(),
        console_logs: recentLogs(),
        cx: e.clientX,
        cy: e.clientY
      });
    };
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("click", onClick, true);
    return () => {
      document.body.style.cursor = "";
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("click", onClick, true);
    };
  }, [tool, pathname, color, isAdmin]);
  useEffect(() => {
    if (!tool || tool === "pin") return;
    document.body.style.cursor = "crosshair";
    const prevTouch = document.body.style.touchAction;
    document.body.style.touchAction = "none";
    const onDown = (e) => {
      if (e.target.closest?.("[data-annot-ui]")) return;
      e.preventDefault();
      e.stopPropagation();
      const start = { shape_type: tool, x: e.pageX, y: e.pageY, x2: e.pageX, y2: e.pageY, points: [{ x: e.pageX, y: e.pageY }] };
      drawRef.current = start;
      setDrawing(start);
      setActive(null);
    };
    const onMove = (e) => {
      const d = drawRef.current;
      if (!d) return;
      e.preventDefault();
      const next = tool === "freehand" ? { ...d, x2: e.pageX, y2: e.pageY, points: Math.hypot(e.pageX - d.points[d.points.length - 1].x, e.pageY - d.points[d.points.length - 1].y) > 3 ? [...d.points, { x: e.pageX, y: e.pageY }] : d.points } : { ...d, x2: e.pageX, y2: e.pageY };
      drawRef.current = next;
      setDrawing(next);
    };
    const onUp = (e) => {
      const d = drawRef.current;
      drawRef.current = null;
      setDrawing(null);
      if (!d) return;
      const w = Math.abs(d.x2 - d.x), h = Math.abs(d.y2 - d.y);
      if (d.shape_type === "freehand" ? d.points.length < 3 : w < 8 && h < 8) return;
      const anchor = document.elementFromPoint(e.clientX, e.clientY);
      setDraft({
        kind: "shape",
        shape_type: d.shape_type,
        page_route: pathname,
        page_title: document.title || pathname,
        target_selector: anchor && !anchor.closest("[data-annot-ui]") ? cssSelector(anchor) : "",
        target_text: "",
        pos_x: Math.round(d.x),
        pos_y: Math.round(d.y),
        x2: Math.round(d.x2),
        y2: Math.round(d.y2),
        points: d.shape_type === "freehand" ? d.points : void 0,
        viewport_w: window.innerWidth,
        viewport_h: window.innerHeight,
        note: "",
        type: "change",
        priority: "med",
        color,
        visibility: isAdmin ? "private" : "public",
        shot: false,
        meta: captureEnv(),
        console_logs: recentLogs(),
        cx: e.clientX,
        cy: e.clientY
      });
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("pointermove", onMove, { capture: true, passive: false });
    document.addEventListener("pointerup", onUp, true);
    document.addEventListener("pointercancel", onUp, true);
    return () => {
      document.body.style.cursor = "";
      document.body.style.touchAction = prevTouch;
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("pointermove", onMove, { capture: true });
      document.removeEventListener("pointerup", onUp, true);
      document.removeEventListener("pointercancel", onUp, true);
      drawRef.current = null;
      setDrawing(null);
    };
  }, [tool, pathname, color, isAdmin]);
  useEffect(() => {
    const on = () => setTick((x) => x + 1);
    window.addEventListener("scroll", on, true);
    window.addEventListener("resize", on);
    return () => {
      window.removeEventListener("scroll", on, true);
      window.removeEventListener("resize", on);
    };
  }, []);
  useEffect(() => {
    const h = (e) => {
      const typing = /input|textarea|select/i.test(e.target?.tagName || "") || e.target?.isContentEditable;
      if (e.key === "Escape") {
        if (helpOpen) setHelpOpen(false);
        else if (draft) closeDraft();
        else if (tool) setTool(null);
        return;
      }
      if (typing) return;
      const meta = e.ctrlKey || e.metaKey;
      if (meta && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        undoLast();
        return;
      }
      if (e.key === "?") {
        e.preventDefault();
        setHelpOpen((v) => !v);
        return;
      }
      if (e.shiftKey && e.key.toLowerCase() === "h") {
        e.preventDefault();
        setPeek((v) => !v);
        return;
      }
      if (e.shiftKey && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setTool((m) => m === "pin" ? null : "pin");
        return;
      }
      const map = { p: "pin", b: "rect", a: "arrow", c: "circle", d: "freehand" };
      const t = map[e.key.toLowerCase()];
      if (t && !e.shiftKey && !meta) {
        e.preventDefault();
        setTool((cur) => cur === t ? null : t);
      }
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [tool, draft, helpOpen]);
  useEffect(() => {
    if (active) {
      const f = all.find((a) => a.id === active.id);
      if (f && f !== active) setActive(f);
    }
  }, [all]);
  async function uploadShot(el) {
    try {
      const blob = await domToBlob(el, { backgroundColor: "#ffffff", scale: 2, quality: 0.95, style: { margin: "0" } });
      if (!blob) return null;
      const shot = new File([blob], "shot.png", { type: blob.type || "image/png" });
      const { path } = await adapter.uploadScreenshot(shot);
      return path;
    } catch (e) {
      console.warn("[annotate] screenshot failed", e);
      return null;
    }
  }
  async function capturePage(full) {
    if (shotBusy) return;
    setShotBusy(true);
    try {
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 40)));
      const target = full ? document.body : document.documentElement;
      const blob = await domToBlob(target, {
        backgroundColor: "#ffffff",
        scale: Math.min(2, window.devicePixelRatio || 1),
        width: full ? void 0 : window.innerWidth,
        height: full ? void 0 : window.innerHeight,
        filter: (n) => !(n instanceof HTMLElement && n.hasAttribute("data-annot-ui"))
      });
      if (!blob) throw new Error("capture failed");
      const canClip = !!navigator.clipboard && typeof window.ClipboardItem === "function";
      if (canClip) {
        try {
          await navigator.clipboard.write([new window.ClipboardItem({ "image/png": blob })]);
          toast("success", `${full ? "Full page" : "Viewport"} copied \u2014 paste anywhere`);
          return;
        } catch {
        }
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `screenshot-${full ? "fullpage" : "viewport"}-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace(/[:T]/g, "-")}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 500);
      toast("success", "Screenshot downloaded");
    } catch (e) {
      toast("error", errMsg(e) || "Screenshot failed");
    } finally {
      setShotBusy(false);
    }
  }
  const submitDraft = async () => {
    if (!draft) return;
    if (draft.kind === "pin" && !draft.note.trim()) return;
    setBusy(true);
    try {
      let screenshot_path = null;
      if (draft.shot && draftElRef.current) {
        screenshot_path = await uploadShot(draftElRef.current);
        if (!screenshot_path) toast("error", "Screenshot failed \u2014 saved without it");
      }
      const { cx: _cx, cy: _cy, shot: _shot, ...body } = draft;
      const saved = await adapter.save({ ...body, screenshot_path });
      if (saved?.id) {
        undoStackRef.current.push(saved.id);
        if (undoStackRef.current.length > 30) undoStackRef.current.shift();
      }
      invalidate();
      closeDraft();
      dismissHint();
      toast("success", "Saved \u2713");
    } catch (e) {
      toast("error", errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  const closeDraft = () => {
    setDraft(null);
    draftElRef.current = null;
    setHoverEl(null);
  };
  const doUpdate = (patch) => adapter.update(patch).then(invalidate).catch((e) => toast("error", errMsg(e)));
  const doDelete = (id) => adapter.remove(id).then(() => {
    invalidate();
    setActive(null);
    toast("success", "Deleted");
  }).catch((e) => toast("error", errMsg(e)));
  const doAddReply = (id, note) => adapter.addReply(id, note).then(() => {
    invalidate();
    setReply("");
    toast("success", "Reply added");
  }).catch((e) => toast("error", errMsg(e)));
  const doClearResolved = () => adapter.clearResolved().then((r) => {
    invalidate();
    toast("success", r?.message || "Cleared");
  }).catch((e) => toast("error", errMsg(e)));
  const toggleAccess = async (next) => {
    setAccessBusy(true);
    try {
      const r = await adapter.setAccess(next);
      await refreshAccess();
      toast("success", r?.message || "Saved");
    } catch (e) {
      toast("error", errMsg(e));
    } finally {
      setAccessBusy(false);
    }
  };
  const undoLast = () => {
    const id = undoStackRef.current.pop();
    if (id) doDelete(id);
  };
  const jumpTo = (a) => {
    const go = () => {
      const el = findEl(a);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        setHoverEl(el);
      } else window.scrollTo({ top: Math.max(0, a.pos_y - 140), behavior: "smooth" });
      setActive(a);
      setFlashId(a.id);
      setTimeout(() => setFlashId(null), 4e3);
    };
    if (a.page_route !== pathname) {
      setPanel(false);
      navigate(a.page_route);
      setTimeout(go, 400);
    } else go();
  };
  const copyPrompt = async (items) => {
    try {
      await navigator.clipboard.writeText(buildClaudePrompt(items));
      toast("success", `Copied ${items.length} mark(s) \u2014 paste to your developer`);
    } catch {
      toast("error", "Clipboard blocked \u2014 use Download");
    }
  };
  const downloadMd = (items) => {
    const blob = new Blob([buildClaudePrompt(items)], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `annotations-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const canEdit = (a) => seeAll || a.created_by === meEmail || a.created_by === meName;
  const listed = useMemo(() => {
    let r = all;
    if (thisPageOnly) r = r.filter((a) => a.page_route === pathname);
    if (filter !== "all") r = r.filter((a) => a.status === filter);
    if (typeFilter) r = r.filter((a) => a.type === typeFilter);
    if (prioFilter) r = r.filter((a) => a.priority === prioFilter);
    if (authorFilter) r = r.filter((a) => (a.created_by || "") === authorFilter);
    const q = search.trim().toLowerCase();
    if (q) r = r.filter((a) => (a.note + a.page_route + a.target_text + (a.created_by_name || "")).toLowerCase().includes(q));
    return [...r].sort((a, b) => b.id - a.id);
  }, [all, thisPageOnly, filter, typeFilter, prioFilter, authorFilter, search, pathname]);
  const grouped = useMemo(() => {
    const m = /* @__PURE__ */ new Map();
    for (const a of listed) {
      const k = a.page_route;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(a);
    }
    return [...m.entries()];
  }, [listed]);
  const openItems = all.filter((a) => OPEN_STATUSES.includes(a.status));
  const authors = useMemo(() => {
    const m = /* @__PURE__ */ new Map();
    for (const a of all) if (a.created_by) m.set(a.created_by, a.created_by_name || a.created_by);
    return [...m.entries()];
  }, [all]);
  const anyFilter = filter !== "all" || !!typeFilter || !!prioFilter || !!authorFilter || thisPageOnly || !!search.trim();
  const beginDrag = (e, onTap) => {
    e.preventDefault();
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    const offX = e.clientX - rect.left, offY = e.clientY - rect.top, sx = e.clientX, sy = e.clientY;
    let moved = false;
    const onMove = (ev) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
      moved = true;
      setPos({ x: Math.min(Math.max(4, ev.clientX - offX), window.innerWidth - 64), y: Math.min(Math.max(4, ev.clientY - offY), window.innerHeight - 64) });
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      if (moved) setPos((p) => {
        if (p) {
          try {
            localStorage.setItem("annot-pos", JSON.stringify(p));
          } catch {
          }
        }
        return p;
      });
      else onTap?.();
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  };
  if (accessLoading || !canUse) return null;
  const highlightEl = draft?.kind === "pin" ? draftElRef.current : hoverEl || (active && active.page_route === pathname ? findEl(active) : null);
  const highlightTone = draft ? annDot(draft.type) : active ? annDot(active.type) : "#6366f1";
  const docW = Math.max(document.documentElement.scrollWidth, window.innerWidth);
  const docH = Math.max(document.documentElement.scrollHeight, window.innerHeight);
  const fabStyle = pos ? { position: "fixed", left: pos.x, top: pos.y } : { position: "fixed", right: 20, bottom: 20 };
  return /* @__PURE__ */ jsxs("div", { "data-annot-ui": true, children: [
    /* @__PURE__ */ jsx(Highlight, { el: highlightEl, tone: highlightTone, label: highlightEl ? elLabel(highlightEl) : void 0 }),
    marksShown && /* @__PURE__ */ jsxs("svg", { width: docW, height: docH, style: { position: "absolute", left: 0, top: 0, overflow: "visible", zIndex: 9994, pointerEvents: "none" }, children: [
      pageMarks.filter((m) => m.kind === "shape").map((s) => /* @__PURE__ */ jsx(ShapeSvg, { s }, s.id)),
      draft?.kind === "shape" && /* @__PURE__ */ jsx(ShapeSvg, { s: { ...draft, color: draft.color }, dash: true })
    ] }),
    drawing && /* @__PURE__ */ jsx("svg", { width: docW, height: docH, style: { position: "absolute", left: 0, top: 0, overflow: "visible", zIndex: 9994, pointerEvents: "none" }, children: /* @__PURE__ */ jsx(ShapeSvg, { s: { shape_type: drawing.shape_type, pos_x: drawing.x, pos_y: drawing.y, x2: drawing.x2, y2: drawing.y2, points: drawing.points, color }, dash: true }) }),
    marksShown && pageMarks.map((a, i) => {
      const el = a.kind === "shape" ? null : findEl(a);
      const r = el?.getBoundingClientRect();
      const left = r ? r.left : a.pos_x - window.scrollX;
      const top = r ? r.top : a.pos_y - window.scrollY;
      const lost = a.kind !== "shape" && !el;
      return /* @__PURE__ */ jsx(
        "button",
        {
          type: "button",
          "data-annot-ui": true,
          onMouseEnter: () => el && setHoverEl(el),
          onMouseLeave: () => tool !== "pin" && setHoverEl(null),
          onClick: (e) => {
            e.stopPropagation();
            setActive(a);
            closeDraft();
          },
          title: `${a.note || annShapeLabel(a.shape_type)}${lost ? "  (element moved)" : ""}`,
          className: cn("fixed z-[9997] grid h-6 w-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full text-[11px] font-bold text-white shadow-md ring-2 ring-white", a.id === flashId && "animate-bounce ring-4 ring-warning", lost && "opacity-70"),
          style: { left, top, background: a.color || annDot(a.type) },
          children: i + 1
        },
        a.id
      );
    }),
    /* @__PURE__ */ jsx("div", { style: fabStyle, className: "z-[9998]", children: tool === null && !panel ? /* @__PURE__ */ jsxs("div", { className: "flex flex-col items-end gap-2", children: [
      !hintSeen && /* @__PURE__ */ jsxs("div", { "data-annot-ui": true, className: "max-w-[220px] rounded-card bg-fg px-3 py-2 text-[11px] text-white shadow-e4", children: [
        /* @__PURE__ */ jsx("b", { children: "Feedback tool" }),
        " \u2014 tap here, then click any element or draw to leave a note for the developer.",
        /* @__PURE__ */ jsx("button", { type: "button", onClick: dismissHint, className: "mt-1 block text-[10px] font-semibold text-brand", children: "Got it" })
      ] }),
      /* @__PURE__ */ jsxs(
        "button",
        {
          type: "button",
          "data-annot-ui": true,
          onPointerDown: (e) => beginDrag(e, () => setTool("pin")),
          title: "Annotate \xB7 drag to move \xB7 Shift+A",
          style: { touchAction: "none" },
          className: "relative grid h-12 w-12 place-items-center rounded-full bg-fg text-white shadow-e4 transition hover:bg-fg-secondary cursor-grab active:cursor-grabbing",
          children: [
            /* @__PURE__ */ jsx(MessageSquarePlus, { size: 20 }),
            openCount > 0 && /* @__PURE__ */ jsx("span", { className: "absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-brand px-1 text-[10px] font-bold text-white ring-2 ring-white", children: openCount })
          ]
        }
      )
    ] }) : /* @__PURE__ */ jsxs("div", { "data-annot-ui": true, className: "w-[252px] overflow-hidden rounded-card border border-line bg-surface shadow-e4", children: [
      /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-1 bg-fg px-2 py-1.5 text-white", children: [
        /* @__PURE__ */ jsx("button", { type: "button", onPointerDown: (e) => beginDrag(e), title: "Drag", style: { touchAction: "none" }, className: "cursor-grab p-1 text-fg-disabled hover:text-white active:cursor-grabbing", children: /* @__PURE__ */ jsx(GripVertical, { size: 14 }) }),
        /* @__PURE__ */ jsxs("span", { className: "flex-1 truncate text-[12px] font-bold", children: [
          "Feedback (",
          all.length,
          ")"
        ] }),
        /* @__PURE__ */ jsx("button", { type: "button", onClick: () => setPeek((v) => !v), title: peek ? "Show marks (Shift+H)" : "Hide marks (Shift+H)", className: "rounded p-1 text-fg-disabled hover:bg-fg-secondary hover:text-white", children: peek ? /* @__PURE__ */ jsx(EyeOff, { size: 15 }) : /* @__PURE__ */ jsx(Eye, { size: 15 }) }),
        /* @__PURE__ */ jsx("button", { type: "button", onClick: undoLast, title: "Undo (Ctrl+Z)", className: "rounded p-1 text-fg-disabled hover:bg-fg-secondary hover:text-white", children: /* @__PURE__ */ jsx(Undo2, { size: 15 }) }),
        /* @__PURE__ */ jsx("button", { type: "button", onClick: () => capturePage(false), disabled: shotBusy, title: "Viewport screenshot", className: "rounded p-1 text-fg-disabled hover:bg-fg-secondary hover:text-white disabled:opacity-40", children: /* @__PURE__ */ jsx(Camera, { size: 15, className: shotBusy ? "animate-pulse" : "" }) }),
        /* @__PURE__ */ jsx("button", { type: "button", onClick: () => capturePage(true), disabled: shotBusy, title: "Full-page screenshot", className: "rounded p-1 text-fg-disabled hover:bg-fg-secondary hover:text-white disabled:opacity-40", children: /* @__PURE__ */ jsx(Maximize2, { size: 15, className: shotBusy ? "animate-pulse" : "" }) }),
        /* @__PURE__ */ jsx("button", { type: "button", onClick: () => setHelpOpen(true), title: "Shortcuts (?)", className: "rounded p-1 text-fg-disabled hover:bg-fg-secondary hover:text-white", children: /* @__PURE__ */ jsx(Keyboard, { size: 15 }) }),
        /* @__PURE__ */ jsx("button", { type: "button", onClick: () => {
          setTool(null);
          closeDraft();
        }, title: "Close", className: "rounded p-1 text-fg-disabled hover:bg-fg-secondary hover:text-white", children: /* @__PURE__ */ jsx(X, { size: 15 }) })
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "space-y-2 p-2", children: [
        /* @__PURE__ */ jsx("div", { className: "grid grid-cols-5 gap-1", children: ANN_MODES.map((m) => {
          const Ico = MODE_ICON[m.key];
          const on = tool === m.key;
          return /* @__PURE__ */ jsxs(
            "button",
            {
              type: "button",
              title: `${m.label} (${m.kbd})`,
              onClick: () => setTool(on ? null : m.key),
              className: cn("flex flex-col items-center gap-0.5 rounded-input border py-1.5 transition", on ? "border-brand bg-brand text-white" : "border-line text-fg-muted hover:bg-row-alt"),
              children: [
                /* @__PURE__ */ jsx(Ico, { size: 15 }),
                /* @__PURE__ */ jsx("span", { className: "text-[9px] font-bold", children: m.label })
              ]
            },
            m.key
          );
        }) }),
        /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-1.5", children: [
          ANN_COLORS.map((c) => /* @__PURE__ */ jsx("button", { type: "button", onClick: () => setColor(c), style: { background: c }, title: "Colour", className: cn("h-5 w-5 rounded-full border-2 transition", color === c ? "scale-110 border-fg" : "border-line") }, c)),
          peek && /* @__PURE__ */ jsx("span", { className: "ml-auto rounded bg-warning-tint px-1.5 py-0.5 text-[10px] font-bold text-warning-text ring-1 ring-warning-hairline", children: "Peek" })
        ] }),
        tool && /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-1.5 rounded-input bg-brand-tint px-2 py-1 text-[11px] font-semibold text-brand-strong ring-1 ring-brand-hairline", children: [
          /* @__PURE__ */ jsx(Crosshair, { size: 12 }),
          " ",
          tool === "pin" ? "Hover an element & click" : "Drag to draw",
          " ",
          /* @__PURE__ */ jsx("span", { className: "ml-auto text-brand", children: "Esc" })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "flex gap-1.5", children: [
          /* @__PURE__ */ jsxs("button", { type: "button", onClick: () => setPanel(true), className: "inline-flex flex-1 items-center justify-center gap-1 rounded-input border border-line py-1.5 text-[12px] font-bold text-fg-secondary hover:bg-row-alt", children: [
            /* @__PURE__ */ jsx(ListChecks, { size: 14 }),
            " Review"
          ] }),
          /* @__PURE__ */ jsxs("button", { type: "button", onClick: () => setSendOpen(true), disabled: !openItems.length, className: "inline-flex flex-1 items-center justify-center gap-1 rounded-input bg-fg py-1.5 text-[12px] font-bold text-white hover:bg-fg-secondary disabled:opacity-40", children: [
            /* @__PURE__ */ jsx(Send, { size: 14 }),
            " Send"
          ] })
        ] })
      ] })
    ] }) }),
    draft && /* @__PURE__ */ jsxs(
      "div",
      {
        "data-annot-ui": true,
        className: "fixed z-[9999] w-[19rem] rounded-card border border-line bg-surface p-3.5 shadow-e4",
        style: { left: Math.min(draft.cx, window.innerWidth - 320), top: Math.min(Math.max(12, draft.cy + 14), window.innerHeight - 380) },
        children: [
          /* @__PURE__ */ jsxs("div", { className: "mb-2 flex items-center justify-between", children: [
            /* @__PURE__ */ jsx("span", { className: "text-sm font-bold text-fg-secondary", children: draft.kind === "shape" ? `New ${annShapeLabel(draft.shape_type)} mark` : "New annotation" }),
            /* @__PURE__ */ jsx("button", { type: "button", onClick: closeDraft, className: "text-fg-muted hover:text-fg-secondary", children: /* @__PURE__ */ jsx(X, { size: 16 }) })
          ] }),
          (draft.target_text || draft.target_selector) && /* @__PURE__ */ jsxs("p", { className: "mb-1.5 flex items-center gap-1 truncate rounded-input bg-brand-tint px-2 py-1 text-[11px] font-medium text-brand-strong", title: draft.target_selector, children: [
            /* @__PURE__ */ jsx(Target, { size: 12, className: "shrink-0" }),
            " ",
            draft.target_text ? `\u201C${draft.target_text.slice(0, 38)}\u201D` : draft.target_selector
          ] }),
          /* @__PURE__ */ jsxs("div", { className: "mb-2 flex flex-wrap gap-1 text-[10px] text-fg-muted", children: [
            draft.styles?.size && /* @__PURE__ */ jsxs("span", { className: cn(chip, "bg-sunken"), children: [
              draft.styles.size,
              "px"
            ] }),
            draft.styles?.color && /* @__PURE__ */ jsxs("span", { className: cn(chip, "bg-sunken"), children: [
              /* @__PURE__ */ jsx("span", { className: "h-2 w-2 rounded-full", style: { background: draft.styles.color } }),
              " text"
            ] }),
            draft.meta && /* @__PURE__ */ jsxs("span", { className: cn(chip, "bg-sunken"), children: [
              /* @__PURE__ */ jsx(Monitor, { size: 10 }),
              " ",
              draft.meta.browser,
              " \xB7 ",
              draft.meta.viewport
            ] }),
            !!draft.console_logs?.length && /* @__PURE__ */ jsxs("span", { className: cn(chip, "bg-danger-tint text-danger-text"), children: [
              /* @__PURE__ */ jsx(TerminalSquare, { size: 10 }),
              " ",
              draft.console_logs.length,
              " log"
            ] })
          ] }),
          /* @__PURE__ */ jsx(
            "textarea",
            {
              autoFocus: true,
              rows: 3,
              value: draft.note,
              onChange: (e) => setDraft({ ...draft, note: e.target.value }),
              onKeyDown: (e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submitDraft();
              },
              placeholder: draft.kind === "shape" ? "What about this area? (optional)" : "What should change here?",
              className: "w-full resize-none rounded-input border border-line px-3 py-2 text-sm outline-none focus:border-brand focus:ring-4 focus:ring-brand/25"
            }
          ),
          /* @__PURE__ */ jsx("div", { className: "mt-2 flex flex-wrap gap-1", children: ANN_TYPES.map((t) => /* @__PURE__ */ jsxs("button", { type: "button", onClick: () => setDraft({ ...draft, type: t.key }), className: cn("flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 transition", draft.type === t.key ? "bg-fg text-white ring-fg" : "bg-surface text-fg-muted ring-line hover:bg-row-alt"), children: [
            /* @__PURE__ */ jsx("span", { className: "h-1.5 w-1.5 rounded-full", style: { background: t.dot } }),
            t.label
          ] }, t.key)) }),
          /* @__PURE__ */ jsxs("div", { className: "mt-2 flex items-center justify-between", children: [
            /* @__PURE__ */ jsx("div", { className: "flex gap-1", children: ANN_PRIORITIES.map((pr) => /* @__PURE__ */ jsx("button", { type: "button", onClick: () => setDraft({ ...draft, priority: pr.key }), className: cn("rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 transition", draft.priority === pr.key ? pr.key === "high" ? "bg-danger text-white ring-danger" : pr.key === "med" ? "bg-warning text-white ring-warning" : "bg-fg-disabled text-white ring-fg-disabled" : "bg-surface text-fg-muted ring-line hover:bg-row-alt"), children: pr.label }, pr.key)) }),
            /* @__PURE__ */ jsxs("div", { className: "flex gap-1", children: [
              /* @__PURE__ */ jsxs("button", { type: "button", onClick: () => setDraft({ ...draft, visibility: draft.visibility === "private" ? "public" : "private" }), title: draft.visibility === "private" ? "Only you see this" : "Shared", className: cn("flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1", draft.visibility === "private" ? "bg-surface text-fg-muted ring-line" : "bg-success-tint text-success-text ring-success-hairline"), children: [
                draft.visibility === "private" ? /* @__PURE__ */ jsx(Lock, { size: 11 }) : /* @__PURE__ */ jsx(Globe, { size: 11 }),
                draft.visibility === "private" ? "Private" : "Public"
              ] }),
              draft.kind === "pin" && /* @__PURE__ */ jsxs("button", { type: "button", onClick: () => setDraft({ ...draft, shot: !draft.shot }), title: "Attach element screenshot", className: cn("flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1", draft.shot ? "bg-success-tint text-success-text ring-success-hairline" : "bg-surface text-fg-muted ring-line"), children: [
                /* @__PURE__ */ jsx(Camera, { size: 11 }),
                draft.shot ? "Shot" : "No shot"
              ] })
            ] })
          ] }),
          /* @__PURE__ */ jsxs("div", { className: "mt-3 flex items-center justify-between", children: [
            /* @__PURE__ */ jsx("span", { className: "text-[10px] text-fg-disabled", children: "\u2318/Ctrl+Enter" }),
            /* @__PURE__ */ jsxs("div", { className: "flex gap-2", children: [
              /* @__PURE__ */ jsx("button", { type: "button", onClick: closeDraft, className: "rounded-input px-3 py-1.5 text-xs font-medium text-fg-muted hover:bg-sunken", children: "Cancel" }),
              /* @__PURE__ */ jsx("button", { type: "button", onClick: submitDraft, disabled: busy || draft.kind === "pin" && !draft.note.trim(), className: "inline-flex items-center gap-1 rounded-input bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50", children: busy ? "Saving\u2026" : /* @__PURE__ */ jsxs(Fragment, { children: [
                /* @__PURE__ */ jsx(Check, { size: 13 }),
                " Save"
              ] }) })
            ] })
          ] })
        ]
      }
    ),
    active && /* @__PURE__ */ jsxs("div", { "data-annot-ui": true, className: "fixed bottom-24 right-5 z-[9999] max-h-[75vh] w-[22rem] overflow-y-auto rounded-card border border-line bg-surface p-4 shadow-e4", children: [
      /* @__PURE__ */ jsxs("div", { className: "mb-2 flex items-center justify-between", children: [
        /* @__PURE__ */ jsxs("span", { className: "flex items-center gap-2 text-sm font-bold text-fg-secondary", children: [
          /* @__PURE__ */ jsx("span", { className: "h-2.5 w-2.5 rounded-full", style: { background: active.color || annDot(active.type) } }),
          " ",
          active.kind === "shape" ? `${annShapeLabel(active.shape_type)} \xB7 ` : "",
          annTypeLabel(active.type)
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-1", children: [
          /* @__PURE__ */ jsx("button", { type: "button", onClick: () => jumpTo(active), title: "Find on page", className: "rounded p-1 text-fg-muted hover:bg-brand-tint hover:text-brand-strong", children: /* @__PURE__ */ jsx(Target, { size: 15 }) }),
          canEdit(active) && /* @__PURE__ */ jsx("button", { type: "button", onClick: () => doDelete(active.id), title: "Delete", className: "rounded p-1 text-fg-muted hover:bg-danger-tint hover:text-danger-text", children: /* @__PURE__ */ jsx(Trash2, { size: 15 }) }),
          /* @__PURE__ */ jsx("button", { type: "button", onClick: () => setActive(null), className: "rounded p-1 text-fg-muted hover:bg-sunken", children: /* @__PURE__ */ jsx(X, { size: 16 }) })
        ] })
      ] }),
      /* @__PURE__ */ jsxs("p", { className: "mb-1 truncate text-[11px] text-fg-muted", title: active.target_selector, children: [
        active.page_route,
        " \xB7 ",
        active.target_text || active.target_selector || annShapeLabel(active.shape_type)
      ] }),
      /* @__PURE__ */ jsxs("p", { className: "mb-2 flex flex-wrap items-center gap-1.5 text-[11px] text-fg-muted", children: [
        /* @__PURE__ */ jsx("span", { className: "font-semibold text-fg-secondary", children: active.created_by_name || active.created_by || "\u2014" }),
        active.created_by_role && /* @__PURE__ */ jsx("span", { className: "rounded bg-sunken px-1.5 text-[10px] font-medium text-fg-muted", children: active.created_by_role }),
        active.visibility === "private" && /* @__PURE__ */ jsx(Lock, { size: 11, className: "text-fg-muted" }),
        active.meta && /* @__PURE__ */ jsxs("span", { className: cn(chip, "bg-sunken"), children: [
          /* @__PURE__ */ jsx(Monitor, { size: 10 }),
          " ",
          active.meta.browser,
          " \xB7 ",
          active.meta.os,
          " \xB7 ",
          active.meta.viewport
        ] })
      ] }),
      canEdit(active) ? /* @__PURE__ */ jsx("textarea", { rows: 2, defaultValue: active.note, onBlur: (e) => {
        if (e.target.value !== active.note) doUpdate({ id: active.id, note: e.target.value });
      }, placeholder: "Add a note\u2026", className: "w-full resize-none rounded-input border border-line px-3 py-2 text-sm outline-none focus:border-brand" }, active.id) : /* @__PURE__ */ jsx("p", { className: "rounded-input bg-sunken px-3 py-2 text-sm text-fg-secondary", children: active.note || /* @__PURE__ */ jsx("span", { className: "italic text-fg-muted", children: "(no note)" }) }),
      canEdit(active) && /* @__PURE__ */ jsx("div", { className: "mt-2 flex flex-wrap gap-1", children: ANN_STATUSES.map((st) => /* @__PURE__ */ jsx("button", { type: "button", onClick: () => doUpdate({ id: active.id, status: st.key }), className: cn("rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 transition", active.status === st.key ? st.key === "done" ? "bg-success text-white ring-success" : st.key === "dismissed" ? "bg-fg-disabled text-white ring-fg-disabled" : st.key === "in_progress" ? "bg-warning text-white ring-warning" : "bg-brand text-white ring-brand" : "bg-surface text-fg-muted ring-line hover:bg-row-alt"), children: st.label }, st.key)) }),
      !!active.console_logs?.length && /* @__PURE__ */ jsxs("details", { className: "mt-2 rounded-input bg-fg p-2 text-[10px] text-white", children: [
        /* @__PURE__ */ jsxs("summary", { className: "cursor-pointer font-semibold text-rose-300", children: [
          "Console (",
          active.console_logs.length,
          ")"
        ] }),
        /* @__PURE__ */ jsx("div", { className: "mt-1 max-h-28 space-y-0.5 overflow-y-auto font-mono", children: active.console_logs.slice(-8).map((l, i) => /* @__PURE__ */ jsxs("div", { className: "truncate", title: l.text, children: [
          /* @__PURE__ */ jsxs("span", { className: "text-rose-400", children: [
            "[",
            l.level,
            "]"
          ] }),
          " ",
          l.text
        ] }, i)) })
      ] }),
      active.screenshot_url && /* @__PURE__ */ jsx("a", { href: active.screenshot_url, target: "_blank", rel: "noreferrer", className: "mt-2 block", children: /* @__PURE__ */ jsx("img", { src: active.screenshot_url, alt: "screenshot", className: "max-h-44 w-full rounded-input border border-line object-contain" }) }),
      (active.replies ?? []).length > 0 && /* @__PURE__ */ jsx("div", { className: "mt-2 space-y-1 border-t border-line pt-2", children: (active.replies ?? []).map((r, i) => /* @__PURE__ */ jsxs("p", { className: "flex items-start gap-1 text-xs text-fg-muted", children: [
        /* @__PURE__ */ jsx(CornerDownRight, { size: 12, className: "mt-0.5 shrink-0 text-fg-disabled" }),
        " ",
        /* @__PURE__ */ jsxs("span", { children: [
          /* @__PURE__ */ jsx("b", { className: "text-fg-muted", children: r.author || "" }),
          " ",
          r.note
        ] })
      ] }, i)) }),
      /* @__PURE__ */ jsxs("div", { className: "mt-2 flex items-center gap-2", children: [
        /* @__PURE__ */ jsx("input", { value: reply, onChange: (e) => setReply(e.target.value), placeholder: "Add a follow-up\u2026", onKeyDown: (e) => {
          if (e.key === "Enter" && reply.trim()) doAddReply(active.id, reply.trim());
        }, className: "flex-1 rounded-input border border-line px-2.5 py-1.5 text-xs outline-none focus:border-brand" }),
        /* @__PURE__ */ jsx("button", { type: "button", onClick: () => reply.trim() && doAddReply(active.id, reply.trim()), className: "rounded-input bg-sunken p-1.5 text-fg-secondary hover:bg-row-alt", children: /* @__PURE__ */ jsx(MessageSquarePlus, { size: 15 }) })
      ] })
    ] }),
    panel && /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsx("div", { "data-annot-ui": true, className: "fixed inset-0 z-[9998] bg-fg/20", onClick: () => setPanel(false) }),
      /* @__PURE__ */ jsxs("div", { "data-annot-ui": true, className: "fixed right-0 top-0 z-[9999] flex h-full w-[27rem] max-w-[94vw] flex-col border-l border-line bg-surface shadow-e4", children: [
        /* @__PURE__ */ jsxs("div", { className: "flex items-center justify-between border-b border-line px-4 py-3", children: [
          /* @__PURE__ */ jsxs("span", { className: "flex items-center gap-2 font-bold text-fg-secondary", children: [
            /* @__PURE__ */ jsx(ListChecks, { size: 18, className: "text-brand" }),
            " Annotations ",
            /* @__PURE__ */ jsx("span", { className: "rounded-full bg-sunken px-2 text-xs text-fg-muted", children: anyFilter ? `${listed.length}/${all.length}` : all.length })
          ] }),
          /* @__PURE__ */ jsx("button", { type: "button", onClick: () => setPanel(false), className: "text-fg-muted hover:text-fg-secondary", children: /* @__PURE__ */ jsx(X, { size: 18 }) })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2 border-b border-line px-3 py-2", children: [
          /* @__PURE__ */ jsxs("button", { type: "button", onClick: () => setSendOpen(true), disabled: !openItems.length, className: "inline-flex flex-1 items-center justify-center gap-1 rounded-input bg-brand px-2.5 py-2 text-xs font-semibold text-white disabled:opacity-40", children: [
            /* @__PURE__ */ jsx(Send, { size: 13 }),
            " Send to developer (",
            openItems.length,
            ")"
          ] }),
          /* @__PURE__ */ jsx("button", { type: "button", onClick: () => downloadMd(openItems), disabled: !openItems.length, title: "Download .md", className: "inline-flex items-center gap-1 rounded-input border border-line px-2.5 py-2 text-xs text-fg-muted disabled:opacity-40", children: /* @__PURE__ */ jsx(Download, { size: 13 }) }),
          /* @__PURE__ */ jsx("button", { type: "button", onClick: () => setHelpOpen(true), title: "Shortcuts", className: "inline-flex items-center gap-1 rounded-input border border-line px-2.5 py-2 text-xs text-fg-muted", children: /* @__PURE__ */ jsx(Keyboard, { size: 13 }) })
        ] }),
        isAdmin && /* @__PURE__ */ jsxs("button", { type: "button", onClick: () => toggleAccess(!enabled), disabled: accessBusy, className: cn("flex items-center gap-2 border-b border-line px-3 py-2 text-left text-[11.5px] font-semibold", enabled ? "text-success-text" : "text-fg-muted"), children: [
          /* @__PURE__ */ jsx(Settings, { size: 13 }),
          " ",
          enabled ? "Visible to ALL users (testing) \u2014 click to make ADMIN-only" : "ADMIN-only \u2014 click to enable for all users"
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "space-y-1.5 border-b border-line px-3 py-2", children: [
          /* @__PURE__ */ jsxs("div", { className: "flex flex-wrap items-center gap-1", children: [
            /* @__PURE__ */ jsx(Filter, { size: 12, className: "text-fg-muted" }),
            ["all", ...ANN_STATUSES.map((s) => s.key)].map((f) => /* @__PURE__ */ jsx("button", { type: "button", onClick: () => setFilter(f), className: cn("rounded-full px-2 py-0.5 text-[11px] font-medium", filter === f ? "bg-brand-tint text-brand-strong ring-1 ring-brand-hairline" : "text-fg-muted hover:bg-sunken"), children: f === "all" ? "All" : annStatusLabel(f) }, f))
          ] }),
          /* @__PURE__ */ jsx("div", { className: "flex flex-wrap items-center gap-1", children: ANN_TYPES.map((t) => /* @__PURE__ */ jsxs("button", { type: "button", onClick: () => setTypeFilter((v) => v === t.key ? "" : t.key), className: cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1", typeFilter === t.key ? "bg-fg text-white ring-fg" : "bg-surface text-fg-muted ring-line hover:bg-row-alt"), children: [
            /* @__PURE__ */ jsx("span", { className: "h-1.5 w-1.5 rounded-full", style: { background: t.dot } }),
            t.label
          ] }, t.key)) }),
          /* @__PURE__ */ jsxs("div", { className: "flex flex-wrap items-center gap-1", children: [
            ANN_PRIORITIES.map((pr) => /* @__PURE__ */ jsx("button", { type: "button", onClick: () => setPrioFilter((v) => v === pr.key ? "" : pr.key), className: cn("rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1", prioFilter === pr.key ? "bg-fg-secondary text-white ring-fg-secondary" : "bg-surface text-fg-muted ring-line hover:bg-row-alt"), children: pr.label }, pr.key)),
            /* @__PURE__ */ jsxs("label", { className: "ml-1 inline-flex cursor-pointer items-center gap-1 text-[11px] font-medium text-fg-muted", children: [
              /* @__PURE__ */ jsx("input", { type: "checkbox", checked: thisPageOnly, onChange: (e) => setThisPageOnly(e.target.checked), className: "h-3 w-3" }),
              " This page"
            ] }),
            seeAll && /* @__PURE__ */ jsxs("button", { type: "button", onClick: () => doClearResolved(), title: "Delete done/dismissed", className: "ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] text-danger-text hover:bg-danger-tint", children: [
              /* @__PURE__ */ jsx(Eraser, { size: 11 }),
              " Clear resolved"
            ] })
          ] }),
          /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2", children: [
            /* @__PURE__ */ jsx("input", { value: search, onChange: (e) => setSearch(e.target.value), placeholder: "Search\u2026", className: "flex-1 rounded-input border border-line px-2.5 py-1.5 text-xs outline-none focus:border-brand" }),
            seeAll && authors.length > 1 && /* @__PURE__ */ jsxs("select", { value: authorFilter, onChange: (e) => setAuthorFilter(e.target.value), className: "max-w-[9rem] rounded-input border border-line px-2 py-1.5 text-xs text-fg-muted", children: [
              /* @__PURE__ */ jsx("option", { value: "", children: "Everyone" }),
              authors.map(([id, name]) => /* @__PURE__ */ jsx("option", { value: id, children: name }, id))
            ] })
          ] })
        ] }),
        /* @__PURE__ */ jsx("div", { className: "flex-1 overflow-y-auto p-2", children: listed.length === 0 ? /* @__PURE__ */ jsx("p", { className: "p-6 text-center text-sm text-fg-muted", children: all.length ? "Nothing matches these filters." : "No annotations yet. Open the dock, pick Pin or a shape, and mark anything." }) : grouped.map(([page, items]) => /* @__PURE__ */ jsxs("div", { className: "mb-2", children: [
          /* @__PURE__ */ jsxs("p", { className: "mb-1 flex items-center gap-1 px-1 text-[10px] font-mono font-bold text-fg-muted", children: [
            /* @__PURE__ */ jsx("span", { className: cn("h-1.5 w-1.5 rounded-full", page === pathname ? "bg-success" : "bg-fg-disabled") }),
            /* @__PURE__ */ jsx("span", { className: "truncate", children: page }),
            /* @__PURE__ */ jsxs("span", { className: "text-fg-disabled", children: [
              "\xB7 ",
              items.length
            ] })
          ] }),
          items.map((a) => {
            const editing = editRow === a.id;
            return /* @__PURE__ */ jsxs("div", { onMouseEnter: () => a.page_route === pathname && a.kind !== "shape" && setHoverEl(findEl(a)), onMouseLeave: () => setHoverEl(null), className: "mb-1.5 rounded-card border border-line hover:bg-row-alt", children: [
              /* @__PURE__ */ jsxs("div", { className: "flex items-start gap-2 p-2.5", children: [
                /* @__PURE__ */ jsx("span", { className: "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-bold text-white", style: { background: a.color || annDot(a.type) }, children: a.kind === "shape" ? annShapeLabel(a.shape_type)[0] : annTypeLabel(a.type)[0] }),
                /* @__PURE__ */ jsxs("button", { type: "button", onClick: () => jumpTo(a), className: "min-w-0 flex-1 text-left", children: [
                  /* @__PURE__ */ jsx("span", { className: "block truncate text-sm font-medium text-fg-secondary", children: a.note || /* @__PURE__ */ jsxs("span", { className: "italic text-fg-muted", children: [
                    annShapeLabel(a.shape_type),
                    " mark"
                  ] }) }),
                  /* @__PURE__ */ jsxs("span", { className: "mt-0.5 flex flex-wrap items-center gap-1 text-[10.5px] text-fg-muted", children: [
                    /* @__PURE__ */ jsx("span", { className: "font-semibold text-fg-muted", children: a.created_by_name || a.created_by }),
                    a.created_by_role && /* @__PURE__ */ jsx("span", { className: "rounded bg-sunken px-1 text-fg-muted", children: a.created_by_role }),
                    /* @__PURE__ */ jsxs("span", { className: "uppercase", children: [
                      "\xB7 ",
                      a.priority
                    ] }),
                    /* @__PURE__ */ jsx("span", { className: cn("rounded px-1", a.status === "done" ? "bg-success-tint text-success-text" : a.status === "dismissed" ? "bg-sunken text-fg-muted" : a.status === "in_progress" ? "bg-warning-tint text-warning-text" : "bg-brand-tint text-brand-strong"), children: annStatusLabel(a.status) }),
                    a.visibility === "private" && /* @__PURE__ */ jsx(Lock, { size: 10 }),
                    a.screenshot_url && /* @__PURE__ */ jsx(Camera, { size: 10 }),
                    !!a.console_logs?.length && /* @__PURE__ */ jsx(TerminalSquare, { size: 10, className: "text-danger-text" }),
                    (a.replies ?? []).length > 0 && /* @__PURE__ */ jsxs("span", { children: [
                      "\u{1F4AC}",
                      (a.replies ?? []).length
                    ] })
                  ] })
                ] }),
                /* @__PURE__ */ jsxs("div", { className: "flex shrink-0 items-center gap-0.5", children: [
                  /* @__PURE__ */ jsx("button", { type: "button", onClick: () => jumpTo(a), title: "Find on page", className: "rounded p-1 text-fg-disabled hover:bg-brand-tint hover:text-brand-strong", children: /* @__PURE__ */ jsx(Target, { size: 14 }) }),
                  canEdit(a) && /* @__PURE__ */ jsx("button", { type: "button", onClick: () => setEditRow(editing ? null : a.id), title: "Edit", className: cn("rounded p-1 hover:bg-sunken", editing ? "bg-brand-tint text-brand-strong" : "text-fg-disabled hover:text-fg-secondary"), children: /* @__PURE__ */ jsx(Pencil, { size: 14 }) }),
                  canEdit(a) && a.status !== "done" && /* @__PURE__ */ jsx("button", { type: "button", onClick: () => doUpdate({ id: a.id, status: "done" }), title: "Mark done", className: "rounded p-1 text-fg-disabled hover:bg-success-tint hover:text-success-text", children: /* @__PURE__ */ jsx(Check, { size: 14 }) }),
                  canEdit(a) && /* @__PURE__ */ jsx("button", { type: "button", onClick: () => doDelete(a.id), title: "Delete", className: "rounded p-1 text-fg-disabled hover:bg-danger-tint hover:text-danger-text", children: /* @__PURE__ */ jsx(Trash, { size: 14 }) })
                ] })
              ] }),
              editing && canEdit(a) && /* @__PURE__ */ jsxs("div", { className: "space-y-2 border-t border-line p-2.5", children: [
                /* @__PURE__ */ jsx("textarea", { rows: 2, defaultValue: a.note, onBlur: (e) => {
                  if (e.target.value !== a.note) doUpdate({ id: a.id, note: e.target.value });
                }, placeholder: "Edit note\u2026", className: "w-full resize-none rounded-input border border-line px-2.5 py-1.5 text-sm outline-none focus:border-brand" }),
                /* @__PURE__ */ jsx("div", { className: "flex flex-wrap items-center gap-1", children: ANN_STATUSES.map((st) => /* @__PURE__ */ jsx("button", { type: "button", onClick: () => doUpdate({ id: a.id, status: st.key }), className: cn("rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1", a.status === st.key ? st.key === "done" ? "bg-success text-white ring-success" : st.key === "dismissed" ? "bg-fg-disabled text-white ring-fg-disabled" : st.key === "in_progress" ? "bg-warning text-white ring-warning" : "bg-brand text-white ring-brand" : "bg-surface text-fg-muted ring-line"), children: st.label }, st.key)) }),
                /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-1.5", children: [
                  /* @__PURE__ */ jsx("select", { value: a.type, onChange: (e) => doUpdate({ id: a.id, type: e.target.value }), className: "flex-1 rounded-input border border-line px-2 py-1 text-[11px]", children: ANN_TYPES.map((t) => /* @__PURE__ */ jsx("option", { value: t.key, children: t.label }, t.key)) }),
                  /* @__PURE__ */ jsx("select", { value: a.priority, onChange: (e) => doUpdate({ id: a.id, priority: e.target.value }), className: "flex-1 rounded-input border border-line px-2 py-1 text-[11px]", children: ANN_PRIORITIES.map((pr) => /* @__PURE__ */ jsx("option", { value: pr.key, children: pr.label }, pr.key)) }),
                  /* @__PURE__ */ jsx("button", { type: "button", onClick: () => setEditRow(null), className: "rounded-input bg-fg px-2.5 py-1 text-[11px] font-semibold text-white", children: "Done" })
                ] })
              ] })
            ] }, a.id);
          })
        ] }, page)) })
      ] })
    ] }),
    sendOpen && /* @__PURE__ */ jsx("div", { "data-annot-ui": true, className: "fixed inset-0 z-[10000] grid place-items-center bg-fg/50 p-4", onClick: () => setSendOpen(false), children: /* @__PURE__ */ jsxs("div", { className: "flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-modal bg-surface shadow-e4", onClick: (e) => e.stopPropagation(), children: [
      /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2 border-b border-line px-4 py-3", children: [
        /* @__PURE__ */ jsx(Send, { size: 16, className: "text-fg" }),
        /* @__PURE__ */ jsxs("span", { className: "flex-1 text-sm font-bold text-fg", children: [
          "Send to developer \u2014 ",
          openItems.length,
          " open item(s)"
        ] }),
        /* @__PURE__ */ jsx("button", { type: "button", onClick: () => setSendOpen(false), className: "text-fg-muted hover:text-fg", children: /* @__PURE__ */ jsx(X, { size: 18 }) })
      ] }),
      /* @__PURE__ */ jsx("p", { className: "px-4 pt-3 text-[12px] text-fg-muted", children: "This exact markdown reaches your developer \u2014 each mark's element, note, environment, and console are included. Copy, then paste in the chat." }),
      /* @__PURE__ */ jsx("pre", { className: "m-4 flex-1 overflow-auto whitespace-pre-wrap rounded-input bg-fg p-3 font-mono text-[11.5px] leading-relaxed text-white", children: buildClaudePrompt(openItems) || "(no open marks)" }),
      /* @__PURE__ */ jsxs("div", { className: "flex items-center justify-end gap-2 border-t border-line p-3", children: [
        /* @__PURE__ */ jsxs("button", { type: "button", onClick: () => downloadMd(openItems), className: "inline-flex items-center gap-1.5 rounded-input border border-line-strong px-4 py-2 text-[12.5px] font-bold text-fg-secondary hover:bg-sunken", children: [
          /* @__PURE__ */ jsx(Download, { size: 15 }),
          " Download .md"
        ] }),
        /* @__PURE__ */ jsxs("button", { type: "button", onClick: () => {
          copyPrompt(openItems);
          setSendOpen(false);
        }, className: "inline-flex items-center gap-1.5 rounded-input bg-fg px-4 py-2 text-[12.5px] font-bold text-white hover:bg-fg-secondary", children: [
          /* @__PURE__ */ jsx(Copy, { size: 15 }),
          " Copy \u2014 paste to developer"
        ] })
      ] })
    ] }) }),
    helpOpen && /* @__PURE__ */ jsx("div", { "data-annot-ui": true, className: "fixed inset-0 z-[10000] grid place-items-center bg-fg/50 p-4", onClick: () => setHelpOpen(false), children: /* @__PURE__ */ jsxs("div", { className: "w-full max-w-sm rounded-modal bg-surface p-4 shadow-e4", onClick: (e) => e.stopPropagation(), children: [
      /* @__PURE__ */ jsxs("div", { className: "mb-2 flex items-center gap-2", children: [
        /* @__PURE__ */ jsx(Keyboard, { size: 16, className: "text-brand" }),
        /* @__PURE__ */ jsx("span", { className: "flex-1 text-sm font-bold text-fg-secondary", children: "Shortcuts" }),
        /* @__PURE__ */ jsx("button", { type: "button", onClick: () => setHelpOpen(false), className: "text-fg-muted hover:text-fg-secondary", children: /* @__PURE__ */ jsx(X, { size: 16 }) })
      ] }),
      /* @__PURE__ */ jsx("div", { className: "grid grid-cols-2 gap-y-1.5 text-[12px] text-fg-muted", children: [["Shift+A", "Pin tool"], ["P / B / A / C / D", "Pin \xB7 Box \xB7 Arrow \xB7 Circle \xB7 Draw"], ["Esc", "Cancel / exit"], ["\u2318/Ctrl+Enter", "Save note"], ["Ctrl+Z", "Undo last mark"], ["Shift+H", "Hide / show marks"], ["?", "This help"]].map(([k, v]) => /* @__PURE__ */ jsxs("div", { className: "contents", children: [
        /* @__PURE__ */ jsx("kbd", { className: "w-fit rounded bg-sunken px-1.5 py-0.5 font-mono text-[11px] font-semibold text-fg-secondary", children: k }),
        /* @__PURE__ */ jsx("span", { children: v })
      ] }, k)) })
    ] }) }),
    toasts.length > 0 && /* @__PURE__ */ jsx("div", { "data-annot-ui": true, className: "fixed bottom-6 left-1/2 z-[10001] flex -translate-x-1/2 flex-col items-center gap-2", children: toasts.map((t) => /* @__PURE__ */ jsx("div", { className: cn("rounded-input px-3 py-2 text-xs font-semibold shadow-e4 ring-1", t.kind === "success" ? "bg-success-tint text-success-text ring-success-hairline" : "bg-danger-tint text-danger-text ring-danger-hairline"), children: t.msg }, t.id)) })
  ] });
}
export {
  ANN_COLORS,
  ANN_MODES,
  ANN_PRIORITIES,
  ANN_STATUSES,
  ANN_TYPES,
  Annotate,
  OPEN_STATUSES,
  annDot,
  annShapeLabel,
  annStatusLabel,
  annTypeLabel,
  buildClaudePrompt
};
