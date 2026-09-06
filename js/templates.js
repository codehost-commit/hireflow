// ============ Resume Template Renderers ============
// Each template renders the same data into a unique formal style.
// mini=true returns compact preview, mini=false returns full export view.
// Customize options (font, spacing, margins, section toggles) all apply.

// `cat` groups templates in the picker: Students, Business, Technology, Creative.
const TEMPLATE_CATEGORIES = ['Students', 'Business', 'Technology', 'Creative', 'Industry'];
const TEMPLATE_DEFS = [
  // Students
  { id: 'harvard',      name: 'Harvard',        cat: 'Students' },
  { id: 'stanford',     name: 'Stanford',       cat: 'Students' },
  { id: 'modern',       name: 'Modern',         cat: 'Students' },
  { id: 'minimal',      name: 'Minimal',        cat: 'Students' },
  // Business
  { id: 'consulting',   name: 'Consulting',     cat: 'Business' },
  { id: 'executive',    name: 'Executive',      cat: 'Business' },
  { id: 'professional', name: 'Professional',   cat: 'Business' },
  { id: 'classic',      name: 'Classic',        cat: 'Business' },
  { id: 'elegant',      name: 'Elegant',        cat: 'Business' },
  { id: 'ivory',        name: 'Ivory',          cat: 'Business' },
  { id: 'cascade',      name: 'Cascade',        cat: 'Business' },
  // Technology
  { id: 'jake',         name: "Jake's Resume",  cat: 'Technology' },
  { id: 'faang',        name: 'FAANG',          cat: 'Technology' },
  { id: 'deedy',        name: 'Deedy',          cat: 'Technology' },
  // Creative
  { id: 'creative',     name: 'Creative',       cat: 'Creative' },
  { id: 'slate',        name: 'Slate',          cat: 'Creative' },
  { id: 'compact',      name: 'Compact',        cat: 'Creative' },
  { id: 'timeline',     name: 'Timeline',       cat: 'Creative' },
  // Industry
  { id: 'twocolumn',    name: 'Two-Column',     cat: 'Industry' },
  { id: 'healthcare',   name: 'Healthcare',     cat: 'Industry' },
  { id: 'sales',        name: 'Sales',          cat: 'Industry' },
  { id: 'ats',          name: 'ATS Clean',      cat: 'Industry' },
  // Elite schools & modern
  { id: 'wharton',      name: 'Wharton',        cat: 'Business' },
  { id: 'mit',          name: 'MIT',            cat: 'Technology' },
  { id: 'googledocs',   name: 'Google Docs',    cat: 'Students' },
];

const SAMPLE = {
  personal: {
    fullName: 'Your Name',
    email: 'name@email.com',
    phone: '(555) 123-4567',
    location: 'City, ST',
    linkedin: 'linkedin.com/in/you',
    github: 'github.com/you',
    website: '',
    summary: 'Results-driven professional with experience delivering measurable impact across cross-functional teams.'
  },
  experience: [
    { title: 'Senior Role', company: 'Company Name', start: '2022', end: 'Present', location: 'Remote',
      description: '• Led initiative resulting in 30% growth\n• Managed team of 8 across product launches' },
    { title: 'Previous Role', company: 'Earlier Co.', start: '2019', end: '2022', location: 'NYC',
      description: '• Built and shipped flagship feature used by 10K+ customers' }
  ],
  education: [{ school: 'University Name', degree: 'B.S.', field: 'Computer Science', gpa: '3.8', start: '2015', end: '2019' }],
  skills: { categories: [{ name:'All', items: ['Leadership','Strategy','Python','React','Communication'] }] },
  projects: [{ name: 'Project Name', tech: 'React, Node', description: 'Short summary of impact.' }],
};

// Curated, print-safe professional font stacks (every stack degrades to a font
// present on virtually all systems, so the exported PDF renders faithfully).
const FONT_STACKS = {
  'Inter':     'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  'Arial':     'Arial, "Helvetica Neue", Helvetica, sans-serif',
  'Calibri':   'Calibri, "Segoe UI", Candara, "Trebuchet MS", sans-serif',
  'Helvetica': '"Helvetica Neue", Helvetica, Arial, sans-serif',
  'Tahoma':    'Tahoma, Verdana, Segoe, sans-serif',
  'Verdana':   'Verdana, Geneva, Tahoma, sans-serif',
  'Georgia':   'Georgia, "Times New Roman", serif',
  'Cambria':   'Cambria, "Palatino Linotype", "Book Antiqua", Georgia, serif',
  'Garamond':  '"EB Garamond", Garamond, "Apple Garamond", "Times New Roman", serif',
  'Times':     '"Times New Roman", Times, serif',
  'Palatino':  '"Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif'
};
// Sans vs serif grouping for the font picker (keys must exist in FONT_STACKS).
const FONT_GROUPS = {
  'Sans-serif': ['Inter', 'Arial', 'Calibri', 'Helvetica', 'Tahoma', 'Verdana'],
  'Serif':      ['Georgia', 'Cambria', 'Garamond', 'Times', 'Palatino']
};
const SPACE_MULT  = { compact: 0.65, medium: 1.0, relaxed: 1.4 };
const MARGIN_MULT = { Narrow:  0.7,  Normal: 1.0, Wide:    1.35 };
// Overall text-size multiplier (applied to the base font-size on the resume root).
const SCALE_MULT  = { xs: 0.9, s: 0.95, m: 1.0, l: 1.06, xl: 1.12 };
// Body line-height (drives --app-line; every template's bullets/prose inherit it).
const LINE_MULT   = { tight: 1.22, normal: 1.4, relaxed: 1.6, loose: 1.8 };
// Bullet glyph used before every list item (empty = no marker, tighter indent).
const BULLET_CHAR = { dot: '•', dash: '-', square: '▪', chevron: '›', arrow: '→', circle: '◦', none: '' };

function esc(s) { return String(s==null?'':s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

// Build inline style for the root template div, sets CSS vars used inside.
function customizeStyleAttr(customize, marginsKey) {
  const c = customize || {};
  const font = FONT_STACKS[c.font];
  const space = SPACE_MULT[c.spacing] ?? 1.0;
  // Margins can come via the render arg (marginsKey) or, more reliably, from the
  // saved customize.margins, so the control works everywhere renderTemplate runs.
  const margin = MARGIN_MULT[marginsKey] ?? MARGIN_MULT[c.margins] ?? 1.0;
  const scale = SCALE_MULT[c.textSize] ?? 1.0;
  const line  = LINE_MULT[c.lineHeight] ?? 1.4;
  // Full-height sidebar/panel templates fill the page via min-height; keep it just
  // under the sheet height so it never spills into a phantom second page.
  const pageH = c.paperSize === 'A4' ? 1115 : 1048;
  const parts = [`--app-space:${space}`, `--app-margin:${margin}`, `--app-scale:${scale}`, `--app-line:${line}`, `--app-page-h:${pageH}px`, `line-height:${line}`];
  // Drive the base text size off a CSS var so "Fit to one page" (which reads
  // --app-scale) and the size control compose cleanly.
  if (scale !== 1) parts.push(`font-size:calc(16px * ${scale})`);
  // Bullet glyph: templates render `content: var(--app-bullet, '•')`.
  if (c.bullet && BULLET_CHAR[c.bullet] !== undefined) {
    parts.push(`--app-bullet:'${BULLET_CHAR[c.bullet]}'`);
    if (c.bullet === 'none') parts.push('--app-bullet-pad:0'); // no marker → no hanging indent
  }
  // Capitalization of headings/labels: templates use `var(--app-upper, uppercase)`.
  if (c.headingCase === 'normal') parts.push('--app-upper:none');
  if (font) {
    // Font stacks contain quoted multi-word names (e.g. "Segoe UI", "Times New Roman").
    // This string is injected into a double-quoted style="" attribute, so any double
    // quote would prematurely close the attribute and break the font. Swap to single
    // quotes (valid CSS) so the font actually registers in the preview and export.
    const safeFont = font.replace(/"/g, "'");
    // Only drive the CSS var, every template's font-family is `var(--app-font, <native>)`,
    // so this respects the font control WITHOUT clobbering a template's intended font
    // (e.g. Harvard's serif). A blanket inline `font-family` here used to override every
    // template to the same font, which is why Harvard rendered sans-serif.
    parts.push(`--app-font:${safeFont}`);
  }
  return parts.join(';');
}

// Filter out sections the user has toggled off in Customize.
function applySectionToggles(safe) {
  const s = safe.customize?.sections || {};
  const kill = key => { if (s[key] === false) safe[key] = Array.isArray(safe[key]) ? [] : { categories: [] }; };
  ['experience','education','skills','projects','certifications','awards','leadership','volunteer','publications'].forEach(kill);
  return safe;
}

function withFallback(resume, mini, marginsKey) {
  const r = resume || {};
  const empty = { fullName:'', email:'', phone:'', location:'', linkedin:'', github:'', website:'', summary:'' };
  const safe = {
    personal: Object.assign({}, empty, r.personal || {}),
    experience: Array.isArray(r.experience) ? r.experience : [],
    education: Array.isArray(r.education) ? r.education : [],
    skills: (r.skills && Array.isArray(r.skills.categories)) ? r.skills : { categories: [] },
    projects: Array.isArray(r.projects) ? r.projects : [],
    certifications: Array.isArray(r.certifications) ? r.certifications : [],
    awards: Array.isArray(r.awards) ? r.awards : [],
    leadership: Array.isArray(r.leadership) ? r.leadership : [],
    volunteer: Array.isArray(r.volunteer) ? r.volunteer : [],
    publications: Array.isArray(r.publications) ? r.publications : [],
    customize: r.customize || {},
    template: r.template || 'modern',
    _marginsKey: marginsKey
  };
  // Carry over user-defined custom sections (their arrays live on dynamic keys).
  const _metas = (safe.customize && Array.isArray(safe.customize.customSections)) ? safe.customize.customSections : [];
  _metas.forEach(function (m) { if (m && m.key) safe[m.key] = Array.isArray(r[m.key]) ? r[m.key] : []; });
  if (mini) {
    // Show the sample resume ONLY when the resume is essentially empty (brand new),
    // so a blank editor isn't a blank page. Never sprinkle sample data into a resume
    // that already has real content, that was leaking a fake "Project Name" project
    // (and similar) into resumes whose owner simply hadn't filled that one section.
    const hasContent = !!(safe.personal.fullName || safe.personal.summary
      || safe.experience.length || safe.education.length
      || (safe.skills.categories && safe.skills.categories.length)
      || safe.projects.length || safe.certifications.length || safe.awards.length
      || safe.leadership.length || safe.volunteer.length || safe.publications.length);
    if (!hasContent) {
      safe.personal   = Object.assign({}, SAMPLE.personal);
      safe.experience = SAMPLE.experience;
      safe.education  = SAMPLE.education;
      safe.skills     = SAMPLE.skills;
      safe.projects   = SAMPLE.projects;
    }
  }
  return applySectionToggles(safe);
}

// ============ Bullet engine ============
// Impact metrics worth emphasising: money, %, multipliers, magnitudes, and
// counts paired with a unit (or any 2+ digit number).
const _METRIC_RE = /(\$\s?\d[\d,]*(?:\.\d+)?\s?(?:k|m|bn|million|billion)?\+?|\b\d[\d,]*(?:\.\d+)?\s?(?:%|x\b|k\b|m\b|bn\b|million|billion|hours?|hrs?|days?|weeks?|months?|years?|users?|customers?|clients?|people|engineers?|products?|teams?|markets?|tickets?|accounts?)|\b\d{2,}\b)/gi;
// Bold metrics without breaking HTML entities: mark on raw text, escape, then
// swap the sentinels for real <strong> tags.
function metricBold(rawText) {
  const marked = String(rawText == null ? '' : rawText).replace(_METRIC_RE, '\x01$1\x02');
  return esc(marked).replace(/\x01/g, '<strong>').replace(/\x02/g, '</strong>');
}
// Turn a free-text description into professional markup: a real <ul> with
// hanging indents (multi-line / bulleted), or a clean paragraph (single line).
function bulletHTML(text) {
  const raw = String(text || '');
  if (!raw.trim()) return '';
  const lines = raw.split('\n').map(l => l.replace(/^\s*[•\-*\u2013▪◦·]\s*/, '').trim()).filter(Boolean);
  if (!lines.length) return '';
  const hadBullets = /(^|\n)\s*[•\-*\u2013▪◦·]\s+/.test(raw);
  if (lines.length === 1 && !hadBullets) {
    return `<div class="t-entry-desc">${metricBold(lines[0])}</div>`;
  }
  return `<ul class="t-bullets">${lines.map(l => `<li>${metricBold(l)}</li>`).join('')}</ul>`;
}

// ============ Section block builders ============
function expBlocks(exp) {
  return (exp||[]).map(e => {
    // 3-tier hierarchy: bold role on its own line, company + location beneath.
    const sub = [e.company, e.location].filter(Boolean).map(esc).join(' · ');
    return `
    <div class="t-entry">
      <div class="t-entry-head"><span class="t-entry-title">${esc(e.title)}</span><span class="t-entry-date">${esc(e.start)} - ${esc(e.end)}</span></div>
      ${sub ? `<div class="t-entry-sub">${sub}</div>` : ''}
      ${bulletHTML(e.description)}
    </div>`;
  }).join('');
}
function eduBlocks(edu) {
  return (edu||[]).map(e => `
    <div class="t-entry">
      <div class="t-entry-head"><span class="t-entry-title">${esc(e.school)}</span><span class="t-entry-date">${esc(e.start)} - ${esc(e.end)}</span></div>
      <div class="t-entry-sub">${esc(e.degree)} ${esc(e.field)}${e.gpa?' · GPA '+esc(e.gpa):''}</div>
    </div>`).join('');
}
function projBlocks(proj) {
  return (proj||[]).map(p => `
    <div class="t-entry">
      <div class="t-entry-head"><span class="t-entry-title">${esc(p.name)}</span><span class="t-entry-date">${esc(p.tech||'')}</span></div>
      ${bulletHTML(p.description)}
    </div>`).join('');
}
function listBlocks(items, fields) {
  return (items||[]).map(it => `<div class="t-entry"><div class="t-entry-head"><span class="t-entry-title">${esc(it[fields[0]])} ${it[fields[1]]?'· '+esc(it[fields[1]]):''}</span><span class="t-entry-date">${esc(it[fields[2]]||'')}</span></div>${bulletHTML(it.description)}</div>`).join('');
}
function skillsLine(skills) {
  return esc((skills?.categories||[]).flatMap(c=>c.items).join(' · '));
}

// ============ Reorderable body sections ============
// The user can reorder these in Customize (e.g. Skills before Experience). Summary
// stays pinned at the top (handled by each template's header), so it's not listed.
const BODY_SECTION_ORDER = ['experience','education','skills','projects','certifications','awards','leadership','volunteer','publications'];
// Sections that live in the MAIN column of two-column templates (skills + education
// are rendered in those templates' sidebars, so they don't participate there).
const MAIN_COLUMN_KEYS = ['experience','projects','certifications','awards','leadership','volunteer','publications'];
const SECTION_DEF = {
  experience:     { title: 'Experience',     html: r => r.experience.length ? expBlocks(r.experience) : '' },
  education:      { title: 'Education',       html: r => r.education.length ? eduBlocks(r.education) : '' },
  skills:         { title: 'Skills',          html: (r, cls) => skillsLine(r.skills) ? `<div class="${cls || 'summary'}">${skillsLine(r.skills)}</div>` : '' },
  projects:       { title: 'Projects',        html: r => r.projects.length ? projBlocks(r.projects) : '' },
  certifications: { title: 'Certifications',  html: r => r.certifications.length ? listBlocks(r.certifications, ['name','issuer','date']) : '' },
  awards:         { title: 'Awards',          html: r => r.awards.length ? listBlocks(r.awards, ['name','issuer','date']) : '' },
  leadership:     { title: 'Leadership',      html: r => r.leadership.length ? listBlocks(r.leadership, ['role','org','end']) : '' },
  volunteer:      { title: 'Volunteer',       html: r => r.volunteer.length ? listBlocks(r.volunteer, ['role','org','end']) : '' },
  publications:   { title: 'Publications',    html: r => r.publications.length ? listBlocks(r.publications, ['title','venue','date']) : '' },
};
// ---- Custom (user-defined) sections ----
// Metadata lives in r.customize.customSections = [{ key, title }]; the entries
// live in r[key] (an array of { heading, subheading, date, description }).
function _customSectionMetas(r) {
  return (r && r.customize && Array.isArray(r.customize.customSections)) ? r.customize.customSections : [];
}
function _customMeta(r, key) {
  return _customSectionMetas(r).find(m => m && m.key === key) || null;
}
function customBlocks(items) {
  return (items || []).map(it => `
    <div class="t-entry">
      <div class="t-entry-head">
        <span class="t-entry-title">${esc(it.heading || '')}${it.subheading ? ' · ' + esc(it.subheading) : ''}</span>
        <span class="t-entry-date">${esc(it.date || '')}</span>
      </div>
      ${bulletHTML(it.description)}
    </div>`).join('');
}

// Section keys in the user's chosen order: honor customize.sectionOrder, then
// append any sections it doesn't mention (so new/custom sections still appear),
// drop unknown keys.
function sectionKeysInOrder(r) {
  const saved = (r.customize && Array.isArray(r.customize.sectionOrder)) ? r.customize.sectionOrder : [];
  const customKeys = _customSectionMetas(r).map(m => m.key);
  const known = new Set([...BODY_SECTION_ORDER, ...customKeys]);
  const seen = new Set(), out = [];
  for (const k of saved) if (known.has(k) && !seen.has(k)) { out.push(k); seen.add(k); }
  for (const k of BODY_SECTION_ORDER) if (!seen.has(k)) out.push(k);
  for (const k of customKeys) if (!seen.has(k)) out.push(k);
  return out;
}
// Render the reorderable sections (each <h2>Title</h2> + content), skipping empties.
// opts: { only:[keys], exclude:[keys], titleTag:'h2'|'h3', titles:{key:override}, titleTransform:fn, skillsClass }
function orderedBody(r, opts) {
  opts = opts || {};
  const tag = opts.titleTag || 'h2';
  const titles = opts.titles || {};
  const xform = opts.titleTransform || (s => s);
  const excl = opts.exclude ? new Set(opts.exclude) : null;
  const customKeys = new Set(_customSectionMetas(r).map(m => m.key));
  return sectionKeysInOrder(r)
    .filter(k => !opts.only || opts.only.includes(k) || customKeys.has(k))
    .filter(k => !excl || !excl.has(k))
    .map(k => {
      const def = SECTION_DEF[k];
      let inner, title;
      if (def) { inner = def.html(r, opts.skillsClass); title = def.title; }
      else {
        const m = _customMeta(r, k); if (!m) return '';
        const items = r[k] || [];
        inner = items.length ? customBlocks(items) : '';
        title = esc(m.title || 'Section');   // user-defined title, must be escaped (the def branch uses trusted constants)
      }
      return inner ? `<${tag}>${xform(titles[k] || title)}</${tag}>${inner}` : '';
    }).join('');
}

// ============ TEMPLATES ============
// Each template's CSS uses var(--app-font) (falls back to its native font),
// var(--app-space, 1) for inter-section/entry gaps, and
// var(--app-margin, 1) for outer page padding.

function tModern(r, accent) {
  const c = accent || '#4f46e5';
  const p = r.personal;
  const st = customizeStyleAttr(r.customize, r._marginsKey);
  return `
    <style>
      .t-modern { font-family: var(--app-font); color: #1f2937; height: 100%; }
      /* Solid accent with a diagonal sheen->shade overlay for depth (no flat band). */
      .t-modern .header { background-color: ${c}; background-image: linear-gradient(150deg, rgba(255,255,255,.13), rgba(255,255,255,0) 46%, rgba(0,0,0,.20)); color: #fff; padding: calc(5% * var(--app-margin, 1)) calc(7% * var(--app-margin, 1)) calc(4.2% * var(--app-margin, 1)); }
      .t-modern .name { font-size: 212%; font-weight: 700; letter-spacing: -.02em; line-height: 1.03; }
      .t-modern .role { font-size: 80%; font-weight: 600; letter-spacing: .15em; text-transform: uppercase; opacity: .82; margin-top: 2.2%; }
      .t-modern .contact { font-size: 80%; opacity: .9; display:flex; flex-wrap:wrap; gap: 1% 3.4%; margin-top: 3.6%; }
      .t-modern .body { padding: calc(4.6% * var(--app-margin, 1)) calc(7% * var(--app-margin, 1)); }
      .t-modern h2 { color: ${c}; font-size: 103%; font-weight: 700; text-transform: var(--app-upper, uppercase); letter-spacing: .12em; margin: calc(4.2% * var(--app-space, 1)) 0 calc(2% * var(--app-space, 1)); border-bottom: 1.5px solid ${c}2b; padding-bottom: 1.2%; }
      .t-modern .body > h2:first-child { margin-top: 0; }
      .t-modern .t-entry { margin-bottom: calc(3.2% * var(--app-space, 1)); }
      .t-modern .t-entry-head { display:flex; justify-content:space-between; align-items:baseline; font-weight: 700; font-size: 96%; color: #111827; }
      .t-modern .t-entry-head .t-entry-date { font-weight: 500; color: #6b7280; font-size: 90%; white-space: nowrap; padding-left: 4%; }
      .t-modern .t-entry-sub { color: #6b7280; font-size: 85%; margin-top: .4%; }
      .t-modern .t-entry-desc { font-size: 88%; margin-top: 1.2%; }
      .t-modern .summary { font-size: 88%; line-height: 1.6; }
    </style>
    <div class="t-modern" style="${st}">
      <div class="header">
        <div class="name">${esc(p.fullName)}</div>
        ${(r.experience && r.experience[0] && r.experience[0].title) ? `<div class="role">${esc(r.experience[0].title)}</div>` : ''}
        <div class="contact">
          ${p.email?`<span>${esc(p.email)}</span>`:''}
          ${p.phone?`<span>${esc(p.phone)}</span>`:''}
          ${p.location?`<span>${esc(p.location)}</span>`:''}
          ${p.linkedin?`<span>${esc(p.linkedin)}</span>`:''}
        </div>
      </div>
      <div class="body">
        ${p.summary?`<h2>Summary</h2><div class="summary">${esc(p.summary)}</div>`:''}
        ${orderedBody(r)}
      </div>
    </div>`;
}

function tClassic(r, accent) {
  const p = r.personal;
  const st = customizeStyleAttr(r.customize, r._marginsKey);
  return `
    <style>
      .t-classic { font-family: var(--app-font); color: #1a1a1a; padding: calc(5% * var(--app-margin, 1)) calc(7% * var(--app-margin, 1)); height: 100%; }
      .t-classic .name { font-size: 240%; font-weight: 700; text-align: center; letter-spacing: .02em; margin-bottom: 2%; }
      .t-classic .contact { text-align: center; font-size: 85%; padding-bottom: 3%; border-bottom: 2px solid #1a1a1a; margin-bottom: 4%; }
      .t-classic h2 { font-size: 110%; font-weight: 700; text-transform: var(--app-upper, uppercase); letter-spacing: .1em; text-align: center; margin: calc(4% * var(--app-space, 1)) 0 calc(2% * var(--app-space, 1)); border-bottom: 1px solid #1a1a1a; padding-bottom: 1%; }
      .t-classic .t-entry { margin-bottom: calc(3% * var(--app-space, 1)); }
      .t-classic .t-entry-head { display:flex; justify-content:space-between; font-weight: 700; font-size: 95%; }
      .t-classic .t-entry-sub { font-style: italic; font-size: 88%; }
      .t-classic .t-entry-desc { font-size: 90%; margin-top: 1%; }
      .t-classic .summary { font-size: 90%; text-align: justify; }
    </style>
    <div class="t-classic" style="${st}">
      <div class="name">${esc(p.fullName)}</div>
      <div class="contact">${[p.email,p.phone,p.location,p.linkedin].filter(Boolean).map(esc).join(' | ')}</div>
      ${p.summary?`<h2>Professional Summary</h2><div class="summary">${esc(p.summary)}</div>`:''}
      ${orderedBody(r)}
    </div>`;
}

function tCreative(r, accent) {
  const c = accent || '#ec4899';
  const p = r.personal;
  const st = customizeStyleAttr(r.customize, r._marginsKey);
  const contact = [p.email, p.phone, p.location, p.linkedin, p.website].filter(Boolean);
  return `
    <style>
      .t-creative { font-family: var(--app-font); color: #1f2937; height: 100%; }
      .t-creative .cr-header { background: ${c}; color: #fff; padding: calc(5% * var(--app-margin, 1)) calc(7% * var(--app-margin, 1)) calc(4% * var(--app-margin, 1)); }
      .t-creative .cr-name { font-size: 220%; font-weight: 800; letter-spacing: -.01em; line-height: 1.05; }
      .t-creative .cr-contact { font-size: 82%; margin-top: 8px; opacity: .92; }
      .t-creative .cr-contact span:not(:last-child)::after { content: "  ·  "; opacity: .6; }
      .t-creative .cr-body { padding: calc(4% * var(--app-margin, 1)) calc(7% * var(--app-margin, 1)); }
      .t-creative h2 { color: ${c}; font-size: 104%; font-weight: 800; text-transform: var(--app-upper, uppercase); letter-spacing: .1em; margin: calc(3.6% * var(--app-space, 1)) 0 calc(1.6% * var(--app-space, 1)); padding-bottom: 4px; border-bottom: 2px solid ${c}22; }
      .t-creative h2:first-child { margin-top: 0; }
      .t-creative .t-entry { margin-bottom: calc(2.8% * var(--app-space, 1)); padding-left: 12px; border-left: 3px solid ${c}55; }
      .t-creative .t-entry-head { display:flex; justify-content:space-between; align-items: baseline; font-weight: 700; font-size: 96%; }
      .t-creative .t-entry-date { font-weight: 400; font-size: 87%; color: #6b7280; white-space: nowrap; padding-left: 4%; }
      .t-creative .t-entry-sub { color: #4b5563; font-style: italic; font-size: 90%; }
      .t-creative .t-entry-desc, .t-creative .summary { font-size: 91%; }
      .t-creative .t-bullets { font-size: 91%; }
      .t-creative .t-bullets li::before { color: ${c}; opacity: 1; }
    </style>
    <div class="t-creative" style="${st}">
      <div class="cr-header">
        <div class="cr-name">${esc(p.fullName)}</div>
        ${contact.length ? `<div class="cr-contact">${contact.map(c2 => `<span>${esc(c2)}</span>`).join('')}</div>` : ''}
      </div>
      <div class="cr-body">
        ${p.summary?`<h2>Summary</h2><div class="summary">${esc(p.summary)}</div>`:''}
        ${orderedBody(r)}
      </div>
    </div>`;
}

function tMinimal(r, accent) {
  const p = r.personal;
  const st = customizeStyleAttr(r.customize, r._marginsKey);
  return `
    <style>
      .t-minimal { font-family: var(--app-font); color: #2c2c2c; padding: calc(7% * var(--app-margin, 1)) calc(8% * var(--app-margin, 1)); height: 100%; font-weight: 300; }
      .t-minimal .name { font-size: 220%; font-weight: 200; letter-spacing: .01em; margin-bottom: 1.5%; }
      .t-minimal .contact { font-size: 80%; color: #888; display:flex; gap: 4%; flex-wrap: wrap; margin-bottom: 5%; padding-bottom: 4%; border-bottom: 1px solid #e5e5e5; }
      .t-minimal h2 { font-size: 80%; font-weight: 500; text-transform: var(--app-upper, uppercase); letter-spacing: .25em; color: #888; margin: calc(5% * var(--app-space, 1)) 0 calc(2.5% * var(--app-space, 1)); }
      .t-minimal .t-entry { margin-bottom: calc(3.5% * var(--app-space, 1)); }
      .t-minimal .t-entry-head { display:flex; justify-content:space-between; font-weight: 500; font-size: 95%; }
      .t-minimal .t-entry-sub { color: #888; font-size: 82%; margin-top: .5%; }
      .t-minimal .t-entry-desc { font-size: 88%; margin-top: 1%; color: #444; }
      .t-minimal .summary { font-size: 90%; color: #444; }
    </style>
    <div class="t-minimal" style="${st}">
      <div class="name">${esc(p.fullName)}</div>
      <div class="contact">${[p.email,p.phone,p.location,p.linkedin].filter(Boolean).map(esc).join(' &nbsp;·&nbsp; ')}</div>
      ${p.summary?`<h2>Summary</h2><div class="summary">${esc(p.summary)}</div>`:''}
      ${orderedBody(r)}
    </div>`;
}

function tProfessional(r, accent) {
  const c = accent || '#0f766e';
  const p = r.personal;
  const st = customizeStyleAttr(r.customize, r._marginsKey);
  return `
    <style>
      .t-professional { font-family: var(--app-font); color: #1f2937; min-height: var(--app-page-h, 1048px); display: grid; grid-template-columns: 32% 68%; grid-template-rows: 1fr; }
      .t-professional .sidebar { background: ${c}; color: #fff; padding: calc(6% * var(--app-margin, 1)) calc(5% * var(--app-margin, 1)); }
      .t-professional .name { font-size: 160%; font-weight: 700; line-height: 1.15; margin-bottom: 4%; }
      .t-professional .sidebar h3 { font-size: 85%; text-transform: var(--app-upper, uppercase); letter-spacing: .12em; margin: calc(5% * var(--app-space, 1)) 0 2%; padding-bottom: 1%; border-bottom: 1px solid rgba(255,255,255,.3); }
      .t-professional .sidebar .item { font-size: 78%; margin-bottom: 1%; opacity: .95; }
      .t-professional .main { padding: calc(6% * var(--app-margin, 1)) calc(5% * var(--app-margin, 1)); }
      .t-professional h2 { color: ${c}; font-size: 105%; font-weight: 700; text-transform: var(--app-upper, uppercase); letter-spacing: .1em; margin: calc(4% * var(--app-space, 1)) 0 calc(2% * var(--app-space, 1)); padding-bottom: 1%; border-bottom: 2px solid ${c}; }
      .t-professional h2:first-child { margin-top: 0; }
      .t-professional .t-entry { margin-bottom: calc(3% * var(--app-space, 1)); }
      .t-professional .t-entry-head { display:flex; justify-content:space-between; font-weight: 600; font-size: 92%; }
      .t-professional .t-entry-sub { color: #4b5563; font-size: 82%; }
      .t-professional .t-entry-desc { font-size: 86%; margin-top: 1%; }
      .t-professional .summary { font-size: 88%; }
    </style>
    <div class="t-professional" style="${st}">
      <div class="sidebar">
        <div class="name">${esc(p.fullName)}</div>
        <h3>Contact</h3>
        ${p.email?`<div class="item">${esc(p.email)}</div>`:''}
        ${p.phone?`<div class="item">${esc(p.phone)}</div>`:''}
        ${p.location?`<div class="item">${esc(p.location)}</div>`:''}
        ${p.linkedin?`<div class="item">${esc(p.linkedin)}</div>`:''}
        ${skillsLine(r.skills)?`<h3>Core Skills</h3><div class="item">${skillsLine(r.skills)}</div>`:''}
        ${r.education.length?`<h3>Education</h3>${r.education.map(e=>`<div class="item"><strong>${esc(e.school)}</strong><br>${esc(e.degree)} ${esc(e.field)}</div>`).join('')}`:''}
      </div>
      <div class="main">
        ${p.summary?`<h2>Professional Summary</h2><div class="summary">${esc(p.summary)}</div>`:''}
        ${orderedBody(r, {only: MAIN_COLUMN_KEYS})}
      </div>
    </div>`;
}


function tExecutive(r, accent) {
  const c = accent || '#7c2d12';
  const p = r.personal;
  const st = customizeStyleAttr(r.customize, r._marginsKey);
  return `
    <style>
      .t-executive { font-family: var(--app-font); color: #1a1a1a; background: #faf7f2; padding: calc(6% * var(--app-margin, 1)) calc(7% * var(--app-margin, 1)); min-height: var(--app-page-h, 1048px); border: 4px double ${c}; box-sizing: border-box; }
      .t-executive .name { font-size: 240%; font-weight: 600; color: ${c}; text-align: center; letter-spacing: .02em; margin-bottom: 1%; }
      .t-executive .subtitle { text-align: center; font-size: 80%; letter-spacing: .25em; text-transform: var(--app-upper, uppercase); color: #6b5a4a; margin-bottom: 4%; padding-bottom: 4%; border-bottom: 1px solid ${c}66; }
      .t-executive .contact { text-align: center; font-size: 82%; margin-bottom: 4%; font-style: italic; }
      .t-executive h2 { color: ${c}; font-size: 115%; font-weight: 600; text-transform: var(--app-upper, uppercase); letter-spacing: .12em; text-align: center; margin: calc(4% * var(--app-space, 1)) 0 calc(2% * var(--app-space, 1)); }
      .t-executive .t-entry { margin-bottom: calc(3% * var(--app-space, 1)); }
      .t-executive .t-entry-head { display:flex; justify-content:space-between; font-weight: 600; font-size: 95%; }
      .t-executive .t-entry-sub { font-style: italic; font-size: 86%; color: #6b5a4a; }
      .t-executive .t-entry-desc { font-size: 90%; margin-top: 1%; }
      .t-executive .summary { font-size: 92%; text-align: justify; font-style: italic; }
    </style>
    <div class="t-executive" style="${st}">
      <div class="name">${esc(p.fullName)}</div>
      <div class="subtitle">Curriculum Vitae</div>
      <div class="contact">${[p.email,p.phone,p.location].filter(Boolean).map(esc).join(' &nbsp;·&nbsp; ')}</div>
      ${p.summary?`<h2>Profile</h2><div class="summary">${esc(p.summary)}</div>`:''}
      ${orderedBody(r, {titles: {skills: 'Competencies', awards: 'Honors &amp; Awards'}})}
    </div>`;
}

function tCompact(r, accent) {
  const c = accent || '#374151';
  const p = r.personal;
  const st = customizeStyleAttr(r.customize, r._marginsKey);
  return `
    <style>
      .t-compact { font-family: var(--app-font); color: #1a1a1a; padding: calc(4% * var(--app-margin, 1)) calc(5% * var(--app-margin, 1)); height: 100%; font-size: 95%; line-height: 1.25; }
      .t-compact .name { font-size: 180%; font-weight: 800; letter-spacing: -.01em; margin-bottom: 1%; color: ${c}; }
      .t-compact .contact { font-size: 78%; color: #555; margin-bottom: 3%; padding-bottom: 2%; border-bottom: 1.5px solid ${c}; }
      .t-compact h2 { font-size: 90%; font-weight: 700; text-transform: var(--app-upper, uppercase); letter-spacing: .08em; color: ${c}; margin: calc(2.5% * var(--app-space, 1)) 0 calc(1.2% * var(--app-space, 1)); }
      .t-compact .t-entry { margin-bottom: calc(1.8% * var(--app-space, 1)); }
      .t-compact .t-entry-head { display:flex; justify-content:space-between; font-weight: 700; font-size: 88%; }
      .t-compact .t-entry-sub { font-style: italic; font-size: 78%; color: #555; }
      .t-compact .t-entry-desc { font-size: 80%; margin-top: .3%; }
      .t-compact .summary { font-size: 82%; }
    </style>
    <div class="t-compact" style="${st}">
      <div class="name">${esc(p.fullName)}</div>
      <div class="contact">${[p.email,p.phone,p.location,p.linkedin].filter(Boolean).map(esc).join(' &nbsp;·&nbsp; ')}</div>
      ${p.summary?`<div class="summary">${esc(p.summary)}</div>`:''}
      ${orderedBody(r)}
    </div>`;
}

function tElegant(r, accent) {
  const c = accent || '#7c3aed';
  const p = r.personal;
  const st = customizeStyleAttr(r.customize, r._marginsKey);
  return `
    <style>
      .t-elegant { font-family: var(--app-font); color: #2c2c2c; padding: calc(7% * var(--app-margin, 1)) calc(8% * var(--app-margin, 1)); height: 100%; }
      .t-elegant .subtitle { text-align: center; font-size: 75%; letter-spacing: .35em; text-transform: var(--app-upper, uppercase); color: #888; margin-bottom: 2%; }
      .t-elegant .name { font-size: 260%; font-weight: 400; color: ${c}; text-align: center; letter-spacing: .01em; line-height: 1; margin-bottom: 2%; }
      .t-elegant .name-dash { text-align: center; margin: 1% 0 4%; }
      .t-elegant .name-dash::before { content: "·"; color: ${c}; font-size: 200%; }
      .t-elegant .contact { text-align: center; font-size: 82%; margin-bottom: 5%; padding-bottom: 4%; border-bottom: 1px solid ${c}44; }
      .t-elegant h2 { color: ${c}; font-size: 105%; font-weight: 600; text-transform: var(--app-upper, uppercase); letter-spacing: .15em; text-align: center; margin: calc(5% * var(--app-space, 1)) 0 calc(2% * var(--app-space, 1)); }
      .t-elegant .t-entry { margin-bottom: calc(3% * var(--app-space, 1)); }
      .t-elegant .t-entry-head { display:flex; justify-content:space-between; font-weight: 600; font-size: 95%; }
      .t-elegant .t-entry-sub { font-style: italic; font-size: 86%; color: #666; }
      .t-elegant .t-entry-desc { font-size: 88%; margin-top: 1%; font-style: italic; color: #444; }
      .t-elegant .summary { font-size: 90%; font-style: italic; text-align: center; color: #444; }
    </style>
    <div class="t-elegant" style="${st}">
      <div class="subtitle">Curriculum Vitae</div>
      <div class="name">${esc(p.fullName)}</div>
      <div class="name-dash"></div>
      <div class="contact">${[p.email,p.phone,p.location].filter(Boolean).map(esc).join(' &nbsp;·&nbsp; ')}</div>
      ${p.summary?`<h2>Profile</h2><div class="summary">${esc(p.summary)}</div>`:''}
      ${orderedBody(r)}
    </div>`;
}


function tSlate(r, accent) {
  const c = accent || '#0ea5e9';
  const p = r.personal;
  const st = customizeStyleAttr(r.customize, r._marginsKey);
  return `
    <style>
      .t-slate { font-family: var(--app-font); color: #1f2937; height: 100%; }
      .t-slate .hd { background: #0f172a; color: #fff; padding: calc(5% * var(--app-margin,1)) calc(7% * var(--app-margin,1)); display:flex; justify-content:space-between; align-items:flex-end; gap: 4%; }
      .t-slate .name { font-size: 195%; font-weight: 800; letter-spacing: -.01em; line-height: 1; }
      .t-slate .role { font-size: 80%; color: color-mix(in srgb, ${c} 45%, #fff); letter-spacing: .06em; text-transform: var(--app-upper, uppercase); margin-top: 2.5%; }
      .t-slate .hd-contact { font-size: 76%; color: #cbd5e1; text-align: right; line-height: 1.7; white-space: nowrap; }
      .t-slate .body { padding: calc(4% * var(--app-margin,1)) calc(7% * var(--app-margin,1)); }
      .t-slate h2 { color: ${c}; font-size: 100%; font-weight: 700; text-transform: var(--app-upper, uppercase); letter-spacing: .1em; margin: calc(4% * var(--app-space,1)) 0 calc(1.5% * var(--app-space,1)); padding-left: 2.5%; border-left: 3px solid ${c}; }
      .t-slate h2:first-child { margin-top: 0; }
      .t-slate .t-entry { margin-bottom: calc(2.6% * var(--app-space,1)); padding-left: 2.5%; }
      .t-slate .t-entry-head { display:flex; justify-content:space-between; font-weight: 600; font-size: 93%; }
      .t-slate .t-entry-sub { color: #4b5563; font-style: italic; font-size: 82%; }
      .t-slate .t-entry-desc { font-size: 86%; margin-top: 1%; }
      .t-slate .summary { font-size: 88%; padding-left: 2.5%; }
      .t-slate .skills { padding-left: 2.5%; font-size: 87%; }
    </style>
    <div class="t-slate" style="${st}">
      <div class="hd">
        <div>
          <div class="name">${esc(p.fullName)}</div>
          ${r.experience[0] && r.experience[0].title ? `<div class="role">${esc(r.experience[0].title)}</div>` : ''}
        </div>
        <div class="hd-contact">${[p.email,p.phone,p.location,p.linkedin].filter(Boolean).map(esc).join('<br>')}</div>
      </div>
      <div class="body">
        ${p.summary?`<h2>Summary</h2><div class="summary">${esc(p.summary)}</div>`:''}
        ${orderedBody(r, {skillsClass: 'skills'})}
      </div>
    </div>`;
}

// Joined, separated contact line shared by the flagship templates.
function _contactLine(p, sep) {
  return [p.email, p.phone, p.location, p.linkedin, p.website].filter(Boolean).map(esc).join(sep);
}

// ===== Flagship: Consulting (serif, McKinsey / Harvard OCS style) =====
// Centered serif name, all-caps tracked section headers with hairline rules,
// no colour, dense-but-airy. Models the highest-signal consulting/finance format.
function tConsulting(r, accent) {
  const p = r.personal;
  const st = customizeStyleAttr(r.customize, r._marginsKey);
  return `
    <style>
      .t-consulting { font-family: var(--app-font, Georgia, 'Times New Roman', serif); color:#1a1a1a; height:100%;
        padding: calc(6% * var(--app-margin,1)) calc(8% * var(--app-margin,1)); line-height:1.34; }
      .t-consulting .name { text-align:center; font-size:212%; font-weight:700; letter-spacing:.01em; }
      .t-consulting .contact { text-align:center; font-size:85%; color:#333; margin-top:1.4%; }
      .t-consulting h2 { font-size:97%; font-weight:700; text-transform: var(--app-upper, uppercase); letter-spacing:.15em;
        margin: calc(4.6% * var(--app-space,1)) 0 calc(1.6% * var(--app-space,1)); padding-bottom:.7%; border-bottom:1px solid #1a1a1a; }
      .t-consulting .t-entry { margin-bottom: calc(2.6% * var(--app-space,1)); }
      .t-consulting .t-entry-head { display:flex; justify-content:space-between; align-items:baseline; font-weight:700; font-size:98%; }
      .t-consulting .t-entry-date { font-weight:400; font-style:italic; font-size:90%; white-space:nowrap; padding-left:4%; }
      .t-consulting .t-entry-sub { font-style:italic; font-size:91%; color:#333; }
      .t-consulting .summary { font-size:95%; text-align:justify; }
    </style>
    <div class="t-consulting" style="${st}">
      <div class="name">${esc(p.fullName)}</div>
      <div class="contact">${_contactLine(p, '&nbsp;&nbsp;•&nbsp;&nbsp;')}</div>
      ${p.summary?`<h2>Summary</h2><div class="summary">${esc(p.summary)}</div>`:''}
      ${orderedBody(r)}
    </div>`;
}

// ===== Flagship: FAANG (clean sans, "Google XYZ" style) =====
// Left-aligned grotesque, one restrained accent on name/headers, metric-bolded
// bullets (via the shared engine), single-line skills strip. ATS-friendly.
function tFaang(r, accent) {
  const c = accent || '#2563eb';
  const p = r.personal;
  const st = customizeStyleAttr(r.customize, r._marginsKey);
  return `
    <style>
      .t-faang { font-family: var(--app-font, 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif); color:#202124; height:100%;
        padding: calc(5.5% * var(--app-margin,1)) calc(7% * var(--app-margin,1)); line-height:1.35; }
      .t-faang .name { font-size:202%; font-weight:800; letter-spacing:-.02em; color:#111; }
      .t-faang .contact { font-size:84%; color:#5f6368; margin-top:1.1%; }
      .t-faang h2 { font-size:88%; font-weight:700; text-transform: var(--app-upper, uppercase); letter-spacing:.1em; color:${c};
        margin: calc(4.2% * var(--app-space,1)) 0 calc(1.7% * var(--app-space,1)); }
      .t-faang h2::after { content:''; display:block; height:1.5px; background:${c}2e; margin-top:.7%; }
      .t-faang .t-entry { margin-bottom: calc(2.8% * var(--app-space,1)); }
      .t-faang .t-entry-head { display:flex; justify-content:space-between; align-items:baseline; font-weight:700; font-size:96%; color:#111; }
      .t-faang .t-entry-date { font-weight:500; color:#5f6368; font-size:88%; white-space:nowrap; padding-left:4%; }
      .t-faang .t-entry-sub { font-size:88%; color:#5f6368; }
      .t-faang .summary { font-size:90%; color:#3c4043; }
    </style>
    <div class="t-faang" style="${st}">
      <div class="name">${esc(p.fullName)}</div>
      <div class="contact">${_contactLine(p, '&nbsp;·&nbsp;')}</div>
      ${p.summary?`<h2>Summary</h2><div class="summary">${esc(p.summary)}</div>`:''}
      ${orderedBody(r)}
    </div>`;
}

// ── Harvard: single-column, black & white, serif, centered header. The classic
// student/academic look, maximally ATS-safe. ──
function tHarvard(r, accent) {
  const p = r.personal;
  const st = customizeStyleAttr(r.customize, r._marginsKey);
  const contact = [p.email, p.phone, p.location, p.linkedin, p.github, p.website].filter(Boolean);
  return `
    <style>
      .t-harvard { font-family: Georgia, "Times New Roman", serif; color:#111; padding: calc(6% * var(--app-margin,1)) calc(7% * var(--app-margin,1)); height:100%; }
      .t-harvard .h-name { text-align:center; font-size:210%; font-weight:700; letter-spacing:.01em; }
      .t-harvard .h-contact { text-align:center; font-size:82%; color:#333; margin-top:4px; }
      .t-harvard .h-contact span:not(:last-child)::after { content:"  \\2022  "; color:#888; }
      .t-harvard h2 { font-size:98%; font-weight:700; text-transform: var(--app-upper, uppercase); letter-spacing:.06em; border-bottom:1.3px solid #111; padding-bottom:2px; margin: calc(4% * var(--app-space,1)) 0 calc(1.6% * var(--app-space,1)); }
      .t-harvard .t-entry { margin-bottom: calc(2.6% * var(--app-space,1)); }
      .t-harvard .t-entry-head { display:flex; justify-content:space-between; font-weight:700; font-size:96%; }
      .t-harvard .t-entry-date { font-weight:400; }
      .t-harvard .t-entry-sub { font-style:italic; font-size:90%; color:#222; }
      .t-harvard .t-entry-desc, .t-harvard .summary { font-size:92%; }
      .t-harvard .t-bullets { font-size:92%; }
      .t-harvard .t-bullets li::before { color:#111; opacity:1; }
    </style>
    <div class="t-harvard" style="${st}">
      <div class="h-name">${esc(p.fullName)}</div>
      ${contact.length ? `<div class="h-contact">${contact.map(c => `<span>${esc(c)}</span>`).join('')}</div>` : ''}
      ${p.summary ? `<h2>Summary</h2><div class="summary">${esc(p.summary)}</div>` : ''}
      ${orderedBody(r)}
    </div>`;
}

// ── Stanford: airy, strong sans typography, minimal, left-aligned. Popular in tech. ──
function tStanford(r, accent) {
  const p = r.personal;
  const st = customizeStyleAttr(r.customize, r._marginsKey);
  return `
    <style>
      .t-stanford { font-family: "Helvetica Neue", Arial, var(--app-font), sans-serif; color:#1a1a1a; padding: calc(6.5% * var(--app-margin,1)) calc(7.5% * var(--app-margin,1)); height:100%; }
      .t-stanford .s-name { font-size:230%; font-weight:800; letter-spacing:-.02em; line-height:1; }
      .t-stanford .s-contact { font-size:81%; color:#555; margin-top:9px; display:flex; flex-wrap:wrap; gap:2.5%; }
      .t-stanford h2 { font-size:79%; font-weight:700; text-transform: var(--app-upper, uppercase); letter-spacing:.18em; color:#111; margin: calc(5.5% * var(--app-space,1)) 0 calc(2% * var(--app-space,1)); }
      .t-stanford .t-entry { margin-bottom: calc(3.2% * var(--app-space,1)); }
      .t-stanford .t-entry-head { display:flex; justify-content:space-between; font-weight:700; font-size:97%; }
      .t-stanford .t-entry-date { font-weight:500; color:#666; }
      .t-stanford .t-entry-sub { font-size:88%; color:#555; }
      .t-stanford .t-entry-desc, .t-stanford .summary, .t-stanford .t-bullets { font-size:91%; color:#333; }
    </style>
    <div class="t-stanford" style="${st}">
      <div class="s-name">${esc(p.fullName)}</div>
      <div class="s-contact">
        ${[p.email, p.phone, p.location, p.linkedin, p.github, p.website].filter(Boolean).map(c => `<span>${esc(c)}</span>`).join('')}
      </div>
      ${p.summary ? `<h2>Summary</h2><div class="summary">${esc(p.summary)}</div>` : ''}
      ${orderedBody(r)}
    </div>`;
}

// ── Jake's Resume: the famous SWE format. Centered name + pipe-separated contact,
// ruled section headers, tight clean bullets. Extremely ATS-friendly, no graphics. ──
function tJake(r, accent) {
  const p = r.personal;
  const st = customizeStyleAttr(r.customize, r._marginsKey);
  const contact = [p.phone, p.email, p.linkedin, p.github, p.website, p.location].filter(Boolean);
  return `
    <style>
      .t-jake { font-family: var(--app-font), "Helvetica Neue", Arial, sans-serif; color:#111; padding: calc(5.5% * var(--app-margin,1)) calc(6.5% * var(--app-margin,1)); height:100%; }
      .t-jake .j-name { text-align:center; font-size:220%; font-weight:700; letter-spacing:-.01em; }
      .t-jake .j-contact { text-align:center; font-size:82%; color:#333; margin-top:5px; }
      .t-jake .j-contact span:not(:last-child)::after { content:"  |  "; color:#aaa; }
      .t-jake h2 { font-size:96%; font-weight:700; text-transform: var(--app-upper, uppercase); letter-spacing:.05em; border-bottom:1px solid #333; padding-bottom:2px; margin: calc(4.5% * var(--app-space,1)) 0 calc(1.5% * var(--app-space,1)); }
      .t-jake .t-entry { margin-bottom: calc(2.4% * var(--app-space,1)); }
      .t-jake .t-entry-head { display:flex; justify-content:space-between; font-weight:700; font-size:96%; }
      .t-jake .t-entry-date { font-weight:400; font-style:italic; }
      .t-jake .t-entry-sub { font-style:italic; font-size:90%; color:#333; }
      .t-jake .t-entry-desc, .t-jake .summary, .t-jake .t-bullets { font-size:91%; }
      .t-jake .t-bullets li { margin-bottom:1.5px; }
    </style>
    <div class="t-jake" style="${st}">
      <div class="j-name">${esc(p.fullName)}</div>
      ${contact.length ? `<div class="j-contact">${contact.map(c => `<span>${esc(c)}</span>`).join('')}</div>` : ''}
      ${p.summary ? `<h2>Summary</h2><div class="summary">${esc(p.summary)}</div>` : ''}
      ${orderedBody(r)}
    </div>`;
}

// Ivory, clean two-column with a LIGHT sidebar (the others are dark/colored),
// the most common "modern professional" resume layout. Accent used as the divider
// rule + role/label color so it stays readable on the light panel.
function tIvory(r, accent) {
  const c = accent || '#334155';
  const p = r.personal;
  const st = customizeStyleAttr(r.customize, r._marginsKey);
  return `
    <style>
      .t-ivory { font-family: var(--app-font); color: #1f2937; min-height: var(--app-page-h, 1048px); display: grid; grid-template-columns: 33% 67%; grid-template-rows: 1fr; }
      .t-ivory .sidebar { background: #f1f3f5; padding: calc(6% * var(--app-margin, 1)) calc(5.5% * var(--app-margin, 1)); border-right: 1px solid #e3e6ea; }
      .t-ivory .name { font-size: 168%; font-weight: 800; line-height: 1.1; letter-spacing: -.01em; color: #111827; margin-bottom: 1.5%; }
      .t-ivory .role { font-size: 82%; font-weight: 600; color: ${c}; margin-bottom: 5%; }
      .t-ivory .sidebar h3 { font-size: 79%; text-transform: var(--app-upper, uppercase); letter-spacing: .12em; color: ${c}; margin: calc(5.5% * var(--app-space, 1)) 0 2.5%; }
      .t-ivory .sidebar .item { font-size: 80%; margin-bottom: 1.5%; color: #374151; word-break: break-word; line-height: 1.4; }
      .t-ivory .sidebar .item strong { color: #111827; }
      .t-ivory .main { padding: calc(6% * var(--app-margin, 1)) calc(5.5% * var(--app-margin, 1)); }
      .t-ivory h2 { font-size: 104%; font-weight: 800; text-transform: var(--app-upper, uppercase); letter-spacing: .09em; color: #111827; margin: calc(4% * var(--app-space, 1)) 0 calc(2% * var(--app-space, 1)); padding-bottom: 1%; border-bottom: 2px solid ${c}; }
      .t-ivory h2:first-child { margin-top: 0; }
      .t-ivory .t-entry { margin-bottom: calc(3% * var(--app-space, 1)); }
      .t-ivory .t-entry-head { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; font-weight: 700; font-size: 93%; }
      .t-ivory .t-entry-date { color: #6b7280; font-weight: 600; font-size: 88%; white-space: nowrap; }
      .t-ivory .t-entry-sub { color: #6b7280; font-size: 83%; }
      .t-ivory .t-entry-desc { font-size: 87%; margin-top: 1%; }
      .t-ivory .summary { font-size: 89%; }
    </style>
    <div class="t-ivory" style="${st}">
      <div class="sidebar">
        <div class="name">${esc(p.fullName)}</div>
        ${(r.experience[0] && r.experience[0].title) ? `<div class="role">${esc(r.experience[0].title)}</div>` : ''}
        <h3>Contact</h3>
        ${p.email ? `<div class="item">${esc(p.email)}</div>` : ''}
        ${p.phone ? `<div class="item">${esc(p.phone)}</div>` : ''}
        ${p.location ? `<div class="item">${esc(p.location)}</div>` : ''}
        ${p.linkedin ? `<div class="item">${esc(p.linkedin)}</div>` : ''}
        ${p.website ? `<div class="item">${esc(p.website)}</div>` : ''}
        ${skillsLine(r.skills) ? `<h3>Skills</h3><div class="item">${skillsLine(r.skills)}</div>` : ''}
        ${r.education.length ? `<h3>Education</h3>${r.education.map(e => `<div class="item"><strong>${esc(e.school)}</strong><br>${esc(e.degree)} ${esc(e.field)}${e.end ? '<br>' + esc(e.start) + ' - ' + esc(e.end) : ''}</div>`).join('')}` : ''}
      </div>
      <div class="main">
        ${p.summary ? `<h2>Summary</h2><div class="summary">${esc(p.summary)}</div>` : ''}
        ${orderedBody(r, { only: MAIN_COLUMN_KEYS })}
      </div>
    </div>`;
}

// Timeline, single column where every entry is a milestone on a continuous
// vertical rail (dots on the line). Distinctive but ATS-safe (real text, one column).
function tTimeline(r, accent) {
  const c = accent || '#4f46e5';
  const p = r.personal;
  const st = customizeStyleAttr(r.customize, r._marginsKey);
  const contact = [p.email, p.phone, p.location, p.linkedin, p.website].filter(Boolean).map(esc).join(' &middot; ');
  return `
    <style>
      .t-timeline { font-family: var(--app-font); color: #1f2937; padding: calc(6% * var(--app-margin, 1)) calc(7% * var(--app-margin, 1)); }
      .t-timeline .name { font-size: 215%; font-weight: 800; letter-spacing: -.02em; line-height: 1.02; color: #111827; }
      .t-timeline .contact { font-size: 80%; color: #6b7280; margin: 1.5% 0 5%; }
      .t-timeline .rail { border-left: 2px solid ${c}40; padding-left: 26px; margin-left: 4px; }
      .t-timeline h2 { color: ${c}; font-size: 106%; font-weight: 800; text-transform: var(--app-upper, uppercase); letter-spacing: .09em; margin: calc(5% * var(--app-space, 1)) 0 calc(2.5% * var(--app-space, 1)); }
      .t-timeline h2:first-child { margin-top: 0; }
      .t-timeline .summary { font-size: 90%; margin-bottom: 2%; }
      .t-timeline .t-entry { position: relative; margin-bottom: calc(3.5% * var(--app-space, 1)); }
      .t-timeline .t-entry::before { content: ''; position: absolute; left: -31px; top: .42em; width: 9px; height: 9px; background: #fff; border: 2.5px solid ${c}; border-radius: 50%; box-sizing: border-box; }
      .t-timeline .t-entry-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; font-weight: 700; font-size: 96%; }
      .t-timeline .t-entry-date { color: #6b7280; font-weight: 600; font-size: 88%; white-space: nowrap; }
      .t-timeline .t-entry-sub { color: #6b7280; font-style: italic; font-size: 85%; }
      .t-timeline .t-entry-desc { font-size: 88%; margin-top: 1%; }
    </style>
    <div class="t-timeline" style="${st}">
      <div class="name">${esc(p.fullName)}</div>
      ${contact ? `<div class="contact">${contact}</div>` : ''}
      <div class="rail">
        ${p.summary ? `<h2>Summary</h2><div class="summary">${esc(p.summary)}</div>` : ''}
        ${orderedBody(r)}
      </div>
    </div>`;
}

// Cascade, a clean corporate single column with a light header band (name, role,
// contact) and an accent baseline. The conventional "modern professional" look used
// across most real-world resume tools; light background, fully legible on any accent.
function tCascade(r, accent) {
  const c = accent || '#1f2937';
  const p = r.personal;
  const st = customizeStyleAttr(r.customize, r._marginsKey);
  const contact = [p.email, p.phone, p.location, p.linkedin, p.website].filter(Boolean).map(esc).join(' &nbsp;&bull;&nbsp; ');
  const role = (r.experience[0] && r.experience[0].title) ? esc(r.experience[0].title) : '';
  return `
    <style>
      .t-cascade { font-family: var(--app-font); color: #1f2937; }
      .t-cascade .head { background: #f3f4f6; border-bottom: 3px solid ${c}; padding: calc(5% * var(--app-margin, 1)) calc(7% * var(--app-margin, 1)); }
      .t-cascade .name { font-size: 210%; font-weight: 800; letter-spacing: -.02em; line-height: 1.04; color: #111827; }
      .t-cascade .role { font-size: 92%; font-weight: 600; color: ${c}; margin-top: .5%; }
      .t-cascade .contact { font-size: 80%; color: #4b5563; margin-top: 1.8%; }
      .t-cascade .body { padding: calc(4.5% * var(--app-margin, 1)) calc(7% * var(--app-margin, 1)); }
      .t-cascade h2 { font-size: 104%; font-weight: 800; text-transform: var(--app-upper, uppercase); letter-spacing: .09em; color: #111827; margin: calc(4% * var(--app-space, 1)) 0 calc(2% * var(--app-space, 1)); padding-bottom: 1%; border-bottom: 1.5px solid #d1d5db; }
      .t-cascade .body > h2:first-child { margin-top: 0; }
      .t-cascade .t-entry { margin-bottom: calc(3% * var(--app-space, 1)); }
      .t-cascade .t-entry-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; font-weight: 700; font-size: 95%; }
      .t-cascade .t-entry-date { color: #6b7280; font-weight: 600; font-size: 88%; white-space: nowrap; }
      .t-cascade .t-entry-sub { color: #6b7280; font-style: italic; font-size: 84%; }
      .t-cascade .t-entry-desc { font-size: 88%; margin-top: 1%; }
      .t-cascade .summary { font-size: 89%; }
    </style>
    <div class="t-cascade" style="${st}">
      <div class="head">
        <div class="name">${esc(p.fullName)}</div>
        ${role ? `<div class="role">${role}</div>` : ''}
        ${contact ? `<div class="contact">${contact}</div>` : ''}
      </div>
      <div class="body">
        ${p.summary ? `<h2>Summary</h2><div class="summary">${esc(p.summary)}</div>` : ''}
        ${orderedBody(r)}
      </div>
    </div>`;
}

// Deedy, the widely-used two-column engineering résumé: a full-width name banner
// (first name black, surname in accent) with right-aligned contact, then a narrow
// Education/Skills column beside a wide Experience column. Real text throughout.
function tDeedy(r, accent) {
  const c = accent || '#2563eb';
  const p = r.personal;
  const st = customizeStyleAttr(r.customize, r._marginsKey);
  const nm = esc(p.fullName || '');
  const sp = nm.indexOf(' ');
  const nameHTML = sp > 0 ? `${nm.slice(0, sp)} <span>${nm.slice(sp + 1)}</span>` : nm;
  const contactBits = [p.email, p.phone, p.location, p.linkedin, p.website].filter(Boolean);
  return `
    <style>
      .t-deedy { font-family: var(--app-font); color: #1f2937; padding: calc(5% * var(--app-margin, 1)) calc(6% * var(--app-margin, 1)); }
      .t-deedy .banner { display: flex; justify-content: space-between; align-items: flex-end; gap: 18px; border-bottom: 2px solid #111827; padding-bottom: 2.5%; margin-bottom: 4%; }
      .t-deedy .name { font-size: 235%; font-weight: 800; letter-spacing: -.02em; line-height: 1; color: #111827; }
      .t-deedy .name span { color: ${c}; }
      .t-deedy .banner .contact { text-align: right; font-size: 76%; color: #4b5563; line-height: 1.55; white-space: nowrap; }
      .t-deedy .cols { display: grid; grid-template-columns: 34% 66%; gap: 5%; }
      .t-deedy h2 { color: ${c}; font-size: 100%; font-weight: 800; text-transform: var(--app-upper, uppercase); letter-spacing: .06em; margin: calc(3.5% * var(--app-space, 1)) 0 calc(1.6% * var(--app-space, 1)); border-bottom: 1px solid #e5e7eb; padding-bottom: .6%; }
      .t-deedy .cols > div > h2:first-child, .t-deedy > .summary + .cols h2:first-child { margin-top: 0; }
      .t-deedy .col-left h2:first-child, .t-deedy .col-right h2:first-child { margin-top: 0; }
      .t-deedy .t-entry { margin-bottom: calc(2.6% * var(--app-space, 1)); }
      .t-deedy .t-entry-head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; font-weight: 700; font-size: 92%; }
      .t-deedy .t-entry-date { color: #6b7280; font-weight: 600; font-size: 84%; white-space: nowrap; }
      .t-deedy .t-entry-sub { color: #6b7280; font-size: 82%; }
      .t-deedy .t-entry-desc { font-size: 85%; margin-top: .6%; }
      .t-deedy .summary { font-size: 87%; margin-bottom: 3%; }
      .t-deedy .side-item { font-size: 82%; margin-bottom: 2%; color: #374151; line-height: 1.45; }
      .t-deedy .side-item strong { color: #111827; }
    </style>
    <div class="t-deedy" style="${st}">
      <div class="banner">
        <div class="name">${nameHTML}</div>
        ${contactBits.length ? `<div class="contact">${contactBits.map(x => `<div>${esc(x)}</div>`).join('')}</div>` : ''}
      </div>
      ${p.summary ? `<div class="summary">${esc(p.summary)}</div>` : ''}
      <div class="cols">
        <div class="col-left">
          ${r.education.length ? `<h2>Education</h2>${r.education.map(e => `<div class="side-item"><strong>${esc(e.school)}</strong><br>${esc(e.degree)} ${esc(e.field)}${e.end ? '<br>' + esc(e.start) + ' - ' + esc(e.end) : ''}${e.gpa ? '<br>GPA ' + esc(e.gpa) : ''}</div>`).join('')}` : ''}
          ${skillsLine(r.skills) ? `<h2>Skills</h2><div class="side-item">${skillsLine(r.skills)}</div>` : ''}
        </div>
        <div class="col-right">
          ${orderedBody(r, { only: MAIN_COLUMN_KEYS })}
        </div>
      </div>
    </div>`;
}

// Two-Column: left sidebar with contact, skills, education; right main body.
function tTwocolumn(r, accent) {
  const c = accent || '#1e40af';
  const p = r.personal;
  const st = customizeStyleAttr(r.customize, r._marginsKey);
  return `
    <style>
      .t-twocolumn { font-family: var(--app-font); color: #1f2937; min-height: var(--app-page-h, 1048px); display: grid; grid-template-columns: 32% 68%; }
      .t-twocolumn .sidebar { background: #f1f5f9; padding: calc(6% * var(--app-margin, 1)) calc(5% * var(--app-margin, 1)); border-right: 2px solid ${c}22; }
      .t-twocolumn .sidebar .name { font-size: 155%; font-weight: 700; color: ${c}; line-height: 1.12; margin-bottom: 4%; }
      .t-twocolumn .sidebar h3 { font-size: 82%; font-weight: 700; text-transform: var(--app-upper, uppercase); letter-spacing: .12em; color: ${c}; margin: calc(6% * var(--app-space, 1)) 0 2%; border-bottom: 1px solid ${c}33; padding-bottom: 1.5%; }
      .t-twocolumn .sidebar .item { font-size: 80%; margin-bottom: 2.5%; color: #374151; line-height: 1.45; }
      .t-twocolumn .sidebar .item strong { color: #111827; }
      .t-twocolumn .main { padding: calc(6% * var(--app-margin, 1)) calc(5.5% * var(--app-margin, 1)); }
      .t-twocolumn h2 { color: ${c}; font-size: 102%; font-weight: 700; text-transform: var(--app-upper, uppercase); letter-spacing: .1em; margin: calc(4% * var(--app-space, 1)) 0 calc(1.8% * var(--app-space, 1)); border-bottom: 1.5px solid ${c}22; padding-bottom: 1%; }
      .t-twocolumn .main > h2:first-child { margin-top: 0; }
      .t-twocolumn .t-entry { margin-bottom: calc(3% * var(--app-space, 1)); }
      .t-twocolumn .t-entry-head { display: flex; justify-content: space-between; align-items: baseline; font-weight: 700; font-size: 93%; }
      .t-twocolumn .t-entry-date { color: #6b7280; font-weight: 500; font-size: 88%; white-space: nowrap; }
      .t-twocolumn .t-entry-sub { color: #6b7280; font-size: 83%; margin-top: .3%; }
      .t-twocolumn .t-entry-desc { font-size: 87%; margin-top: 1%; }
      .t-twocolumn .summary { font-size: 87%; line-height: 1.55; }
    </style>
    <div class="t-twocolumn" style="${st}">
      <div class="sidebar">
        <div class="name">${esc(p.fullName)}</div>
        <h3>Contact</h3>
        ${p.email ? `<div class="item">${esc(p.email)}</div>` : ''}
        ${p.phone ? `<div class="item">${esc(p.phone)}</div>` : ''}
        ${p.location ? `<div class="item">${esc(p.location)}</div>` : ''}
        ${p.linkedin ? `<div class="item">${esc(p.linkedin)}</div>` : ''}
        ${p.github ? `<div class="item">${esc(p.github)}</div>` : ''}
        ${p.website ? `<div class="item">${esc(p.website)}</div>` : ''}
        ${skillsLine(r.skills) ? `<h3>Skills</h3><div class="item">${skillsLine(r.skills)}</div>` : ''}
        ${r.education.length ? `<h3>Education</h3>${r.education.map(e => `<div class="item"><strong>${esc(e.school)}</strong><br>${esc(e.degree)} ${esc(e.field)}${e.gpa ? '<br>GPA ' + esc(e.gpa) : ''}</div>`).join('')}` : ''}
      </div>
      <div class="main">
        ${p.summary ? `<h2>Summary</h2><div class="summary">${esc(p.summary)}</div>` : ''}
        ${orderedBody(r, { only: MAIN_COLUMN_KEYS })}
      </div>
    </div>`;
}

// Healthcare: certifications/licensure prominent at top, clean clinical layout.
function tHealthcare(r, accent) {
  const c = accent || '#0d9488';
  const p = r.personal;
  const st = customizeStyleAttr(r.customize, r._marginsKey);
  return `
    <style>
      .t-healthcare { font-family: var(--app-font); color: #1f2937; padding: calc(5% * var(--app-margin, 1)) calc(6.5% * var(--app-margin, 1)); }
      .t-healthcare .header { border-bottom: 3px solid ${c}; padding-bottom: 3%; margin-bottom: 3%; }
      .t-healthcare .name { font-size: 200%; font-weight: 700; color: ${c}; letter-spacing: -.01em; }
      .t-healthcare .contact { font-size: 80%; color: #4b5563; margin-top: 1.5%; display: flex; flex-wrap: wrap; gap: 1% 3%; }
      .t-healthcare .certs-banner { background: ${c}0d; border: 1px solid ${c}22; border-radius: 4px; padding: 2.5% 3%; margin-bottom: calc(3.5% * var(--app-space, 1)); }
      .t-healthcare .certs-banner h2 { color: ${c}; font-size: 90%; font-weight: 700; text-transform: var(--app-upper, uppercase); letter-spacing: .1em; margin: 0 0 1.2%; }
      .t-healthcare .cert-item { font-size: 84%; margin-bottom: 1%; display: flex; justify-content: space-between; }
      .t-healthcare .cert-item .cert-name { font-weight: 600; }
      .t-healthcare .cert-item .cert-detail { color: #6b7280; font-size: 94%; }
      .t-healthcare h2 { color: ${c}; font-size: 100%; font-weight: 700; text-transform: var(--app-upper, uppercase); letter-spacing: .1em; margin: calc(4% * var(--app-space, 1)) 0 calc(1.8% * var(--app-space, 1)); border-bottom: 1.5px solid ${c}22; padding-bottom: 1%; }
      .t-healthcare .body > h2:first-child { margin-top: 0; }
      .t-healthcare .t-entry { margin-bottom: calc(3% * var(--app-space, 1)); }
      .t-healthcare .t-entry-head { display: flex; justify-content: space-between; align-items: baseline; font-weight: 700; font-size: 94%; }
      .t-healthcare .t-entry-date { color: #6b7280; font-weight: 500; font-size: 88%; white-space: nowrap; }
      .t-healthcare .t-entry-sub { color: #6b7280; font-size: 83%; margin-top: .3%; }
      .t-healthcare .t-entry-desc { font-size: 87%; margin-top: 1%; }
      .t-healthcare .summary { font-size: 87%; line-height: 1.55; }
    </style>
    <div class="t-healthcare" style="${st}">
      <div class="header">
        <div class="name">${esc(p.fullName)}</div>
        <div class="contact">
          ${p.email ? `<span>${esc(p.email)}</span>` : ''}
          ${p.phone ? `<span>${esc(p.phone)}</span>` : ''}
          ${p.location ? `<span>${esc(p.location)}</span>` : ''}
          ${p.linkedin ? `<span>${esc(p.linkedin)}</span>` : ''}
        </div>
      </div>
      ${r.certifications.length ? `<div class="certs-banner"><h2>Certifications &amp; Licensure</h2>${r.certifications.map(c2 => `<div class="cert-item"><span class="cert-name">${esc(c2.name)}</span><span class="cert-detail">${[c2.issuer, c2.date].filter(Boolean).map(esc).join(' · ')}</span></div>`).join('')}</div>` : ''}
      <div class="body">
        ${p.summary ? `<h2>Summary</h2><div class="summary">${esc(p.summary)}</div>` : ''}
        ${orderedBody(r, { exclude: ['certifications'] })}
      </div>
    </div>`;
}

// Sales/Results: metrics-heavy, key achievements banner at top.
function tSales(r, accent) {
  const c = accent || '#dc2626';
  const p = r.personal;
  const st = customizeStyleAttr(r.customize, r._marginsKey);
  return `
    <style>
      .t-sales { font-family: var(--app-font); color: #1f2937; padding: calc(4.5% * var(--app-margin, 1)) calc(6% * var(--app-margin, 1)); }
      .t-sales .header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 3px solid ${c}; padding-bottom: 2.5%; margin-bottom: 3%; }
      .t-sales .name { font-size: 210%; font-weight: 800; letter-spacing: -.02em; color: #111827; }
      .t-sales .role { font-size: 85%; font-weight: 600; color: ${c}; text-transform: uppercase; letter-spacing: .1em; margin-top: 1%; }
      .t-sales .contact { text-align: right; font-size: 78%; color: #4b5563; line-height: 1.55; }
      .t-sales .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 2%; background: ${c}08; border: 1px solid ${c}18; border-radius: 4px; padding: 2.5% 3%; margin-bottom: calc(3.5% * var(--app-space, 1)); }
      .t-sales .metric { text-align: center; }
      .t-sales .metric-val { font-size: 160%; font-weight: 800; color: ${c}; line-height: 1.1; }
      .t-sales .metric-label { font-size: 72%; color: #6b7280; text-transform: uppercase; letter-spacing: .06em; }
      .t-sales h2 { color: ${c}; font-size: 100%; font-weight: 700; text-transform: var(--app-upper, uppercase); letter-spacing: .1em; margin: calc(4% * var(--app-space, 1)) 0 calc(1.8% * var(--app-space, 1)); border-bottom: 1.5px solid ${c}22; padding-bottom: 1%; }
      .t-sales .body > h2:first-child { margin-top: 0; }
      .t-sales .t-entry { margin-bottom: calc(3% * var(--app-space, 1)); }
      .t-sales .t-entry-head { display: flex; justify-content: space-between; align-items: baseline; font-weight: 700; font-size: 94%; }
      .t-sales .t-entry-date { color: #6b7280; font-weight: 500; font-size: 88%; white-space: nowrap; }
      .t-sales .t-entry-sub { color: #6b7280; font-size: 83%; margin-top: .3%; }
      .t-sales .t-entry-desc { font-size: 87%; margin-top: 1%; }
      .t-sales .summary { font-size: 87%; line-height: 1.55; }
    </style>
    <div class="t-sales" style="${st}">
      <div class="header">
        <div>
          <div class="name">${esc(p.fullName)}</div>
          ${(r.experience && r.experience[0] && r.experience[0].title) ? `<div class="role">${esc(r.experience[0].title)}</div>` : ''}
        </div>
        <div class="contact">${[p.email, p.phone, p.location, p.linkedin].filter(Boolean).map(x => `<div>${esc(x)}</div>`).join('')}</div>
      </div>
      ${r.awards.length ? `<div class="metrics">${r.awards.slice(0, 4).map(a => `<div class="metric"><div class="metric-val">${esc(a.name)}</div><div class="metric-label">${esc(a.issuer || a.date || '')}</div></div>`).join('')}</div>` : ''}
      <div class="body">
        ${p.summary ? `<h2>Summary</h2><div class="summary">${esc(p.summary)}</div>` : ''}
        ${orderedBody(r, { exclude: ['awards'] })}
      </div>
    </div>`;
}

// ATS Clean: most stripped-down single-column, guaranteed ATS-parseable.
function tAts(r, accent) {
  const p = r.personal;
  const st = customizeStyleAttr(r.customize, r._marginsKey);
  return `
    <style>
      .t-ats { font-family: var(--app-font, Arial, Helvetica, sans-serif); color: #000; padding: calc(5% * var(--app-margin, 1)) calc(6% * var(--app-margin, 1)); }
      .t-ats .name { font-size: 190%; font-weight: 700; text-align: center; color: #000; }
      .t-ats .contact { font-size: 82%; text-align: center; color: #333; margin: 1% 0 3%; }
      .t-ats h2 { font-size: 100%; font-weight: 700; text-transform: var(--app-upper, uppercase); letter-spacing: .06em; color: #000; margin: calc(4% * var(--app-space, 1)) 0 calc(1.5% * var(--app-space, 1)); border-bottom: 1px solid #000; padding-bottom: .8%; }
      .t-ats .body > h2:first-child { margin-top: 0; }
      .t-ats .t-entry { margin-bottom: calc(2.8% * var(--app-space, 1)); }
      .t-ats .t-entry-head { display: flex; justify-content: space-between; align-items: baseline; font-weight: 700; font-size: 95%; }
      .t-ats .t-entry-date { color: #333; font-weight: 400; font-size: 90%; white-space: nowrap; }
      .t-ats .t-entry-sub { color: #333; font-size: 85%; margin-top: .3%; }
      .t-ats .t-entry-desc { font-size: 89%; margin-top: 1%; }
      .t-ats .summary { font-size: 89%; line-height: 1.55; }
    </style>
    <div class="t-ats" style="${st}">
      <div class="name">${esc(p.fullName)}</div>
      <div class="contact">${[p.email, p.phone, p.location, p.linkedin].filter(Boolean).map(esc).join(' | ')}</div>
      <div class="body">
        ${p.summary ? `<h2>Summary</h2><div class="summary">${esc(p.summary)}</div>` : ''}
        ${orderedBody(r)}
      </div>
    </div>`;
}

// ── Wharton: right-aligned dates, small caps section heads, restrained serif.
// Modeled on the Wharton MBA resume guide format. Popular for finance and consulting.
function tWharton(r, accent) {
  const p = r.personal;
  const st = customizeStyleAttr(r.customize, r._marginsKey);
  const contact = [p.email, p.phone, p.location, p.linkedin, p.website].filter(Boolean);
  return `
    <style>
      .t-wharton { font-family: "Times New Roman", Times, serif; color:#111; height:100%;
        padding: calc(5.5% * var(--app-margin,1)) calc(7.5% * var(--app-margin,1)); line-height:1.34; }
      .t-wharton .w-name { text-align:center; font-size:200%; font-weight:700; letter-spacing:.04em; text-transform:uppercase; }
      .t-wharton .w-contact { text-align:center; font-size:82%; color:#333; margin-top:5px; padding-bottom:calc(2% * var(--app-space,1)); border-bottom:1.2px solid #111; }
      .t-wharton .w-contact span:not(:last-child)::after { content:"  |  "; color:#666; }
      .t-wharton h2 { font-size:94%; font-weight:700; text-transform: var(--app-upper, uppercase); letter-spacing:.14em; text-align:center;
        margin: calc(4.4% * var(--app-space,1)) 0 calc(1.6% * var(--app-space,1)); border-bottom:.8px solid #111; padding-bottom:2px; }
      .t-wharton .t-entry { margin-bottom: calc(2.6% * var(--app-space,1)); }
      .t-wharton .t-entry-head { display:flex; justify-content:space-between; align-items:baseline; font-weight:700; font-size:96%; }
      .t-wharton .t-entry-date { font-weight:400; font-style:italic; font-size:88%; white-space:nowrap; padding-left:4%; }
      .t-wharton .t-entry-sub { font-style:italic; font-size:90%; color:#222; }
      .t-wharton .t-entry-desc, .t-wharton .summary { font-size:91%; }
      .t-wharton .t-bullets { font-size:91%; }
      .t-wharton .t-bullets li::before { color:#111; opacity:1; }
    </style>
    <div class="t-wharton" style="${st}">
      <div class="w-name">${esc(p.fullName)}</div>
      ${contact.length ? `<div class="w-contact">${contact.map(c => `<span>${esc(c)}</span>`).join('')}</div>` : ''}
      ${p.summary ? `<h2>Summary</h2><div class="summary">${esc(p.summary)}</div>` : ''}
      ${orderedBody(r)}
    </div>`;
}

// ── MIT: technical minimalism with a thin accent rule. Sans-serif, tight,
// engineered feel. Fits engineering, research, and applied science roles.
function tMit(r, accent) {
  const c = accent || '#8a1a2b';
  const p = r.personal;
  const st = customizeStyleAttr(r.customize, r._marginsKey);
  const contact = [p.email, p.phone, p.location, p.linkedin, p.github, p.website].filter(Boolean);
  return `
    <style>
      .t-mit { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; color:#111; height:100%;
        padding: calc(5% * var(--app-margin,1)) calc(7% * var(--app-margin,1)); line-height:1.36; }
      .t-mit .m-head { border-bottom: 3px solid ${c}; padding-bottom: calc(2% * var(--app-space,1)); margin-bottom: calc(3% * var(--app-space,1)); }
      .t-mit .m-name { font-size: 215%; font-weight:800; letter-spacing:-.01em; }
      .t-mit .m-contact { font-size:82%; color:#333; margin-top:6px; }
      .t-mit .m-contact span:not(:last-child)::after { content:" · "; color:#888; }
      .t-mit h2 { font-size:88%; font-weight:800; text-transform: var(--app-upper, uppercase); letter-spacing:.12em;
        color:${c}; margin: calc(4% * var(--app-space,1)) 0 calc(1.4% * var(--app-space,1)); }
      .t-mit .t-entry { margin-bottom: calc(2.6% * var(--app-space,1)); }
      .t-mit .t-entry-head { display:flex; justify-content:space-between; font-weight:700; font-size:96%; }
      .t-mit .t-entry-date { font-weight:400; font-size:87%; color:#555; white-space:nowrap; padding-left:4%; }
      .t-mit .t-entry-sub { font-size:89%; color:#333; }
      .t-mit .t-entry-desc, .t-mit .summary { font-size:91%; }
      .t-mit .t-bullets { font-size:91%; }
      .t-mit .t-bullets li::before { color:${c}; opacity:1; content:"▸"; }
      .t-mit .t-bullets li { padding-left: 1.05em; }
    </style>
    <div class="t-mit" style="${st}">
      <div class="m-head">
        <div class="m-name">${esc(p.fullName)}</div>
        ${contact.length ? `<div class="m-contact">${contact.map(c2 => `<span>${esc(c2)}</span>`).join('')}</div>` : ''}
      </div>
      ${p.summary ? `<h2>Summary</h2><div class="summary">${esc(p.summary)}</div>` : ''}
      ${orderedBody(r)}
    </div>`;
}

// ── Google Docs: the ubiquitous "resume template Google Docs" aesthetic.
// Arial-family sans, left-aligned name, thin blue accent, clean and universal.
// Ranks for the biggest resume-template keyword on Google.
function tGoogledocs(r, accent) {
  const c = accent || '#1a73e8';
  const p = r.personal;
  const st = customizeStyleAttr(r.customize, r._marginsKey);
  const contact = [p.email, p.phone, p.location, p.linkedin, p.website].filter(Boolean);
  return `
    <style>
      .t-gdocs { font-family: Arial, "Helvetica Neue", Helvetica, sans-serif; color:#202124; height:100%;
        padding: calc(6% * var(--app-margin,1)) calc(7.5% * var(--app-margin,1)); line-height:1.4; }
      .t-gdocs .g-name { font-size: 200%; font-weight:700; color:#202124; letter-spacing:-.01em; }
      .t-gdocs .g-title { font-size:105%; color:${c}; margin-top:2px; font-weight:500; }
      .t-gdocs .g-contact { font-size:82%; color:#5f6368; margin-top:8px; }
      .t-gdocs .g-contact span:not(:last-child)::after { content:"  ·  "; color:#bdc1c6; }
      .t-gdocs h2 { font-size:100%; font-weight:700; color:${c}; text-transform: var(--app-upper, uppercase); letter-spacing:.08em;
        margin: calc(4.2% * var(--app-space,1)) 0 calc(1.4% * var(--app-space,1)); padding-bottom:4px; border-bottom:1px solid #dadce0; }
      .t-gdocs .t-entry { margin-bottom: calc(2.8% * var(--app-space,1)); }
      .t-gdocs .t-entry-head { display:flex; justify-content:space-between; align-items:baseline; font-weight:700; font-size:96%; color:#202124; }
      .t-gdocs .t-entry-date { font-weight:400; font-size:86%; color:#5f6368; white-space:nowrap; padding-left:4%; }
      .t-gdocs .t-entry-sub { font-size:90%; color:#3c4043; font-style:normal; }
      .t-gdocs .t-entry-desc, .t-gdocs .summary { font-size:92%; color:#3c4043; }
      .t-gdocs .t-bullets { font-size:92%; }
      .t-gdocs .t-bullets li::before { color:#5f6368; opacity:1; }
    </style>
    <div class="t-gdocs" style="${st}">
      <div class="g-name">${esc(p.fullName)}</div>
      ${contact.length ? `<div class="g-contact">${contact.map(c2 => `<span>${esc(c2)}</span>`).join('')}</div>` : ''}
      ${p.summary ? `<h2>Summary</h2><div class="summary">${esc(p.summary)}</div>` : ''}
      ${orderedBody(r)}
    </div>`;
}

const TEMPLATE_RENDERERS = {
  harvard: tHarvard, stanford: tStanford, jake: tJake,
  consulting: tConsulting, faang: tFaang,
  modern: tModern, classic: tClassic, creative: tCreative, minimal: tMinimal,
  professional: tProfessional, executive: tExecutive,
  compact: tCompact, elegant: tElegant, slate: tSlate,
  ivory: tIvory, timeline: tTimeline, cascade: tCascade, deedy: tDeedy,
  twocolumn: tTwocolumn, healthcare: tHealthcare, sales: tSales, ats: tAts,
  wharton: tWharton, mit: tMit, googledocs: tGoogledocs
};

// Public API: render any template
// renderTemplate(templateId, resume, mini, accent, marginsKey?)
// Shared across every template + the export iframe: clean hanging-indent bullet
// lists with emphasised metrics. Inherits colour from the template root so it
// works on both light and dark templates.
const SHARED_TEMPLATE_CSS = `<style>
.t-bullets { list-style: none; margin: .4em 0 0; padding: 0; font-size: .92em; line-height: var(--app-line, 1.42); }
.t-bullets li { position: relative; padding-left: var(--app-bullet-pad, 1.05em); margin-bottom: .28em; }
.t-bullets li:last-child { margin-bottom: 0; }
.t-bullets li::before { content: var(--app-bullet, '•'); position: absolute; left: .12em; top: 0; opacity: .65; }
.t-bullets strong { font-weight: 700; }
</style>`;

function renderTemplate(templateId, resume, mini, accent, marginsKey) {
  const fn = TEMPLATE_RENDERERS[templateId] || tModern;
  const data = withFallback(resume, mini, marginsKey);
  // Accent is interpolated into template <style> blocks; force it to a valid hex so
  // tampered stored/cloud JSON can't inject CSS (or break out of the <style>).
  const safeAccent = /^#[0-9a-fA-F]{3,8}$/.test(accent || "") ? accent : "#4f46e5";
  return SHARED_TEMPLATE_CSS + fn(data, safeAccent);
}

// ============ Isolated iframe rendering ============
// Templates emit <style> blocks with class rules that can bleed into a host
// page. Rendering them inside an iframe document keeps them fully isolated.
// One US-Letter page is 816×1056px at 96dpi; A4 is 794px wide.
function resumeDocHTML(bodyHTML, pageWidth) {
  const w = pageWidth || 816;
  const pageSize = w > 800 ? 'letter' : 'A4';
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  html, body { margin:0; padding:0; background:#fff; color:#111;
    font-family:-apple-system,BlinkMacSystemFont,Inter,"Segoe UI",Roboto,sans-serif;
    /* Force background colours/gradients (template headers, sidebars) to print
       instead of being stripped by the browser's "economy" print default. */
    -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  body { width:${w}px;
    /* Print-grade typography: crisp rendering, real kerning/ligatures, and
       lining tabular figures so date ranges align like a typeset resume. */
    -webkit-font-smoothing:antialiased; -moz-osx-font-smoothing:grayscale;
    text-rendering:optimizeLegibility; font-kerning:normal;
    font-feature-settings:"kern" 1,"liga" 1,"tnum" 1,"lnum" 1;
    font-variant-numeric: lining-nums tabular-nums; }
  * { box-sizing:border-box; }
  @page { size:${pageSize}; margin:0; }
  /* Two-page support: don't split an entry across the page break, and keep a
     section heading with its content. */
  .t-entry { break-inside:avoid; page-break-inside:avoid; }
  h2, h3, h4 { break-after:avoid; page-break-after:avoid; }
  /* Two-column templates (creative / professional / slate): keep the colored
     sidebar and the main column from splitting mid-block across a page break,
     which is what makes the columns look offset on page 2. */
  .sidebar, .main { break-inside:avoid; page-break-inside:avoid; }
</style></head><body>${bodyHTML}</body></html>`;
}

// Write resume body HTML into an iframe in fully isolated fashion.
// Returns the iframe's document.
function writeResumeFrame(frame, bodyHTML, pageWidth) {
  const doc = frame.contentDocument || frame.contentWindow.document;
  doc.open();
  doc.write(resumeDocHTML(bodyHTML, pageWidth));
  doc.close();
  return doc;
}

// "Fit to one page": if the resume is only slightly over a page, shrink the base
// font-size and the --app-space spacing multiplier together (both scale content
// height ~proportionally) until it fits, clamped to a readable floor so it never
// becomes unreadable. Runs on the SAME rendered doc used by the preview and the
// export, so what you see matches the PDF. Idempotent: always resets first.
// Returns true if the doc now fits within one page.
const FIT_ONE_PAGE_FLOOR = 0.72;   // never shrink text below 72% (~11.5px base, print-readable floor)
const FIT_ONE_PAGE_MARGIN_FLOOR = 0.58;   // margins may go tighter than text; they cost height without hurting legibility
function fitDocToOnePage(doc, pageH) {
  if (!doc || !doc.body) return false;
  // The body starts with the shared + template <style> blocks, so the resume root
  // (.t-modern, .t-onyx, …) is the first DIV child, NOT firstElementChild.
  const root = doc.body.querySelector('div[class^="t-"]')
    || Array.from(doc.body.children).find(el => el.tagName === 'DIV');
  if (!root) return false;
  const win = doc.defaultView || window;
  // Reset any previous fit so re-renders are idempotent and measurement is honest.
  root.style.fontSize = '';
  root.style.removeProperty('--app-space');
  root.style.removeProperty('--app-margin');
  const cs = win.getComputedStyle(root);
  const baseSpace = parseFloat(cs.getPropertyValue('--app-space')) || 1;
  const baseMargin = parseFloat(cs.getPropertyValue('--app-margin')) || 1;
  const baseScale = parseFloat(cs.getPropertyValue('--app-scale')) || 1;   // user text-size choice
  const measure = () => doc.body.scrollHeight || doc.documentElement.scrollHeight || 0;
  let h = measure();
  if (h <= pageH) return true;                     // already one page, nothing to do
  // Shrink CUMULATIVELY: each pass multiplies the running factor by the ratio still
  // needed. Some height (fixed page padding) doesn't scale, so a linear guess would
  // overshoot; a few multiplicative passes converge. We compress font-size + section
  // spacing to the readability floor, and squeeze the page margins a little further
  // (they cost vertical room but don't hurt legibility), clamped to their own floor.
  let factor = 1;
  for (let i = 0; i < 6 && h > pageH; i++) {
    const prev = factor;
    factor = Math.max(FIT_ONE_PAGE_FLOOR, factor * (pageH - 8) / h);
    const marginFactor = Math.max(FIT_ONE_PAGE_MARGIN_FLOOR, factor);   // margins can go a touch tighter than text
    root.style.fontSize = (16 * baseScale * factor).toFixed(2) + 'px';
    root.style.setProperty('--app-space', (baseSpace * factor).toFixed(3));
    root.style.setProperty('--app-margin', (baseMargin * marginFactor).toFixed(3));
    h = measure();
    if (factor === prev && marginFactor === Math.max(FIT_ONE_PAGE_MARGIN_FLOOR, prev)) break;  // fully floored
  }
  return h <= pageH;
}
if (typeof window !== 'undefined') window.fitDocToOnePage = fitDocToOnePage;

/* ============================================================================
   HFPaginate, ONE shared page-break decision for BOTH the editor's live
   preview and the exported PDF, so what a user sees is exactly what an employer
   receives (true WYSIWYG). Previously the two had separate paginators that
   drifted (different page-height tolerance, page caps, and oversized-block
   handling), so the preview and the PDF could disagree. This is the single
   source of truth; each surface keeps its own rendering (gray sheets on canvas
   vs. clean flow with CSS page-breaks) but asks THIS for where the breaks go.

   The decision runs on CONTINUOUS (un-paginated) coordinates, measured at the
   real page width, so it's identical whether it drives on-screen sheets or the
   print break-before markers. Logic is ported from the editor's proven
   paginator: an 8px tail tolerance, section-heading orphan control, oversized
   atomic blocks that span multiple sheets, and a 40-page safety cap.
   ============================================================================ */
(function () {
  var DIMS = { Letter: { w: 816, h: 1056 }, A4: { w: 794, h: 1123 } }; // 96dpi
  var GAP = 24;          // gray gap between page sheets (preview only)
  var PAD = 40;          // gray canvas margin around the page column (preview only)
  var MAX_SHEETS = 40;   // safety cap: covers even long academic CVs
  var TAIL = 8;          // absorb trailing margins/rounding so a hair of overflow can't spawn a page

  function dims(paper) { return (paper === 'A4') ? DIMS.A4 : DIMS.Letter; }
  function isHeading(el) { return el && el.nodeType === 1 && /^H[1-4]$/.test(el.tagName); }

  // Best "flow root": the element that actually holds the resume's top-level blocks.
  function flowRoot(root) {
    var named = root.querySelector('.body');
    if (named) return named;
    var best = root.firstElementChild || root, bn = best.children ? best.children.length : 0;
    root.querySelectorAll('div, section, main').forEach(function (el) {
      if (el.children.length > bn) { best = el; bn = el.children.length; }
    });
    return best;
  }

  // Break-units: descend into any block taller than a page (with >1 child) so a
  // huge entry or long bullet list breaks at a real child boundary, not mid-line.
  function breakUnits(root, pageH) {
    var units = [], MAX_DEPTH = 5;
    function collect(el, depth) {
      if (el.classList && el.classList.contains('hf-pagebreak')) return;
      var kids = el.children
        ? Array.prototype.slice.call(el.children).filter(function (c) { return !(c.classList && c.classList.contains('hf-pagebreak')); })
        : [];
      var tooTall = el.getBoundingClientRect().height > pageH;
      if (tooTall && kids.length > 1 && depth < MAX_DEPTH) { kids.forEach(function (gc) { collect(gc, depth + 1); }); }
      else units.push(el);
    }
    Array.prototype.slice.call(root.children).forEach(function (c) { collect(c, 0); });
    return units;
  }

  // Content children of the iframe body (everything except the <style> and our sheets).
  function contentEls(body) {
    return Array.prototype.slice.call(body.children).filter(function (el) {
      return el.tagName !== 'STYLE' && !(el.classList && el.classList.contains('hf-sheet'));
    });
  }

  // Measure each unit's continuous top + height relative to `ref`'s top.
  function measure(units, ref) {
    var base = ref.getBoundingClientRect().top;
    return units.map(function (u) { var r = u.getBoundingClientRect(); return { el: u, top: r.top - base, h: r.height }; });
  }

  // THE decision. Given continuously-measured units, return the ordered set of
  // units that begin a new page (each with the sheet index it lands on + its
  // continuous top), plus the total page count. Faithful port of the editor loop.
  function decide(measured, pageH) {
    var breaks = [];
    if (!measured.length) return { breaks: breaks, pages: 1 };
    var page = 0, pageStartY = measured[0].top, forceBreakNext = false, prev = null;
    for (var i = 0; i < measured.length; i++) {
      if (page >= MAX_SHEETS - 1) break;
      var m = measured[i];
      if (m.h < 1) { prev = m; continue; }   // skip phantom units (no height)
      if (forceBreakNext) {
        forceBreakNext = false;
        if (m.top - pageStartY > 1) { breaks.push({ el: m.el, page: page + 1, top: m.top }); pageStartY = m.top; page++; }
      }
      if ((m.top + m.h - pageStartY > pageH + TAIL) && (m.top - pageStartY > 1)) {
        // Orphan control: carry a preceding section heading to the next page.
        var targetEl = m.el, targetTop = m.top;
        if (prev && isHeading(prev.el) && (prev.top - pageStartY > 1)) { targetEl = prev.el; targetTop = prev.top; }
        breaks.push({ el: targetEl, page: page + 1, top: targetTop });
        pageStartY = targetTop; page++;
      }
      // Atomic block taller than a page: reserve the extra sheets it spans.
      if (m.h > pageH + TAIL) {
        page += Math.min(MAX_SHEETS - 1 - page, Math.ceil((m.h - TAIL) / pageH) - 1);
        forceBreakNext = true;
      }
      prev = m;
    }
    return { breaks: breaks, pages: Math.min(MAX_SHEETS, page + 1) };
  }

  // Convenience: reset any prior pagination artifacts a surface left behind.
  function reset(doc) {
    doc.querySelectorAll('.hf-sheet, .hf-pagebreak').forEach(function (e) { e.remove(); });
    var body = doc.body;
    var prevCol = Array.prototype.slice.call(body.children).find(function (el) { return el.classList && el.classList.contains('hf-doc'); });
    if (prevCol) { while (prevCol.firstChild) body.insertBefore(prevCol.firstChild, prevCol); prevCol.remove(); }
  }

  window.HFPaginate = {
    DIMS: DIMS, GAP: GAP, PAD: PAD, MAX_SHEETS: MAX_SHEETS, TAIL: TAIL,
    dims: dims, isHeading: isHeading, flowRoot: flowRoot,
    breakUnits: breakUnits, contentEls: contentEls, measure: measure, decide: decide, reset: reset,
  };
})();