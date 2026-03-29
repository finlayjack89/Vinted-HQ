#!/usr/bin/env python3
"""
AKB Interactive Database Viewer
Standalone local server — run with: python3 akb_viewer.py
Opens at http://localhost:8787
"""

import json
import os
import sqlite3
import traceback
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "akb.db")

# Load API key for chat feature
def _load_chat_key() -> str:
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                if line.strip().startswith("ANTHROPIC_API_KEY="):
                    return line.strip().split("=", 1)[1].strip().strip('"')
    return os.environ.get("ANTHROPIC_API_KEY", "")

CHAT_API_KEY = _load_chat_key()


def query_db(sql: str, params: tuple = ()) -> list[dict]:
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        rows = conn.execute(sql, params).fetchall()
        conn.close()
        return [dict(r) for r in rows]
    except sqlite3.OperationalError:
        return []


def get_dashboard_data() -> dict:
    """Pull all data from the AKB for the dashboard."""
    brands = query_db("SELECT brand, data, research_depth, kcs, created_at, updated_at FROM akb_brands ORDER BY brand")
    markers = query_db("SELECT brand, model, variant, marker_name, marker_type, data, base_weight, created_at FROM akb_markers ORDER BY brand, marker_type, base_weight DESC")
    images = query_db("SELECT brand, model, image_url, source, image_class, component, confidence_source, created_at FROM akb_reference_images ORDER BY brand, image_class")
    journals = query_db("SELECT brand, model, stage, data, created_at FROM akb_meta_journal ORDER BY created_at")
    logs = query_db("SELECT brand, model, depth, data, created_at FROM akb_research_log ORDER BY created_at DESC")
    traces = query_db("SELECT id, brand, model, stage, llm_model, prompt_summary, full_prompt, raw_response, parsed_result, citations, token_usage, duration_ms, created_at FROM akb_traces ORDER BY created_at")

    for m in markers:
        try: m["parsed"] = json.loads(m["data"])
        except Exception: m["parsed"] = {}
    for b in brands:
        try: b["parsed"] = json.loads(b["data"])
        except Exception: b["parsed"] = {}
    for lg in logs:
        try: lg["parsed"] = json.loads(lg["data"])
        except Exception: lg["parsed"] = {}
    for j in journals:
        try: j["parsed"] = json.loads(j["data"])
        except Exception: j["parsed"] = {}

    return {
        "brands": brands,
        "markers": markers,
        "images": images,
        "journals": journals,
        "logs": logs,
        "traces": traces,
    }


def handle_chat(question: str, brand: str = "") -> str:
    """Use Claude to answer questions about the research process using trace data as context."""
    if not CHAT_API_KEY:
        return "Error: No ANTHROPIC_API_KEY found. Add it to .env to enable chat."

    # Gather relevant traces
    if brand:
        traces = query_db("SELECT stage, llm_model, prompt_summary, raw_response, parsed_result, citations, created_at FROM akb_traces WHERE brand = ? ORDER BY created_at", (brand,))
    else:
        traces = query_db("SELECT brand, stage, llm_model, prompt_summary, raw_response, parsed_result, citations, created_at FROM akb_traces ORDER BY created_at LIMIT 100")

    if not traces:
        return "No research traces found. Run a research pipeline first to generate trace data."

    # Build context from traces (truncate raw_response to avoid token explosion)
    context_parts = []
    for t in traces:
        brand_label = t.get("brand", brand) or brand
        raw = (t.get("raw_response") or "")[:2000]
        citations = t.get("citations") or ""
        context_parts.append(
            f"**{brand_label} — {t['stage']}** (model: {t['llm_model']})\n"
            f"Summary: {t.get('prompt_summary', '')}\n"
            f"Result: {t.get('parsed_result', '')}\n"
            f"Raw response (truncated): {raw}\n"
            f"Citations: {citations}\n"
        )

    context = "\n---\n".join(context_parts)

    # Call Claude
    import httpx
    response = httpx.post(
        "https://api.anthropic.com/v1/messages",
        headers={
            "x-api-key": CHAT_API_KEY,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        json={
            "model": "claude-sonnet-4-20250514",
            "max_tokens": 2000,
            "system": (
                "You are an AI research analyst helping the user understand their Authentication Knowledge Base (AKB) research data. "
                "You have access to the full trace logs from the research pipeline showing what each LLM (Perplexity, Gemini, Claude) "
                "was asked, what it returned, and what citations it used. Answer questions about why specific markers were created, "
                "what sources informed the research, how decisions were made, and the quality of the evidence. "
                "Be specific and cite the actual data from the traces. Format responses in markdown."
            ),
            "messages": [
                {"role": "user", "content": f"Research trace context:\n\n{context}\n\n---\n\nUser question: {question}"}
            ],
        },
        timeout=60,
    )
    result = response.json()
    if "content" in result and result["content"]:
        return result["content"][0].get("text", "No response generated.")
    return f"API error: {json.dumps(result)}"


DASHBOARD_HTML = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AKB — Authentication Knowledge Base</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
<style>
:root {
  --bg: #0a0a0f;
  --surface: #12121a;
  --surface2: #1a1a2e;
  --surface3: #252540;
  --border: #2a2a40;
  --text: #e4e4ef;
  --text2: #9999b0;
  --accent: #6c5ce7;
  --accent2: #a29bfe;
  --green: #00b894;
  --red: #e74c3c;
  --orange: #f39c12;
  --blue: #0984e3;
  --pink: #e84393;
  --cyan: #00cec9;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'Inter', sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; overflow-x: hidden; }

.header {
  background: linear-gradient(135deg, var(--surface) 0%, var(--surface2) 100%);
  border-bottom: 1px solid var(--border);
  padding: 20px 32px;
  display: flex; align-items: center; gap: 16px;
}
.header h1 { font-size: 22px; font-weight: 700; background: linear-gradient(135deg, var(--accent2), var(--pink)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
.header .subtitle { color: var(--text2); font-size: 13px; }
.tab-bar { display: flex; gap: 2px; background: var(--surface); border-bottom: 1px solid var(--border); padding: 0 32px; }
.tab { padding: 12px 20px; cursor: pointer; color: var(--text2); font-size: 13px; font-weight: 500; border-bottom: 2px solid transparent; transition: all 0.2s; }
.tab:hover { color: var(--text); }
.tab.active { color: var(--accent2); border-bottom-color: var(--accent); }
.content { padding: 24px 32px; }
.panel { display: none; }
.panel.active { display: block; }

/* Cards & Stats */
.brand-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 16px; }
.brand-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 20px; cursor: pointer; transition: all 0.2s; }
.brand-card:hover { border-color: var(--accent); transform: translateY(-2px); }
.brand-card .name { font-size: 18px; font-weight: 700; margin-bottom: 8px; }
.brand-card .stats { display: flex; gap: 16px; margin-top: 12px; flex-wrap: wrap; }
.stat { background: var(--surface2); border-radius: 8px; padding: 8px 12px; text-align: center; min-width: 70px; }
.stat .val { font-size: 20px; font-weight: 700; }
.stat .lbl { font-size: 10px; color: var(--text2); text-transform: uppercase; letter-spacing: 0.5px; }
.kcs-gauge { width: 100%; height: 8px; background: var(--surface3); border-radius: 4px; margin-top: 12px; overflow: hidden; }
.kcs-fill { height: 100%; border-radius: 4px; transition: width 0.5s ease-out; }
.kcs-label { display: flex; justify-content: space-between; margin-top: 4px; font-size: 11px; color: var(--text2); }

/* Tables */
.matrix-container { overflow-x: auto; }
.matrix-table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 13px; }
.matrix-table th { background: var(--surface2); padding: 10px 14px; text-align: left; font-weight: 600; color: var(--text2); text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px; position: sticky; top: 0; z-index: 1; border-bottom: 1px solid var(--border); }
.matrix-table td { padding: 10px 14px; border-bottom: 1px solid var(--border); vertical-align: top; }
.matrix-table tr:hover td { background: var(--surface2); }

/* Badges */
.badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
.badge-auth { background: rgba(0,184,148,0.15); color: var(--green); }
.badge-inauth { background: rgba(231,76,60,0.15); color: var(--red); }
.badge-critical { background: rgba(231,76,60,0.2); color: var(--red); }
.badge-supporting { background: rgba(108,92,231,0.15); color: var(--accent2); }
.badge-definitive { background: rgba(231,76,60,0.25); color: #ff6b6b; }
.badge-strong { background: rgba(243,156,18,0.2); color: var(--orange); }
.badge-moderate { background: rgba(9,132,227,0.2); color: var(--blue); }

/* Marker detail */
.marker-detail { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 16px; margin-top: 8px; animation: fadeIn 0.2s ease; }
@keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
.marker-detail h4 { color: var(--accent2); margin-bottom: 8px; }
.marker-detail .tells { display: flex; gap: 16px; margin-top: 8px; }
.tells-col { flex: 1; }
.tells-col h5 { font-size: 11px; text-transform: uppercase; color: var(--text2); margin-bottom: 4px; }
.tell-item { background: var(--surface2); border-radius: 4px; padding: 6px 10px; font-size: 12px; margin-bottom: 4px; line-height: 1.4; }
.tell-auth { border-left: 3px solid var(--green); }
.tell-fake { border-left: 3px solid var(--red); }

/* Images */
.images-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; }
.img-card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; transition: all 0.2s; }
.img-card:hover { border-color: var(--accent); transform: translateY(-2px); }
.img-card img { width: 100%; height: 160px; object-fit: cover; display: block; }
.img-card .img-info { padding: 10px; font-size: 11px; }
.img-card .img-class { display: inline-block; padding: 2px 6px; border-radius: 3px; font-size: 10px; font-weight: 600; }
.img-auth { background: rgba(0,184,148,0.15); color: var(--green); }
.img-rep { background: rgba(231,76,60,0.15); color: var(--red); }

/* Timeline */
.timeline { max-width: 800px; }
.timeline-item { display: flex; gap: 16px; padding: 16px 0; border-left: 2px solid var(--border); margin-left: 16px; padding-left: 24px; position: relative; }
.timeline-item::before { content: ''; width: 10px; height: 10px; border-radius: 50%; background: var(--accent); position: absolute; left: -6px; top: 20px; }
.timeline-item .time { color: var(--text2); font-size: 11px; min-width: 120px; }
.timeline-item .detail { flex: 1; }
.timeline-item .stage-name { font-weight: 600; margin-bottom: 4px; }

/* Components */
.comp-matrix { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; margin-top: 16px; }
.comp-cell { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 14px; text-align: center; cursor: pointer; transition: all 0.2s; }
.comp-cell:hover { border-color: var(--accent); transform: scale(1.02); }
.comp-cell .comp-name { font-size: 12px; font-weight: 600; text-transform: capitalize; margin-bottom: 8px; }
.comp-cell .comp-counts { display: flex; justify-content: center; gap: 12px; }
.comp-count { text-align: center; }
.comp-count .num { font-size: 22px; font-weight: 700; }
.comp-count .label { font-size: 9px; color: var(--text2); text-transform: uppercase; }

/* Filters */
.filters { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
.filter-btn { padding: 6px 14px; border-radius: 6px; border: 1px solid var(--border); background: var(--surface); color: var(--text2); font-size: 12px; cursor: pointer; transition: all 0.2s; }
.filter-btn:hover, .filter-btn.active { border-color: var(--accent); color: var(--accent2); background: rgba(108,92,231,0.1); }
.section-title { font-size: 16px; font-weight: 700; margin-bottom: 16px; color: var(--text); }
.empty-state { text-align: center; padding: 60px 20px; color: var(--text2); }
.empty-state .icon { font-size: 48px; margin-bottom: 12px; }

/* Trace / Reasoning Trail */
.trace-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 12px;
  cursor: pointer;
  transition: all 0.2s;
}
.trace-card:hover { border-color: var(--accent); }
.trace-header { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
.trace-stage { background: rgba(108,92,231,0.15); color: var(--accent2); padding: 3px 10px; border-radius: 4px; font-size: 11px; font-weight: 600; }
.trace-model { background: rgba(0,206,201,0.15); color: var(--cyan); padding: 3px 10px; border-radius: 4px; font-size: 11px; font-weight: 600; }
.trace-body { display: none; margin-top: 12px; }
.trace-body.open { display: block; }
.trace-section { margin-bottom: 12px; }
.trace-section-title { font-size: 11px; font-weight: 700; color: var(--text2); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
.trace-content {
  background: var(--surface2); border-radius: 6px; padding: 12px;
  font-size: 12px; line-height: 1.6; color: var(--text);
  max-height: 300px; overflow-y: auto; white-space: pre-wrap; word-break: break-word;
}

/* Chat */
.chat-container { max-width: 800px; }
.chat-messages { min-height: 200px; max-height: 500px; overflow-y: auto; margin-bottom: 16px; }
.chat-msg { padding: 12px 16px; border-radius: 8px; margin-bottom: 8px; font-size: 13px; line-height: 1.6; }
.chat-msg.user { background: rgba(108,92,231,0.15); border: 1px solid rgba(108,92,231,0.3); }
.chat-msg.assistant { background: var(--surface); border: 1px solid var(--border); }
.chat-msg.assistant pre { background: var(--surface2); padding: 8px; border-radius: 4px; overflow-x: auto; margin: 8px 0; }
.chat-msg.assistant code { font-size: 12px; }
.chat-input-row { display: flex; gap: 8px; }
.chat-input {
  flex: 1; padding: 12px 16px; border-radius: 8px; border: 1px solid var(--border);
  background: var(--surface); color: var(--text); font-size: 13px; font-family: 'Inter', sans-serif;
  outline: none;
}
.chat-input:focus { border-color: var(--accent); }
.chat-input::placeholder { color: var(--text2); }
.chat-send {
  padding: 12px 24px; border-radius: 8px; border: none; background: var(--accent);
  color: white; font-weight: 600; cursor: pointer; font-size: 13px; transition: all 0.2s;
}
.chat-send:hover { background: var(--accent2); }
.chat-send:disabled { opacity: 0.5; cursor: not-allowed; }
.chat-brand-select {
  padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border);
  background: var(--surface); color: var(--text); font-size: 12px; margin-bottom: 12px;
}
</style>
</head>
<body>

<div class="header">
  <h1>🔍 AKB — Authentication Knowledge Base</h1>
  <span class="subtitle">Interactive Database Viewer</span>
</div>

<div class="tab-bar">
  <div class="tab active" data-panel="overview">Overview</div>
  <div class="tab" data-panel="markers">Marker Matrix</div>
  <div class="tab" data-panel="components">Components</div>
  <div class="tab" data-panel="images">Reference Images</div>
  <div class="tab" data-panel="traces">Reasoning Trail</div>
  <div class="tab" data-panel="timeline">Research Timeline</div>
  <div class="tab" data-panel="chat">Research Chat</div>
</div>

<div class="content">
  <div id="overview" class="panel active"></div>
  <div id="markers" class="panel"></div>
  <div id="components" class="panel"></div>
  <div id="images" class="panel"></div>
  <div id="traces" class="panel"></div>
  <div id="timeline" class="panel"></div>
  <div id="chat" class="panel"></div>
</div>

<script>
let DATA = null;

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.panel).classList.add('active');
  });
});

function kcsColor(kcs) {
  if (kcs >= 0.8) return 'var(--green)';
  if (kcs >= 0.6) return 'var(--orange)';
  return 'var(--red)';
}

function formatTime(ts) {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// ── Overview ──
function renderOverview() {
  const panel = document.getElementById('overview');
  if (!DATA.brands.length) {
    panel.innerHTML = '<div class="empty-state"><div class="icon">📭</div><p>No data yet. Run the research pipeline and refresh this page.</p></div>';
    return;
  }
  let html = '<div class="brand-cards">';
  for (const brand of DATA.brands) {
    const bm = DATA.markers.filter(m => m.brand === brand.brand);
    const ac = bm.filter(m => m.marker_type === 'authenticity').length;
    const ic = bm.filter(m => m.marker_type === 'inauthenticity').length;
    const bi = DATA.images.filter(i => i.brand === brand.brand);
    const comps = {}; bm.forEach(m => { const c = m.parsed?.component || 'other'; comps[c] = (comps[c]||0)+1; });
    const kcs = brand.kcs;
    html += `<div class="brand-card" onclick="selectBrand('${brand.brand}')">
      <div class="name">${brand.brand}</div>
      <div style="color:var(--text2);font-size:12px">Depth: ${brand.research_depth} · Updated: ${formatTime(brand.updated_at)}</div>
      <div class="kcs-gauge"><div class="kcs-fill" style="width:${kcs*100}%;background:${kcsColor(kcs)}"></div></div>
      <div class="kcs-label"><span>KCS</span><span style="color:${kcsColor(kcs)};font-weight:700">${(kcs*100).toFixed(0)}%</span></div>
      <div class="stats">
        <div class="stat"><div class="val" style="color:var(--green)">${ac}</div><div class="lbl">Auth</div></div>
        <div class="stat"><div class="val" style="color:var(--red)">${ic}</div><div class="lbl">Rep</div></div>
        <div class="stat"><div class="val" style="color:var(--blue)">${bi.length}</div><div class="lbl">Images</div></div>
        <div class="stat"><div class="val" style="color:var(--accent2)">${Object.keys(comps).length}</div><div class="lbl">Components</div></div>
      </div></div>`;
  }
  html += '</div>';
  panel.innerHTML = html;
}

function selectBrand(brand) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelector('[data-panel="markers"]').classList.add('active');
  document.getElementById('markers').classList.add('active');
  renderMarkers(brand);
}

// ── Marker Matrix ──
function renderMarkers(filterBrand = null) {
  const panel = document.getElementById('markers');
  let markers = DATA.markers;
  if (filterBrand) markers = markers.filter(m => m.brand === filterBrand);
  const brands = [...new Set(DATA.markers.map(m => m.brand))];
  let html = '<div class="filters">';
  html += `<button class="filter-btn ${!filterBrand?'active':''}" onclick="renderMarkers()">All</button>`;
  brands.forEach(b => { html += `<button class="filter-btn ${filterBrand===b?'active':''}" onclick="renderMarkers('${b}')">${b}</button>`; });
  html += '</div>';
  html += '<div class="matrix-container"><table class="matrix-table"><thead><tr><th>Name</th><th>Type</th><th>Component</th><th>Weight</th><th>Severity</th><th>Description</th><th></th></tr></thead><tbody>';
  markers.forEach((m, idx) => {
    const p = m.parsed||{};
    const tb = m.marker_type==='authenticity'?'<span class="badge badge-auth">AUTH</span>':'<span class="badge badge-inauth">INAUTH</span>';
    const wb = p.weight==='CRITICAL'?'<span class="badge badge-critical">CRITICAL</span>':'<span class="badge badge-supporting">SUPPORTING</span>';
    let sb = '—';
    if(p.severity==='definitive') sb='<span class="badge badge-definitive">DEFINITIVE</span>';
    else if(p.severity==='strong') sb='<span class="badge badge-strong">STRONG</span>';
    else if(p.severity==='moderate') sb='<span class="badge badge-moderate">MODERATE</span>';
    const desc = (p.description||'').substring(0,100)+((p.description||'').length>100?'…':'');
    html += `<tr onclick="toggleDetail(${idx})" style="cursor:pointer">
      <td style="font-weight:600">${escapeHtml(m.marker_name)}</td><td>${tb}</td>
      <td style="text-transform:capitalize">${p.component||'—'}</td><td>${wb}</td><td>${sb}</td>
      <td style="color:var(--text2);font-size:12px;max-width:300px">${escapeHtml(desc)}</td>
      <td style="color:var(--accent2);font-size:12px">▸</td></tr>`;
    const at = p.authentic_tells||[], ft = p.counterfeit_tells||[], vc = p.visual_cue||'';
    html += `<tr id="detail-${idx}" style="display:none"><td colspan="7"><div class="marker-detail">
      <h4>${escapeHtml(m.marker_name)}</h4>
      <p style="color:var(--text2);font-size:13px;margin-bottom:12px">${escapeHtml(p.description||'')}</p>
      ${vc?`<p style="font-size:12px;margin-bottom:12px"><strong style="color:var(--orange)">👁 Visual Cue:</strong> ${escapeHtml(vc)}</p>`:''}
      <div class="tells">
        <div class="tells-col"><h5 style="color:var(--green)">✓ Authentic Tells (${at.length})</h5>
        ${at.map(t=>`<div class="tell-item tell-auth">${escapeHtml(t)}</div>`).join('')}
        ${at.length===0?'<div style="color:var(--text2);font-size:12px">None</div>':''}</div>
        <div class="tells-col"><h5 style="color:var(--red)">✗ Counterfeit Tells (${ft.length})</h5>
        ${ft.map(t=>`<div class="tell-item tell-fake">${escapeHtml(t)}</div>`).join('')}
        ${ft.length===0?'<div style="color:var(--text2);font-size:12px">None</div>':''}</div>
      </div>
      <div style="margin-top:12px;font-size:11px;color:var(--text2)">Weight: ${p.base_weight||'—'} · Sources: ${(p.source_urls||[]).length} · Agreement: ${p.cross_source_agreement||1}x</div>
    </div></td></tr>`;
  });
  html += '</tbody></table></div>';
  panel.innerHTML = html;
}

function toggleDetail(idx) {
  const r = document.getElementById('detail-'+idx);
  r.style.display = r.style.display==='none'?'table-row':'none';
}

// ── Components ──
function renderComponents() {
  const panel = document.getElementById('components');
  const comps = {};
  DATA.markers.forEach(m => {
    const p=m.parsed||{}, c=p.component||'other';
    if(!comps[c]) comps[c]={auth:0,inauth:0,critical:0};
    if(m.marker_type==='authenticity') comps[c].auth++; else comps[c].inauth++;
    if(p.weight==='CRITICAL') comps[c].critical++;
  });
  let html = '<div class="section-title">Component Coverage Matrix</div><div class="comp-matrix">';
  Object.entries(comps).sort((a,b)=>(b[1].auth+b[1].inauth)-(a[1].auth+a[1].inauth)).forEach(([c,d]) => {
    html += `<div class="comp-cell" onclick="showComponent('${c}')"><div class="comp-name">${c}</div>
      <div class="comp-counts">
        <div class="comp-count"><div class="num" style="color:var(--green)">${d.auth}</div><div class="label">Auth</div></div>
        <div class="comp-count"><div class="num" style="color:var(--red)">${d.inauth}</div><div class="label">Rep</div></div>
        <div class="comp-count"><div class="num" style="color:var(--orange)">${d.critical}</div><div class="label">Crit</div></div>
      </div></div>`;
  });
  html += '</div><div id="comp-detail" style="margin-top:24px"></div>';
  panel.innerHTML = html;
}

function showComponent(comp) {
  const ms = DATA.markers.filter(m=>(m.parsed?.component||'other')===comp);
  let html = `<div class="section-title" style="text-transform:capitalize">${comp} — ${ms.length} Markers</div>`;
  ms.forEach(m => {
    const p=m.parsed||{};
    const tb = m.marker_type==='authenticity'?'<span class="badge badge-auth">AUTH</span>':'<span class="badge badge-inauth">INAUTH</span>';
    html += `<div class="marker-detail" style="margin-bottom:8px">
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px"><h4 style="margin:0">${escapeHtml(m.marker_name)}</h4> ${tb}
      ${p.weight==='CRITICAL'?'<span class="badge badge-critical">CRITICAL</span>':'<span class="badge badge-supporting">SUPPORTING</span>'}</div>
      <p style="color:var(--text2);font-size:13px">${escapeHtml(p.description||'')}</p>
      ${p.visual_cue?`<p style="font-size:12px;margin-top:8px"><strong style="color:var(--orange)">👁</strong> ${escapeHtml(p.visual_cue)}</p>`:''}
      <div class="tells" style="margin-top:8px">
        <div class="tells-col">${(p.authentic_tells||[]).map(t=>`<div class="tell-item tell-auth">${escapeHtml(t)}</div>`).join('')}</div>
        <div class="tells-col">${(p.counterfeit_tells||[]).map(t=>`<div class="tell-item tell-fake">${escapeHtml(t)}</div>`).join('')}</div>
      </div></div>`;
  });
  document.getElementById('comp-detail').innerHTML = html;
}

// ── Images ──
function renderImages() {
  const panel = document.getElementById('images');
  if (!DATA.images.length) { panel.innerHTML = '<div class="empty-state"><div class="icon">🖼️</div><p>No reference images yet.</p></div>'; return; }
  let html = '<div class="filters">';
  html += '<button class="filter-btn active" onclick="filterImages(null,this)">All</button>';
  html += `<button class="filter-btn" onclick="filterImages('authentic',this)">Authentic</button>`;
  html += `<button class="filter-btn" onclick="filterImages('replica',this)">Replica</button>`;
  html += '</div><div class="images-grid">';
  DATA.images.forEach(img => {
    const cb = img.image_class==='authentic'?'<span class="img-class img-auth">AUTHENTIC</span>':'<span class="img-class img-rep">REPLICA</span>';
    html += `<div class="img-card" data-class="${img.image_class}">
      <img src="${img.image_url}" alt="${escapeHtml(img.source||'')}" onerror="this.style.display='none'" loading="lazy">
      <div class="img-info">${cb}<div style="margin-top:4px;color:var(--text2)">${escapeHtml(img.source||'—')}</div></div></div>`;
  });
  html += '</div>';
  panel.innerHTML = html;
}

function filterImages(cls, btn) {
  document.querySelectorAll('.img-card').forEach(c => { c.style.display = (!cls||c.dataset.class===cls)?'block':'none'; });
  document.querySelectorAll('#images .filter-btn').forEach(b => b.classList.remove('active'));
  if(btn) btn.classList.add('active');
}

// ── Reasoning Trail ──
function renderTraces() {
  const panel = document.getElementById('traces');
  if (!DATA.traces || !DATA.traces.length) {
    panel.innerHTML = '<div class="empty-state"><div class="icon">🧠</div><p>No reasoning traces yet. Run a research pipeline to see LLM decision logs.</p></div>';
    return;
  }
  const brands = [...new Set(DATA.traces.map(t => t.brand))];
  let html = '<div class="filters">';
  html += '<button class="filter-btn active" onclick="filterTraces(null)">All</button>';
  brands.forEach(b => { html += `<button class="filter-btn" onclick="filterTraces('${b}')">${b}</button>`; });
  html += '</div>';
  html += `<div class="section-title">LLM Reasoning Trail — ${DATA.traces.length} calls logged</div>`;
  html += '<div id="traces-list">';
  DATA.traces.forEach((t, idx) => {
    const stageColors = {
      'stage_0_recon': '#6c5ce7', 'stage_1_experts': '#0984e3', 'stage_2_threats': '#e74c3c',
      'stage_2b_rep_flaws': '#d63031', 'stage_3_deep_research': '#00b894',
      'stage_3b_images': '#fdcb6e', 'stage_3c_visual': '#e84393',
      'stage_4_gaps': '#00cec9', 'stage_5_fill': '#a29bfe', 'stage_6_synthesis': '#ff6b6b',
    };
    const color = stageColors[t.stage] || 'var(--accent2)';

    // Try to parse raw_response as JSON for prettier display
    let rawDisplay = t.raw_response || '';
    try {
      const parsed = JSON.parse(rawDisplay);
      rawDisplay = JSON.stringify(parsed, null, 2);
    } catch(e) {}

    let citationsDisplay = '';
    if (t.citations) {
      try {
        const cits = JSON.parse(t.citations);
        if (Array.isArray(cits) && cits.length) {
          citationsDisplay = cits.map(c => `<a href="${c}" target="_blank" style="color:var(--accent2);font-size:11px;display:block;margin:2px 0">${c}</a>`).join('');
        }
      } catch(e) { citationsDisplay = escapeHtml(t.citations); }
    }

    html += `<div class="trace-card" data-brand="${t.brand}" onclick="toggleTrace(${idx})">
      <div class="trace-header">
        <span class="trace-stage" style="background:${color}22;color:${color}">${t.stage.replace(/_/g,' ').toUpperCase()}</span>
        <span class="trace-model">${t.llm_model}</span>
        <span style="color:var(--text2);font-size:11px;margin-left:auto">${t.brand} · ${formatTime(t.created_at)}</span>
      </div>
      <div style="font-size:13px;color:var(--text)">${escapeHtml(t.prompt_summary)}</div>
      <div style="font-size:12px;color:var(--green);margin-top:4px">→ ${escapeHtml(t.parsed_result||'')}</div>

      <div id="trace-body-${idx}" class="trace-body">
        <div class="trace-section">
          <div class="trace-section-title">📝 What was asked</div>
          <div class="trace-content">${escapeHtml(t.full_prompt||'')}</div>
        </div>
        <div class="trace-section">
          <div class="trace-section-title">🤖 Full LLM Response</div>
          <div class="trace-content" style="max-height:500px">${escapeHtml(rawDisplay)}</div>
        </div>
        ${citationsDisplay ? `<div class="trace-section">
          <div class="trace-section-title">📚 Sources & Citations</div>
          <div class="trace-content">${citationsDisplay}</div>
        </div>` : ''}
      </div>
    </div>`;
  });
  html += '</div>';
  panel.innerHTML = html;
}

function toggleTrace(idx) {
  const body = document.getElementById('trace-body-'+idx);
  body.classList.toggle('open');
}

function filterTraces(brand) {
  document.querySelectorAll('.trace-card').forEach(c => {
    c.style.display = (!brand || c.dataset.brand === brand) ? 'block' : 'none';
  });
  document.querySelectorAll('#traces .filter-btn').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
}

// ── Timeline ──
function renderTimeline() {
  const panel = document.getElementById('timeline');
  if (!DATA.logs.length) { panel.innerHTML = '<div class="empty-state"><div class="icon">📋</div><p>No research logs yet.</p></div>'; return; }
  let html = '<div class="section-title">Research Run History</div><div class="timeline">';
  DATA.logs.forEach(log => {
    const p=log.parsed||{}, apis=p.apis_used||{};
    html += `<div class="timeline-item"><div class="time">${formatTime(log.created_at)}</div>
      <div class="detail"><div class="stage-name">${log.brand} ${log.model||''} — Depth ${log.depth}</div>
      <div style="font-size:12px;color:var(--text2);margin-top:4px">${p.markers_found||0} markers · KCS: ${((p.kcs_after||0)*100).toFixed(0)}% · ${(p.duration_seconds||0).toFixed(0)}s · £${(p.total_cost_gbp||0).toFixed(2)}</div>
      <div style="font-size:11px;color:var(--text2);margin-top:4px">APIs: ${Object.entries(apis).map(([k,v])=>`${k}: ${v}`).join(' · ')}</div>
      <div style="font-size:11px;color:var(--text2);margin-top:4px">Stages: ${(p.stages_completed||[]).join(' → ')}</div>
      </div></div>`;
  });
  html += '</div>';
  panel.innerHTML = html;
}

// ── Research Chat ──
let chatMessages = [];

function renderChat() {
  const panel = document.getElementById('chat');
  const brands = [...new Set(DATA.traces.map(t => t.brand))];
  let brandOpts = '<option value="">All brands</option>';
  brands.forEach(b => { brandOpts += `<option value="${b}">${b}</option>`; });

  panel.innerHTML = `
    <div class="section-title">💬 Research Chat — Ask about the AKB data</div>
    <p style="color:var(--text2);font-size:13px;margin-bottom:16px">Ask questions about why markers were created, what sources informed decisions, or anything about the research process. The AI has access to all LLM trace logs.</p>
    <select id="chat-brand" class="chat-brand-select">${brandOpts}</select>
    <div class="chat-container">
      <div id="chat-messages" class="chat-messages"></div>
      <div class="chat-input-row">
        <input id="chat-input" class="chat-input" placeholder="e.g. Why was 'CC Lock Turnlock' marked as CRITICAL?" onkeydown="if(event.key==='Enter')sendChat()">
        <button id="chat-send" class="chat-send" onclick="sendChat()">Send</button>
      </div>
    </div>`;
}

async function sendChat() {
  const input = document.getElementById('chat-input');
  const q = input.value.trim();
  if (!q) return;

  const brand = document.getElementById('chat-brand').value;
  input.value = '';
  document.getElementById('chat-send').disabled = true;

  chatMessages.push({ role: 'user', content: q });
  renderChatMessages();

  // Add loading indicator
  const msgs = document.getElementById('chat-messages');
  const loading = document.createElement('div');
  loading.className = 'chat-msg assistant';
  loading.innerHTML = '<em style="color:var(--text2)">Thinking...</em>';
  loading.id = 'chat-loading';
  msgs.appendChild(loading);
  msgs.scrollTop = msgs.scrollHeight;

  try {
    const resp = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: q, brand: brand }),
    });
    const data = await resp.json();
    loading.remove();
    chatMessages.push({ role: 'assistant', content: data.answer || 'No response.' });
    renderChatMessages();
  } catch(e) {
    loading.remove();
    chatMessages.push({ role: 'assistant', content: 'Error: ' + e.message });
    renderChatMessages();
  }
  document.getElementById('chat-send').disabled = false;
}

function renderChatMessages() {
  const container = document.getElementById('chat-messages');
  container.innerHTML = chatMessages.map(m => {
    // Simple markdown rendering for assistant messages
    let content = escapeHtml(m.content);
    if (m.role === 'assistant') {
      content = content
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\n/g, '<br>');
    }
    return `<div class="chat-msg ${m.role}">${content}</div>`;
  }).join('');
  container.scrollTop = container.scrollHeight;
}

// ── Init ──
fetch('/api/data')
  .then(r => r.json())
  .then(data => {
    DATA = data;
    renderOverview();
    renderMarkers();
    renderComponents();
    renderImages();
    renderTraces();
    renderTimeline();
    renderChat();
  });
</script>
</body>
</html>"""


class AKBHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == '/api/data':
            data = get_dashboard_data()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps(data, default=str).encode())
        elif parsed.path in ('/', '/index.html'):
            self.send_response(200)
            self.send_header('Content-Type', 'text/html')
            self.end_headers()
            self.wfile.write(DASHBOARD_HTML.encode())
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == '/api/chat':
            length = int(self.headers.get('Content-Length', 0))
            body = json.loads(self.rfile.read(length))
            try:
                answer = handle_chat(body.get("question", ""), body.get("brand", ""))
            except Exception as e:
                answer = f"Error: {e}\n{traceback.format_exc()}"
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({"answer": answer}).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        pass


if __name__ == '__main__':
    port = 8787
    print(f"\n🔍 AKB Database Viewer")
    print(f"   Database: {DB_PATH}")
    print(f"   Chat: {'enabled' if CHAT_API_KEY else 'disabled (no ANTHROPIC_API_KEY)'}")
    print(f"   Open: http://localhost:{port}\n")

    server = HTTPServer(('localhost', port), AKBHandler)
    try:
        import webbrowser
        webbrowser.open(f'http://localhost:{port}')
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
        server.shutdown()
