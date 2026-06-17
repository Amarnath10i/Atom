import { useEffect, useRef } from "react";
import * as d3 from "d3";

type Atom = { id: string; subject: string; topic: string; strength: number; reviews: number };
type Bond = { id: string; source_atom: string; target_atom: string; relation?: string; weight: number };

const SUBJECT_COLOR: Record<string, string> = {
  physics: "#4cc9f0", maths: "#f4a261", chemistry: "#b388ff", chem: "#b388ff",
  biology: "#57d9a3", bio: "#57d9a3", cs: "#ff6b9d", history: "#ffd166", general: "#9aa4b2",
};
const NUCLEUS_COLOR = "#f4c542";
const SHELL_R: Record<number, number> = { 1: 90, 2: 165, 3: 240 };
const SHELL_LABEL: Record<number, string> = { 1: "inner · strong", 2: "middle · medium", 3: "outer · weak" };

const colorFor = (s: string) => SUBJECT_COLOR[s.toLowerCase()] || SUBJECT_COLOR.general;
const initials = (s: string) => {
  const parts = (s || "").split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase();
};
const shellFor = (w: number | null | undefined) =>
  w == null ? 3 : w > 0.7 ? 1 : w > 0.45 ? 2 : 3;

export function MemoryGraph({ atoms, bonds, className }: { atoms: Atom[]; bonds: Bond[]; className?: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svgEl = svgRef.current;
    const wrap = wrapRef.current;
    if (!svgEl || !wrap) return;

    const svg = d3.select(svgEl);
    svg.selectAll("*").remove();
    const root = svg.append("g");
    const gOrbits = root.append("g");
    const gOrbitLabels = root.append("g");
    const gSpokes = root.append("g");
    const gNodes = root.append("g");
    const gLabels = root.append("g");

    type A = Atom & {
      x: number; y: number; r: number; deg: number;
      isNucleus: boolean; shell: number; orbitRadius: number;
      fx?: number | null; fy?: number | null;
    };
    const norm: A[] = atoms.map((a) => ({
      ...a,
      subject: (a.subject || "general").toLowerCase(),
      strength: typeof a.strength === "number" ? a.strength : 0.5,
      reviews: a.reviews ?? 0,
      x: 0, y: 0, r: 0, deg: 0, isNucleus: false, shell: 3, orbitRadius: 240,
    }));
    const byId = new Map(norm.map((a) => [a.id, a]));
    const ids = new Set(norm.map((a) => a.id));
    const links = bonds
      .map((b, i) => ({
        id: b.id || "e" + i,
        source: String(b.source_atom),
        target: String(b.target_atom),
        weight: typeof b.weight === "number" ? b.weight : 0.5,
      }))
      .filter((b) => ids.has(b.source) && ids.has(b.target) && b.source !== b.target);

    const adj = new Map<string, Map<string, number>>(norm.map((a) => [a.id, new Map()]));
    links.forEach((b) => {
      adj.get(b.source)!.set(b.target, Math.max(adj.get(b.source)!.get(b.target) || 0, b.weight));
      adj.get(b.target)!.set(b.source, Math.max(adj.get(b.target)!.get(b.source) || 0, b.weight));
    });
    const degree: Record<string, number> = {};
    links.forEach((b) => {
      degree[b.source] = (degree[b.source] || 0) + b.weight;
      degree[b.target] = (degree[b.target] || 0) + b.weight;
    });
    norm.forEach((a) => {
      a.deg = degree[a.id] || 0;
      a.r = 12 + a.strength * 12 + Math.sqrt(a.deg) * 1.8;
    });

    const subjects = [...new Set(norm.map((a) => a.subject))];
    subjects.forEach((s) => {
      const members = norm.filter((a) => a.subject === s).sort((a, b) => b.deg - a.deg);
      members.forEach((a, i) => (a.isNucleus = i === 0));
    });

    const clusterPos: Record<string, { x: number; y: number }> = {};
    const ringRadius = Math.max(280, subjects.length * 140);
    subjects.forEach((s, i) => {
      const ang = (i / subjects.length) * Math.PI * 2;
      clusterPos[s] = { x: Math.cos(ang) * ringRadius, y: Math.sin(ang) * ringRadius };
    });

    norm.forEach((a) => {
      if (a.isNucleus) {
        a.shell = 0; a.orbitRadius = 0; return;
      }
      const nucleus = norm.find((n) => n.subject === a.subject && n.isNucleus);
      const w = nucleus ? adj.get(a.id)?.get(nucleus.id) ?? null : null;
      a.shell = shellFor(w);
      a.orbitRadius = SHELL_R[a.shell];
    });
    subjects.forEach((s) => {
      const members = norm.filter((a) => a.subject === s);
      const nucleus = members.find((a) => a.isNucleus);
      const c = clusterPos[s];
      if (nucleus) { nucleus.x = c.x; nucleus.y = c.y; }
      const byShell = new Map<number, A[]>();
      members.forEach((a) => {
        if (a.isNucleus) return;
        if (!byShell.has(a.shell)) byShell.set(a.shell, []);
        byShell.get(a.shell)!.push(a);
      });
      byShell.forEach((list, shell) => {
        const radius = SHELL_R[shell];
        list.forEach((a, i) => {
          const ang = (i / list.length) * Math.PI * 2 + shell * 0.6;
          a.x = c.x + Math.cos(ang) * radius;
          a.y = c.y + Math.sin(ang) * radius;
        });
      });
    });

    type Ring = { id: string; subject: string; shell: number; r: number; cx: number; cy: number; text?: string };
    const orbitRings: Ring[] = [];
    const orbitLabels: Ring[] = [];
    subjects.forEach((s) => {
      const members = norm.filter((a) => a.subject === s && !a.isNucleus);
      [...new Set(members.map((a) => a.shell))].sort().forEach((shell) => {
        orbitRings.push({ id: `${s}-o-${shell}`, subject: s, shell, r: SHELL_R[shell], cx: clusterPos[s].x, cy: clusterPos[s].y });
        orbitLabels.push({ id: `${s}-ol-${shell}`, subject: s, shell, r: SHELL_R[shell], cx: clusterPos[s].x, cy: clusterPos[s].y, text: SHELL_LABEL[shell] });
      });
    });

    const orbitSel = gOrbits.selectAll<SVGCircleElement, Ring>("circle.orbit")
      .data(orbitRings, (d: Ring) => d.id)
      .join("circle")
      .attr("class", (d) => `orbit shell-${d.shell}`)
      .attr("fill", "none")
      .attr("stroke", (d) => (d.shell === 1 ? "#ff6b9d" : d.shell === 2 ? "#4cc9f0" : "#9b8ec4"))
      .attr("stroke-opacity", (d) => (d.shell === 1 ? 0.6 : d.shell === 2 ? 0.5 : 0.4))
      .attr("stroke-width", 1.5)
      .attr("stroke-dasharray", "4 5")
      .attr("r", (d) => d.r).attr("cx", (d) => d.cx).attr("cy", (d) => d.cy);

    const orbitLabelSel = gOrbitLabels.selectAll<SVGTextElement, Ring>("text.orbit-label")
      .data(orbitLabels, (d: Ring) => d.id)
      .join("text")
      .attr("class", (d) => `orbit-label shell-${d.shell}`)
      .attr("fill", (d) => (d.shell === 1 ? "#ff6b9d" : d.shell === 2 ? "#4cc9f0" : "#9b8ec4"))
      .attr("font-size", 10).attr("font-weight", 700).attr("opacity", 0.9)
      .text((d) => d.text || "");

    type Spoke = { id: string; source: string; target: string; weight: number };
    const spokes: Spoke[] = [];
    subjects.forEach((s) => {
      const members = norm.filter((a) => a.subject === s);
      const nucleus = members.find((a) => a.isNucleus);
      if (!nucleus) return;
      members.forEach((a) => {
        if (a.isNucleus) return;
        const w = adj.get(a.id)?.get(nucleus.id) ?? 0.3;
        spokes.push({ id: "sp-" + a.id, source: a.id, target: nucleus.id, weight: w });
      });
    });
    const extraBonds = links
      .filter((b) => {
        const s = byId.get(b.source); const t = byId.get(b.target);
        if (!s || !t) return false;
        if ((s.isNucleus || t.isNucleus) && s.subject === t.subject) return false;
        return true;
      })
      .map((b) => {
        const s = byId.get(b.source)!; const t = byId.get(b.target)!;
        return { ...b, cross: s.subject !== t.subject };
      });

    const spokeSel = gSpokes.selectAll<SVGLineElement, Spoke>("line.spoke")
      .data(spokes, (d: Spoke) => d.id)
      .join("line")
      .attr("class", (d) => `spoke shell-${byId.get(d.source)?.shell}`)
      .attr("fill", "none")
      .attr("stroke", (d) => {
        const sh = byId.get(d.source)?.shell;
        return sh === 1 ? "#ff6b9d" : sh === 2 ? "#4cc9f0" : "#9b8ec4";
      })
      .attr("stroke-opacity", (d) => {
        const sh = byId.get(d.source)?.shell;
        return sh === 1 ? 0.95 : sh === 2 ? 0.75 : 0.45;
      })
      .attr("stroke-dasharray", (d) => (byId.get(d.source)?.shell === 3 ? "3 3" : null))
      .attr("stroke-width", (d) => 0.8 + d.weight * 2.6);

    const extraSel = gSpokes.selectAll<SVGLineElement, typeof extraBonds[number]>("line.extra")
      .data(extraBonds, (d) => d.id)
      .join("line")
      .attr("stroke", (d) => (d.cross ? "#ef476f" : "#ffd166"))
      .attr("stroke-opacity", (d) => (d.cross ? 0.55 : 0.5))
      .attr("stroke-dasharray", (d) => (d.cross ? "1 4" : "2 3"))
      .attr("stroke-width", (d) => 0.5 + d.weight * 1.4);

    const tooltip = d3.select(wrap).select<HTMLDivElement>(".mg-tooltip");

    const nodeSel = gNodes.selectAll<SVGGElement, A>("g.node")
      .data(norm, (d: A) => d.id)
      .join((enter) => {
        const g = enter.append("g").attr("class", "node");
        g.append("circle").attr("class", "ring").attr("fill", "none");
        g.append("circle").attr("class", "body");
        g.append("text").attr("class", "initials")
          .attr("text-anchor", "middle").attr("dominant-baseline", "middle")
          .attr("font-size", 10).attr("font-weight", 700).attr("fill", "#0b0d10")
          .attr("pointer-events", "none");
        return g;
      })
      .attr("class", (d) => "node" + (d.isNucleus ? " nucleus" : ""))
      .style("cursor", "grab")
      .on("mousemove", (e: MouseEvent, d) => {
        const rect = wrap.getBoundingClientRect();
        tooltip.style("display", "block")
          .style("left", e.clientX - rect.left + 14 + "px")
          .style("top", e.clientY - rect.top + 14 + "px")
          .html(
            `<b>${d.topic}</b><div class="meta">${d.subject} · strength ${(d.strength * 100).toFixed(0)}% · ${d.reviews} reviews${
              d.isNucleus ? " · nucleus" : ` · ${SHELL_LABEL[d.shell]}`
            }</div>`
          );
      })
      .on("mouseleave", () => tooltip.style("display", "none"));

    nodeSel.select("circle.ring")
      .attr("r", (d) => d.r + (d.isNucleus ? 5 : 3))
      .attr("stroke", (d) => (d.isNucleus ? NUCLEUS_COLOR : colorFor(d.subject)))
      .attr("stroke-width", (d) => (d.isNucleus ? 2.5 : 1.5))
      .attr("opacity", (d) => (d.isNucleus ? 0.95 : 0.65));
    nodeSel.select("circle.body")
      .attr("r", (d) => d.r)
      .attr("fill", (d) => (d.isNucleus ? NUCLEUS_COLOR : colorFor(d.subject)))
      .attr("fill-opacity", (d) => (d.isNucleus ? 1 : 0.55 + d.strength * 0.35))
      .attr("stroke", (d) => (d.isNucleus ? NUCLEUS_COLOR : colorFor(d.subject)))
      .attr("stroke-width", (d) => (d.isNucleus ? 2.5 : 1.5));
    nodeSel.select("text.initials")
      .attr("font-size", (d) => (d.isNucleus ? 11 : 10))
      .text((d) => initials(d.topic));

    const labelSel = gLabels.selectAll<SVGTextElement, A>("text.topic-label")
      .data(norm, (d: A) => d.id)
      .join("text")
      .attr("class", (d) => "topic-label" + (d.isNucleus ? " nucleus-label" : ""))
      .attr("pointer-events", "none")
      .attr("fill", (d) => (d.isNucleus ? "#e7ecf3" : "#8b95a5"))
      .attr("font-size", (d) => (d.isNucleus ? 11 : 10))
      .attr("font-weight", (d) => (d.isNucleus ? 700 : 400))
      .attr("text-anchor", (d) => (d.isNucleus ? "middle" : "start"))
      .text((d) => (d.isNucleus ? d.topic : d.topic.length > 28 ? d.topic.slice(0, 27) + "…" : d.topic));

    const sim = d3.forceSimulation<A>(norm)
      .force("link", d3.forceLink<A, Spoke>(spokes).id((d) => d.id)
        .distance((d: any) => byId.get(typeof d.source === "string" ? d.source : d.source.id)?.orbitRadius || 90)
        .strength(0.9))
      .force("charge", d3.forceManyBody<A>().strength((d) => (d.isNucleus ? -30 : -40)))
      .force("collide", d3.forceCollide<A>().radius((d) => d.r + 14).strength(0.85))
      .force("radial", d3.forceRadial<A>(
        (d) => (d.isNucleus ? 0 : d.orbitRadius),
        (d) => (clusterPos[d.subject] || { x: 0 }).x,
        (d) => (clusterPos[d.subject] || { y: 0 }).y
      ).strength((d) => (d.isNucleus ? 0 : 0.85)))
      .force("clusterX", d3.forceX<A>((d) => (clusterPos[d.subject] || { x: 0 }).x).strength((d) => (d.isNucleus ? 1 : 0.02)))
      .force("clusterY", d3.forceY<A>((d) => (clusterPos[d.subject] || { y: 0 }).y).strength((d) => (d.isNucleus ? 1 : 0.02)))
      .alpha(1).alphaDecay(0.03);

    sim.on("tick", () => {
      spokeSel
        .attr("x1", (d) => byId.get(d.source)?.x ?? 0).attr("y1", (d) => byId.get(d.source)?.y ?? 0)
        .attr("x2", (d) => byId.get(d.target)?.x ?? 0).attr("y2", (d) => byId.get(d.target)?.y ?? 0);
      extraSel
        .attr("x1", (d) => byId.get(d.source)?.x ?? 0).attr("y1", (d) => byId.get(d.source)?.y ?? 0)
        .attr("x2", (d) => byId.get(d.target)?.x ?? 0).attr("y2", (d) => byId.get(d.target)?.y ?? 0);
      nodeSel.attr("transform", (d) => `translate(${d.x},${d.y})`);
      labelSel
        .attr("x", (d) => d.x + (d.isNucleus ? 0 : d.r + 8))
        .attr("y", (d) => d.y + (d.isNucleus ? d.r + 16 : 3));
      orbitSel.each(function (d) {
        const n = norm.find((a) => a.subject === d.subject && a.isNucleus);
        if (n) { d.cx = n.x; d.cy = n.y; }
      }).attr("cx", (d) => d.cx).attr("cy", (d) => d.cy);
      orbitLabelSel.each(function (d) {
        const n = norm.find((a) => a.subject === d.subject && a.isNucleus);
        if (n) { d.cx = n.x; d.cy = n.y; }
      })
        .attr("x", (d) => d.cx + d.r * Math.cos(-Math.PI / 4) + 6)
        .attr("y", (d) => d.cy + d.r * Math.sin(-Math.PI / 4));
    });

    nodeSel.call(
      d3.drag<SVGGElement, A>()
        .on("start", (e, d) => { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
        .on("drag", (e, d) => { d.fx = e.x; d.fy = e.y; })
        .on("end", (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null; })
    );

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.25, 4])
      .on("zoom", (e) => root.attr("transform", e.transform.toString()));
    svg.call(zoom);

    // center on the wrap size
    const fit = () => {
      const w = wrap.clientWidth || 600;
      const h = wrap.clientHeight || 420;
      svg.call(zoom.transform, d3.zoomIdentity.translate(w / 2, h / 2).scale(0.75));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);

    return () => { ro.disconnect(); sim.stop(); };
  }, [atoms, bonds]);

  return (
    <div
      ref={wrapRef}
      className={`relative overflow-hidden rounded-xl border border-border bg-card/40 ${className ?? "h-[420px]"}`}
      style={{ background: "#0b0d10" }}
    >
      <svg ref={svgRef} style={{ width: "100%", height: "100%", display: "block", cursor: "grab" }} />
      <div
        className="mg-tooltip"
        style={{
          position: "absolute", pointerEvents: "none", display: "none",
          background: "rgba(18,22,28,.95)", border: "1px solid #1f2630", borderRadius: 8,
          padding: "8px 10px", fontSize: 12, color: "#e7ecf3", maxWidth: 260, zIndex: 10,
        }}
      />
      <div
        style={{
          position: "absolute", left: 10, bottom: 8, fontSize: 10, color: "#8b95a5",
          pointerEvents: "none",
        }}
      >
        drag nodes · scroll to zoom · drag canvas to pan · hover for details
      </div>
      <style>{`.mg-tooltip b{display:block;margin-bottom:2px}.mg-tooltip .meta{color:#8b95a5;font-size:11px}`}</style>
    </div>
  );
}
