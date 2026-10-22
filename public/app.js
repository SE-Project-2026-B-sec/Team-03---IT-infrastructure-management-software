'use strict';

// ITIM dashboard client: no framework and no build step. All server data is
// rendered through textContent and DOM nodes only (PRJ-SR-004). The access
// token lives in memory only, so closing or reloading the tab signs out.
(function () {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const THEME_KEY = 'itim-theme';

  const ROLE_LABELS = {
    SUPER_ADMIN: 'Super Administrator',
    IT_ADMIN: 'IT Administrator',
    IT_TECHNICIAN: 'IT Technician',
    MANAGER: 'Manager',
    IT_DIRECTOR: 'IT Director',
    FINANCE_OFFICER: 'Finance Officer',
    AUDITOR: 'Auditor',
    EMPLOYEE: 'Employee'
  };
  const DEMO_USERS = [
    ['superadmin', 'SUPER_ADMIN'], ['itadmin', 'IT_ADMIN'], ['technician', 'IT_TECHNICIAN'],
    ['manager', 'MANAGER'], ['director', 'IT_DIRECTOR'], ['finance', 'FINANCE_OFFICER'],
    ['auditor', 'AUDITOR'], ['employee', 'EMPLOYEE'], ['employee2', 'EMPLOYEE']
  ];

  // Mirror of src/security/rbac.js. It only decides what to show; the server enforces.
  const ADMINS = ['SUPER_ADMIN', 'IT_ADMIN'];
  const IT_STAFF = [...ADMINS, 'IT_TECHNICIAN'];
  const PERMS = {
    assetRead: [...IT_STAFF, 'AUDITOR'],
    assetCreate: ADMINS,
    assetAssign: IT_STAFF,
    assetMaintain: IT_STAFF,
    licenseRead: [...IT_STAFF, 'AUDITOR'],
    licenseManage: ADMINS,
    revealKey: ['SUPER_ADMIN'],
    complianceRead: [...ADMINS, 'AUDITOR'],
    complianceManage: ADMINS,
    alertsRun: ADMINS,
    notificationsRead: [...ADMINS, 'AUDITOR'],
    procurementRequest: Object.keys(ROLE_LABELS).filter((r) => r !== 'AUDITOR'),
    procurementOrder: ['FINANCE_OFFICER'],
    procurementReceive: IT_STAFF,
    auditRead: ['SUPER_ADMIN', 'AUDITOR']
  };
  const STAGE_ROLE = {
    PENDING_MANAGER_APPROVAL: 'MANAGER',
    PENDING_DIRECTOR_APPROVAL: 'IT_DIRECTOR',
    PENDING_FINANCE_APPROVAL: 'FINANCE_OFFICER'
  };
  const ASSET_STATUS = {
    AVAILABLE: { label: 'Available', tone: 'ok' },
    IN_USE: { label: 'In use', tone: 'info' },
    UNDER_REPAIR: { label: 'Under repair', tone: 'warn' },
    DECOMMISSIONED: { label: 'Decommissioned', tone: 'neutral' }
  };
  // Fixed categorical order for the fleet chart (validated palette slots 1-4).
  const FLEET_SERIES = [['IN_USE', 's1'], ['AVAILABLE', 's2'], ['UNDER_REPAIR', 's3'], ['DECOMMISSIONED', 's4']];
  const PR_STATE = {
    PENDING_MANAGER_APPROVAL: { label: 'Awaiting manager', tone: 'warn' },
    PENDING_DIRECTOR_APPROVAL: { label: 'Awaiting IT director', tone: 'warn' },
    PENDING_FINANCE_APPROVAL: { label: 'Awaiting finance', tone: 'warn' },
    APPROVED: { label: 'Approved', tone: 'info' },
    PO_ISSUED: { label: 'Ordered', tone: 'accent' },
    DELIVERED: { label: 'Delivered', tone: 'ok' },
    REJECTED: { label: 'Rejected', tone: 'bad' }
  };
  const SEVERITY = {
    HIGH: { tone: 'bad', icon: 'alert', label: 'High' },
    MEDIUM: { tone: 'warn', icon: 'clock', label: 'Medium' },
    LOW: { tone: 'info', icon: 'info', label: 'Low' }
  };
  const CATEGORY_ICON = { LAPTOP: 'laptop', DESKTOP: 'monitor', SERVER: 'layers', NETWORK: 'grid', PERIPHERAL: 'monitor', MOBILE: 'phone', OTHER: 'box' };
  const CATEGORIES = ['LAPTOP', 'DESKTOP', 'SERVER', 'NETWORK', 'PERIPHERAL', 'MOBILE', 'OTHER'];

  const state = {
    token: null,
    user: null,
    view: 'overview',
    renderSeq: 0,
    people: new Map(),
    directory: [],
    assetQuery: { q: '', status: '', category: '', page: 1, pageSize: 12 },
    procurementFilter: 'all',
    alertsFilter: 'ALL',
    drawerAssetId: null,
    objectUrls: []
  };

  // ------------------------------------------------------------ DOM helpers

  const $ = (id) => document.getElementById(id);

  function append(parent, children) {
    for (const child of children.flat(Infinity)) {
      if (child === null || child === undefined || child === false) continue;
      parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return parent;
  }

  function h(tag, props, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
      else if (value === true) node.setAttribute(key, '');
      else node.setAttribute(key, String(value));
    }
    return append(node, children);
  }

  function icon(name, extraClass) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', extraClass ? `icon ${extraClass}` : 'icon');
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', `#i-${name}`);
    svg.appendChild(use);
    return svg;
  }

  const can = (perm) => Boolean(state.user && PERMS[perm].includes(state.user.role));
  const stale = (seq) => seq !== state.renderSeq || !state.user;

  // ------------------------------------------------------------ formatting

  const moneyFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const moneyFmt2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const numberFmt = new Intl.NumberFormat('en-US');
  const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const money = (n) => moneyFmt.format(n || 0);
  const money2 = (n) => moneyFmt2.format(n || 0);
  const num = (n) => numberFmt.format(n || 0);
  const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
  // Compliance is shown rounded down to one decimal so it is never overstated.
  const rateText = (rate) => String(Math.floor(rate * 10) / 10);

  function fmtDate(value) {
    if (!value) return '—';
    const dateOnly = value.length === 10;
    const d = new Date(dateOnly ? `${value}T00:00:00Z` : value);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: dateOnly ? 'UTC' : undefined });
  }

  function ago(iso) {
    const seconds = (Date.parse(iso) - Date.now()) / 1000;
    const units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
    for (const [unit, size] of units) {
      if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
    }
    return 'just now';
  }

  function daysUntil(date) {
    const today = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
    return Math.round((Date.parse(`${date}T00:00:00Z`) - today) / 86400000);
  }

  const initials = (fullName) => String(fullName || '?').split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  const titleCase = (value) => String(value).toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
  const personName = (employeeId) => state.people.get(employeeId) || employeeId;
  const LICENSE_TYPE_LABELS = { SAAS: 'SaaS', OEM: 'OEM' };
  const licenseTypeLabel = (type) => LICENSE_TYPE_LABELS[type] || titleCase(type);

  function greeting() {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  }

  // ------------------------------------------------------------ API & feedback

  async function api(path, options) {
    const opts = options || {};
    const headers = { Accept: 'application/json' };
    if (state.token) headers.Authorization = `Bearer ${state.token}`;
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(path, { method: opts.method || 'GET', headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
    if (res.status === 401 && state.token) {
      signOut('Your session expired. Please sign in again.');
      const expired = new Error('Session expired');
      expired.status = 401;
      throw expired;
    }
    if (opts.raw) {
      if (!res.ok) {
        const failed = new Error(`Request failed (${res.status})`);
        failed.status = res.status;
        throw failed;
      }
      return res;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(Array.isArray(data.errors) ? data.errors.join('. ') : data.detail || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function toast(message, tone) {
    const t = tone || 'ok';
    const iconName = { ok: 'check', bad: 'alert', warn: 'alert', info: 'info' }[t];
    const node = h('div', { class: 'toast' }, h('span', { class: `tone-${t}` }, icon(iconName)), h('span', { text: message }));
    $('status').appendChild(node);
    setTimeout(() => {
      node.classList.add('leaving');
      setTimeout(() => node.remove(), 240);
    }, 4200);
  }

  function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = h('a', { href: url, download: filename });
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ------------------------------------------------------------ theme

  function storedTheme() {
    try {
      return localStorage.getItem(THEME_KEY);
    } catch {
      return null;
    }
  }

  const effectiveTheme = () => document.documentElement.dataset.theme || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

  function syncThemeButton() {
    const dark = effectiveTheme() === 'dark';
    $('theme-icon').setAttribute('href', dark ? '#i-sun' : '#i-moon');
    $('theme-toggle').setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
  }

  function toggleTheme() {
    const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // Storage may be unavailable (private mode); the choice still applies to this tab.
    }
    syncThemeButton();
  }

  // ------------------------------------------------------------ shared components

  function pill(text, tone) {
    return h('span', { class: `pill ${tone === 'neutral' || tone === 'accent' ? `pill-${tone}` : `tone-${tone}`}`, text });
  }

  function assetPill(status) {
    const meta = ASSET_STATUS[status] || { label: titleCase(status), tone: 'neutral' };
    return pill(meta.label, meta.tone);
  }

  function emptyState(iconName, title, text) {
    return h('div', { class: 'empty' }, h('span', { class: 'empty-icon' }, icon(iconName)), h('p', { class: 'empty-title', text: title }), text ? h('p', { class: 'empty-text', text }) : null);
  }

  function card(title, subtitle, body, action) {
    return h('section', { class: 'card card-pad' },
      h('div', { class: 'card-head' }, h('div', null, h('h2', { text: title }), subtitle ? h('p', { text: subtitle }) : null), action || null),
      body);
  }

  function statTile({ label, value, unit, context, contextTone, contextIcon, iconName, tag }) {
    return h(tag || 'li', { class: 'kpi' },
      h('div', { class: 'kpi-top' }, h('span', { class: 'kpi-label', text: label }), h('span', { class: 'kpi-icon' }, icon(iconName))),
      h('p', { class: 'kpi-value' }, String(value), unit ? h('small', { text: unit }) : null),
      context ? h('p', { class: `kpi-context${contextTone ? ` tone-${contextTone}` : ''}` }, contextIcon ? icon(contextIcon) : null, h('span', { text: context })) : null);
  }

  function personCell(employeeId) {
    if (!employeeId) return h('span', { class: 'cell-sub', text: 'Unassigned' });
    const fullName = personName(employeeId);
    return h('span', { class: 'person' }, h('span', { class: 'avatar sm', 'aria-hidden': 'true', text: initials(fullName) }),
      h('span', null, h('span', { class: 'cell-main', text: fullName }), fullName !== employeeId ? h('span', { class: 'cell-sub', text: employeeId }) : null));
  }

  function linkButton(text, href) {
    return h('a', { class: 'card-link', href }, text, icon('arrow-right'));
  }

  // Tooltip shared by chart marks; the same text is always in the legend or table too.
  function attachTooltip(target, lines) {
    const tip = $('tooltip');
    const show = (x, y) => {
      tip.replaceChildren(h('strong', { text: lines[0] }), h('span', { text: lines[1] }));
      tip.hidden = false;
      const rect = tip.getBoundingClientRect();
      tip.style.left = `${Math.min(window.innerWidth - rect.width - 8, Math.max(8, x - rect.width / 2))}px`;
      tip.style.top = `${Math.max(8, y - rect.height - 12)}px`;
    };
    target.addEventListener('pointermove', (e) => show(e.clientX, e.clientY));
    target.addEventListener('pointerleave', () => { tip.hidden = true; });
    target.addEventListener('focus', () => {
      const r = target.getBoundingClientRect();
      show(r.left + r.width / 2, r.top);
    });
    target.addEventListener('blur', () => { tip.hidden = true; });
  }

  // ------------------------------------------------------------ charts

  function fleetChart(byStatus) {
    const total = FLEET_SERIES.reduce((n, [key]) => n + (byStatus[key] || 0), 0);
    const bar = h('div', { class: 'stacked-bar', role: 'group', 'aria-label': 'Assets by status' });
    if (!total) bar.appendChild(h('span', { class: 'stacked-empty' }));
    for (const [key, cls] of FLEET_SERIES) {
      const count = byStatus[key] || 0;
      if (!count) continue;
      const label = ASSET_STATUS[key].label;
      const text = `${num(count)} ${count === 1 ? 'asset' : 'assets'} · ${pct(count, total)}%`;
      const seg = h('span', { class: `stacked-seg ${cls}`, tabindex: '0', role: 'img', 'aria-label': `${label}: ${text}` });
      seg.style.flexGrow = String(count);
      attachTooltip(seg, [text, label]);
      bar.appendChild(seg);
    }
    const legend = h('ul', { class: 'legend' }, FLEET_SERIES.map(([key, cls]) => h('li', null,
      h('span', { class: `swatch ${cls}`, 'aria-hidden': 'true' }),
      h('span', { class: 'legend-label', text: ASSET_STATUS[key].label }),
      h('span', { class: 'legend-value', text: num(byStatus[key] || 0) }),
      h('span', { class: 'legend-pct', text: `${pct(byStatus[key] || 0, total)}%` }))));
    return h('div', null, h('p', { class: 'kpi-value' }, num(total), h('small', { text: total === 1 ? 'asset' : 'assets' })), bar, legend);
  }

  function complianceTone(rate) {
    if (rate >= 100) return { tone: 'ok', icon: 'check', label: 'Fully compliant' };
    if (rate >= 90) return { tone: 'warn', icon: 'alert', label: 'Minor deficit' };
    return { tone: 'bad', icon: 'alert', label: 'Non-compliant' };
  }

  function ringMeter(rate, recon) {
    const radius = 52;
    const circumference = 2 * Math.PI * radius;
    const meta = complianceTone(rate);
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 120 120');
    svg.setAttribute('aria-hidden', 'true');
    const track = document.createElementNS(SVG_NS, 'circle');
    const arc = document.createElementNS(SVG_NS, 'circle');
    for (const c of [track, arc]) {
      c.setAttribute('cx', '60');
      c.setAttribute('cy', '60');
      c.setAttribute('r', String(radius));
    }
    track.setAttribute('class', 'ring-track');
    arc.setAttribute('class', 'ring-arc');
    arc.setAttribute('stroke-dasharray', String(circumference));
    arc.setAttribute('stroke-dashoffset', String(circumference));
    svg.append(track, arc);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      arc.setAttribute('stroke-dashoffset', String(circumference * (1 - Math.min(100, rate) / 100)));
    }));
    const covered = recon.totalInstalls - recon.totalDeficit;
    return h('div', null,
      h('div', { class: `ring tone-${meta.tone}`, role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(rate), 'aria-label': `License compliance ${rateText(rate)}%` },
        svg, h('div', { class: 'ring-center' }, h('span', { class: 'ring-value', text: `${rateText(rate)}%` }), h('span', { class: 'ring-label', text: 'licensed installs' }))),
      h('p', { class: `ring-status tone-${meta.tone}` }, icon(meta.icon), meta.label),
      h('p', { class: 'ring-caption', text: recon.totalInstalls ? `${num(covered)} of ${num(recon.totalInstalls)} detected installs are covered by a license` : 'No endpoint scans received yet' }));
  }

  function meter(used, total, label, inline) {
    const m = h('div', { class: inline ? 'meter inline' : 'meter', role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': String(total), 'aria-valuenow': String(used), 'aria-label': label });
    const fill = h('div', { class: 'meter-fill' });
    fill.style.width = `${Math.min(100, pct(used, total))}%`;
    m.appendChild(fill);
    return m;
  }

  function seatMeters(licenses) {
    const rows = [...licenses].sort((a, b) => pct(b.usedSeats, b.totalSeats) - pct(a.usedSeats, a.totalSeats)).slice(0, 5);
    if (!rows.length) return emptyState('key', 'No license pools yet', 'Add a license to start tracking seats.');
    return h('div', null, rows.map((l) => h('div', { class: 'meter-row' },
      h('div', { class: 'meter-head' }, h('span', { class: 'meter-name', text: l.softwareName }), h('span', { class: 'meter-value', text: `${num(l.usedSeats)} / ${num(l.totalSeats)} seats · ${pct(l.usedSeats, l.totalSeats)}%` })),
      meter(l.usedSeats, l.totalSeats, `${l.softwareName} seats in use`))));
  }

  function alertFeed(notes, limit) {
    const items = notes.slice(0, limit || notes.length);
    if (!items.length) return emptyState('bell', 'All quiet', 'No alerts have been raised.');
    return h('ul', { class: 'feed' }, items.map((n) => {
      const sev = SEVERITY[n.severity] || SEVERITY.LOW;
      return h('li', null,
        h('span', { class: `feed-icon tone-${sev.tone}` }, icon(sev.icon)),
        h('div', { class: 'feed-body' },
          h('p', { class: 'feed-title', text: n.title }),
          h('p', { class: 'feed-text', text: n.message }),
          h('p', { class: 'feed-meta' }, pill(sev.label, sev.tone), h('span', { text: titleCase(n.type) }), h('span', { text: '·' }), h('span', { text: ago(n.createdAt) }))));
    }));
  }

  function deviceList(assets) {
    if (!assets.length) return emptyState('laptop', 'No devices assigned', 'Devices checked out to you will appear here.');
    return h('ul', { class: 'device-list' }, assets.map((a) => h('li', { class: 'device' },
      h('span', { class: 'device-icon' }, icon(CATEGORY_ICON[a.category] || 'box')),
      h('span', null, h('span', { class: 'cell-main', text: a.model || titleCase(a.category) }), h('span', { class: 'cell-sub mono', text: a.assetTag })))));
  }

  // ------------------------------------------------------------ modal & drawer

  function closeButton(dialog, label) {
    return h('button', { type: 'button', class: 'icon-btn', 'aria-label': label || 'Close', onclick: () => dialog.close() }, icon('x'));
  }

  function fieldControl(spec, id) {
    const common = { id, name: spec.name, required: spec.required || undefined };
    if (spec.type === 'select') {
      const select = h('select', common, (spec.options || []).map(([value, text]) => h('option', { value, text })));
      if (spec.value !== undefined) select.value = spec.value;
      return select;
    }
    if (spec.type === 'textarea') {
      const area = h('textarea', { ...common, placeholder: spec.placeholder, maxlength: spec.maxLength });
      if (spec.value) area.value = spec.value;
      return area;
    }
    if (spec.type === 'checkbox') {
      const box = h('input', { ...common, type: 'checkbox' });
      box.checked = Boolean(spec.value);
      return box;
    }
    const input = h('input', { ...common, type: spec.type || 'text', placeholder: spec.placeholder, min: spec.min, step: spec.step, maxlength: spec.maxLength, autocomplete: 'off' });
    if (spec.value !== undefined && spec.value !== null) input.value = spec.value;
    return input;
  }

  /**
   * Opens a form dialog. `fields` describe inputs; `onSubmit(values)` may
   * throw, in which case the message is shown inside the dialog.
   */
  function openModal({ title, description, fields, submitLabel, danger, onSubmit, content }) {
    const dialog = $('modal');
    const opener = document.activeElement;
    const error = h('p', { class: 'form-error', role: 'alert', hidden: true });
    const wrappers = [];
    const grid = h('div', { class: 'form-grid' });
    for (const spec of fields || []) {
      const id = `f-${spec.name}`;
      const control = fieldControl(spec, id);
      const wrapper = spec.type === 'checkbox'
        ? h('div', { class: `field${spec.span2 ? ' span-2' : ''}` }, h('label', { class: 'check', for: id }, control, spec.label), spec.hint ? h('p', { class: 'hint', text: spec.hint }) : null)
        : h('div', { class: `field${spec.span2 ? ' span-2' : ''}` }, h('label', { for: id, text: spec.required ? `${spec.label} *` : spec.label }), control, spec.hint ? h('p', { class: 'hint', text: spec.hint }) : null);
      wrappers.push({ spec, wrapper, control });
      grid.appendChild(wrapper);
    }
    const values = () => {
      const out = {};
      for (const { spec, wrapper, control } of wrappers) {
        if (wrapper.hidden) continue;
        if (spec.type === 'checkbox') out[spec.name] = control.checked;
        else if (control.value.trim() !== '') out[spec.name] = spec.type === 'number' ? Number(control.value) : control.value.trim();
      }
      return out;
    };
    const applyVisibility = () => {
      const current = values();
      for (const { spec, wrapper } of wrappers) if (spec.showWhen) wrapper.hidden = !spec.showWhen(current);
    };
    const submit = h('button', { type: 'submit', class: danger ? 'btn btn-danger' : 'btn btn-primary', text: submitLabel || 'Save' });
    const form = h('form', { novalidate: true },
      h('div', { class: 'dialog-head' }, h('div', null, h('h2', { id: 'modal-title', text: title }), description ? h('p', { text: description }) : null), closeButton(dialog)),
      h('div', { class: 'dialog-body' }, error, content || null, wrappers.length ? grid : null),
      h('div', { class: 'dialog-foot' }, h('button', { type: 'button', class: 'btn btn-ghost', text: onSubmit ? 'Cancel' : 'Close', onclick: () => dialog.close() }), onSubmit ? submit : null));
    form.addEventListener('input', applyVisibility);
    form.addEventListener('change', applyVisibility);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!onSubmit) return;
      const missing = wrappers.filter(({ spec, wrapper, control }) => spec.required && !wrapper.hidden && spec.type !== 'checkbox' && !control.value.trim());
      if (missing.length) {
        error.textContent = `Please fill in: ${missing.map(({ spec }) => spec.label).join(', ')}`;
        error.hidden = false;
        missing[0].control.focus();
        return;
      }
      submit.disabled = true;
      error.hidden = true;
      try {
        await onSubmit(values());
        dialog.close();
      } catch (err) {
        if (err.status !== 401) {
          error.textContent = err.message;
          error.hidden = false;
        }
      } finally {
        submit.disabled = false;
      }
    });
    dialog.replaceChildren(form);
    applyVisibility();
    dialog.onclose = () => {
      dialog.replaceChildren();
      if (opener && typeof opener.focus === 'function' && document.contains(opener)) opener.focus();
    };
    dialog.showModal();
    const first = form.querySelector('input, select, textarea');
    if (first) first.focus();
  }

  function revokeObjectUrls() {
    for (const url of state.objectUrls) URL.revokeObjectURL(url);
    state.objectUrls = [];
  }

  // ------------------------------------------------------------ asset drawer

  async function openAsset(id) {
    const drawer = $('drawer');
    state.drawerAssetId = id;
    if (!drawer.open) {
      state.drawerOpener = document.activeElement;
      drawer.replaceChildren(h('div', { class: 'drawer-inner' }, h('div', { class: 'drawer-body', 'aria-busy': 'true' },
        h('h2', { id: 'drawer-title', class: 'visually-hidden', text: 'Loading asset' }),
        h('div', { class: 'skeleton skeleton-card' }), h('div', { class: 'skeleton skeleton-card' }))));
      drawer.showModal();
    }
    try {
      const [asset, maintenance, depreciation, labelRes] = await Promise.all([
        api(`/api/v1/assets/${id}`),
        api(`/api/v1/assets/${id}/maintenance`),
        api(`/api/v1/assets/${id}/depreciation`).catch(() => null),
        api(`/api/v1/assets/${id}/label.svg`, { raw: true })
      ]);
      revokeObjectUrls();
      const labelUrl = URL.createObjectURL(await labelRes.blob());
      state.objectUrls.push(labelUrl);
      if (state.drawerAssetId === id && drawer.open) drawer.replaceChildren(assetDrawer(asset, maintenance, depreciation, labelUrl));
    } catch (err) {
      if (err.status !== 401) {
        drawer.close();
        toast(err.message, 'bad');
      }
    }
  }

  function assetDrawer(asset, maintenance, dep, labelUrl) {
    const drawer = $('drawer');
    const warranty = asset.warrantyExpiry ? daysUntil(asset.warrantyExpiry) : null;
    let warrantyPill = null;
    if (warranty !== null) {
      if (warranty < 0) warrantyPill = pill('Expired', 'bad');
      else if (warranty <= 60) warrantyPill = pill(`${warranty} days left`, 'warn');
    }

    const facts = [
      ['Serial number', h('span', { class: 'mono', text: asset.serialNumber })],
      ['Category', titleCase(asset.category)],
      ['Manufacturer', asset.manufacturer || '—'],
      ['MAC address', asset.macAddress ? h('span', { class: 'mono', text: asset.macAddress }) : '—'],
      ['Purchased', fmtDate(asset.purchaseDate)],
      ['Purchase cost', money2(asset.purchaseCost)],
      ['Warranty until', h('span', null, fmtDate(asset.warrantyExpiry), warrantyPill ? ' ' : null, warrantyPill)],
      ['Source', asset.source === 'PROCUREMENT' ? 'Purchase order' : 'Manual registration'],
      ['Location', asset.location || '—'],
      ['Maintenance spend', money2(asset.totalMaintenanceCost)]
    ];

    const sections = [
      h('section', { class: 'panel' }, h('h3', { text: 'Asset label' }),
        h('div', { class: 'label-preview' }, h('img', { src: labelUrl, alt: `Code 128 barcode label for ${asset.assetTag}`, width: '360' })),
        h('div', { class: 'label-actions' }, h('a', { class: 'btn btn-secondary btn-sm', href: labelUrl, download: `${asset.assetTag}.svg` }, icon('download'), 'Download label'))),
      h('section', { class: 'panel' }, h('h3', { text: 'Details' }), h('dl', { class: 'facts' }, facts.map(([dt, dd]) => h('div', null, h('dt', { text: dt }), h('dd', null, dd)))))
    ];

    if (dep) {
      sections.push(h('section', { class: 'panel' }, h('h3', { text: 'Depreciation' }),
        h('div', { class: 'dep-grid' },
          h('div', null, h('p', { text: 'Current book value' }), h('span', { class: 'big-number', text: money2(dep.bookValue) })),
          h('div', null, h('p', { text: `Straight-line over ${dep.lifespanYears} years` }), h('strong', { text: `${money2(dep.annualDepreciation)} per year` }))),
        meter(dep.accumulatedDepreciation, Math.max(dep.cost, 0.01), 'Share of cost depreciated'),
        h('p', { class: 'ring-caption', text: `${money2(dep.accumulatedDepreciation)} depreciated since ${fmtDate(dep.purchaseDate)} (${pct(dep.accumulatedDepreciation, dep.cost)}% of cost)` })));
    }

    const history = [...asset.assignmentHistory].reverse();
    sections.push(h('section', { class: 'panel' }, h('h3', { text: 'Assignment history' }),
      history.length
        ? h('ol', { class: 'timeline' }, history.map((entry) => h('li', null,
          h('strong', { text: personName(entry.employeeId) }),
          h('span', { class: 'when', text: `Checked out ${fmtDate(entry.checkedOutAt)}${entry.checkedInAt ? ` · returned ${fmtDate(entry.checkedInAt)}` : ' · currently assigned'}` }))))
        : h('p', { class: 'section-note', text: 'This asset has never been checked out.' })));

    sections.push(h('section', { class: 'panel' }, h('h3', { text: 'Maintenance' }),
      maintenance.length
        ? h('ul', { class: 'feed' }, [...maintenance].reverse().map((m) => h('li', null,
          h('span', { class: `feed-icon ${m.status === 'OPEN' ? 'tone-warn' : 'tone-info'}` }, icon('wrench')),
          h('div', { class: 'feed-body' },
            h('p', { class: 'feed-title', text: `${titleCase(m.type)}: ${m.description}` }),
            h('p', { class: 'feed-meta' }, pill(m.status === 'OPEN' ? 'Open' : 'Completed', m.status === 'OPEN' ? 'warn' : 'ok'), h('span', { text: `${money2(m.cost)} · ${m.technician} · ${fmtDate(m.serviceDate)}` }))))))
        : h('p', { class: 'section-note', text: 'No maintenance has been logged.' })));

    if (asset.decommission) {
      const d = asset.decommission;
      sections.push(h('section', { class: 'panel' }, h('h3', { text: 'Decommissioning certificate' }), h('dl', { class: 'facts' },
        [['Certificate', d.certificateId], ['Method', `${titleCase(d.sanitizationMethod)} (${d.sanitizationStandard})`], ['Performed by', d.performedBy], ['Date', fmtDate(d.decommissionedAt)]]
          .map(([dt, dd]) => h('div', null, h('dt', { text: dt }), h('dd', { text: dd }))))));
    }

    const actions = [];
    if (can('assetAssign') && asset.status === 'AVAILABLE') {
      actions.push(h('button', { type: 'button', class: 'btn btn-primary', onclick: () => checkoutModal(asset) }, icon('user'), 'Check out'));
    }
    if (can('assetAssign') && asset.status === 'IN_USE') {
      actions.push(h('button', { type: 'button', class: 'btn btn-primary', onclick: () => checkin(asset) }, icon('check'), 'Check in'));
    }
    if (can('assetMaintain') && asset.status !== 'DECOMMISSIONED') {
      actions.push(h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => maintenanceModal(asset) }, icon('wrench'), 'Log maintenance'));
    }

    return h('div', { class: 'drawer-inner' },
      h('header', { class: 'drawer-head' },
        h('div', { class: 'drawer-head-top' }, h('span', { class: 'chip mono' }, icon('barcode'), asset.assetTag), closeButton(drawer, 'Close asset details')),
        h('h2', { id: 'drawer-title', text: asset.model || 'Unnamed device' }),
        h('p', { text: [asset.manufacturer, titleCase(asset.category)].filter(Boolean).join(' · ') }),
        h('div', { class: 'feed-meta' }, assetPill(asset.status), asset.assignedTo ? h('span', { text: `Assigned to ${personName(asset.assignedTo)}` }) : null)),
      h('div', { class: 'drawer-body' }, sections),
      actions.length ? h('footer', { class: 'drawer-foot' }, actions) : null);
  }

  function afterAssetChange(id, message) {
    toast(message);
    if ($('drawer').open) openAsset(id);
    renderView(state.view, { quiet: true });
  }

  function checkoutModal(asset) {
    const options = state.directory.map((p) => [p.employeeId, `${p.fullName} · ${p.employeeId}`]);
    openModal({
      title: `Check out ${asset.assetTag}`,
      description: `${asset.model || 'Device'} will be assigned to the selected person.`,
      submitLabel: 'Check out',
      fields: [
        { name: 'employeeId', label: 'Assign to', type: 'select', required: true, options: [['', 'Choose a person'], ...options], span2: true },
        { name: 'notes', label: 'Notes', type: 'textarea', placeholder: 'Optional, for example "New starter laptop"', maxLength: 500, span2: true }
      ],
      onSubmit: async (values) => {
        await api(`/api/v1/assets/${asset.id}/checkout`, { method: 'POST', body: values });
        afterAssetChange(asset.id, `${asset.assetTag} checked out to ${personName(values.employeeId)}`);
      }
    });
  }

  async function checkin(asset) {
    try {
      await api(`/api/v1/assets/${asset.id}/checkin`, { method: 'POST', body: {} });
      afterAssetChange(asset.id, `${asset.assetTag} checked in and available`);
    } catch (err) {
      if (err.status !== 401) toast(err.message, 'bad');
    }
  }

  function maintenanceModal(asset) {
    openModal({
      title: `Log maintenance for ${asset.assetTag}`,
      submitLabel: 'Save record',
      fields: [
        { name: 'type', label: 'Type', type: 'select', required: true, options: [['REPAIR', 'Repair'], ['UPGRADE', 'Upgrade'], ['PREVENTIVE', 'Preventive'], ['INSPECTION', 'Inspection']] },
        { name: 'cost', label: 'Cost (USD)', type: 'number', min: '0', step: '0.01', value: '0' },
        { name: 'description', label: 'Description', type: 'textarea', required: true, placeholder: 'What was done and why', span2: true },
        { name: 'technician', label: 'Technician', required: true, value: state.user.fullName },
        { name: 'vendor', label: 'Vendor', placeholder: 'Optional' },
        { name: 'outOfService', label: 'Take the device out of service until this is completed', type: 'checkbox', span2: true, hint: asset.status === 'IN_USE' ? 'The device is checked out; check it in first to take it out of service.' : undefined }
      ],
      onSubmit: async (values) => {
        await api(`/api/v1/assets/${asset.id}/maintenance`, { method: 'POST', body: values });
        afterAssetChange(asset.id, 'Maintenance record saved');
      }
    });
  }

  function registerAssetModal() {
    openModal({
      title: 'Register hardware asset',
      description: 'A unique asset tag is generated if you leave the tag empty.',
      submitLabel: 'Register asset',
      fields: [
        { name: 'serialNumber', label: 'Serial number', required: true, placeholder: '5CD1234XYZ' },
        { name: 'assetTag', label: 'Asset tag', placeholder: 'Auto-generated' },
        { name: 'manufacturer', label: 'Manufacturer', placeholder: 'Dell' },
        { name: 'model', label: 'Model', placeholder: 'Latitude 5430' },
        { name: 'category', label: 'Category', type: 'select', options: CATEGORIES.map((c) => [c, titleCase(c)]), value: 'LAPTOP' },
        { name: 'purchaseCost', label: 'Purchase cost (USD)', type: 'number', min: '0', step: '0.01' },
        { name: 'purchaseDate', label: 'Purchase date', type: 'date' },
        { name: 'warrantyExpiry', label: 'Warranty expiry', type: 'date' },
        { name: 'macAddress', label: 'MAC address', placeholder: 'AA:BB:CC:DD:EE:FF', span2: true }
      ],
      onSubmit: async (values) => {
        const asset = await api('/api/v1/assets', { method: 'POST', body: values });
        toast(`Registered ${asset.assetTag}`);
        renderView(state.view, { quiet: true });
        openAsset(asset.id);
      }
    });
  }

  // ------------------------------------------------------------ procurement helpers

  function needsMyAction(pr) {
    const u = state.user;
    if (STAGE_ROLE[pr.state] === u.role) return pr.requesterId !== u.id && !pr.approvals.some((a) => a.approverId === u.id);
    if (pr.state === 'APPROVED') return can('procurementOrder');
    if (pr.state === 'PO_ISSUED') return can('procurementReceive');
    return false;
  }

  const STEPS = ['Submitted', 'Manager', 'Director', 'Finance', 'Ordered', 'Delivered'];
  const STEP_INDEX = { PENDING_MANAGER_APPROVAL: 1, PENDING_DIRECTOR_APPROVAL: 2, PENDING_FINANCE_APPROVAL: 3, APPROVED: 4, PO_ISSUED: 5, DELIVERED: 6 };

  function stepper(pr) {
    const rejectedAt = pr.state === 'REJECTED' ? STEP_INDEX[pr.rejection.stage] : -1;
    const current = pr.state === 'REJECTED' ? rejectedAt : STEP_INDEX[pr.state];
    return h('ol', { class: 'stepper', 'aria-label': 'Approval progress' }, STEPS.map((label, i) => {
      let cls = 'step';
      let dot = String(i + 1);
      if (i === rejectedAt) {
        cls += ' rejected';
        dot = icon('x');
      } else if (i < current) {
        cls += ' done';
        dot = icon('check');
      } else if (i === current) {
        cls += ' current';
      }
      return h('li', { class: cls, 'aria-current': i === current && pr.state !== 'DELIVERED' ? 'step' : undefined }, h('span', { class: 'step-dot', 'aria-hidden': 'true' }, dot), h('span', { text: label }));
    }));
  }

  function requisitionCard(pr, compact) {
    const meta = PR_STATE[pr.state];
    const actions = [];
    if (needsMyAction(pr) && STAGE_ROLE[pr.state]) {
      actions.push(h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => approveModal(pr) }, icon('check'), 'Approve'));
      actions.push(h('button', { type: 'button', class: 'btn btn-danger btn-sm', onclick: () => rejectModal(pr) }, icon('x'), 'Reject'));
    } else if (needsMyAction(pr) && pr.state === 'APPROVED') {
      actions.push(h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => purchaseOrderModal(pr) }, icon('file'), 'Issue purchase order'));
    } else if (needsMyAction(pr) && pr.state === 'PO_ISSUED') {
      actions.push(h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => deliveryModal(pr) }, icon('box'), 'Receive delivery'));
    }
    return h('article', { class: 'card req' },
      h('div', { class: 'req-head' },
        h('span', { class: 'chip mono', text: pr.prNumber }),
        h('span', { class: 'chip' }, icon(pr.itemType === 'HARDWARE' ? 'laptop' : 'key'), pr.itemType === 'HARDWARE' ? 'Hardware' : 'Software license'),
        pill(meta.label, meta.tone)),
      h('h3', { class: 'req-title', text: pr.itemDescription }),
      h('p', { class: 'req-meta' },
        h('span', null, `${num(pr.quantity)} × ${money2(pr.estimatedUnitCost)} = `, h('strong', { text: money2(pr.estimatedTotal) })),
        h('span', { text: `Requested by ${pr.requesterName}` }),
        h('span', { text: ago(pr.createdAt) })),
      compact ? null : h('p', { class: 'req-just', text: pr.businessJustification }),
      pr.rejection ? h('p', { class: 'req-just tone-bad', text: `Rejected by ${pr.rejection.rejectedBy}: ${pr.rejection.reason}` }) : null,
      h('div', { class: 'req-foot' }, stepper(pr), actions.length ? h('div', { class: 'req-actions' }, actions) : null));
  }

  function afterProcurementChange(message) {
    toast(message);
    renderView(state.view, { quiet: true });
    refreshBadges();
  }

  function newRequisitionModal() {
    openModal({
      title: 'New purchase request',
      description: 'Requests go to your manager, then the IT director, then finance.',
      submitLabel: 'Submit request',
      fields: [
        { name: 'itemType', label: 'Type', type: 'select', required: true, options: [['HARDWARE', 'Hardware'], ['SOFTWARE_LICENSE', 'Software license']] },
        { name: 'category', label: 'Hardware category', type: 'select', options: CATEGORIES.map((c) => [c, titleCase(c)]), value: 'LAPTOP', showWhen: (v) => v.itemType === 'HARDWARE' },
        { name: 'softwareName', label: 'Software name', required: true, placeholder: 'Figma', showWhen: (v) => v.itemType === 'SOFTWARE_LICENSE' },
        { name: 'itemDescription', label: 'Item description', required: true, placeholder: 'Dell UltraSharp 27 monitor', span2: true },
        { name: 'quantity', label: 'Quantity', type: 'number', required: true, min: '1', step: '1', value: '1' },
        { name: 'estimatedUnitCost', label: 'Unit cost (USD)', type: 'number', required: true, min: '0.01', step: '0.01' },
        { name: 'businessJustification', label: 'Business justification', type: 'textarea', required: true, placeholder: 'Why is this needed? At least 10 characters.', span2: true },
        { name: 'department', label: 'Department', placeholder: 'Optional', span2: true }
      ],
      onSubmit: async (values) => {
        const pr = await api('/api/v1/procurement/requisitions', { method: 'POST', body: values });
        afterProcurementChange(`${pr.prNumber} submitted for approval`);
      }
    });
  }

  function approveModal(pr) {
    openModal({
      title: `Approve ${pr.prNumber}`,
      description: `${pr.itemDescription} · ${money2(pr.estimatedTotal)}`,
      submitLabel: 'Approve',
      fields: [{ name: 'comment', label: 'Comment', type: 'textarea', placeholder: 'Optional note for the next approver', span2: true }],
      onSubmit: async (values) => {
        const updated = await api(`/api/v1/procurement/requisitions/${pr.id}/approve`, { method: 'POST', body: values });
        afterProcurementChange(`${pr.prNumber} approved · now ${PR_STATE[updated.state].label}`);
      }
    });
  }

  function rejectModal(pr) {
    openModal({
      title: `Reject ${pr.prNumber}`,
      description: 'The requester will see your reason.',
      submitLabel: 'Reject request',
      danger: true,
      fields: [{ name: 'reason', label: 'Reason', type: 'textarea', required: true, placeholder: 'At least 5 characters', span2: true }],
      onSubmit: async (values) => {
        await api(`/api/v1/procurement/requisitions/${pr.id}/reject`, { method: 'POST', body: values });
        afterProcurementChange(`${pr.prNumber} rejected`);
      }
    });
  }

  function purchaseOrderModal(pr) {
    openModal({
      title: `Issue purchase order for ${pr.prNumber}`,
      description: `${num(pr.quantity)} × ${pr.itemDescription} · ${money2(pr.estimatedTotal)}`,
      submitLabel: 'Issue purchase order',
      fields: [
        { name: 'vendorName', label: 'Vendor', required: true, placeholder: 'Dell Technologies', span2: true },
        { name: 'expectedDeliveryDate', label: 'Expected delivery', type: 'date', span2: true }
      ],
      onSubmit: async (values) => {
        const po = await api(`/api/v1/procurement/requisitions/${pr.id}/purchase-order`, { method: 'POST', body: values });
        afterProcurementChange(`${po.poNumber} issued to ${po.vendorName}`);
      }
    });
  }

  function deliveryModal(pr) {
    const hardware = pr.itemType === 'HARDWARE';
    openModal({
      title: `Receive delivery for ${pr.prNumber}`,
      description: hardware ? `Enter the ${pr.quantity} serial number(s) printed on the delivered items. Each becomes an asset in stock.` : 'The purchased seats become a new license pool.',
      submitLabel: 'Confirm delivery',
      fields: hardware
        ? [
          { name: 'serialNumbers', label: 'Serial numbers (one per line)', type: 'textarea', required: true, span2: true },
          { name: 'warrantyExpiry', label: 'Warranty expiry', type: 'date' },
          { name: 'location', label: 'Location', placeholder: 'Optional' }
        ]
        : [
          { name: 'licenseKey', label: 'Product key', placeholder: 'Optional', span2: true },
          { name: 'validUntil', label: 'Valid until', type: 'date', span2: true }
        ],
      onSubmit: async (values) => {
        const body = { ...values };
        if (hardware) body.serialNumbers = values.serialNumbers.split(/[\s,]+/).filter(Boolean);
        await api(`/api/v1/procurement/purchase-orders/${pr.purchaseOrderId}/deliver`, { method: 'POST', body });
        afterProcurementChange(hardware ? `${body.serialNumbers.length} asset(s) added to stock` : 'License pool created');
      }
    });
  }

  // ------------------------------------------------------------ views

  function skeletonOverview() {
    return h('div', { 'aria-busy': 'true' },
      h('div', { class: 'skeleton skeleton-card', 'aria-hidden': 'true' }),
      h('div', { class: 'kpi-grid', 'aria-hidden': 'true' }, [1, 2, 3, 4].map(() => h('div', { class: 'skeleton skeleton-tile' }))),
      h('div', { class: 'grid grid-2', 'aria-hidden': 'true' }, h('div', { class: 'skeleton skeleton-card' }), h('div', { class: 'skeleton skeleton-card' })));
  }

  async function renderOverview(el, seq) {
    if (!el.childElementCount) el.replaceChildren(skeletonOverview());
    const u = state.user;
    const [summary, licenses, notes, recon, reqs] = await Promise.all([
      api('/api/v1/dashboard/summary'),
      can('licenseRead') ? api('/api/v1/licenses') : null,
      can('notificationsRead') ? api('/api/v1/notifications?limit=6') : null,
      can('complianceRead') ? api('/api/v1/compliance/reconciliation') : null,
      api('/api/v1/procurement/requisitions')
    ]);
    if (stale(seq)) return;

    const awaiting = reqs.filter(needsMyAction);
    const awaitingValue = awaiting.reduce((n, pr) => n + pr.estimatedTotal, 0);
    const mine = reqs.filter((pr) => pr.requesterId === u.id);
    const firstName = u.fullName.split(' ')[0];
    const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
    let lede = 'Everything is up to date.';
    if (awaiting.length) lede = `${awaiting.length} request${awaiting.length === 1 ? '' : 's'} worth ${money(awaitingValue)} ${awaiting.length === 1 ? 'needs' : 'need'} your attention.`;
    else if (recon && recon.hasBreaches) lede = `License deficit detected: ${recon.totalDeficit} seat${recon.totalDeficit === 1 ? '' : 's'} short.`;

    const heroActions = [];
    if (can('assetCreate')) heroActions.push(h('button', { type: 'button', class: 'btn btn-primary', onclick: registerAssetModal }, icon('plus'), 'Register asset'));
    if (can('procurementRequest')) heroActions.push(h('button', { type: 'button', class: heroActions.length ? 'btn btn-secondary' : 'btn btn-primary', onclick: newRequisitionModal }, icon('cart'), 'New request'));

    const hero = h('section', { class: 'hero' },
      h('div', null, h('h2', { text: `${greeting()}, ${firstName}` }), h('p', { text: `${today} · ${lede}` }), h('span', { class: 'role-pill' }, icon('user'), ROLE_LABELS[u.role])),
      heroActions.length ? h('div', { class: 'hero-actions' }, heroActions) : null);

    const tiles = [];
    if (summary.assets) {
      const s = summary.assets.byStatus;
      tiles.push({ label: 'Hardware assets', value: num(summary.assets.total), context: `${num(s.IN_USE)} in use · ${num(s.AVAILABLE)} available`, iconName: 'laptop' });
      const lic = summary.licenses;
      tiles.push(lic.totalSeats
        ? { label: 'Seat utilisation', value: pct(lic.usedSeats, lic.totalSeats), unit: '%', context: `${num(lic.usedSeats)} of ${num(lic.totalSeats)} seats allocated`, iconName: 'key' }
        : { label: 'Seat utilisation', value: '—', context: 'No license pools yet', iconName: 'key' });
      if (recon) {
        const meta = complianceTone(recon.complianceRate);
        tiles.push({ label: 'License compliance', value: rateText(recon.complianceRate), unit: '%', context: recon.hasBreaches ? `${recon.totalDeficit} seat deficit` : meta.label, contextTone: meta.tone, contextIcon: meta.icon, iconName: 'shield' });
        tiles.push({ label: 'Open security incidents', value: num(summary.openIncidents), context: summary.openIncidents ? 'Prohibited software detected' : 'No prohibited software', contextTone: summary.openIncidents ? 'bad' : 'ok', contextIcon: summary.openIncidents ? 'alert' : 'check', iconName: 'alert' });
      } else {
        tiles.push({ label: 'Under repair', value: num(s.UNDER_REPAIR), context: 'Out of service for maintenance', iconName: 'wrench' });
      }
    }
    if (awaiting.length || ['MANAGER', 'IT_DIRECTOR', 'FINANCE_OFFICER'].includes(u.role)) {
      tiles.push({ label: 'Awaiting your action', value: num(awaiting.length), context: awaiting.length ? `${money(awaitingValue)} in pending value` : 'Nothing waiting for you', contextTone: awaiting.length ? 'warn' : 'ok', contextIcon: awaiting.length ? 'clock' : 'check', iconName: 'cart' });
    }
    if (!summary.assets) {
      tiles.push({ label: 'My devices', value: num(summary.myAssets.length), context: summary.myAssets.length ? 'Assigned to you' : 'None assigned', iconName: 'laptop' });
      tiles.push({ label: 'My open requests', value: num(mine.filter((pr) => !['DELIVERED', 'REJECTED'].includes(pr.state)).length), context: `${num(mine.filter((pr) => pr.state === 'DELIVERED').length)} delivered`, iconName: 'cart' });
    }

    const content = [hero, h('ul', { class: 'kpi-grid' }, tiles.map((t) => statTile(t)))];

    if (summary.assets) {
      content.push(h('div', { class: 'grid grid-main' },
        card('Fleet status', 'Every registered device by lifecycle state', fleetChart(summary.assets.byStatus), linkButton('View assets', '#/assets')),
        recon
          ? card('License compliance', 'Detected installs covered by purchased seats', ringMeter(recon.complianceRate, recon), linkButton('Details', '#/compliance'))
          : card('Seat utilisation', 'Most-used license pools', seatMeters(licenses || []), linkButton('Licenses', '#/licenses'))));
      const second = [];
      if (recon) second.push(card('Seat utilisation', 'Most-used license pools', seatMeters(licenses || []), linkButton('Licenses', '#/licenses')));
      if (notes) second.push(card('Recent alerts', 'Breaches, incidents and expiries', alertFeed(notes, 5), linkButton('All alerts', '#/alerts')));
      if (second.length) content.push(h('div', { class: 'grid grid-2' }, second));
    }
    if (awaiting.length) {
      content.push(card('Waiting for you', 'Requests at your stage of the approval chain', h('div', { class: 'req-list' }, awaiting.slice(0, 3).map((pr) => requisitionCard(pr, true))), linkButton('Procurement', '#/procurement')));
    }
    const lower = [];
    if (!summary.assets || summary.myAssets.length) lower.push(card('My devices', 'Hardware assigned to you', deviceList(summary.myAssets)));
    if (!summary.assets && mine.length) lower.push(card('My requests', 'Your recent purchase requests', h('div', { class: 'req-list' }, mine.slice(0, 3).map((pr) => requisitionCard(pr, true))), linkButton('All requests', '#/procurement')));
    if (lower.length) content.push(h('div', { class: lower.length > 1 ? 'grid grid-2' : 'grid' }, lower));

    for (const node of content.slice(2)) node.classList.add('spaced');
    el.replaceChildren(...content);
  }

  async function renderAssets(el, seq) {
    $('register-asset').hidden = !can('assetCreate');
    const body = $('assets-body');
    if (!body.childElementCount) {
      body.replaceChildren(...[1, 2, 3, 4, 5].map(() => h('tr', null, h('td', { colspan: '6' }, h('div', { class: 'skeleton skeleton-row' })))));
    }
    const q = state.assetQuery;
    const params = new URLSearchParams({ page: String(q.page), pageSize: String(q.pageSize) });
    if (q.q) params.set('q', q.q);
    if (q.status) params.set('status', q.status);
    if (q.category) params.set('category', q.category);
    const data = await api(`/api/v1/assets?${params}`);
    if (stale(seq)) return;

    if (!data.items.length) {
      const filtered = q.q || q.status || q.category;
      body.replaceChildren(h('tr', null, h('td', { colspan: '6', class: 'empty-cell' },
        emptyState('laptop', filtered ? 'No matching assets' : 'No assets yet', filtered ? 'Try a different search or filter.' : 'Register your first device to get started.'))));
    } else {
      body.replaceChildren(...data.items.map((a) => {
        const row = h('tr', { class: 'clickable', onclick: () => openAsset(a.id) },
          h('td', null, h('button', { type: 'button', class: 'tag-btn mono', 'aria-label': `Open ${a.assetTag}`, text: a.assetTag, onclick: (e) => { e.stopPropagation(); openAsset(a.id); } })),
          h('td', null, h('span', { class: 'cell-main', text: a.model || 'Unnamed device' }), h('span', { class: 'cell-sub', text: [a.manufacturer, a.serialNumber].filter(Boolean).join(' · ') })),
          h('td', null, h('span', { class: 'chip' }, icon(CATEGORY_ICON[a.category] || 'box'), titleCase(a.category))),
          h('td', null, assetPill(a.status)),
          h('td', null, personCell(a.assignedTo)),
          h('td', { class: 'num', text: money(a.purchaseCost) }));
        return row;
      }));
    }
    const from = data.total ? (data.page - 1) * data.pageSize + 1 : 0;
    const to = Math.min(data.total, data.page * data.pageSize);
    const lastPage = Math.max(1, Math.ceil(data.total / data.pageSize));
    $('assets-pager').replaceChildren(
      h('span', { text: `Showing ${num(from)}–${num(to)} of ${num(data.total)}` }),
      h('div', { class: 'pager-buttons' },
        h('button', { type: 'button', class: 'btn btn-secondary btn-sm', disabled: data.page <= 1, onclick: () => { q.page -= 1; renderView('assets', { quiet: true }); } }, icon('chevron-left'), 'Previous'),
        h('button', { type: 'button', class: 'btn btn-secondary btn-sm', disabled: data.page >= lastPage, onclick: () => { q.page += 1; renderView('assets', { quiet: true }); } }, 'Next', icon('chevron-right'))));
    el.removeAttribute('aria-busy');
  }

  function expiryCell(license) {
    if (!license.validUntil) return h('span', { class: 'chip', text: 'Perpetual' });
    const days = daysUntil(license.validUntil);
    let tag = pill(`${days} days`, 'neutral');
    if (days < 0) tag = pill('Expired', 'bad');
    else if (days <= 60) tag = pill(`${days} days left`, 'warn');
    return h('span', { class: 'person' }, h('span', { text: fmtDate(license.validUntil) }), tag);
  }

  async function revealKey(license) {
    try {
      const { licenseKey } = await api(`/api/v1/licenses/${license.id}/key`);
      const copy = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Copy' });
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(licenseKey);
          copy.textContent = 'Copied';
        } catch {
          copy.textContent = 'Copy failed';
        }
      });
      openModal({
        title: `${license.softwareName} product key`,
        description: 'This disclosure has been recorded in the audit trail.',
        content: h('div', { class: 'secret-box' }, h('span', { class: 'mono', text: licenseKey }), copy)
      });
    } catch (err) {
      if (err.status !== 401) toast(err.message, 'bad');
    }
  }

  async function renderLicenses(el, seq) {
    $('add-license').hidden = !can('licenseManage');
    const list = await api('/api/v1/licenses');
    if (stale(seq)) return;
    const used = list.reduce((n, l) => n + l.usedSeats, 0);
    const total = list.reduce((n, l) => n + l.totalSeats, 0);
    const expiring = list.filter((l) => l.validUntil && daysUntil(l.validUntil) >= 0 && daysUntil(l.validUntil) <= 60).length;
    const expired = list.filter((l) => l.validUntil && daysUntil(l.validUntil) < 0).length;
    $('license-summary').replaceChildren(
      statTile({ tag: 'div', label: 'License pools', value: num(list.length), context: `${num(total)} seats purchased`, iconName: 'key' }),
      statTile({ tag: 'div', label: 'Seats in use', value: pct(used, total), unit: '%', context: `${num(used)} of ${num(total)} allocated`, iconName: 'layers' }),
      statTile({ tag: 'div', label: 'Expiring in 60 days', value: num(expiring), context: expiring ? 'Plan renewals now' : 'No renewals due', contextTone: expiring ? 'warn' : 'ok', contextIcon: expiring ? 'clock' : 'check', iconName: 'clock' }),
      statTile({ tag: 'div', label: 'Expired', value: num(expired), context: expired ? 'Seats can no longer be allocated' : 'All pools current', contextTone: expired ? 'bad' : 'ok', contextIcon: expired ? 'alert' : 'check', iconName: 'alert' }));

    const body = $('licenses-body');
    if (!list.length) {
      body.replaceChildren(h('tr', null, h('td', { colspan: '5', class: 'empty-cell' }, emptyState('key', 'No license pools yet', 'Add a license to start tracking seats.'))));
      return;
    }
    body.replaceChildren(...list.map((l) => h('tr', null,
      h('td', null, h('span', { class: 'cell-main', text: l.softwareName }), h('span', { class: 'cell-sub', text: [l.publisher, l.version && `v${l.version}`].filter(Boolean).join(' · ') || '—' })),
      h('td', null, h('span', { class: 'chip', text: licenseTypeLabel(l.licenseType) })),
      h('td', null, h('span', { class: 'person' },
        h('span', { class: 'mono', text: l.licenseKeyMasked || '—' }),
        can('revealKey') && l.hasKey ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'aria-label': `Reveal ${l.softwareName} product key`, onclick: () => revealKey(l) }, icon('eye'), 'Reveal') : null)),
      h('td', null, h('div', { class: 'util' }, meter(l.usedSeats, l.totalSeats, `${l.softwareName} seats in use`, true), h('span', { class: 'util-text', text: `${num(l.usedSeats)} / ${num(l.totalSeats)}` }))),
      h('td', null, expiryCell(l)))));
  }

  function addLicenseModal() {
    openModal({
      title: 'Add license pool',
      description: 'Product keys are encrypted at rest and only ever shown masked.',
      submitLabel: 'Add license',
      fields: [
        { name: 'softwareName', label: 'Software name', required: true, placeholder: 'Adobe Photoshop' },
        { name: 'publisher', label: 'Publisher', placeholder: 'Adobe' },
        { name: 'licenseType', label: 'License type', type: 'select', options: [['SUBSCRIPTION', 'Subscription'], ['PERPETUAL', 'Perpetual'], ['SAAS', 'SaaS'], ['VOLUME', 'Volume'], ['OEM', 'OEM']] },
        { name: 'totalSeats', label: 'Seats', type: 'number', required: true, min: '1', step: '1' },
        { name: 'licenseKey', label: 'Product key', placeholder: 'Optional', span2: true },
        { name: 'validFrom', label: 'Valid from', type: 'date' },
        { name: 'validUntil', label: 'Valid until', type: 'date' },
        { name: 'costPerSeat', label: 'Cost per seat (USD)', type: 'number', min: '0', step: '0.01', span2: true }
      ],
      onSubmit: async (values) => {
        const license = await api('/api/v1/licenses', { method: 'POST', body: values });
        toast(`${license.softwareName} added with ${license.totalSeats} seats`);
        renderView('licenses', { quiet: true });
      }
    });
  }

  async function renderProcurement(el, seq) {
    const reqs = await api('/api/v1/procurement/requisitions');
    if (stale(seq)) return;
    const groups = {
      all: reqs,
      action: reqs.filter(needsMyAction),
      open: reqs.filter((pr) => !['DELIVERED', 'REJECTED'].includes(pr.state)),
      done: reqs.filter((pr) => pr.state === 'DELIVERED'),
      rejected: reqs.filter((pr) => pr.state === 'REJECTED')
    };
    const labels = [['all', 'All'], ['action', 'Needs my action'], ['open', 'In progress'], ['done', 'Delivered'], ['rejected', 'Rejected']];
    const filters = h('div', { class: 'filters', role: 'group', 'aria-label': 'Filter requests' }, labels.map(([key, text]) => h('button', {
      type: 'button',
      class: 'filter-chip',
      'aria-pressed': String(state.procurementFilter === key),
      onclick: () => { state.procurementFilter = key; renderView('procurement', { quiet: true }); }
    }, text, h('span', { class: 'filter-count', text: String(groups[key].length) }))));
    const shown = groups[state.procurementFilter] || reqs;
    const head = h('div', { class: 'section-head' },
      h('p', { class: 'section-note', text: can('procurementRequest') ? 'Every request passes Manager, IT Director and Finance approval before a purchase order is issued.' : 'Read-only view of every purchase request.' }),
      can('procurementRequest') ? h('button', { type: 'button', class: 'btn btn-primary', onclick: newRequisitionModal }, icon('plus'), 'New request') : null);
    el.replaceChildren(head, filters, shown.length
      ? h('div', { class: 'req-list' }, shown.map((pr) => requisitionCard(pr)))
      : h('div', { class: 'card' }, emptyState('cart', 'Nothing here', state.procurementFilter === 'action' ? 'No requests are waiting for you.' : 'No purchase requests match this filter.')));
  }

  async function downloadReport(format) {
    try {
      const res = await api(`/api/v1/compliance/report?format=${format}`, { raw: true });
      const date = new Date().toISOString().slice(0, 10);
      saveBlob(await res.blob(), `compliance-report-${date}.${format}`);
      toast(`Report downloaded (${format.toUpperCase()})`);
    } catch (err) {
      if (err.status !== 401) toast(err.message, 'bad');
    }
  }

  async function renderCompliance(el, seq) {
    const [recon, incidents, audit] = await Promise.all([
      api('/api/v1/compliance/reconciliation'),
      api('/api/v1/compliance/incidents?status=OPEN'),
      can('auditRead') ? api('/api/v1/audit/verify') : null
    ]);
    if (stale(seq)) return;

    const actions = [
      can('complianceManage') ? h('button', { type: 'button', class: 'btn btn-secondary', onclick: runReconciliation }, icon('refresh'), 'Run reconciliation') : null,
      h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => downloadReport('csv') }, icon('download'), 'CSV'),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: () => downloadReport('json') }, icon('file'), 'Audit report')
    ];
    const head = h('div', { class: 'section-head' }, h('p', { class: 'section-note', text: `Last computed ${ago(recon.generatedAt)} from the latest endpoint scans.` }), h('div', { class: 'hero-actions' }, actions));

    const side = [
      h('ul', { class: 'kpi-grid compact side-tiles' },
        statTile({ label: 'Seat deficit', value: num(recon.totalDeficit), context: recon.totalDeficit ? 'Installs exceed purchased seats' : 'Within entitlement', contextTone: recon.totalDeficit ? 'bad' : 'ok', contextIcon: recon.totalDeficit ? 'alert' : 'check', iconName: 'key' }),
        statTile({ label: 'Unlicensed titles', value: num(recon.unlicensedSoftware.length), context: 'Installed with no license pool', iconName: 'layers' }),
        statTile({ label: 'Open incidents', value: num(incidents.length), context: incidents.length ? 'Prohibited software' : 'None open', contextTone: incidents.length ? 'bad' : 'ok', contextIcon: incidents.length ? 'alert' : 'check', iconName: 'shield' }))
    ];
    if (audit) {
      side.push(card('Audit trail integrity', 'SHA-256 hash chain over every recorded action',
        h('div', null,
          h('p', { class: `ring-status tone-${audit.valid ? 'ok' : 'bad'}` }, icon(audit.valid ? 'lock' : 'alert'), audit.valid ? `Verified · ${num(audit.entries)} entries` : `Broken at entry ${audit.brokenAtSeq}`),
          audit.headHash ? h('p', { class: 'ring-caption mono', text: `Head ${audit.headHash.slice(0, 24)}…` }) : null)));
    }

    const STATUS = { NON_COMPLIANT: ['Non-compliant', 'bad'], FULLY_UTILIZED: ['Fully used', 'info'], UNDER_UTILIZED: ['Within entitlement', 'ok'] };
    const table = recon.results.length
      ? h('div', { class: 'table-wrap' }, h('table', { class: 'data-table' },
        h('caption', { class: 'visually-hidden', text: 'License reconciliation: purchased seats against detected installs' }),
        h('thead', null, h('tr', null, ['Software', 'Purchased', 'Allocated', 'Installed', 'Unallocated', 'Deficit', 'Status'].map((t, i) => h('th', { scope: 'col', class: i > 0 && i < 6 ? 'num' : undefined, text: t })))),
        h('tbody', null, recon.results.map((r) => h('tr', null,
          h('td', { class: 'wrap' }, h('span', { class: 'cell-main', text: r.softwareName }), r.actionRequired ? h('span', { class: 'cell-sub tone-bad', text: r.actionRequired }) : null),
          h('td', { class: 'num', text: num(r.purchasedSeats) }),
          h('td', { class: 'num', text: num(r.allocatedSeats) }),
          h('td', { class: 'num', text: num(r.installedCount) }),
          h('td', { class: 'num', text: num(r.unallocatedInstalls) }),
          h('td', { class: `num${r.deficit ? ' tone-bad' : ''}`, text: num(r.deficit) }),
          h('td', null, pill(...(STATUS[r.status] || [titleCase(r.status), 'neutral']))))))))
      : emptyState('shield', 'Nothing to reconcile yet', 'Add license pools and let endpoint agents report their installed software.');

    const incidentList = incidents.length
      ? h('ul', { class: 'feed' }, incidents.map((i) => h('li', null,
        h('span', { class: 'feed-icon tone-bad' }, icon('alert')),
        h('div', { class: 'feed-body' },
          h('p', { class: 'feed-title', text: `${i.softwareName} on ${i.assetTag}` }),
          h('p', { class: 'feed-text', text: i.recommendedAction }),
          h('p', { class: 'feed-meta' }, pill('High', 'bad'), h('span', { text: `Detected ${ago(i.detectedAt)}` }), i.assignedTo ? h('span', { text: `· ${personName(i.assignedTo)}` }) : null)),
        can('complianceManage') ? h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: () => resolveIncidentModal(i) }, 'Resolve') : null)))
      : emptyState('check', 'No open incidents', 'No prohibited software has been detected.');

    const unlicensed = recon.unlicensedSoftware.length
      ? h('div', { class: 'filters' }, recon.unlicensedSoftware.map((s) => h('span', { class: 'chip', text: `${s.softwareName} · ${s.installedCount}` })))
      : h('p', { class: 'section-note', text: 'Every detected title has a license pool or is blacklisted.' });

    const ringCard = card('Compliance score', 'Detected installs covered by purchased seats', ringMeter(recon.complianceRate, recon));
    el.replaceChildren(head,
      h('div', { class: 'grid grid-main' }, ringCard, h('div', { class: 'stack' }, side)),
      h('section', { class: 'card table-card spaced' }, h('div', { class: 'card-pad card-head' }, h('div', null, h('h2', { text: 'License reconciliation' }), h('p', { text: 'Purchased entitlements against installs reported by endpoint agents' }))), table),
      h('div', { class: 'grid grid-2 spaced' },
        card('Security incidents', 'Prohibited software found on endpoints', incidentList),
        card('Unlicensed software', 'Installed titles with no license pool (title · installs)', unlicensed)));
  }

  async function runReconciliation() {
    try {
      const result = await api('/api/v1/compliance/reconcile', { method: 'POST' });
      toast(result.notificationsRaised.length ? `Reconciled · ${result.notificationsRaised.length} new breach alert(s)` : `Reconciled · compliance ${rateText(result.complianceRate)}%`, result.hasBreaches ? 'warn' : 'ok');
      renderView('compliance', { quiet: true });
      refreshBadges();
    } catch (err) {
      if (err.status !== 401) toast(err.message, 'bad');
    }
  }

  function resolveIncidentModal(incident) {
    openModal({
      title: `Resolve incident on ${incident.assetTag}`,
      description: `${incident.softwareName} · detected ${ago(incident.detectedAt)}`,
      submitLabel: 'Mark resolved',
      fields: [{ name: 'resolution', label: 'Resolution', type: 'textarea', required: true, placeholder: 'For example "Uninstalled and user briefed"', span2: true }],
      onSubmit: async (values) => {
        await api(`/api/v1/compliance/incidents/${incident.id}/resolve`, { method: 'POST', body: values });
        toast('Incident resolved');
        renderView('compliance', { quiet: true });
      }
    });
  }

  async function renderAlerts(el, seq) {
    const notes = await api('/api/v1/notifications?limit=200');
    if (stale(seq)) return;
    const groups = {
      ALL: notes,
      BREACH: notes.filter((n) => n.type === 'LICENSE_BREACH'),
      SECURITY: notes.filter((n) => n.type === 'SECURITY_INCIDENT'),
      EXPIRY: notes.filter((n) => /_(EXPIRING|EXPIRED)$/.test(n.type))
    };
    const labels = [['ALL', 'All'], ['BREACH', 'License breaches'], ['SECURITY', 'Security'], ['EXPIRY', 'Expiries']];
    const filters = h('div', { class: 'filters', role: 'group', 'aria-label': 'Filter alerts' }, labels.map(([key, text]) => h('button', {
      type: 'button',
      class: 'filter-chip',
      'aria-pressed': String(state.alertsFilter === key),
      onclick: () => { state.alertsFilter = key; renderView('alerts', { quiet: true }); }
    }, text, h('span', { class: 'filter-count', text: String(groups[key].length) }))));
    const head = h('div', { class: 'section-head' },
      h('p', { class: 'section-note', text: 'Expiry checks run daily at 60, 30 and 7 days before each license and warranty ends.' }),
      can('alertsRun') ? h('button', { type: 'button', class: 'btn btn-secondary', onclick: runExpiryCheck }, icon('refresh'), 'Run expiry check') : null);
    el.replaceChildren(head, filters, h('section', { class: 'card card-pad' }, alertFeed(groups[state.alertsFilter] || notes)));
  }

  async function runExpiryCheck() {
    try {
      const result = await api('/api/v1/alerts/expiry/run', { method: 'POST', body: {} });
      toast(result.created.length ? `${result.created.length} new expiry alert(s)` : `Checked ${result.checked} item(s) · nothing new`);
      renderView('alerts', { quiet: true });
      refreshBadges();
    } catch (err) {
      if (err.status !== 401) toast(err.message, 'bad');
    }
  }

  // ------------------------------------------------------------ routing

  const VIEWS = {
    overview: { title: 'Overview', eyebrow: 'Workspace', iconName: 'grid', allowed: () => true, render: renderOverview },
    assets: { title: 'Hardware assets', eyebrow: 'Inventory', iconName: 'laptop', allowed: () => can('assetRead'), render: renderAssets },
    licenses: { title: 'Software licenses', eyebrow: 'Inventory', iconName: 'key', allowed: () => can('licenseRead'), render: renderLicenses },
    procurement: { title: 'Procurement', eyebrow: 'Workflow', iconName: 'cart', allowed: () => true, render: renderProcurement },
    compliance: { title: 'Compliance', eyebrow: 'Governance', iconName: 'shield', allowed: () => can('complianceRead'), render: renderCompliance },
    alerts: { title: 'Alerts', eyebrow: 'Governance', iconName: 'bell', allowed: () => can('notificationsRead'), render: renderAlerts }
  };

  const viewFromHash = () => (location.hash.match(/^#\/([a-z]+)/) || [])[1] || 'overview';

  function buildNav() {
    $('nav').replaceChildren(...Object.entries(VIEWS).filter(([, v]) => v.allowed()).map(([key, v]) => h('li', null,
      h('a', { href: `#/${key}`, 'data-view': key }, icon(v.iconName), h('span', { text: v.title }), h('span', { class: 'nav-count', id: `nav-count-${key}`, hidden: true })))));
  }

  async function renderView(name, options) {
    const view = VIEWS[name];
    if (!view || !state.user) return;
    const el = $(`view-${name}`);
    const seq = ++state.renderSeq;
    if (options && options.quiet && el.childElementCount) el.classList.add('is-refreshing');
    if (!el.childElementCount && ['procurement', 'compliance', 'alerts'].includes(name)) {
      el.replaceChildren(h('div', { 'aria-busy': 'true' }, h('div', { class: 'skeleton skeleton-row', 'aria-hidden': 'true' }), h('div', { class: 'grid grid-2 spaced', 'aria-hidden': 'true' }, h('div', { class: 'skeleton skeleton-card' }), h('div', { class: 'skeleton skeleton-card' }))));
    }
    try {
      await view.render(el, seq);
    } catch (err) {
      if (err.status !== 401 && !stale(seq)) {
        toast(err.message, 'bad');
        if (!el.childElementCount || el.querySelector('[aria-busy="true"]')) el.replaceChildren(h('div', { class: 'card' }, emptyState('alert', 'Could not load this view', err.message)));
      }
    } finally {
      el.classList.remove('is-refreshing');
    }
  }

  function route() {
    if (!state.user) return;
    let name = viewFromHash();
    if (!VIEWS[name] || !VIEWS[name].allowed()) name = 'overview';
    const changed = state.view !== name;
    state.view = name;
    for (const key of Object.keys(VIEWS)) $(`view-${key}`).hidden = key !== name;
    for (const link of $('nav').querySelectorAll('a')) {
      if (link.dataset.view === name) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    $('page-title').textContent = VIEWS[name].title;
    $('page-eyebrow').textContent = VIEWS[name].eyebrow;
    document.title = `${VIEWS[name].title} · ITIM`;
    closeNav();
    if (changed) window.scrollTo(0, 0);
    renderView(name);
  }

  function setCount(id, count) {
    const badge = $(id);
    if (!badge) return;
    badge.hidden = !count;
    badge.textContent = String(count);
  }

  async function refreshBadges() {
    try {
      const reqs = await api('/api/v1/procurement/requisitions');
      setCount('nav-count-procurement', reqs.filter(needsMyAction).length);
      if (can('notificationsRead')) {
        const notes = await api('/api/v1/notifications?limit=200');
        const high = notes.filter((n) => n.severity === 'HIGH').length;
        setCount('nav-count-alerts', high);
        $('alerts-dot').hidden = !high;
        $('alerts-link').setAttribute('aria-label', high ? `Alerts, ${high} high severity` : 'Alerts');
      }
    } catch {
      // Badges are a convenience; failures are surfaced by the views themselves.
    }
  }

  async function loadDirectory() {
    try {
      state.directory = await api('/api/v1/directory/employees');
      state.people = new Map(state.directory.map((p) => [p.employeeId, p.fullName]));
    } catch {
      state.directory = [];
    }
  }

  function openNav() {
    $('app').classList.add('nav-open');
    $('nav-backdrop').hidden = false;
    $('menu-toggle').setAttribute('aria-expanded', 'true');
    const first = $('nav').querySelector('a');
    if (first) first.focus();
  }

  function closeNav() {
    $('app').classList.remove('nav-open');
    $('nav-backdrop').hidden = true;
    $('menu-toggle').setAttribute('aria-expanded', 'false');
  }

  // ------------------------------------------------------------ session

  async function enterApp(user) {
    state.user = user;
    $('login-section').hidden = true;
    $('app').hidden = false;
    $('session-user').textContent = user.fullName;
    $('session-role').textContent = ROLE_LABELS[user.role];
    $('user-avatar').textContent = initials(user.fullName);
    $('scan-form').hidden = !can('assetRead');
    $('alerts-link').hidden = !can('notificationsRead');
    buildNav();
    state.view = null;
    if (can('assetAssign')) await loadDirectory();
    route();
    refreshBadges();
    $('main').focus({ preventScroll: true });
  }

  function signOut(message) {
    state.token = null;
    state.user = null;
    state.renderSeq += 1;
    state.people = new Map();
    state.directory = [];
    state.assetQuery = { q: '', status: '', category: '', page: 1, pageSize: 12 };
    state.procurementFilter = 'all';
    state.alertsFilter = 'ALL';
    for (const d of [$('drawer'), $('modal')]) if (d.open) d.close();
    revokeObjectUrls();
    for (const key of Object.keys(VIEWS)) if (key !== 'assets' && key !== 'licenses') $(`view-${key}`).replaceChildren();
    $('assets-body').replaceChildren();
    $('licenses-body').replaceChildren();
    $('license-summary').replaceChildren();
    $('assets-pager').replaceChildren();
    $('asset-search').value = '';
    $('asset-status').value = '';
    $('asset-category').value = '';
    $('app').hidden = true;
    $('login-section').hidden = false;
    $('session-user').textContent = '';
    $('login-form').reset();
    for (const chip of $('demo-roles').querySelectorAll('button')) chip.setAttribute('aria-pressed', 'false');
    toast(message || 'Signed out.', 'info');
    $('username').focus();
  }

  async function login(event) {
    event.preventDefault();
    const submit = $('login-submit');
    const username = $('username').value.trim();
    const password = $('password').value;
    if (!username || !password) {
      toast('Enter your username and password.', 'warn');
      (username ? $('password') : $('username')).focus();
      return;
    }
    submit.disabled = true;
    submit.textContent = 'Signing in…';
    try {
      const result = await api('/api/v1/auth/login', { method: 'POST', body: { username, password } });
      state.token = result.accessToken;
      $('password').value = '';
      await enterApp(result.user);
      toast(`Signed in as ${result.user.fullName}`);
    } catch (err) {
      toast(err.message, 'bad');
      $('password').select();
    } finally {
      submit.disabled = false;
      submit.textContent = 'Sign in';
    }
  }

  // ------------------------------------------------------------ wiring

  function init() {
    const saved = storedTheme();
    if (saved === 'light' || saved === 'dark') document.documentElement.dataset.theme = saved;
    syncThemeButton();
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncThemeButton);
    $('theme-toggle').addEventListener('click', toggleTheme);

    $('demo-roles').replaceChildren(...DEMO_USERS.map(([username, role]) => {
      const chip = h('button', { type: 'button', class: 'demo-chip', 'aria-pressed': 'false' },
        h('span', { class: 'demo-chip-role', text: ROLE_LABELS[role] }), h('span', { class: 'demo-chip-user', text: username }));
      chip.addEventListener('click', () => {
        for (const other of $('demo-roles').querySelectorAll('button')) other.setAttribute('aria-pressed', String(other === chip));
        $('username').value = username;
        $('password').focus();
      });
      return chip;
    }));

    $('toggle-password').addEventListener('click', () => {
      const field = $('password');
      const show = field.type === 'password';
      field.type = show ? 'text' : 'password';
      $('toggle-password').setAttribute('aria-pressed', String(show));
      $('toggle-password').setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      $('toggle-password').replaceChildren(icon(show ? 'eye-off' : 'eye'));
    });

    $('login-form').addEventListener('submit', login);
    $('logout').addEventListener('click', () => signOut());
    $('menu-toggle').addEventListener('click', () => ($('app').classList.contains('nav-open') ? closeNav() : openNav()));
    $('nav-backdrop').addEventListener('click', closeNav);
    window.addEventListener('hashchange', route);

    $('register-asset').addEventListener('click', registerAssetModal);
    $('add-license').addEventListener('click', addLicenseModal);

    let searchTimer = null;
    $('asset-search').addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        state.assetQuery.q = e.target.value.trim();
        state.assetQuery.page = 1;
        renderView('assets', { quiet: true });
      }, 250);
    });
    for (const [id, key] of [['asset-status', 'status'], ['asset-category', 'category']]) {
      $(id).addEventListener('change', (e) => {
        state.assetQuery[key] = e.target.value;
        state.assetQuery.page = 1;
        renderView('assets', { quiet: true });
      });
    }

    $('scan-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const tag = $('scan-tag').value.trim();
      if (!tag) return;
      try {
        const asset = await api(`/api/v1/assets/by-tag/${encodeURIComponent(tag)}`);
        $('scan-tag').value = '';
        openAsset(asset.id);
      } catch (err) {
        if (err.status !== 401) toast(err.status === 404 ? `No asset with tag ${tag}` : err.message, 'bad');
      }
    });

    for (const dialog of [$('drawer'), $('modal')]) {
      dialog.addEventListener('click', (e) => {
        if (e.target === dialog) dialog.close();
      });
    }
    $('drawer').addEventListener('close', () => {
      revokeObjectUrls();
      state.drawerAssetId = null;
      const opener = state.drawerOpener;
      // The opener may have been re-rendered while the drawer was open; fall back
      // to the equivalent button for the same asset, then to the main region.
      const label = opener && opener.getAttribute ? opener.getAttribute('aria-label') : null;
      const replacement = label ? [...document.querySelectorAll('#main [aria-label]')].find((node) => node.getAttribute('aria-label') === label) : null;
      const target = opener && document.contains(opener) ? opener : replacement || $('main');
      if (target && typeof target.focus === 'function') target.focus();
    });

    document.addEventListener('keydown', (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
      if (e.key === '/' && !typing && state.user && !$('scan-form').hidden && !$('modal').open && !$('drawer').open) {
        e.preventDefault();
        $('scan-tag').focus();
      }
      if (e.key === 'Escape' && $('app').classList.contains('nav-open')) closeNav();
    });

    $('username').focus();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
