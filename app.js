const CONFIG = { sheetId: '', cacheTTL: 5 * 60 * 1000 };

let LIVE_DATA = null;
let _loadPromise = null;

function loadLiveData() {
  if (!_loadPromise) {
    _loadPromise = fetch('/api/data', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(result => {
        if (result && result.exists && result.data) LIVE_DATA = result.data;
      })
      .catch(() => {});
  }
  return _loadPromise;
}

async function fetchTab(tabName) {
  await loadLiveData();
  const source = LIVE_DATA || window.DEMO_DATA;
  if (source) {
    const data = source[tabName];
    if (data) return data;
    throw new Error(`FETCH_FAIL:${tabName}`);
  }
  if (!CONFIG.sheetId) throw new Error('NO_SHEET_ID');
  const cached = getCache(tabName);
  if (cached) return cached;
  const url = `https://docs.google.com/spreadsheets/d/${CONFIG.sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tabName)}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`FETCH_FAIL:${tabName}`);
  const csv = await resp.text();
  if (csv.includes('Quota exceeded')) throw new Error(`SHEET_ERROR:${tabName}`);
  const data = parseCSV(csv);
  setCache(tabName, data);
  return data;
}

// ── CSV parser ──────────────────────────────────────────────────────

function parseCSV(text) {
  const rows = [];
  let i = 0;
  const len = text.length;
  while (i < len) {
    const row = [];
    while (i < len) {
      let val = '';
      if (text[i] === '"') {
        i++;
        while (i < len) {
          if (text[i] === '"') {
            if (i + 1 < len && text[i + 1] === '"') { val += '"'; i += 2; }
            else { i++; break; }
          } else { val += text[i]; i++; }
        }
      } else {
        while (i < len && text[i] !== ',' && text[i] !== '\n' && text[i] !== '\r') {
          val += text[i]; i++;
        }
      }
      row.push(val.trim());
      if (i < len && text[i] === ',') { i++; continue; }
      break;
    }
    if (text[i] === '\r') i++;
    if (text[i] === '\n') i++;
    if (row.length > 0 && !(row.length === 1 && row[0] === '')) rows.push(row);
  }
  if (rows.length < 2) return [];
  const headers = rows[0].map(h => h.toLowerCase().replace(/\s+/g, '_'));
  return rows.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = row[idx] || ''; });
    return obj;
  });
}

// ── Cache ───────────────────────────────────────────────────────────

function getCache(key) {
  try {
    const raw = localStorage.getItem(`drip_${key}`);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    if (Date.now() - ts > CONFIG.cacheTTL) return null;
    return data;
  } catch { return null; }
}

function setCache(key, data) {
  try { localStorage.setItem(`drip_${key}`, JSON.stringify({ data, ts: Date.now() })); } catch {}
}

function clearAllCache() {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith('drip_')) keys.push(k);
  }
  keys.forEach(k => localStorage.removeItem(k));
}

// ── Content rendering ───────────────────────────────────────────────

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function escName(str) {
  const escaped = esc(str);
  return escaped.replace(/\(([^)]+)\)/, '<span class="pronouns">($1)</span>');
}

function renderContent(text) {
  if (!text) return '';
  let html = esc(text);
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" class="action-btn" style="display:inline-flex;padding:4px 10px;font-size:11px;min-height:0;margin-left:4px">$1 ↗</a>');
  html = linkifyPhones(html);
  html = linkifyAddresses(html);

  const lines = html.split('\n');
  const blocks = [];
  let pendingItems = [];
  let pendingHeader = null;

  const flush = () => {
    if (pendingItems.length) {
      const ul = `<ul>${pendingItems.join('')}</ul>`;
      if (pendingHeader) {
        blocks.push(`<div class="rider-group"><div class="rider-group-header">${pendingHeader}</div>${ul}</div>`);
      } else {
        blocks.push(ul);
      }
    } else if (pendingHeader) {
      blocks.push(`<p>${pendingHeader}</p>`);
    }
    pendingHeader = null;
    pendingItems = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { flush(); continue; }
    if (/^[-•–●○]/.test(trimmed)) {
      pendingItems.push(`<li>${trimmed.replace(/^[-•–●○]\s*/, '')}</li>`);
    } else if (trimmed.startsWith('<a href="tel:')) {
      flush();
      blocks.push(`<div class="ph-row">${trimmed}</div>`);
    } else {
      // Non-bullet line. If we were collecting items, this is a new block — flush.
      // If we have a header from a previous line with no items yet, push it as a standalone para.
      if (pendingItems.length) flush();
      if (pendingHeader) blocks.push(`<p>${pendingHeader}</p>`);
      pendingHeader = trimmed;
    }
  }
  flush();
  return blocks.join('');
}

function linkifyPhones(html) {
  // Skip content inside existing <a> tags so we don't inject inside href URLs
  // (e.g. digits in a rider PDF URL would otherwise break the anchor).
  const parts = html.split(/(<a\b[^>]*>[\s\S]*?<\/a>)/i);
  return parts.map((part, i) => {
    if (i % 2 === 1) return part;
    return part.replace(
      /(\+?\(?\d{1,4}\)?[\s.\-]?\(?\d{1,4}\)?[\s.\-]?\d{1,4}[\s.\-]?\d{2,4}[\s.\-]?\d{0,4})/g,
      (match) => {
        const digits = match.replace(/\D/g, '');
        if (digits.length < 7 || digits.length > 15) return match;
        const href = digits.length > 10 ? `+${digits}` : `+1${digits}`;
        return `<a href="tel:${href}" class="ph-num">${match}</a><span class="ph-actions"><a href="tel:${href}" class="action-btn">Call ↗</a><a href="sms:${href}" class="action-btn">Text ↗</a></span>`;
      }
    );
  }).join('');
}

function linkifyAddresses(html) {
  const pattern = /(\d{1,5}\s+(?:[\w\s]+\s+)?(?:Rd|Road|St|Street|Ave|Avenue|Blvd|Dr|Drive|Ln|Lane|Way|Ct|Court|Pl|Place|US-\d+)[,.\s]+[\w\s]+,?\s*(?:NJ|NY|PA|CT|MA)\s+\d{5})/gi;
  return html.replace(pattern, (m) => {
    const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(m)}`;
    return `${m}<span style="display:flex;justify-content:flex-end;margin-top:8px;"><a href="${url}" target="_blank" rel="noopener" class="action-btn">Maps ↗</a></span>`;
  });
}

function parseDashTimeLine(line) {
  if (!line.startsWith('-')) return null;
  const stripped = line.slice(1).trim();
  // Match a single time or a range like "Noon–4pm", "10:30am–2:30pm" so range stays in time column.
  const timeMatch = stripped.match(/^((?:noon|\d{1,2}(?::\d{2})?\s*(?:am|pm)?)(?:\s*[–-]\s*(?:noon|\d{1,2}(?::\d{2})?\s*(?:am|pm)?))?(?:\s*\([^)]+\))?)\s*:?\s*/i);
  if (!timeMatch) return null;
  const time = timeMatch[1].trim();
  const rest = stripped.slice(timeMatch[0].length).trim();
  if (!rest) return null;
  const noteMatch = rest.match(/^(.*?)\.\s*Note:\s*(.+)$/i);
  if (noteMatch) {
    return { time, detail: noteMatch[1].trim(), note: noteMatch[2].trim().replace(/\.$/, '') };
  }
  return { time, detail: rest.replace(/\.$/, '').trim(), note: null };
}

function renderScheduleContent(text) {
  if (!text) return '';

  // Pipe/arrow format (performer schedules, portrait schedules)
  if (/\|/.test(text) || /→/.test(text)) {
    const html = esc(text);
    const lines = html.split('\n').filter(l => l.trim());
    return lines.map(line => {
      const pipeMatch = line.match(/^(.+?)\s*\|\s*(.+)$/);
      if (pipeMatch) {
        return `<div class="sched-row"><div class="sched-time">${pipeMatch[1].trim()}</div><div class="sched-detail">${linkifyPhones(pipeMatch[2].trim())}</div></div>`;
      }
      const arrowMatch = line.match(/^(.+?)\s*→\s*(.+)$/);
      if (arrowMatch) {
        return `<div class="sched-row"><div class="sched-time">${arrowMatch[1].trim()}</div><div class="sched-detail">${linkifyPhones(arrowMatch[2].trim())}</div></div>`;
      }
      return `<div class="sched-label">${linkifyPhones(line)}</div>`;
    }).join('');
  }

  // Narrative format (stage manager / production schedules)
  const hasDashTime = /^-\s*(?:noon|\d)/im.test(text);
  if (!hasDashTime) return renderContent(text);

  const lines = text.split('\n').filter(l => l.trim());
  return lines.map(line => {
    const trimmed = line.trim();

    if (/^Overview:\s*/i.test(trimmed)) {
      return `<div class="sched-overview">${esc(trimmed.replace(/^Overview:\s*/i, ''))}</div>`;
    }

    const parsed = parseDashTimeLine(trimmed);
    if (parsed) {
      const noteHtml = parsed.note ? `<div class="sched-note">${esc(parsed.note)}</div>` : '';
      return `<div class="sched-row"><div class="sched-time">${esc(parsed.time)}</div><div class="sched-detail">${esc(parsed.detail)}${noteHtml}</div></div>`;
    }

    // Warning callout (⚠️ or ❗ prefix)
    if (/^[⚠❗]|^⚠️|^❗/.test(trimmed)) {
      let content = trimmed.replace(/^[⚠️❗⚠❗️\s]+/, '');
      content = content.replace(/^\*\*(.+?)\*\*\s*$/, '$1');
      return `<div class="sched-warning">${linkifyPhones(esc(content))}</div>`;
    }

    // Day headings (e.g. Saturday:, Friday:, Monday-Wed:) — plain or bolded
    if (/^(?:\*\*)?(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Wed|Thu|Fri|Sat|Sun)(?:[-–](?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Wed|Thu|Fri|Sat|Sun))?:?(?:\*\*)?\s*$/i.test(trimmed)) {
      return `<div class="sched-label">${esc(trimmed.replace(/\*\*/g, '').replace(/:$/, ''))}</div>`;
    }
    // Other bold-wrapped headings (e.g. **Saturday:**, **Friday:**) — short phrase only
    if (/^\*\*[^*]{1,40}\*\*:?\s*$/.test(trimmed)) {
      return `<div class="sched-label">${esc(trimmed.replace(/\*\*/g, '').replace(/:$/, ''))}</div>`;
    }

    // Dash-prefixed continuation/sub-bullet (no parseable time) → small indented body
    if (trimmed.startsWith('-')) {
      return `<div class="sched-sub">${linkifyPhones(esc(trimmed.replace(/^-\s*/, '')))}</div>`;
    }

    // Fallback: regular continuation paragraph (not a label)
    return `<div class="sched-continuation">${linkifyPhones(esc(trimmed))}</div>`;
  }).join('');
}

// ── Contacts ────────────────────────────────────────────────────────

function renderContactCard(c) {
  const name = esc(c.name || '');
  const role = esc(c.role || '');
  const phone = c.phone || '';
  const hours = esc(c.hours || '');
  const isWA = (c.is_whatsapp || '').toLowerCase() === 'whatsapp' || (c.is_whatsapp || '').toLowerCase() === 'true';
  const digits = phone.replace(/\D/g, '');
  const href = digits.length > 10 ? `+${digits}` : `+1${digits}`;

  const label = [role, hours].filter(Boolean).join(' · ');
  const detail = digits ? `${esc(phone)}${isWA ? ' · WhatsApp preferred' : ''}` : '';

  let btns = '';
  if (digits) {
    btns += `<a href="tel:${href}" class="action-btn">Call ↗</a>`;
    btns += `<a href="sms:${href}" class="action-btn">Text ↗</a>`;
  }

  const desc = esc(c.description || '');

  return `
    <div class="contact-card">
      <div class="contact-card-inner">
        <div class="card-text">
          ${label ? `<div class="card-label">${label}</div>` : ''}
          <div class="card-title">${name}</div>
          ${detail ? `<div class="card-detail">${detail}</div>` : ''}
        </div>
        <div class="action-btns">${btns}</div>
      </div>
      ${desc ? `<div class="card-detail" style="margin-top:8px;font-family:var(--font);font-style:italic;font-size:13px">${desc}</div>` : ''}
    </div>`;
}

function renderContactsBar(contacts) {
  if (!contacts || !contacts.length) return '';
  return `
    <div class="contacts-section">
      <button class="contacts-toggle" onclick="toggleContacts()" id="contactsToggle" aria-expanded="false">
        <span class="section-icon">📞</span>
        <span class="contacts-toggle-label">Contacts & Communication</span>
        <svg viewBox="0 0 16 16"><path d="M8 11L3 6l.7-.7L8 9.6l4.3-4.3.7.7z"/></svg>
      </button>
      <div class="contacts-cards" id="contactsList">
        <div class="contact-card">
          <div class="card-detail" style="padding:4px 0">Use <strong>Slack</strong> for all general communication during the event. Phone contacts below are for emergencies only.</div>
        </div>
        ${contacts.map(renderContactCard).join('')}
      </div>
    </div>`;
}

function toggleContacts() {
  const list = document.getElementById('contactsList');
  const toggle = document.getElementById('contactsToggle');
  const open = list.classList.toggle('open');
  toggle.setAttribute('aria-expanded', open);
}

// ── Parking ─────────────────────────────────────────────────────────

const PARKING_TYPES = {
  ga: 'Must have a prepurchased parking pass. [Buy here](https://ra.co/events/2327627)',
  paid_staff: 'Park at The Loop, which is the first parking lot at check-in.',
  special: 'Special Access Parking in front of The Inn: for working vehicles, vendors, site managers, and anyone on the emergency contact sheet.'
};

function renderParkingSection(type) {
  const text = PARKING_TYPES[type];
  if (!text) return '';
  return renderSection('Parking', text);
}

function renderRiderPDF(url, title) {
  if (!url) return '';
  const label = esc(title || 'Full Rider');
  return `
    <div class="s">
      <div class="s-label">${label}</div>
      <div class="s-body"><p><a href="${esc(url)}" target="_blank" rel="noopener" class="action-btn">Download PDF ↗</a></p></div>
    </div>`;
}

// ── Contact list renderer ────────────────────────────────────────────

const PHONE_RE = /(\+?\(?\d{1,4}\)?[\s.\-]?\(?\d{1,4}\)?[\s.\-]?\d{1,4}[\s.\-]?\d{2,4}[\s.\-]?\d{0,4})/;

function extractPhone(str) {
  const m = str.match(PHONE_RE);
  if (!m) return null;
  const digits = m[1].replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  return { raw: m[1], href: digits.length > 10 ? `+${digits}` : `+1${digits}` };
}

function renderContactList(content) {
  // Split by blank lines if present, otherwise each line is one entry
  const entries = content.includes('\n\n')
    ? content.split(/\n\n+/).filter(e => e.trim())
    : content.split('\n').filter(e => e.trim());

  return entries.map(entry => {
    const lines = entry.trim().split('\n').filter(l => l.trim());
    let name = lines[0] || '';
    let phoneStr = lines[1] ? lines[1].trim() : '';

    // If second line isn't a phone, try extracting phone from first line
    if (!extractPhone(phoneStr)) {
      const p = extractPhone(name);
      if (p) {
        phoneStr = p.raw;
        name = name.replace(p.raw, '').replace(/[\s–—\-·:,]+$/, '').trim();
      } else {
        phoneStr = '';
      }
    }

    const phone = extractPhone(phoneStr);
    const phoneEl = phoneStr ? `<div class="card-detail">${esc(phoneStr)}</div>` : '';
    const btns = phone
      ? `<div class="action-btns"><a href="tel:${phone.href}" class="action-btn">Call ↗</a><a href="sms:${phone.href}" class="action-btn">Text ↗</a></div>`
      : '';
    return `<div class="contact-card"><div class="contact-card-inner"><div class="card-text"><div class="card-title" style="font-size:15px">${esc(name)}</div>${phoneEl}</div>${btns}</div></div>`;
  }).join('');
}

// ── Sections ────────────────────────────────────────────────────────

function renderSection(title, content) {
  const isAlert = /^[⚠️🚨❗]/.test(title) || /important|alert|warning/i.test(title);
  const isSchedule = /schedule|shift|thursday|friday|saturday|sunday|performances?|portraits?/i.test(title);
  const isRainPlan = /^rain plan$/i.test(title && title.trim());
  const isContactList = /contact/i.test(title);
  const cls = isAlert ? 's s-alert' : 's';
  const rendered = isSchedule ? renderScheduleContent(content) : renderContent(content);

  if (isContactList) {
    return `<div class="${cls} s-contact-list">${title ? `<div class="s-label">${esc(title)}</div>` : ''}${renderContactList(content)}</div>`;
  }

  if (isRainPlan) {
    const id = 'rp-' + Math.random().toString(36).slice(2, 7);
    return `
    <div class="s s-collapsible" id="${id}">
      <button class="s-toggle" onclick="document.getElementById('${id}').classList.toggle('open')" aria-expanded="false">
        <span class="s-toggle-label">Rain Plan</span>
        <span class="s-toggle-hint">tap to view</span>
        <span class="s-toggle-arrow">▼</span>
      </button>
      <div class="s-collapsible-body">${renderScheduleContent(content)}</div>
    </div>`;
  }

  return `
    <div class="${cls}">
      ${title ? `<div class="s-label">${esc(title)}</div>` : ''}
      <div class="s-body">${rendered}</div>
    </div>`;
}

function renderSectionGrouped(icon, groupLabel, sections) {
  let html = `<div class="section-head"><span class="section-icon">${icon}</span><span class="section-head-label">${esc(groupLabel)}</span></div>`;
  for (const s of sections) {
    html += renderSection(s.section || '', s.content || '');
  }
  return html;
}

// ── Headers ─────────────────────────────────────────────────────────

const LOGO_SVG = `<svg class="logo-svg" viewBox="0 0 421 64" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4.17233e-06 49.536V9.05991e-06H20.376C35.64 9.05991e-06 44.784 9.21601 44.784 24.552C44.784 39.96 35.64 49.536 20.376 49.536H4.17233e-06ZM19.728 40.104C28.944 40.104 32.976 33.984 32.976 24.552C32.976 15.192 28.944 9.43201 19.728 9.43201H11.592V40.104H19.728ZM48.438 49.536V13.968H59.094V20.952C60.822 16.488 64.782 13.104 70.182 13.104C70.83 13.104 71.262 13.104 71.982 13.176V23.688C71.19 23.616 70.542 23.544 69.534 23.544C63.918 23.544 59.526 26.64 59.526 32.832V49.536H48.438ZM74.3327 49.536V13.968H85.6367V49.536H74.3327ZM74.3327 9.93601V9.05991e-06H85.5647V9.93601H74.3327ZM90.9461 62.856V13.968H102.034V18.432C104.122 15.264 107.722 13.104 112.834 13.104C121.978 13.104 128.962 20.232 128.962 31.752C128.962 43.272 121.978 50.4 112.834 50.4C107.146 50.4 104.05 47.952 102.25 45.576V62.856H90.9461ZM109.522 42.336C114.778 42.336 117.37 37.728 117.37 31.752C117.37 25.776 114.778 21.168 109.522 21.168C104.338 21.168 101.602 25.848 101.602 31.752C101.602 37.656 104.338 42.336 109.522 42.336ZM132.591 62.856V13.968H143.679V18.432C145.767 15.264 149.367 13.104 154.479 13.104C163.623 13.104 170.607 20.232 170.607 31.752C170.607 43.272 163.623 50.4 154.479 50.4C148.791 50.4 145.695 47.952 143.895 45.576V62.856H132.591ZM151.167 42.336C156.423 42.336 159.015 37.728 159.015 31.752C159.015 25.776 156.423 21.168 151.167 21.168C145.983 21.168 143.247 25.848 143.247 31.752C143.247 37.656 145.983 42.336 151.167 42.336ZM174.236 49.536V13.968H185.54V49.536H174.236ZM174.236 9.93601V9.05991e-06H185.468V9.93601H174.236ZM190.849 49.536V13.968H201.793V18.288H201.865C203.737 15.624 207.337 13.104 212.593 13.104C220.009 13.104 225.193 17.424 225.193 27.216V49.536H213.889V30.24C213.889 25.632 213.241 21.888 208.633 21.888C204.457 21.888 202.153 25.416 202.153 30.312V49.536H190.849ZM246.877 63.72C236.437 63.72 230.245 59.04 229.381 51.12L240.469 50.112C241.045 54.144 243.421 56.088 247.309 56.088C251.341 56.088 253.933 54.072 253.933 48.888V43.056C252.061 45.648 248.893 47.952 243.997 47.952C235.429 47.952 228.589 41.616 228.589 30.6C228.589 19.296 235.429 13.104 243.997 13.104C249.469 13.104 252.565 15.84 254.149 18.216V13.968H265.021V48.816C265.021 59.256 257.461 63.72 246.877 63.72ZM247.237 39.672C252.061 39.672 254.365 35.28 254.365 30.456C254.365 25.704 252.061 21.312 247.237 21.312C242.557 21.312 240.181 25.2 240.181 30.456C240.181 35.784 242.557 39.672 247.237 39.672ZM283.682 49.536V43.74C288.42 39.968 292.56 36.495 296.102 33.321C299.69 30.147 302.496 27.088 304.52 24.144C306.544 21.2 307.556 18.21 307.556 15.174C307.556 12.644 306.843 10.666 305.417 9.24001C303.991 7.76801 302.059 7.03201 299.621 7.03201C296.815 7.03201 294.653 7.92901 293.135 9.72301C291.617 11.471 290.858 13.564 290.858 16.002H283.751C283.797 12.598 284.51 9.74601 285.89 7.44601C287.27 5.14601 289.133 3.39801 291.479 2.20201C293.871 1.00601 296.585 0.40801 299.621 0.40801C304.543 0.40801 308.338 1.74201 311.006 4.41001C313.674 7.03201 315.008 10.551 315.008 14.967C315.008 17.773 314.387 20.487 313.145 23.109C311.949 25.685 310.362 28.146 308.384 30.492C306.406 32.838 304.198 35.069 301.76 37.185C299.368 39.301 296.953 41.325 294.515 43.257H316.319V49.536H283.682ZM334.025 50.364C330.299 50.364 327.033 49.352 324.227 47.328C321.467 45.304 319.328 42.429 317.81 38.703C316.292 34.931 315.533 30.492 315.533 25.386C315.533 20.234 316.292 15.795 317.81 12.069C319.328 8.34301 321.467 5.46801 324.227 3.44401C327.033 1.42001 330.299 0.40801 334.025 0.40801C337.797 0.40801 341.063 1.42001 343.823 3.44401C346.583 5.46801 348.722 8.34301 350.24 12.069C351.758 15.795 352.517 20.234 352.517 25.386C352.517 30.492 351.758 34.931 350.24 38.703C348.722 42.429 346.583 45.304 343.823 47.328C341.063 49.352 337.797 50.364 334.025 50.364ZM322.985 25.386C322.985 27.962 323.215 30.308 323.675 32.424C324.135 34.54 324.779 36.38 325.607 37.944L337.682 8.06701C336.532 7.51501 335.313 7.23901 334.025 7.23901C330.805 7.23901 328.16 8.87201 326.09 12.138C324.02 15.358 322.985 19.774 322.985 25.386ZM334.025 43.602C336.187 43.602 338.096 42.866 339.752 41.394C341.408 39.922 342.696 37.829 343.616 35.115C344.582 32.355 345.065 29.112 345.065 25.386C345.065 22.81 344.835 20.464 344.375 18.348C343.915 16.232 343.271 14.415 342.443 12.897L330.368 42.774C331.518 43.326 332.737 43.602 334.025 43.602ZM352.628 49.536V43.74C357.366 39.968 361.506 36.495 365.048 33.321C368.636 30.147 371.442 27.088 373.466 24.144C375.49 21.2 376.502 18.21 376.502 15.174C376.502 12.644 375.789 10.666 374.363 9.24001C372.937 7.76801 371.005 7.03201 368.567 7.03201C365.761 7.03201 363.599 7.92901 362.081 9.72301C360.563 11.471 359.804 13.564 359.804 16.002H352.697C352.743 12.598 353.456 9.74601 354.836 7.44601C356.216 5.14601 358.079 3.39801 360.425 2.20201C362.817 1.00601 365.531 0.40801 368.567 0.40801C373.489 0.40801 377.284 1.74201 379.952 4.41001C382.62 7.03201 383.954 10.551 383.954 14.967C383.954 17.773 383.333 20.487 382.091 23.109C380.895 25.685 379.308 28.146 377.33 30.492C375.352 32.838 373.144 35.069 370.706 37.185C368.314 39.301 365.899 41.325 363.461 43.257H385.265V49.536H352.628ZM403.937 50.364C400.533 50.364 397.658 49.743 395.312 48.501C392.966 47.213 391.057 45.488 389.585 43.326C388.159 41.164 387.101 38.703 386.411 35.943C385.767 33.137 385.445 30.193 385.445 27.111C385.445 21.775 386.181 17.106 387.653 13.104C389.171 9.10201 391.333 5.99701 394.139 3.78901C396.945 1.53501 400.326 0.40801 404.282 0.40801C407.548 0.40801 410.285 1.00601 412.493 2.20201C414.747 3.35201 416.495 4.96201 417.737 7.03201C419.025 9.05601 419.807 11.379 420.083 14.001H413.252C412.792 11.839 411.757 10.137 410.147 8.89501C408.537 7.65301 406.559 7.03201 404.213 7.03201C401.131 7.03201 398.463 8.50401 396.209 11.448C393.955 14.346 392.69 18.9 392.414 25.11H392.828C393.794 23.362 395.312 21.821 397.382 20.487C399.498 19.153 402.005 18.486 404.903 18.486C407.709 18.486 410.262 19.153 412.562 20.487C414.862 21.775 416.679 23.592 418.013 25.938C419.393 28.284 420.083 30.998 420.083 34.08C420.083 36.978 419.416 39.669 418.082 42.153C416.794 44.637 414.931 46.638 412.493 48.156C410.101 49.628 407.249 50.364 403.937 50.364ZM403.454 43.74C406.26 43.74 408.514 42.866 410.216 41.118C411.964 39.37 412.838 37.139 412.838 34.425C412.838 31.711 411.964 29.48 410.216 27.732C408.514 25.938 406.26 25.041 403.454 25.041C400.648 25.041 398.348 25.915 396.554 27.663C394.806 29.411 393.932 31.642 393.932 34.356C393.932 37.024 394.806 39.255 396.554 41.049C398.348 42.843 400.648 43.74 403.454 43.74Z" fill="currentColor"/></svg>`;

function renderHeader(context) {
  const ctx = context ? `<span class="header-sep">/</span><span class="header-context">${esc(context)}</span>` : '';
  return `<div class="header"><div class="header-inner"><a href="index.html" class="header-logo">${LOGO_SVG}</a>${ctx}</div></div>`;
}

function renderRefreshBar() {
  return `<div class="refresh"><span>Updated just now</span><a onclick="clearAllCache(); location.reload()">Refresh</a> · <a href="admin.html">Admin</a></div>`;
}

// ── URL / state ─────────────────────────────────────────────────────

function getParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function showLoading(el) {
  el.innerHTML = '<div class="state"><div class="spinner"></div><p>Loading...</p></div>';
}

function showError(el, err) {
  let msg = 'Something went wrong.';
  if (err.message === 'NO_SHEET_ID') msg = 'No Google Sheet connected yet.';
  else if (err.message?.startsWith('FETCH_FAIL')) msg = 'Couldn’t load data. Check your connection.';
  el.innerHTML = `<div class="state"><p>${msg}</p><button onclick="location.reload()" class="btn">Retry</button></div>`;
}

function getSheetId() {
  const params = new URLSearchParams(window.location.search);
  if (params.has('reset')) {
    localStorage.removeItem('drip_sheetId');
    clearAllCache();
    CONFIG.sheetId = '';
    return '';
  }
  if (CONFIG.sheetId) return CONFIG.sheetId;
  const stored = localStorage.getItem('drip_sheetId');
  if (stored) { CONFIG.sheetId = stored; return stored; }
  const fromUrl = params.get('sheet');
  if (fromUrl) {
    CONFIG.sheetId = fromUrl;
    localStorage.setItem('drip_sheetId', fromUrl);
    return fromUrl;
  }
  return '';
}

function promptSheetId() {
  const id = prompt('Enter the Google Sheet ID.\n\nFind it in the URL:\ndocs.google.com/spreadsheets/d/[THIS PART]/edit');
  if (id && id.trim()) {
    CONFIG.sheetId = id.trim();
    localStorage.setItem('drip_sheetId', id.trim());
    location.reload();
  }
}

// Unregister stale service workers
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(regs => { regs.forEach(r => r.unregister()); });
}
