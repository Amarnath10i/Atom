import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import {
  BANDS,
  RELATION_LABEL,
  bandFor,
  effectiveStrength,
  examPriorities,
  isFading,
  learnedPreferences,
  recall,
} from "@/lib/memory-map";
import { topicWeightage } from "@/lib/exam-weightage";

/**
 * Student-centred memory map.
 *
 *  - The student sits at the centre.
 *  - Each subject owns a sector; a soft boundary is drawn around its topics.
 *  - "Gravity": the stronger a topic, the closer it sits to the student.
 *    Faint rings mark the Mastered / Developing / Needs-work bands.
 *  - Bonds between topics are drawn as curves coloured by relation, and cross
 *    subject boundaries when topics from different subjects connect.
 *  - Node size = how often the topic has been reviewed.
 *  - Mastery decays with time since review (forgetting curve), so topics that
 *    aren't revisited drift outward; fading ones get a dashed outline.
 *  - Gold rotating ring = highest-yield gap (exam weightage × gap).
 *  - Red satellites = active misconceptions on that topic.
 */

type Atom = {
  id: string;
  subject: string;
  topic: string;
  strength: number;
  reviews: number;
  summary?: string | null;
  state?: string | null;
  last_reviewed?: string | null;
  sm2_next_review_date?: string | null;
  sm2_interval?: number | null;
  exam_unit?: string | null;
};
type Bond = { id?: string; source_atom: string; target_atom: string; relation?: string | null; weight?: number | null };
type Weak = { subject: string; topic: string; severity: number };
type Pattern = { pattern_type: string; description?: string | null; confidence: number };
type Misconception = { subject: string; topic: string; pattern: string; description?: string | null; occurrences?: number | null };

const SUBJECT_COLOR: Record<string, string> = {
  physics: "#4cc9f0", chemistry: "#b388ff", maths: "#f4a261", biology: "#57d9a3",
};
const FALLBACK_COLORS = ["#ff6b9d", "#ffd166", "#9aa4b2", "#06d6a0"];
const RELATION_COLOR: Record<string, string> = {
  prerequisite: "#f4a261", application: "#4cc9f0", analogy: "#c77dff",
};
const STATE_COLOR: Record<string, string> = {
  stuck: "#ef476f", completed: "#57d9a3", planned: "#8b95a5", stale: "#5c6573", active: "#e7ecf3",
};
const CENTER_R = 36;
const NEAR = 140; // radius for strength 1.0
const FAR = 380;  // radius for strength 0.0
const radiusFor = (s: number) => NEAR + (1 - s) * (FAR - NEAR);

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export function MemoryGraph({
  atoms: rawAtoms,
  bonds,
  studentName = "You",
  weakTopics = [],
  patterns = [],
  misconceptions = [],
  exam = "JEE",
  memoryStability = 1,
  className,
}: {
  atoms: Atom[];
  bonds: Bond[];
  studentName?: string;
  weakTopics?: Weak[];
  patterns?: Pattern[];
  misconceptions?: Misconception[];
  exam?: string;
  /** The student's learned forgetting speed (students.memory_stability). */
  memoryStability?: number;
  className?: string;
}) {
  const atoms = useMemo(
    () => rawAtoms.map((a) => ({ ...a, stability_mul: memoryStability })),
    [rawAtoms, memoryStability],
  );
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const subjects = useMemo(() => {
    const counts = new Map<string, number>();
    atoms.forEach((a) => {
      const s = (a.subject || "general").toLowerCase();
      counts.set(s, (counts.get(s) ?? 0) + 1);
    });
    const order = ["physics", "chemistry", "maths", "biology"];
    return [...counts.keys()].sort((a, b) => {
      const ia = order.indexOf(a), ib = order.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
    });
  }, [atoms]);
  const colorFor = useMemo(() => {
    const extra = new Map<string, string>();
    return (s: string) => {
      const k = s.toLowerCase();
      if (SUBJECT_COLOR[k]) return SUBJECT_COLOR[k];
      if (!extra.has(k)) extra.set(k, FALLBACK_COLORS[extra.size % FALLBACK_COLORS.length]);
      return extra.get(k)!;
    };
  }, []);

  const learnerPrefs = useMemo(
    () => learnedPreferences(patterns).map((p) => ({ type: p.key, label: p.label, instruction: p.instruction, confidence: p.confidence })),
    [patterns],
  );

  const misByTopic = useMemo(() => {
    const m = new Map<string, Misconception[]>();
    misconceptions.forEach((x) => {
      const k = norm(x.topic);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(x);
    });
    return m;
  }, [misconceptions]);

  const highYieldIds = useMemo(
    () =>
      new Set(
        examPriorities(atoms, (a) => topicWeightage(exam, titleCase(a.subject), a.exam_unit))
          .filter((p) => effectiveStrength(p.atom) < 0.7)
          .slice(0, 3)
          .map((p) => p.atom.id),
      ),
    [atoms, exam],
  );

  const weakSet = useMemo(
    () => new Set(weakTopics.filter((w) => w.severity >= 0.5).map((w) => norm(w.topic))),
    [weakTopics],
  );

  useEffect(() => {
    const svgEl = svgRef.current;
    const wrap = wrapRef.current;
    if (!svgEl || !wrap) return;

    const svg = d3.select(svgEl);
    svg.selectAll("*").remove();

    const defs = svg.append("defs");
    Object.entries(RELATION_COLOR).forEach(([rel, color]) => {
      defs.append("marker")
        .attr("id", `mg-arrow-${rel}`).attr("viewBox", "0 -4 8 8")
        .attr("refX", 8).attr("refY", 0).attr("markerWidth", 7).attr("markerHeight", 7)
        .attr("orient", "auto")
        .append("path").attr("d", "M0,-4L8,0L0,4").attr("fill", color);
    });
    const glow = defs.append("radialGradient").attr("id", "mg-center-glow");
    glow.append("stop").attr("offset", "0%").attr("stop-color", "#f4c542").attr("stop-opacity", 0.35);
    glow.append("stop").attr("offset", "100%").attr("stop-color", "#f4c542").attr("stop-opacity", 0);

    const root = svg.append("g");
    const gBands = root.append("g");
    const gHulls = root.append("g");
    const gGravity = root.append("g");
    const gBonds = root.append("g");
    const gNodes = root.append("g");
    const gLabels = root.append("g");
    const gSubjectLabels = root.append("g");
    const gCenter = root.append("g");

    // ── Data ────────────────────────────────────────────────────────────────
    type N = Atom & {
      key: string; x: number; y: number; r: number; tx: number; ty: number;
      targetR: number; weak: boolean; eff: number; fading: boolean; highYield: boolean; mis: number;
      fx?: number | null; fy?: number | null;
    };
    const nodes: N[] = atoms.map((a) => {
      const strength = typeof a.strength === "number" ? Math.max(0, Math.min(1, a.strength)) : 0.5;
      const reviews = a.reviews ?? 0;
      return {
        ...a,
        strength,
        reviews,
        key: (a.subject || "general").toLowerCase(),
        x: 0, y: 0, tx: 0, ty: 0,
        r: 8 + Math.min(10, Math.sqrt(reviews) * 2.4),
        eff: effectiveStrength({ ...a, strength }),
        targetR: radiusFor(effectiveStrength({ ...a, strength })),
        fading: isFading({ ...a, strength }),
        highYield: highYieldIds.has(a.id),
        mis: misByTopic.get(norm(a.topic))?.length ?? 0,
        weak: weakSet.has(norm(a.topic)) || a.state === "stuck",
      };
    });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const links = bonds
      .filter((b) => byId.has(b.source_atom) && byId.has(b.target_atom) && b.source_atom !== b.target_atom)
      .map((b, i) => ({
        id: b.id ?? `b${i}`,
        source: byId.get(b.source_atom)!,
        target: byId.get(b.target_atom)!,
        relation: b.relation && RELATION_COLOR[b.relation] ? b.relation : "application",
        weight: typeof b.weight === "number" ? b.weight : 0.5,
      }));
    type L = (typeof links)[number];
    const neighbours = new Map<string, Set<string>>(nodes.map((n) => [n.id, new Set()]));
    links.forEach((l) => {
      neighbours.get(l.source.id)!.add(l.target.id);
      neighbours.get(l.target.id)!.add(l.source.id);
    });

    // ── Sectors: each subject gets an arc proportional to its topic count ───
    const GAP = subjects.length > 1 ? 0.18 : 0;
    const weights = subjects.map((s) => Math.max(2, nodes.filter((n) => n.key === s).length));
    const total = weights.reduce((a, b) => a + b, 0);
    const avail = Math.PI * 2 - GAP * subjects.length;
    const sector = new Map<string, { start: number; end: number; mid: number }>();
    let cursor = -Math.PI / 2;
    subjects.forEach((s, i) => {
      const span = (weights[i] / total) * avail;
      sector.set(s, { start: cursor + GAP / 2, end: cursor + GAP / 2 + span, mid: cursor + GAP / 2 + span / 2 });
      cursor += span + GAP;
    });
    subjects.forEach((s) => {
      const members = nodes.filter((n) => n.key === s).sort((a, b) => b.strength - a.strength);
      const sec = sector.get(s)!;
      members.forEach((n, i) => {
        // Spread across the sector, alternating so neighbours differ in radius.
        const t = members.length === 1 ? 0.5 : (i + 0.5) / members.length;
        const ang = sec.start + (sec.end - sec.start) * (i % 2 ? 1 - t : t);
        n.tx = Math.cos(ang) * n.targetR;
        n.ty = Math.sin(ang) * n.targetR;
        n.x = n.tx; n.y = n.ty;
      });
    });

    // ── Mastery bands (concentric "gravity" rings) ──────────────────────────
    const bandEdges = [
      { r: radiusFor(BANDS[0].min), label: BANDS[0].label },
      { r: radiusFor(BANDS[1].min), label: BANDS[1].label },
      { r: FAR + 30, label: BANDS[2].label },
    ];
    gBands.selectAll("circle").data(bandEdges).join("circle")
      .attr("r", (d) => d.r).attr("fill", "none")
      .attr("stroke", "#2a3340").attr("stroke-dasharray", "2 6").attr("stroke-width", 1);
    gBands.selectAll("text").data(bandEdges).join("text")
      .attr("x", 0).attr("y", (d) => -d.r + 14)
      .attr("text-anchor", "middle").attr("font-size", 10).attr("fill", "#5c6573")
      .attr("letter-spacing", "0.08em")
      .text((d) => d.label.toUpperCase());

    // ── Subject boundaries ──────────────────────────────────────────────────
    const hullLine = d3.line().curve(d3.curveCatmullRomClosed.alpha(0.6));
    const hullSel = gHulls.selectAll<SVGPathElement, string>("path").data(subjects).join("path")
      .attr("fill", (s) => colorFor(s)).attr("fill-opacity", 0.07)
      .attr("stroke", (s) => colorFor(s)).attr("stroke-opacity", 0.45)
      .attr("stroke-width", 1.5).attr("stroke-dasharray", "6 4");
    const subjectStats = new Map(subjects.map((s) => {
      const m = nodes.filter((n) => n.key === s);
      const avg = m.reduce((a, n) => a + n.strength, 0) / (m.length || 1);
      return [s, { count: m.length, avg }];
    }));
    const subjectLabelSel = gSubjectLabels.selectAll<SVGGElement, string>("g").data(subjects).join((enter) => {
      const g = enter.append("g").attr("pointer-events", "none");
      g.append("text").attr("class", "name").attr("text-anchor", "middle")
        .attr("font-size", 14).attr("font-weight", 700);
      g.append("text").attr("class", "meta").attr("text-anchor", "middle").attr("dy", 15)
        .attr("font-size", 10).attr("fill", "#8b95a5");
      return g;
    });
    subjectLabelSel.select("text.name").attr("fill", (s) => colorFor(s)).text((s) => titleCase(s));
    subjectLabelSel.select("text.meta").text((s) => {
      const st = subjectStats.get(s)!;
      return `${st.count} topic${st.count === 1 ? "" : "s"} · ${Math.round(st.avg * 100)}% mastery`;
    });

    // ── Gravity lines: student → topic, thicker for stronger topics ────────
    const gravitySel = gGravity.selectAll<SVGLineElement, N>("line").data(nodes).join("line")
      .attr("stroke", (d) => colorFor(d.key))
      .attr("stroke-opacity", (d) => 0.06 + d.eff * 0.22)
      .attr("stroke-width", (d) => 0.5 + d.eff * 2);

    // ── Bonds ───────────────────────────────────────────────────────────────
    const bondSel = gBonds.selectAll<SVGPathElement, L>("path").data(links).join("path")
      .attr("fill", "none")
      .attr("stroke", (d) => RELATION_COLOR[d.relation])
      .attr("stroke-opacity", (d) => 0.35 + d.weight * 0.45)
      .attr("stroke-width", (d) => 1 + d.weight * 2.2)
      .attr("stroke-dasharray", (d) => (d.relation === "analogy" ? "5 4" : null))
      .attr("marker-end", (d) => (d.relation === "prerequisite" ? `url(#mg-arrow-prerequisite)` : null));

    // ── Nodes ───────────────────────────────────────────────────────────────
    const tooltip = d3.select(wrap).select<HTMLDivElement>(".mg-tooltip");
    const nodeSel = gNodes.selectAll<SVGGElement, N>("g.node").data(nodes, (d) => d.id)
      .join((enter) => {
        const g = enter.append("g").attr("class", "node").style("cursor", "pointer");
        g.append("circle").attr("class", "halo");
        g.append("circle").attr("class", "pulse");
        g.append("circle").attr("class", "body");
        g.append("g").attr("class", "sats");
        return g;
      });
    nodeSel.select<SVGCircleElement>("circle.halo")
      .attr("r", (d) => d.r + 11).attr("fill", "none")
      .attr("stroke", "#f4c542").attr("stroke-width", 1.6).attr("stroke-dasharray", "3 4")
      .attr("class", (d) => (d.highYield ? "halo mg-spin" : "halo"))
      .attr("opacity", (d) => (d.highYield ? 0.95 : 0));
    // Misconception satellites: one small red dot per active wrong belief.
    nodeSel.select<SVGGElement>("g.sats").each(function (d) {
      const g = d3.select(this);
      g.selectAll("circle").data(d3.range(Math.min(d.mis, 4))).join("circle")
        .attr("r", 3.2).attr("fill", "#ef476f").attr("stroke", "#0b0d10").attr("stroke-width", 1)
        .attr("cx", (i) => Math.cos(-Math.PI / 4 + i * 0.7) * (d.r + 5))
        .attr("cy", (i) => Math.sin(-Math.PI / 4 + i * 0.7) * (d.r + 5));
    });
    nodeSel.select<SVGCircleElement>("circle.pulse")
      .attr("r", (d) => d.r + 6).attr("fill", "none")
      .attr("stroke", "#ef476f").attr("stroke-width", 2)
      .attr("class", (d) => (d.weak ? "pulse mg-pulse" : "pulse"))
      .attr("opacity", (d) => (d.weak ? 1 : 0));
    nodeSel.select<SVGCircleElement>("circle.body")
      .attr("r", (d) => d.r)
      .attr("fill", (d) => colorFor(d.key))
      .attr("fill-opacity", (d) => 0.3 + d.eff * 0.65)
      .attr("stroke", (d) => STATE_COLOR[d.state ?? "active"] ?? STATE_COLOR.active)
      .attr("stroke-width", (d) => (d.fading || (d.state && d.state !== "active") ? 2 : 1.2))
      .attr("stroke-dasharray", (d) => (d.fading ? "2 2" : null))
      .attr("stroke-opacity", 0.9);

    const labelSel = gLabels.selectAll<SVGTextElement, N>("text").data(nodes, (d) => d.id).join("text")
      .attr("pointer-events", "none").attr("font-size", 11).attr("fill", "#c9d1dc")
      .attr("paint-order", "stroke").attr("stroke", "#0b0d10").attr("stroke-width", 3)
      .text((d) => (d.topic.length > 26 ? d.topic.slice(0, 25) + "…" : titleCase(d.topic)));

    // ── Student at the centre ───────────────────────────────────────────────
    gCenter.append("circle").attr("r", CENTER_R * 2.6).attr("fill", "url(#mg-center-glow)");
    gCenter.append("circle").attr("r", CENTER_R)
      .attr("fill", "#f4c542").attr("stroke", "#fff3c4").attr("stroke-width", 2);
    const initials = studentName.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("");
    gCenter.append("text").attr("text-anchor", "middle").attr("dominant-baseline", "central")
      .attr("font-size", 18).attr("font-weight", 800).attr("fill", "#0b0d10").text(initials || "•");
    gCenter.append("text").attr("text-anchor", "middle").attr("y", CENTER_R + 18)
      .attr("font-size", 13).attr("font-weight", 700).attr("fill", "#f4f1e6")
      .attr("paint-order", "stroke").attr("stroke", "#0b0d10").attr("stroke-width", 4)
      .text(studentName);

    // ── Interaction: highlight neighbourhood on hover, select on click ─────
    const highlight = (id: string | null) => {
      const near = id ? new Set([id, ...(neighbours.get(id) ?? [])]) : null;
      nodeSel.attr("opacity", (d) => (!near || near.has(d.id) ? 1 : 0.18));
      labelSel.attr("opacity", (d) => (!near || near.has(d.id) ? 1 : 0.15));
      gravitySel.attr("opacity", (d) => (!near || d.id === id ? 1 : 0.2));
      bondSel.attr("opacity", (d) => (!near || d.source.id === id || d.target.id === id ? 1 : 0.08));
    };
    nodeSel
      .on("mouseenter", (_, d) => highlight(d.id))
      .on("mousemove", (e: MouseEvent, d) => {
        const rect = wrap.getBoundingClientRect();
        tooltip.style("display", "block")
          .style("left", `${e.clientX - rect.left + 14}px`)
          .style("top", `${e.clientY - rect.top + 14}px`)
          .html(`<b>${titleCase(d.topic)}</b><div class="meta">${titleCase(d.key)} · ${Math.round(d.eff * 100)}% · ${
            BANDS.find((b) => b.band === bandFor(d.eff))!.label
          }${d.fading ? " · fading" : ""}${d.highYield ? " · high-yield gap" : ""}${d.mis ? ` · ${d.mis} misconception${d.mis > 1 ? "s" : ""}` : ""}</div>`);
      })
      .on("mouseleave", () => { tooltip.style("display", "none"); highlight(null); })
      .on("click", (e: MouseEvent, d) => { e.stopPropagation(); setSelectedId(d.id); });
    svg.on("click", () => setSelectedId(null));

    // ── Simulation ──────────────────────────────────────────────────────────
    const sim = d3.forceSimulation<N>(nodes)
      .force("x", d3.forceX<N>((d) => d.tx).strength(0.12))
      .force("y", d3.forceY<N>((d) => d.ty).strength(0.12))
      .force("radial", d3.forceRadial<N>((d) => d.targetR, 0, 0).strength(0.6))
      .force("collide", d3.forceCollide<N>().radius((d) => d.r + 16).strength(0.9))
      .force("bond", d3.forceLink<N, L>(links).id((d) => d.id).distance(90).strength((l) => 0.03 + l.weight * 0.05))
      .alpha(1).alphaDecay(0.035);

    const bondPath = (d: L) => {
      const sx = d.source.x, sy = d.source.y, tx = d.target.x, ty = d.target.y;
      const dx = tx - sx, dy = ty - sy;
      const len = Math.hypot(dx, dy) || 1;
      // Bow the curve slightly outward so links don't run through the centre.
      const mx = (sx + tx) / 2, my = (sy + ty) / 2;
      const bow = Math.min(60, len * 0.22);
      const outward = Math.sign(mx * -dy + my * dx) || 1;
      const cx = mx + (-dy / len) * bow * outward;
      const cy = my + (dx / len) * bow * outward;
      // End the arrow at the target's edge.
      const ex = tx - ((tx - cx) / Math.hypot(tx - cx, ty - cy)) * (d.target.r + 4);
      const ey = ty - ((ty - cy) / Math.hypot(tx - cx, ty - cy)) * (d.target.r + 4);
      return `M${sx},${sy} Q${cx},${cy} ${ex},${ey}`;
    };

    const hullPoints = (s: string): [number, number][] => {
      const pts: [number, number][] = [];
      nodes.filter((n) => n.key === s).forEach((n) => {
        const pad = n.r + 38;
        for (let k = 0; k < 10; k++) {
          const a = (k / 10) * Math.PI * 2;
          pts.push([n.x + Math.cos(a) * pad, n.y + Math.sin(a) * pad]);
        }
      });
      return pts;
    };

    sim.on("tick", () => {
      gravitySel
        .attr("x1", 0).attr("y1", 0)
        .attr("x2", (d) => d.x).attr("y2", (d) => d.y);
      bondSel.attr("d", bondPath);
      nodeSel.attr("transform", (d) => `translate(${d.x},${d.y})`);
      labelSel
        .attr("x", (d) => d.x + (d.x >= 0 ? d.r + 6 : -(d.r + 6)))
        .attr("y", (d) => d.y + 4)
        .attr("text-anchor", (d) => (d.x >= 0 ? "start" : "end"));
      hullSel.attr("d", (s) => {
        const hull = d3.polygonHull(hullPoints(s));
        return hull ? hullLine(hull) : null;
      });
      subjectLabelSel.attr("transform", (s) => {
        const sec = sector.get(s)!;
        const outer = Math.max(...nodes.filter((n) => n.key === s).map((n) => Math.hypot(n.x, n.y) + n.r), NEAR);
        const rr = Math.max(outer + 72, FAR + 40);
        return `translate(${Math.cos(sec.mid) * rr},${Math.sin(sec.mid) * rr})`;
      });
    });

    nodeSel.call(
      d3.drag<SVGGElement, N>()
        .on("start", (e, d) => { if (!e.active) sim.alphaTarget(0.25).restart(); d.fx = d.x; d.fy = d.y; })
        .on("drag", (e, d) => { d.fx = e.x; d.fy = e.y; })
        .on("end", (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null; }),
    );

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 4])
      .on("zoom", (e) => root.attr("transform", e.transform.toString()));
    svg.call(zoom).on("dblclick.zoom", null);

    // Fit the view to where the topics actually are (plus room for labels),
    // keeping the student at the centre.
    const fit = () => {
      const w = wrap.clientWidth || 600;
      const h = wrap.clientHeight || 420;
      const reachX = Math.max(NEAR, ...nodes.map((n) => Math.abs(n.x) + n.r + 150));
      const reachY = Math.max(NEAR, ...nodes.map((n) => Math.abs(n.y) + n.r + 70));
      const k = Math.min(w / (reachX * 2), h / (reachY * 2));
      svg.call(zoom.transform, d3.zoomIdentity.translate(w / 2, h / 2).scale(Math.max(0.3, Math.min(1.4, k))));
    };
    fit();
    sim.on("end", fit);
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);

    return () => { ro.disconnect(); sim.stop(); };
  }, [atoms, bonds, subjects, colorFor, weakSet, studentName, misByTopic, highYieldIds]);

  // ── Detail panel ─────────────────────────────────────────────────────────
  const selected = atoms.find((a) => a.id === selectedId) ?? null;
  const sel = selected
    ? (() => {
        const eff = effectiveStrength(selected);
        const subject = titleCase(selected.subject);
        return {
          eff,
          recall: recall(selected),
          unit: selected.exam_unit ?? null,
          weight: topicWeightage(exam, subject, selected.exam_unit),
          highYield: highYieldIds.has(selected.id),
          misconceptions: misByTopic.get(norm(selected.topic)) ?? [],
        };
      })()
    : null;
  const connections = useMemo(() => {
    if (!selected) return [];
    const byId = new Map(atoms.map((a) => [a.id, a]));
    return bonds.flatMap((b) => {
      if (b.source_atom === selected.id && byId.has(b.target_atom)) {
        return [{ other: byId.get(b.target_atom)!, text: RELATION_LABEL[b.relation ?? ""] ?? "relates to", relation: b.relation ?? "" }];
      }
      if (b.target_atom === selected.id && byId.has(b.source_atom)) {
        const rev: Record<string, string> = { prerequisite: "is needed for", application: "is applied in", analogy: "is like" };
        return [{ other: byId.get(b.source_atom)!, text: rev[b.relation ?? ""] ?? "relates to", relation: b.relation ?? "" }];
      }
      return [];
    });
  }, [selected, atoms, bonds]);

  const fmtDate = (s?: string | null) =>
    s ? new Date(s).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "—";

  return (
    <div
      className={`flex flex-col overflow-hidden rounded-xl border border-border ${className ?? "h-[560px]"}`}
      style={{ background: "#0b0d10" }}
    >
      <div ref={wrapRef} className="relative min-h-0 flex-1">
        <svg ref={svgRef} style={{ width: "100%", height: "100%", display: "block", cursor: "grab" }} />

        <div
          className="mg-tooltip"
          style={{
            position: "absolute", pointerEvents: "none", display: "none",
            background: "rgba(18,22,28,.96)", border: "1px solid #1f2630", borderRadius: 8,
            padding: "8px 10px", fontSize: 12, color: "#e7ecf3", maxWidth: 260, zIndex: 10,
          }}
        />

        {/* Selected topic */}
        {selected ? (
          <div
            className="absolute right-3 top-3 w-72 max-w-[calc(100%-1.5rem)] rounded-xl p-4 text-sm"
            style={{ background: "rgba(18,22,28,.97)", border: "1px solid #1f2630", color: "#e7ecf3" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-xs uppercase tracking-wide" style={{ color: colorFor(selected.subject) }}>
                  {titleCase(selected.subject)}
                </div>
                <div className="text-base font-semibold">{titleCase(selected.topic)}</div>
              </div>
              <button onClick={() => setSelectedId(null)} className="text-xs opacity-60 hover:opacity-100" aria-label="Close">✕</button>
            </div>
            <div className="mt-3">
              <div className="mb-1 flex justify-between text-xs" style={{ color: "#aab4c3" }}>
                <span>{BANDS.find((b) => b.band === bandFor(sel!.eff))!.label}</span>
                <span>{Math.round(sel!.eff * 100)}%</span>
              </div>
              <div className="h-1.5 w-full rounded-full" style={{ background: "#1f2630" }}>
                <div className="h-1.5 rounded-full" style={{ width: `${Math.round(sel!.eff * 100)}%`, background: colorFor(selected.subject) }} />
              </div>
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
              <div><dt style={{ color: "#8b95a5" }}>Reviews</dt><dd className="font-semibold">{selected.reviews ?? 0}</dd></div>
              <div><dt style={{ color: "#8b95a5" }}>Last seen</dt><dd className="font-semibold">{fmtDate(selected.last_reviewed)}</dd></div>
              <div><dt style={{ color: "#8b95a5" }}>Next review</dt><dd className="font-semibold">{fmtDate(selected.sm2_next_review_date)}</dd></div>
            </dl>
            {selected.state && selected.state !== "active" ? (
              <div className="mt-2 text-xs" style={{ color: STATE_COLOR[selected.state] ?? "#aab4c3" }}>State: {selected.state}</div>
            ) : null}
            <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
              <div>
                <dt style={{ color: "#8b95a5" }}>Recall now</dt>
                <dd className="font-semibold" style={{ color: sel!.recall < 0.5 ? "#f4a261" : undefined }}>
                  ~{Math.round(sel!.recall * 100)}%{sel!.recall < 0.5 ? " · fading" : ""}
                </dd>
              </div>
              <div>
                <dt style={{ color: "#8b95a5" }}>{exam} weight</dt>
                <dd className="font-semibold">{sel!.unit ? `${sel!.unit} · ~${sel!.weight}%` : "—"}</dd>
              </div>
            </dl>
            {sel!.highYield ? (
              <div className="mt-2 rounded-md px-2 py-1 text-xs" style={{ background: "rgba(244,197,66,.12)", color: "#f4e3a8" }}>
                High-yield gap: worth many marks and not solid yet
              </div>
            ) : null}
            {selected.summary ? <p className="mt-3 text-xs leading-relaxed" style={{ color: "#c9d1dc" }}>{selected.summary}</p> : null}
            {sel!.misconceptions.length ? (
              <div className="mt-3">
                <div className="mb-1 text-xs font-semibold" style={{ color: "#ef476f" }}>Misconceptions to fix</div>
                <ul className="space-y-1 text-xs" style={{ color: "#c9d1dc" }}>
                  {sel!.misconceptions.map((m, i) => (
                    <li key={i}>
                      <span className="font-medium">{m.pattern}</span>
                      {m.description ? <span style={{ color: "#8b95a5" }}> — {m.description}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="mt-3">
              <div className="mb-1 text-xs font-semibold" style={{ color: "#aab4c3" }}>Connections</div>
              {connections.length ? (
                <ul className="space-y-1 text-xs">
                  {connections.map((c, i) => (
                    <li key={i}>
                      <span style={{ color: RELATION_COLOR[c.relation] ?? "#aab4c3" }}>{c.text}</span>{" "}
                      <button className="underline decoration-dotted hover:opacity-80" onClick={() => setSelectedId(c.other.id)}>
                        {titleCase(c.other.topic)}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-xs" style={{ color: "#8b95a5" }}>No links yet — they form as you study related topics.</div>
              )}
            </div>
          </div>
        ) : null}

        <div className="pointer-events-none absolute bottom-2 left-3 text-[10px]" style={{ color: "#5c6573" }}>
          click a topic for details · drag to rearrange · scroll to zoom
        </div>
      </div>

      {/* Legend + how this student learns, below the canvas so nothing covers topics */}
      <div
        className="flex flex-wrap items-start gap-x-6 gap-y-2 px-4 py-3 text-[11px]"
        style={{ borderTop: "1px solid #1f2630", color: "#aab4c3" }}
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <span>Closer to centre = stronger</span>
          <span>Bigger dot = reviewed more</span>
          {Object.entries(RELATION_COLOR).map(([rel, c]) => (
            <span key={rel} className="flex items-center gap-1.5">
              <svg width="18" height="6"><line x1="0" y1="3" x2="18" y2="3" stroke={c} strokeWidth="2" strokeDasharray={rel === "analogy" ? "4 3" : undefined} /></svg>
              {rel === "prerequisite" ? "needs (→ prerequisite)" : rel === "application" ? "applies" : "is like"}
            </span>
          ))}
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ border: "2px solid #ef476f" }} />
            weak spot
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ border: "1.5px dashed #e7ecf3" }} />
            fading (not reviewed)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-full" style={{ border: "1.5px dashed #f4c542" }} />
            high-yield gap
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: "#ef476f" }} />
            misconception
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 md:ml-auto">
          <span className="font-semibold" style={{ color: "#e7ecf3" }}>How {studentName.split(" ")[0]} learns:</span>
          {learnerPrefs.length ? (
            learnerPrefs.map((p) => (
              <span
                key={p.type}
                className="rounded-full px-2 py-0.5"
                style={{ background: `rgba(244,197,66,${0.08 + p.confidence * 0.2})`, color: "#f4e3a8" }}
                title={`${p.instruction ? p.instruction + " · " : ""}${Math.round(p.confidence * 100)}% confident`}
              >
                {p.label}
              </span>
            ))
          ) : (
            <span style={{ color: "#8b95a5" }}>picked up automatically as they chat</span>
          )}
          <span className="ml-2" style={{ color: "#8b95a5" }}>
            {atoms.length} topics · {bonds.length} links · {misconceptions.length} misconception{misconceptions.length === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      <style>{`
        .mg-tooltip b{display:block;margin-bottom:2px}
        .mg-tooltip .meta{color:#8b95a5;font-size:11px}
        @keyframes mg-spin{to{transform:rotate(360deg)}}
        .mg-spin{animation:mg-spin 12s linear infinite;transform-box:fill-box;transform-origin:center}
        @keyframes mg-pulse{0%{stroke-opacity:.9;stroke-width:2}70%{stroke-opacity:0;stroke-width:9}100%{stroke-opacity:0}}
        .mg-pulse{animation:mg-pulse 1.8s ease-out infinite}
      `}</style>
    </div>
  );
}
