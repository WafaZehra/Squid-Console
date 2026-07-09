(() => {
  "use strict";

  const API = {
    preview: "/api/preview",
    analyze: "/api/analyze",
  };

  // state
  const state = {
    file: null,
    fileId: null,
    columns: [],
    rowCount: 0,
    hasHeader: true,
    labelColumn: "",
    excludedColumns: new Set(),
    sensitivity: "balanced",
    epochs: 120,
    result: null,   
    table: {
      view: "anomalies", 
      sortKey: "error",
      sortDir: "desc",
      search: "",
      page: 1,
      pageSize: 12,
      expanded: new Set(),
    },
  };

  // dom refs
  const $ = (id) => document.getElementById(id);

  const el = {
    statusPill: $("statusPill"),
    statusLabel: $("statusLabel"),

    stageIntake: $("stageIntake"),
    stageConfigure: $("stageConfigure"),
    stageScanning: $("stageScanning"),
    stageResults: $("stageResults"),

    dropzone: $("dropzone"),
    fileInput: $("fileInput"),
    dropzoneMeta: $("dropzoneMeta"),
    intakeError: $("intakeError"),

    configFileName: $("configFileName"),
    btnChangeFile: $("btnChangeFile"),
    hasHeaderToggle: $("hasHeaderToggle"),
    rowCountHint: $("rowCountHint"),
    labelSelect: $("labelSelect"),
    sensitivityBlock: $("sensitivityBlock"),
    sensitivitySegmented: $("sensitivitySegmented"),
    columnList: $("columnList"),
    epochsInput: $("epochsInput"),
    configError: $("configError"),
    btnRunScan: $("btnRunScan"),

    scanStatus: $("scanStatus"),
    scanLog: $("scanLog"),

    resultFileMeta: $("resultFileMeta"),
    resultModeLabel: $("resultModeLabel"),
    btnExport: $("btnExport"),
    btnNewScan: $("btnNewScan"),
    kpiRow: $("kpiRow"),
    scopeChart: $("scopeChart"),
    histChart: $("histChart"),
    lossChart: $("lossChart"),
    tableTitle: $("tableTitle"),
    tableSearch: $("tableSearch"),
    tableToggle: $("tableToggle"),
    dataTable: $("dataTable"),
    btnPrev: $("btnPrev"),
    btnNext: $("btnNext"),
    pageInfo: $("pageInfo"),
    featureSummary: $("featureSummary"),
    notesLog: $("notesLog"),
  };

  // stage / status helpers
  function showStage(name) {
    for (const s of [el.stageIntake, el.stageConfigure, el.stageScanning, el.stageResults]) {
      s.classList.add("hidden");
    }
    ({
      intake: el.stageIntake,
      configure: el.stageConfigure,
      scanning: el.stageScanning,
      results: el.stageResults,
    })[name].classList.remove("hidden");
  }

  function setStatus(mode, label) {
    el.statusPill.className = "status" + (mode ? ` is-${mode}` : "");
    el.statusLabel.textContent = label;
  }

  function fmtInt(n) {
    return new Intl.NumberFormat("en-US").format(n);
  }

  function fmtPct(n, digits = 1) {
    return `${(n * 100).toFixed(digits)}%`;
  }

  function fmtNum(n, digits = 4) {
    if (n === null || n === undefined) return "—";
    return Number(n).toFixed(digits);
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  // stage 1 — intake
  function resetToIntake() {
    state.file = null;
    state.fileId = null;
    state.columns = [];
    state.rowCount = 0;
    state.labelColumn = "";
    state.excludedColumns = new Set();
    state.sensitivity = "balanced";
    state.epochs = 120;
    state.result = null;
    el.fileInput.value = "";
    el.dropzoneMeta.textContent = "No file selected";
    el.intakeError.hidden = true;
    setStatus(null, "STANDBY");
    showStage("intake");
  }

  ["dragover", "dragleave", "drop"].forEach((evt) => {
    el.dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      el.dropzone.classList.toggle("is-dragover", evt === "dragover");
    });
  });

  el.dropzone.addEventListener("drop", (e) => {
    const f = e.dataTransfer.files?.[0];
    if (f) handleFileSelected(f);
  });

  el.fileInput.addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    if (f) handleFileSelected(f);
  });

  function handleFileSelected(file) {
    el.intakeError.hidden = true;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      el.intakeError.hidden = false;
      el.intakeError.textContent = "Only .csv files are accepted right now.";
      return;
    }
    state.file = file;
    el.dropzoneMeta.textContent = `${file.name} · ${(file.size / 1024).toFixed(1)} KB`;
    uploadAndPreview();
  }

  async function uploadAndPreview() {
    el.dropzoneMeta.textContent = `Reading ${state.file.name}…`;
    try {
      const form = new FormData();
      form.append("file", state.file);
      form.append("has_header", state.hasHeader ? "true" : "false");
      const res = await fetch(API.preview, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not read this file.");

      state.fileId = data.file_id;
      state.columns = data.columns;
      state.rowCount = data.row_count;
      state.excludedColumns = new Set();
      state.labelColumn = "";

      enterConfigureStage();
    } catch (err) {
      el.intakeError.hidden = false;
      el.intakeError.textContent = err.message;
      el.dropzoneMeta.textContent = "No file selected";
    }
  }

  // stage 2 — configure
  function enterConfigureStage() {
    el.configFileName.textContent = state.file.name;
    el.rowCountHint.textContent = `${fmtInt(state.rowCount)} rows detected`;
    el.configError.hidden = true;
    el.epochsInput.value = state.epochs;

    renderLabelSelect();
    renderColumnList();
    updateSensitivityVisibility();
    showStage("configure");
  }

  function renderLabelSelect() {
    el.labelSelect.innerHTML = '<option value="">No label — score unsupervised</option>';
    for (const col of state.columns) {
      if (col.dtype !== "categorical" || col.unique_values !== 2) continue;
      const opt = document.createElement("option");
      opt.value = col.name;
      opt.textContent = `${col.name} (${col.sample.slice(0, 2).join(" / ")})`;
      el.labelSelect.appendChild(opt);
    }
    el.labelSelect.value = state.labelColumn;
  }

  el.labelSelect.addEventListener("change", () => {
    state.labelColumn = el.labelSelect.value;
    state.excludedColumns.delete(state.labelColumn);
    renderColumnList();
    updateSensitivityVisibility();
  });

  function updateSensitivityVisibility() {
    el.sensitivityBlock.classList.toggle("hidden", !!state.labelColumn);
  }

  function renderColumnList() {
    el.columnList.innerHTML = "";
    for (const col of state.columns) {
      const isLabel = col.name === state.labelColumn;
      const row = document.createElement("label");
      row.className = "column-row" + (state.excludedColumns.has(col.name) ? " col-row-disabled" : "");

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = !state.excludedColumns.has(col.name) && !isLabel;
      checkbox.disabled = isLabel;
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) state.excludedColumns.delete(col.name);
        else state.excludedColumns.add(col.name);
        row.classList.toggle("col-row-disabled", !checkbox.checked);
      });

      const name = document.createElement("span");
      name.className = "col-name";
      name.textContent = col.name + (isLabel ? " (label)" : "");

      const badge = document.createElement("span");
      badge.className = "col-badge " + col.dtype;
      badge.textContent = col.dtype;

      const meta = document.createElement("span");
      meta.className = "col-meta";
      meta.textContent = col.missing > 0
        ? `${col.unique_values} unique · ${col.missing} missing`
        : `${col.unique_values} unique`;

      row.append(checkbox, name, badge, meta);
      el.columnList.appendChild(row);
    }
  }

  el.sensitivitySegmented.addEventListener("click", (e) => {
    const btn = e.target.closest(".segmented-option");
    if (!btn) return;
    state.sensitivity = btn.dataset.value;
    [...el.sensitivitySegmented.children].forEach((c) => c.classList.toggle("active", c === btn));
  });

  el.hasHeaderToggle.addEventListener("change", () => {
    state.hasHeader = el.hasHeaderToggle.checked;
    uploadAndPreview(); // re-parse with the new header assumption
  });

  el.btnChangeFile.addEventListener("click", resetToIntake);
  el.btnNewScan.addEventListener("click", resetToIntake);

  el.btnRunScan.addEventListener("click", runScan);

  // stage 3 — scanning
  const SCAN_STEPS = [
    "Reading the CSV…",
    "Cleaning and encoding columns…",
    "Training the autoencoder…",
    "Scoring every row…",
    "Picking out the outliers…",
  ];

  let scanTimer = null;

  function startScanAnimation() {
    el.scanLog.innerHTML = "";
    let i = 0;
    const lines = SCAN_STEPS.map((text) => {
      const line = document.createElement("p");
      line.className = "scan-log-line";
      line.textContent = text;
      el.scanLog.appendChild(line);
      return line;
    });
    el.scanStatus.textContent = SCAN_STEPS[0];
    lines[0].classList.add("is-active");

    scanTimer = setInterval(() => {
      if (i < lines.length) lines[i].classList.add("is-done");
      i++;
      if (i < lines.length) {
        el.scanStatus.textContent = SCAN_STEPS[i];
        lines[i].classList.add("is-active");
      }
    }, 1100);
  }

  function stopScanAnimation() {
    clearInterval(scanTimer);
  }

  async function runScan() {
    state.epochs = Math.min(300, Math.max(20, parseInt(el.epochsInput.value, 10) || 120));
    setStatus("busy", "TRAINING");
    showStage("scanning");
    startScanAnimation();

    try {
      const res = await fetch(API.analyze, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_id: state.fileId,
          has_header: state.hasHeader,
          label_column: state.labelColumn || null,
          exclude_columns: [...state.excludedColumns],
          sensitivity: state.sensitivity,
          epochs: state.epochs,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "The scan failed.");

      stopScanAnimation();
      state.result = data;
      state.table = { ...state.table, page: 1, search: "", expanded: new Set(), view: "anomalies" };
      enterResultsStage();
    } catch (err) {
      stopScanAnimation();
      setStatus("error", "SCAN FAILED");
      el.configError.hidden = false;
      el.configError.textContent = err.message;
      showStage("configure");
    }
  }

  // stage 4 — results
  function enterResultsStage() {
    setStatus("ready", "SCAN COMPLETE");
    const r = state.result;

    el.resultFileMeta.textContent = `${state.file.name} · ${fmtInt(r.meta.row_count)} rows · ${fmtInt(r.meta.feature_count_processed)} features used`;
    el.resultModeLabel.textContent = r.meta.mode === "supervised"
      ? "Supervised scan — evaluated against your label column"
      : "Unsupervised scan — flagged from reconstruction error alone";

    renderKpis(r);
    renderScopeChart(r);
    renderHistChart(r);
    renderLossChart(r);
    renderTable();
    renderFeatureSummary(r);
    renderNotesLog(r);

    showStage("results");
  }

  function kpiTile(label, value, sub, tone) {
    const tile = document.createElement("div");
    tile.className = "kpi-tile";
    tile.innerHTML = `
      <p class="kpi-label">${label}</p>
      <p class="kpi-value${tone ? " " + tone : ""}">${value}</p>
      ${sub ? `<p class="kpi-sub">${sub}</p>` : ""}
    `;
    return tile;
  }

  function renderKpis(r) {
    el.kpiRow.innerHTML = "";
    const tiles = [
      kpiTile("Rows scanned", fmtInt(r.meta.row_count)),
      kpiTile("Features used", fmtInt(r.meta.feature_count_processed), `of ${r.meta.feature_count_raw} raw columns`),
      kpiTile("Flagged", fmtInt(r.anomaly_count), fmtPct(r.anomaly_count / r.meta.row_count) + " of rows", "alert"),
      kpiTile("Threshold", fmtNum(r.threshold.value, 4), r.threshold.method, "accent"),
    ];
    if (r.metrics) {
      tiles.push(kpiTile("AUROC", r.metrics.auroc.toFixed(3), `F1 ${r.metrics.best_f1.toFixed(3)}`, "ok"));
    } else {
      tiles.push(kpiTile("Final loss", fmtNum(r.training.final_loss, 5), `${r.training.epochs} epochs`));
    }
    tiles.forEach((t) => el.kpiRow.appendChild(t));
  }

  //signature chart: the signal trace

  function renderScopeChart(r) {
    const rows = r.rows;
    const W = 1000, H = 220, PAD_L = 40, PAD_B = 24, PAD_T = 10;
    const plotW = W - PAD_L - 10, plotH = H - PAD_T - PAD_B;

    const maxBars = 480;
    let bins;
    if (rows.length <= maxBars) {
      bins = rows.map((row) => ({ error: row.error, isAnomaly: row.is_anomaly, span: [row.index, row.index] }));
    } else {
      const binCount = maxBars;
      const binSize = Math.ceil(rows.length / binCount);
      bins = [];
      for (let i = 0; i < rows.length; i += binSize) {
        const chunk = rows.slice(i, i + binSize);
        const maxRow = chunk.reduce((a, b) => (b.error > a.error ? b : a), chunk[0]);
        bins.push({ error: maxRow.error, isAnomaly: chunk.some((c) => c.is_anomaly), span: [chunk[0].index, chunk[chunk.length - 1].index] });
      }
    }

    const maxErr = Math.max(r.threshold.value * 1.15, ...bins.map((b) => b.error)) || 1;
    const barW = plotW / bins.length;
    const x = (i) => PAD_L + i * barW;
    const y = (v) => PAD_T + plotH - (v / maxErr) * plotH;
    const threshY = y(r.threshold.value);

    let bars = "";
    bins.forEach((b, i) => {
      const h = Math.max(1, plotH - (y(b.error) - PAD_T));
      const cx = x(i);
      bars += `<rect x="${cx.toFixed(2)}" y="${y(b.error).toFixed(2)}" width="${Math.max(1, barW - 0.6).toFixed(2)}" height="${h.toFixed(2)}" fill="${b.isAnomaly ? "var(--alert-coral)" : "var(--depth-teal)"}" opacity="${b.isAnomaly ? 0.95 : 0.55}"><title>rows ${b.span[0]}–${b.span[1]}: error ${b.error.toFixed(4)}</title></rect>`;
    });

    const yTicks = [0, maxErr / 2, maxErr];
    const yLabels = yTicks.map((t) => `<text x="${PAD_L - 8}" y="${y(t).toFixed(2)}" text-anchor="end" dominant-baseline="middle" class="chart-label">${t.toFixed(3)}</text>`).join("");
    const xLabel = `<text x="${PAD_L}" y="${H - 4}" class="chart-label">row 0</text><text x="${W - 10}" y="${H - 4}" text-anchor="end" class="chart-label">row ${fmtInt(rows.length - 1)}</text>`;

    el.scopeChart.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
        <style>.chart-label{font-family:var(--font-mono);font-size:10px;fill:var(--text-faint);}</style>
        ${yLabels}
        <line x1="${PAD_L}" y1="${threshY.toFixed(2)}" x2="${W - 10}" y2="${threshY.toFixed(2)}" stroke="var(--signal-amber)" stroke-width="1" stroke-dasharray="4 4" />
        ${bars}
        ${xLabel}
      </svg>
    `;
  }

  //distribution histogram

  function renderHistChart(r) {
    const rows = r.rows;
    if (!rows.length) { el.histChart.innerHTML = '<p class="chart-empty">No data.</p>'; return; }

    const errors = rows.map((row) => row.error);
    const maxErr = Math.max(...errors) || 1;
    const binCount = 18;
    const binW = maxErr / binCount;
    const normalCounts = new Array(binCount).fill(0);
    const anomalyCounts = new Array(binCount).fill(0);

    rows.forEach((row) => {
      const idx = Math.min(binCount - 1, Math.floor(row.error / binW));
      (row.is_anomaly ? anomalyCounts : normalCounts)[idx]++;
    });

    const maxCount = Math.max(...normalCounts.map((c, i) => c + anomalyCounts[i]), 1);

    const W = 480, H = 200, PAD_L = 36, PAD_B = 20, PAD_T = 8;
    const plotW = W - PAD_L - 8, plotH = H - PAD_T - PAD_B;
    const barW = plotW / binCount;

    let bars = "";
    for (let i = 0; i < binCount; i++) {
      const x = PAD_L + i * barW;
      const nH = (normalCounts[i] / maxCount) * plotH;
      const aH = (anomalyCounts[i] / maxCount) * plotH;
      const baseY = PAD_T + plotH;
      bars += `<rect x="${x.toFixed(2)}" y="${(baseY - nH).toFixed(2)}" width="${(barW - 1).toFixed(2)}" height="${nH.toFixed(2)}" fill="var(--depth-teal)" opacity="0.65" />`;
      bars += `<rect x="${x.toFixed(2)}" y="${(baseY - nH - aH).toFixed(2)}" width="${(barW - 1).toFixed(2)}" height="${aH.toFixed(2)}" fill="var(--alert-coral)" opacity="0.9" />`;
    }

    const threshX = PAD_L + Math.min(1, r.threshold.value / maxErr) * plotW;

    el.histChart.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
        <style>.chart-label{font-family:var(--font-mono);font-size:10px;fill:var(--text-faint);}</style>
        ${bars}
        <line x1="${threshX.toFixed(2)}" y1="${PAD_T}" x2="${threshX.toFixed(2)}" y2="${PAD_T + plotH}" stroke="var(--signal-amber)" stroke-width="1" stroke-dasharray="3 3" />
        <text x="${PAD_L}" y="${H - 4}" class="chart-label">0</text>
        <text x="${W - 8}" y="${H - 4}" text-anchor="end" class="chart-label">${maxErr.toFixed(3)}</text>
      </svg>
    `;
  }

  //training loss sparkline

  function renderLossChart(r) {
    const losses = r.training.loss_history;
    if (!losses || losses.length < 2) { el.lossChart.innerHTML = '<p class="chart-empty">No training history.</p>'; return; }

    const W = 480, H = 200, PAD = 16, PAD_B = 22;
    const maxL = Math.max(...losses), minL = Math.min(...losses);
    const range = maxL - minL || 1;
    const stepX = (W - PAD * 2) / (losses.length - 1);
    const y = (v) => PAD + (1 - (v - minL) / range) * (H - PAD - PAD_B);

    const points = losses.map((l, i) => `${(PAD + i * stepX).toFixed(2)},${y(l).toFixed(2)}`).join(" ");
    const areaPoints = `${PAD},${H - PAD_B} ${points} ${(W - PAD).toFixed(2)},${H - PAD_B}`;

    el.lossChart.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
        <style>.chart-label{font-family:var(--font-mono);font-size:10px;fill:var(--text-faint);}</style>
        <polygon points="${areaPoints}" fill="var(--signal-amber)" opacity="0.08" />
        <polyline points="${points}" fill="none" stroke="var(--signal-amber)" stroke-width="1.6" />
        <text x="${PAD}" y="${H - 4}" class="chart-label">epoch 1</text>
        <text x="${W - PAD}" y="${H - 4}" text-anchor="end" class="chart-label">epoch ${losses.length}</text>
        <text x="${PAD}" y="${(y(maxL) - 4).toFixed(2)}" class="chart-label">${maxL.toFixed(4)}</text>
        <text x="${PAD}" y="${(y(minL) + 12).toFixed(2)}" class="chart-label">${minL.toFixed(4)}</text>
      </svg>
    `;
  }

  //findings table

  el.tableSearch.addEventListener("input", () => {
    state.table.search = el.tableSearch.value.trim().toLowerCase();
    state.table.page = 1;
    renderTable();
  });

  el.tableToggle.addEventListener("click", (e) => {
    const btn = e.target.closest(".toggle-option");
    if (!btn) return;
    state.table.view = btn.dataset.view;
    state.table.page = 1;
    [...el.tableToggle.children].forEach((c) => c.classList.toggle("active", c === btn));
    renderTable();
  });

  el.btnPrev.addEventListener("click", () => {
    if (state.table.page > 1) { state.table.page--; renderTable(); }
  });
  el.btnNext.addEventListener("click", () => {
    state.table.page++; renderTable();
  });

  function getFilteredSortedRows() {
    const r = state.result;
    let rows = r.rows;
    if (state.table.view === "anomalies") rows = rows.filter((row) => row.is_anomaly);

    const q = state.table.search;
    if (q) {
      rows = rows.filter((row) => {
        if (String(row.index).includes(q)) return true;
        return row.top_features.some((f) => f.feature.toLowerCase().includes(q));
      });
    }

    const { sortKey, sortDir } = state.table;
    rows = [...rows].sort((a, b) => {
      const va = sortKey === "index" ? a.index : a.error;
      const vb = sortKey === "index" ? b.index : b.error;
      return sortDir === "asc" ? va - vb : vb - va;
    });
    return rows;
  }

  function renderTable() {
    const allFiltered = getFilteredSortedRows();
    const { pageSize } = state.table;
    const totalPages = Math.max(1, Math.ceil(allFiltered.length / pageSize));
    state.table.page = Math.min(state.table.page, totalPages);
    const start = (state.table.page - 1) * pageSize;
    const pageRows = allFiltered.slice(start, start + pageSize);

    el.tableTitle.textContent = state.table.view === "anomalies"
      ? `Flagged rows (${fmtInt(allFiltered.length)})`
      : `All rows (${fmtInt(allFiltered.length)})`;

    const hasLabel = !!state.result.meta.label_column;

    el.dataTable.querySelector("thead").innerHTML = `
      <tr>
        <th data-key="index" class="${state.table.sortKey === "index" ? "sorted" : ""}">Row</th>
        <th data-key="error" class="${state.table.sortKey === "error" ? "sorted" : ""}">Error score</th>
        ${hasLabel ? "<th>True label</th>" : ""}
        <th>Top contributing features</th>
        <th></th>
      </tr>
    `;

    const tbody = el.dataTable.querySelector("tbody");
    tbody.innerHTML = "";

    if (!pageRows.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="chart-empty">No rows match.</td></tr>`;
    }

    for (const row of pageRows) {
      const tr = document.createElement("tr");
      tr.className = row.is_anomaly ? "row-anomaly" : "";
      const chips = row.top_features.slice(0, 3).map((f) =>
        `<span class="feature-chip"><b>${escapeHtml(f.feature)}</b> ${formatValue(f.value)}</span>`
      ).join("");

      tr.innerHTML = `
        <td class="row-index">#${row.index}</td>
        <td class="row-error ${row.is_anomaly ? "is-anomaly" : "is-normal"}">${row.error.toFixed(5)}</td>
        ${hasLabel ? `<td>${row.true_label ?? "—"}</td>` : ""}
        <td><div class="feature-chips">${chips}</div></td>
        <td><button class="expand-btn" data-idx="${row.index}">${state.table.expanded.has(row.index) ? "▾ hide" : "▸ detail"}</button></td>
      `;
      tbody.appendChild(tr);

      if (state.table.expanded.has(row.index)) {
        const detailTr = document.createElement("tr");
        detailTr.className = "row-detail";
        const maxContrib = Math.max(...row.top_features.map((f) => f.contribution), 1e-9);
        const grid = row.top_features.map((f) => `
          <div class="row-detail-feature">
            <p class="name">${escapeHtml(f.feature)}</p>
            <div class="row-detail-bar"><span style="width:${((f.contribution / maxContrib) * 100).toFixed(0)}%"></span></div>
            <p class="meta">value: ${formatValue(f.value)} · contribution ${f.contribution.toFixed(4)}</p>
          </div>
        `).join("");
        detailTr.innerHTML = `<td colspan="5"><div class="row-detail-grid">${grid}</div></td>`;
        tbody.appendChild(detailTr);
      }
    }

    el.pageInfo.textContent = `Page ${state.table.page} of ${totalPages}`;
    el.btnPrev.disabled = state.table.page <= 1;
    el.btnNext.disabled = state.table.page >= totalPages;

    el.dataTable.querySelectorAll("thead th[data-key]").forEach((th) => {
      th.addEventListener("click", () => {
        const key = th.dataset.key;
        if (state.table.sortKey === key) {
          state.table.sortDir = state.table.sortDir === "asc" ? "desc" : "asc";
        } else {
          state.table.sortKey = key;
          state.table.sortDir = "desc";
        }
        renderTable();
      });
    });

    tbody.querySelectorAll(".expand-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.dataset.idx, 10);
        if (state.table.expanded.has(idx)) state.table.expanded.delete(idx);
        else state.table.expanded.add(idx);
        renderTable();
      });
    });
  }

  function formatValue(v) {
    if (v === null || v === undefined) return "—";
    if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(3);
    return escapeHtml(String(v));
  }

  // ---- feature profile panel --------------------------------------------

  function renderFeatureSummary(r) {
    el.featureSummary.innerHTML = "";
    for (const f of r.feature_summary) {
      const row = document.createElement("div");
      row.className = "feature-summary-row";

      if (f.type === "numeric") {
        row.innerHTML = `
          <div class="fs-head"><span class="fs-name">${escapeHtml(f.feature)}</span><span class="fs-type">numeric</span></div>
          <div class="fs-compare">
            <span class="fs-metric normal"><span class="k">normal mean</span> <span class="v">${fmtNum(f.normal_mean, 3)} ± ${fmtNum(f.normal_std, 3)}</span></span>
            <span class="fs-metric anomaly"><span class="k">flagged mean</span> <span class="v">${fmtNum(f.anomaly_mean, 3)} ± ${fmtNum(f.anomaly_std, 3)}</span></span>
          </div>
        `;
      } else {
        const normalChips = f.normal_top_values.map((v) => `<span class="feature-chip">${escapeHtml(v.value)} <b>${v.count}</b></span>`).join("") || "—";
        const anomalyChips = f.anomaly_top_values.map((v) => `<span class="feature-chip">${escapeHtml(v.value)} <b>${v.count}</b></span>`).join("") || "—";
        row.innerHTML = `
          <div class="fs-head"><span class="fs-name">${escapeHtml(f.feature)}</span><span class="fs-type">categorical</span></div>
          <div class="fs-compare" style="flex-direction:column; gap:8px;">
            <div><span class="fs-metric normal"><span class="k">normal —</span></span> <div class="fs-chip-list">${normalChips}</div></div>
            <div><span class="fs-metric anomaly"><span class="k">flagged —</span></span> <div class="fs-chip-list">${anomalyChips}</div></div>
          </div>
        `;
      }
      el.featureSummary.appendChild(row);
    }
  }

  // system notes 
  function renderNotesLog(r) {
    el.notesLog.innerHTML = "";
    const notes = [...r.meta.notes];
    notes.push(`Trained on ${fmtInt(r.meta.training_rows)} rows · ${r.training.epochs} epochs · device: ${r.meta.device}`);
    if (!notes.length) {
      el.notesLog.innerHTML = '<p class="console-log-empty">No adjustments were needed.</p>';
      return;
    }
    notes.forEach((n) => {
      const line = document.createElement("p");
      line.className = "console-log-line";
      line.textContent = n;
      el.notesLog.appendChild(line);
    });
  }

  //export 
  el.btnExport.addEventListener("click", () => {
    const r = state.result;
    if (!r) return;
    const flagged = r.rows.filter((row) => row.is_anomaly);
    const header = ["row_index", "error_score", "true_label", "top_features"];
    const lines = [header.join(",")];
    for (const row of flagged) {
      const feats = row.top_features.map((f) => `${f.feature}=${formatValue(f.value)}`).join(" | ");
      lines.push([
        row.index,
        row.error.toFixed(6),
        row.true_label ?? "",
        `"${feats.replace(/"/g, '""')}"`,
      ].join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(state.file?.name || "scan").replace(/\.csv$/i, "")}-flagged.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // boot
  resetToIntake();
})();
