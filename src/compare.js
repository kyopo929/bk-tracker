/* Compare with shipping's pending parts list (BDTP "Pending Parts List" Excel).
   The file is read here in the browser; nothing is uploaded anywhere. */
'use strict';

// ── Minimal .xlsx reader: an .xlsx is a zip of XML files ──
function parseCSV(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',' || ch === '\t' || ch === ';') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.map(r => r.map(v => (v !== '' && !isNaN(+v) && !/^0\d/.test(v)) ? +v : v));
}
async function readSheets(file) {
  if (/\.(csv|txt|tsv)$/i.test(file.name)) return [{ name: file.name, rows: parseCSV((await file.text()).replace(/^﻿/, '')) }];
  if (/\.xls$/i.test(file.name)) throw new Error('This is an old .xls file. In Excel, use File → Save As → Excel Workbook (.xlsx), or CSV, and choose that instead.');
  return readXlsx(file);
}
async function readXlsx(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const dv = new DataView(buf.buffer);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('This doesn’t look like an Excel (.xlsx) file.');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const files = {};
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nlen));
    files[name] = { method, csize, off };
    p += 46 + nlen + xlen + clen;
  }
  const text = async name => {
    const f = files[name] || files[name.replace(/^\//, '')]; if (!f) return null;
    const start = f.off + 30 + dv.getUint16(f.off + 26, true) + dv.getUint16(f.off + 28, true);
    const raw = buf.subarray(start, start + f.csize);
    if (f.method === 0) return new TextDecoder().decode(raw);
    const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return await new Response(stream).text();
  };
  const xml = s => new DOMParser().parseFromString(s, 'application/xml');
  const shared = [];
  const ss = await text('xl/sharedStrings.xml');
  if (ss) for (const si of xml(ss).getElementsByTagName('si')) shared.push([...si.getElementsByTagName('t')].map(t => t.textContent).join(''));
  const rels = {};
  for (const r of xml(await text('xl/_rels/workbook.xml.rels')).getElementsByTagName('Relationship')) rels[r.getAttribute('Id')] = r.getAttribute('Target');
  const sheets = [];
  for (const sh of xml(await text('xl/workbook.xml')).getElementsByTagName('sheet')) {
    const rid = sh.getAttribute('r:id') || sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    let target = rels[rid] || ''; target = target.startsWith('/') ? target.slice(1) : 'xl/' + target;
    const body = await text(target); if (!body) continue;
    const rows = [];
    for (const row of xml(body).getElementsByTagName('row')) {
      const out = [];
      for (const c of row.getElementsByTagName('c')) {
        const ref = c.getAttribute('r') || ''; let col = 0;
        for (const ch of ref.replace(/\d+/g, '')) col = col * 26 + ch.charCodeAt(0) - 64;
        const t = c.getAttribute('t'), v = c.getElementsByTagName('v')[0];
        let val = null;
        if (t === 's') val = shared[+v.textContent];
        else if (t === 'inlineStr') val = [...c.getElementsByTagName('t')].map(x => x.textContent).join('');
        else if (t === 'b') val = v && v.textContent === '1';
        else if (v) val = t === 'str' || t === 'e' ? v.textContent : +v.textContent;
        out[(col || out.length + 1) - 1] = val;
      }
      rows[(+row.getAttribute('r') || rows.length + 1) - 1] = out;
    }
    sheets.push({ name: sh.getAttribute('name'), rows });
  }
  return sheets;
}

// ── Find shipping's lines in the workbook ──
function parseShippingList(sheets) {
  for (const sh of sheets) {
    const rows = sh.rows;
    for (let h = 0; h < Math.min(rows.length, 30); h++) {
      const head = (rows[h] || []).map(v => lc(v));
      const col = re => head.findIndex(x => re.test(x || ''));
      const c = { po: col(/^po\b|po number/), so: col(/^so\b|so number/), item: col(/item number|wet id/), wc: col(/wetcare|client/), desc: col(/desc/),
        qty: col(/qty pending|pending|outstanding/), staged: col(/^staged$/), sqty: col(/staged qty/), eta: col(/lead time|eta/), wcfr: col(/wcfr/), rem: col(/remark/) };
      if (c.po < 0 || c.item < 0 || c.qty < 0) continue;
      const lines = [];
      for (let r = h + 1; r < rows.length; r++) {
        const row = rows[r] || [];
        const po = String(row[c.po] ?? '').trim();
        if (!/^\d{6,}$/.test(po)) continue;
        const so = c.so >= 0 ? String(row[c.so] ?? '').trim() : '';
        const item = String(row[c.item] ?? '').trim();
        const wcs = String(c.wc >= 0 ? row[c.wc] ?? '' : '').split(/[,;/]/).map(x => x.trim().replace(/\s*wc$/i, '')).filter(x => /^[\w.-]+$/.test(x) && !/^(none|n\/?a|closed)$/i.test(x));
        const stagedFlag = c.staged >= 0 && String(row[c.staged] ?? '').trim() !== '';
        lines.push({ row: r + 1, po: 'PO' + po, so: /^\d+$/.test(so) ? so : '', notOnSO: c.so >= 0 && /not|none|missing/i.test(so), item: /not on|^none$/i.test(item) ? '' : item, wcs,
          desc: String(row[c.desc] ?? ''), qty: +row[c.qty] || 0, staged: stagedFlag ? (+row[c.sqty] || 0) : 0, eta: c.eta >= 0 ? row[c.eta] ?? '' : '', remark: c.rem >= 0 ? String(row[c.rem] ?? '') : '' });
      }
      if (lines.length) return { sheet: sh.name, lines };
    }
  }
  throw new Error('Couldn’t find shipping’s table in this file. It needs columns like “PO Number”, “Item Number” and “Qty Pending”.');
}

// ── Match against the app ──
const words = s => new Set(lc(s).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length >= 4 && !/^(with|assembly|assy|inch)$/.test(w)));
function compareShipping(list) {
  const res = [], used = new Set(), poSeen = new Set();
  const orderByPO = new Map(db.orders.filter(o => o.po_number).map(o => [lc(o.po_number), o]));
  for (const s of list.lines) {
    const o = orderByPO.get(lc(s.po));
    poSeen.add(lc(s.po));
    const r = { s, o, line: null, kind: '', add: [], stagedChange: null, probable: false };
    if (!o) { r.kind = 'noPO'; res.push(r); continue; }
    if (s.notOnSO) { r.kind = 'notOnSO'; }
    const nums = [s.item, ...s.wcs].filter(Boolean);
    const pids = new Set(nums.map(n => partIdFor(n)).filter(Boolean));
    const lines = (D.linesByOrder.get(o.id) || []).filter(l => !used.has(l.id) && !l.cancelled);
    let cands = lines.filter(l => pids.has(l.part_id));
    cands.sort((a, b) => Math.abs(D.L.get(a.id).outstanding - s.qty) - Math.abs(D.L.get(b.id).outstanding - s.qty) || D.L.get(b.id).outstanding - D.L.get(a.id).outstanding);
    let line = cands[0];
    if (!line && pids.size) {
      // Shipping's number is a part the app knows, but this PO has no line for it: likely a typo on one side.
      const w = words(s.desc);
      const guess = lines.filter(l => D.L.get(l.id).outstanding === s.qty).map(l => ({ l, score: [...words(partDesc(l.part_id))].filter(x => w.has(x)).length })).filter(x => x.score > 0).sort((a, b) => b.score - a.score)[0];
      r.kind = r.kind || 'mixup'; r.shipPart = [...pids][0];
      if (guess) { used.add(guess.l.id); r.line = guess.l; }
      res.push(r); continue;
    }
    if (!line) {
      const w = words(s.desc);
      const probable = lines.filter(l => D.L.get(l.id).outstanding === s.qty)
        .map(l => ({ l, score: [...words(partDesc(l.part_id))].filter(x => w.has(x)).length })).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
      if (probable.length) { line = probable[0].l; r.probable = true; }
    }
    if (line) {
      used.add(line.id); r.line = line;
      const c = D.L.get(line.id);
      if (!r.kind) r.kind = c.outstanding === s.qty ? 'match' : 'qty';
      const known = new Set((D.numbers.get(line.part_id) || []).map(n => lc(n.number)));
      r.add = nums.filter(n => !known.has(lc(n)) && !partIdFor(n)).map(n => ({ number: n, label: n === s.item ? 'new' : 'client' }));
      if (hasStaged) { const cur = +line.staged_qty || 0; if (cur !== s.staged) r.stagedChange = { from: cur, to: s.staged }; }
    } else if (!r.kind) r.kind = 'shipOnly';
    res.push(r);
  }
  const appOnly = db.order_lines.filter(l => !used.has(l.id) && D.L.get(l.id).outstanding > 0 && poSeen.has(lc((D.order.get(l.order_id) || {}).po_number)));
  const openPOs = new Set(db.order_lines.filter(l => D.L.get(l.id).outstanding > 0).map(l => lc((D.order.get(l.order_id) || {}).po_number)));
  const posMissing = [...openPOs].filter(po => po && !poSeen.has(po)).map(po => orderByPO.get(po)).filter(Boolean);
  const soChanges = [];
  for (const po of poSeen) {
    const o = orderByPO.get(po); if (!o || !hasSO) continue;
    const so = (list.lines.find(s => lc(s.po) === po && s.so) || {}).so;
    if (so && o.wet_so !== so) soChanges.push({ o, so });
  }
  return { res, appOnly, posMissing, soChanges };
}

const TEMPLATE_HEAD = ['PO Number', 'SO Number', 'Item Number (WET ID)', 'WetCare ID', 'Description', 'Qty Pending', 'Staged', 'Staged Qty', 'Lead Time / ETA', 'WCFR #', 'Remarks'];
const TEMPLATE_ROWS = [
  ['5002012', '7195', '09110', '8481WC', 'Nozzle, Base, Delrin', 500, 'x', 350, '', '', 'Keeping qty at 500'],
  ['5002308', '7570', '40-02618', '3388WC', 'Hose Barb, 3/4" MPT X Push-Lock, Brass', 200, '', '', '2 weeks', '', ''],
  ['5002613', '7527', '40-18442', '1167WC', 'Lamp, 12V AC/DC, 90W', 3500, 'x', 600, '', '', ''],
];
const FORMAT_HELP = `<div class="card fmt">
  <h2>What to upload</h2>
  <p>The pending parts list from shipping, as an Excel file (.xlsx) or CSV. One row per open PO line. The column names just need to contain these words; order doesn’t matter, and extra columns or title rows above the table are ignored.</p>
  <div class="tbl-wrap"><table class="tbl"><thead><tr>${TEMPLATE_HEAD.map((h, i) => `<th class="${i === 0 || i === 2 || i === 5 ? 'req' : ''}">${esc(h)}</th>`).join('')}</tr></thead>
  <tbody>${TEMPLATE_ROWS.map(r => `<tr>${r.map(v => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
  <ul class="small">
    <li><b>Needed:</b> PO Number (digits, with or without “PO”), Item Number (WET’s part number) and Qty Pending (what they still owe).</li>
    <li><b>Helpful:</b> WetCare ID (the client number, e.g. 8481WC; several can go in one cell, separated by commas), SO Number, Description (used to pair lines when a number is new), Staged + Staged Qty, Remarks.</li>
    <li>Rows whose PO cell isn’t a number (headings like “SO 7195 | PO 5002012”) are skipped.</li>
  </ul>
  <button class="btn small" data-act="shipTemplate">${ICON.down}Download a blank template (CSV)</button>
</div>`;
ACTIONS.shipTemplate = () => {
  const cell = v => /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
  const csv = [TEMPLATE_HEAD, ...TEMPLATE_ROWS].map(r => r.map(cell).join(',')).join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })); a.download = 'Shipping pending list template.csv';
  document.body.appendChild(a); a.click(); a.remove();
};
const SHIP_KIND = {
  match: ['green', 'Match'], qty: ['red', 'Qty differs'], notOnSO: ['red', 'Not on shipping’s SO'],
  shipOnly: ['amber', 'Only on shipping’s list'], noPO: ['amber', 'PO not in the app'], mixup: ['red', 'Part number mix-up'],
};
VIEWS.compare = () => {
  const C = ui.compare;
  const intro = `<div class="card dropzone" id="dropzone">
      <div><b>Compare with shipping’s pending parts list</b><p class="small" style="margin:4px 0 0">Choose or drop the Excel file shipping sends (the BDTP “Pending Parts List”). It’s read here in your browser and checked line by line against the app: PO, part (any WET, client or old number) and quantity.</p></div>
      <label class="btn primary">${ICON.down}Choose file…<input type="file" id="shipFile" accept=".xlsx,.csv" hidden></label></div>` + FORMAT_HELP;
  if (!C) return { title: 'Shipping check', sub: 'Does shipping’s list agree with yours?', html: intro };
  if (C.error) return { title: 'Shipping check', html: intro + `<div class="warnbox">${esc(C.error)}</div>` };
  const { res, appOnly, posMissing, soChanges } = compareShipping(C.list);
  const count = k => res.filter(r => r.kind === k).length;
  const adds = res.flatMap(r => r.line && (!r.probable || C.acceptProbable.has(r.s.row)) ? r.add.map(a => ({ ...a, r })) : []);
  const staged = res.filter(r => r.stagedChange);
  const probable = res.filter(r => r.probable);
  const problems = res.filter(r => ['qty', 'notOnSO', 'shipOnly', 'noPO', 'mixup'].includes(r.kind));
  const strip = `<div class="strip">
    <div><b>${res.length}</b><span>lines on shipping’s list</span></div>
    <div><b>${count('match')}</b><span>match</span></div>
    <div class="${problems.length ? 'hot' : ''}"><b>${problems.length}</b><span>need a look</span></div>
    <div class="${appOnly.length ? 'hot' : ''}"><b>${appOnly.length}</b><span>open in the app, not on their list</span></div>
    <div><b>${adds.length + staged.length + soChanges.length}</b><span>updates ready</span></div>
  </div>`;
  const shipCell = r => `<span class="pn">${esc(r.s.item || '–')}</span>${r.s.wcs.length ? `<div class="alias">${r.s.wcs.map(w => esc(w) + 'WC').join(', ')}</div>` : ''}`;
  const appCell = r => r.line ? `${partCell(r.line.part_id)}<div class="small">${esc(partDesc(r.line.part_id))}</div>` : '<span class="small">–</span>';
  const rowsHtml = list => list.map(r => `<tr>
      <td>${(([c, t]) => `<span class="pill ${c}">${t}</span>`)(SHIP_KIND[r.kind])}${r.probable ? ' <span class="pill blue" title="Matched by description and quantity">Probable</span>' : ''}</td>
      <td class="nowrap">${esc(r.s.po)}${r.s.so ? `<div class="alias">SO ${esc(r.s.so)}</div>` : ''}</td>
      <td>${shipCell(r)}<div class="small">${esc(r.s.desc)}</div></td><td>${appCell(r)}</td>
      <td class="num">${fmtN(r.s.qty)}</td><td class="num">${r.line ? fmtN(D.L.get(r.line.id).outstanding) : '–'}</td>
      <td class="small">${r.kind === 'mixup' ? `Shipping’s number is your part <b>${esc(mainNo(r.shipPart))}</b> ${esc(partDesc(r.shipPart))}${r.line ? `, but this PO’s line is ${esc(mainNo(r.line.part_id))}. If shipping is right, open the order, click the line and use “Change part”.` : ', which isn’t on this PO.'} ` : ''}${esc(r.s.remark)}${r.o ? ` <a href="#/orders/${r.o.id}">Open order</a>` : ''}</td></tr>`).join('');
  const head = '<thead><tr><th>Result</th><th>PO</th><th>Shipping has</th><th>App has</th><th class="num">Shipping pending</th><th class="num">App owed</th><th>Note</th></tr></thead>';
  let html = strip;
  html += `<div class="section-title"><h2>Need a look</h2><span class="small">${problems.length ? 'Quantities or lines that disagree. Decide which is right, then fix it in the order (or tell shipping).' : 'Nothing: every line on their list matches a line in the app.'}</span></div>`;
  if (problems.length) html += `<div class="tbl-wrap"><table class="tbl">${head}<tbody>${rowsHtml(problems)}</tbody></table></div>`;
  if (appOnly.length || posMissing.length) {
    html += `<div class="section-title"><h2>Open in the app but not on their list</h2><span class="small">Shipping may have missed these, or they were shipped. Check before chasing.</span></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>PO</th><th>Part</th><th class="num">App owed</th><th></th></tr></thead><tbody>${appOnly.map(l => `<tr><td>${esc(orderName(l.order_id))}</td><td>${partCell(l.part_id)}<div class="small">${esc(partDesc(l.part_id))}</div></td><td class="num">${fmtN(D.L.get(l.id).outstanding)}</td><td><a href="#/orders/${l.order_id}">Open order</a></td></tr>`).join('')}${posMissing.map(o => `<tr><td>${esc(o.po_number)}</td><td><i>Whole PO missing from their list</i> <span class="small">${esc(o.title)}</span></td><td class="num">${fmtN(D.O.get(o.id).outstanding)}</td><td><a href="#/orders/${o.id}">Open order</a></td></tr>`).join('')}</tbody></table></div>`;
  }
  if (probable.length) {
    html += `<div class="section-title"><h2>Matched by description</h2><span class="small">Their part number isn’t known yet, so these were paired by description and quantity on the same PO. Tick the ones that are right; their numbers get added to the part.</span></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th></th><th>PO</th><th>Shipping has</th><th>App has</th><th class="num">Qty</th></tr></thead><tbody>${probable.map(r => `<tr><td><input type="checkbox" data-act="toggleProbable" data-v="${r.s.row}" ${C.acceptProbable.has(r.s.row) ? 'checked' : ''} aria-label="Same part"></td><td>${esc(r.s.po)}</td><td>${shipCell(r)}<div class="small">${esc(r.s.desc)}</div></td><td>${appCell(r)}</td><td class="num">${fmtN(r.s.qty)}</td></tr>`).join('')}</tbody></table></div>`;
  }
  const upd = adds.length + staged.length + soChanges.length;
  html += `<div class="section-title"><h2>Updates from their list</h2><span class="spacer"></span>${upd ? `<button class="btn primary" data-act="applyShipping">Apply ${upd} update${upd > 1 ? 's' : ''}</button>` : ''}</div>`;
  html += upd ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Update</th><th>Details</th></tr></thead><tbody>
      ${adds.map(a => `<tr><td>Add part number</td><td><b>${esc(a.number)}</b> (${a.label === 'new' ? 'WET number' : 'client number'}) to ${esc(mainNo(a.r.line.part_id))} ${esc(partDesc(a.r.line.part_id))}</td></tr>`).join('')}
      ${hasStaged ? staged.map(r => `<tr><td>Staged quantity</td><td>${esc(r.s.po)} · ${esc(mainNo(r.line.part_id))}: ${fmtN(r.stagedChange.from) || 'none'} → <b>${fmtN(r.stagedChange.to) || 'none'}</b></td></tr>`).join('') : ''}
      ${soChanges.map(x => `<tr><td>WET SO number</td><td>${esc(x.o.po_number)}: ${esc(x.o.wet_so || 'none')} → <b>${esc(x.so)}</b></td></tr>`).join('')}
    </tbody></table></div>` : '<div class="tbl-wrap"><div class="empty">Nothing to update: numbers, SO numbers and staged quantities already agree.</div></div>';
  if (!hasStaged) html += '<p class="small">Staged quantities will show here once <code>supabase/fixes/2026-11-25-staged.sql</code> has been run.</p>';
  html += `<details class="allrows"><summary>All ${res.length} lines</summary><div class="tbl-wrap"><table class="tbl">${head}<tbody>${rowsHtml(res)}</tbody></table></div></details>`;
  exportable = { name: 'Shipping check', rows: res, cols: [
    { label: 'Result', text: r => SHIP_KIND[r.kind][1] + (r.probable ? ' (probable)' : '') }, { label: 'PO', text: r => r.s.po }, { label: 'WET SO', text: r => r.s.so },
    { label: 'Shipping item', text: r => r.s.item }, { label: 'Client #', text: r => r.s.wcs.map(w => w + 'WC').join(', ') }, { label: 'Shipping description', text: r => r.s.desc },
    { label: 'App part', text: r => r.line ? mainNo(r.line.part_id) : '' }, { label: 'Shipping pending', text: r => r.s.qty }, { label: 'App owed', text: r => r.line ? D.L.get(r.line.id).outstanding : '' },
    { label: 'Staged', text: r => r.s.staged || '' }, { label: 'Shipping remark', text: r => r.s.remark }] };
  return { title: 'Shipping check', sub: `${esc(C.fileName)} · ${esc(C.list.sheet)}`, tools: `<label class="btn small">${ICON.down}Choose another file…<input type="file" id="shipFile" accept=".xlsx,.csv" hidden></label>`, html };
};

async function loadShippingFile(file) {
  try {
    const list = parseShippingList(await readSheets(file));
    ui.compare = { fileName: file.name, list, acceptProbable: new Set() };
  } catch (e) { console.error(e); ui.compare = { error: friendlyError(e) }; }
  if (route().view !== 'compare') go('#/compare'); else render();
}
document.addEventListener('change', e => { if (e.target.id === 'shipFile' && e.target.files[0]) loadShippingFile(e.target.files[0]); });
document.addEventListener('dragover', e => { if (route().view === 'compare') { e.preventDefault(); } });
document.addEventListener('drop', e => { if (route().view === 'compare' && e.dataTransfer.files[0]) { e.preventDefault(); loadShippingFile(e.dataTransfer.files[0]); } });

ACTIONS.toggleProbable = b => { const s = ui.compare.acceptProbable, k = +b.dataset.v; if (s.has(k)) s.delete(k); else s.add(k); render(); };
ACTIONS.applyShipping = () => {
  const { res, soChanges } = compareShipping(ui.compare.list);
  const C = ui.compare;
  const adds = []; const seen = new Set();
  for (const r of res) if (r.line && (!r.probable || C.acceptProbable.has(r.s.row))) for (const a of r.add) if (!seen.has(lc(a.number))) { seen.add(lc(a.number)); adds.push({ part_id: r.line.part_id, number: a.number, label: a.label, is_main: false }); }
  const staged = hasStaged ? res.filter(r => r.stagedChange) : [];
  confirmSheet('Apply updates from shipping?', `This adds <b>${adds.length}</b> part number${adds.length === 1 ? '' : 's'}, updates <b>${staged.length}</b> staged quantit${staged.length === 1 ? 'y' : 'ies'} and <b>${soChanges.length}</b> WET SO number${soChanges.length === 1 ? '' : 's'}. Quantities ordered are not changed. Everything shows in History.`, 'Apply', async () => {
    if (adds.length) await ins('part_numbers', adds);
    for (const r of staged) await upd('order_lines', r.line.id, { staged_qty: r.stagedChange.to || null, staged_date: todayISO() });
    for (const x of soChanges) await upd('orders', x.o.id, { wet_so: x.so });
    toast('Updated from shipping’s list');
  }, false);
};
