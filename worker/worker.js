// ===== HireFlow Cloudflare Worker =====
// Auth + AI + Stripe billing + plan gating
//
// Endpoints:
//   Auth:    POST /auth/signup, POST /auth/login
//   User:    GET  /me                                  → { email, plan, downloadsUsed, downloadLimit }
//   Resume:  GET  /resume,  POST /resume
//   AI:      POST /ai/{improve,skills,tailor,ats,analyze,parse,interview}  (Premium+ only except 'improve' on summary)
//   Billing: POST /stripe/checkout  { plan: "premium" | "lifetime" }  → { url }
//            POST /stripe/portal                                       → { url }
//            POST /stripe/webhook                                      (Stripe → us)
//   Usage:   POST /downloads/increment                                  → { ok, downloadsUsed, allowed }

// Smaller, faster: free-form writing tasks.
// NOTE: the old "@cf/meta/llama-3.1-8b-instruct" was DEPRECATED by Cloudflare on
// 2026-05-30 (error 5028), which broke every AI call. Use the current model ids.
const FAST_MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";
// Larger, better at structured output + reasoning: parse, analyze, tailor, ats.
const SMART_MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";

// Shared anti-hallucination directive, prepended to every generative AI prompt so the
// model can never fabricate facts the candidate didn't actually provide. This is the
// single most important guardrail for output quality/trust.
const GROUNDING = `GROUNDING, the most important rule, overrides everything else if in conflict:
Use ONLY facts explicitly present in the candidate's input. Never invent, assume, infer, or embellish. Do NOT add numbers, percentages, dollar amounts, metrics, dates, job titles, company names, team sizes, technologies, tools, degrees, certifications, or achievements that are not clearly stated in the input. If a specific detail (like a metric) is missing, keep the statement qualitative, never fabricate one. When unsure whether something is supported, leave it out. Accurate and modest always beats impressive and false.
Never use em dashes; use commas, periods, or parentheses instead.`;

// AI endpoints that require Premium/Lifetime
// Note: "parse" (resume import) is intentionally NOT here, importing is free for everyone.
const PRO_AI = new Set(["tailor", "ats", "analyze", "interview", "skills", "improve", "assistant", "autopilot", "letter", "modernize", "salary"]);
// Career Coach (assistant) is Premium/Lifetime only, it is in PRO_AI above and the
// frontend shows a Premium gate to free users. Cover letters give a small free taste.
const FREE_COVER_LETTERS = 2;
// Free users get a few real tries of each PRO AI feature before the paywall, so they
// actually experience the AI (the biggest driver of activation + paid conversion).
// Tracked per feature on the user record; the daily cap still applies on top.
// Per-feature overrides (0 = fully Premium, no free try). MUST mirror the client's
// FEATURE_TRIAL_LIMITS in js/plan.js so the UI and backend agree.
const FREE_AI_TRIALS = 2;
const FREE_TRIAL_LIMITS = { assistant: 0, autopilot: 0, skills: 1 };
// Per-account daily AI call caps, a soft backstop against runaway usage/abuse
// driving up Workers AI cost. Deliberately far above what a genuine user does in a
// day (free users can only reach parse / interview / summary-improve; paid do heavier
// tailoring). Admins bypass entirely. Approximate (KV, eventually consistent) by design.
const FREE_AI_DAILY = 50;
const PAID_AI_DAILY = 400;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname;
    const cors = corsHeaders(env, req);

    if (req.method === "OPTIONS") return new Response(null, { headers: cors });

    // Stripe webhook gets raw body, handle before JSON parsing
    if (path === "/stripe/webhook") {
      return handleWebhook(req, env).then(r => withCors(r, cors)).catch(e => withCors(json({ error: e.message }, e.status || 500), cors));
    }

    // One-click email unsubscribe (public, HTML response, token-verified, no login).
    if (path === "/unsubscribe") {
      return handleUnsubscribe(url, env).catch(() => new Response("Something went wrong.", { status: 500, headers: { "Content-Type": "text/html" } }));
    }

    // Google Drive OAuth callback: exchanges code for tokens, stores refresh_token, closes popup.
    if (path === "/auth/gdrive/callback") {
      return gdriveCallback(req, url, env).catch(e => new Response(`<html><body><script>window.opener&&window.opener.postMessage({type:'gdrive_error',error:${JSON.stringify(e.message)}},'*');window.close();</script><p>Error: ${e.message}</p></body></html>`, { status: 500, headers: { "Content-Type": "text/html" } }));
    }

    try {
      if (path === "/auth/signup")             return json(await signup(req, env), 200, cors);
      if (path === "/auth/login")              return json(await login(req, env), 200, cors);
      if (path === "/auth/google")             return json(await googleAuth(req, env), 200, cors);
      if (path === "/me")                      return json(await me(req, env), 200, cors);
      if (path === "/me/sync")                 return json(await syncWithStripe(req, env), 200, cors);
      if (path === "/status")                  return json(await getStatus(req, env), 200, cors);
      if (path === "/promo/earlybird")         return json(await getEarlyBirdStatus(req, env), 200, cors);
      if (path === "/pageview")                return json(await trackPageview(req, env), 200, cors);
      if (path === "/track" && req.method === "POST") return json(await trackFeature(req, env), 200, cors);
      if (path === "/demo/session" && req.method === "POST") return json(await demoSession(req, env), 200, cors);
      if (path === "/resume" && req.method === "GET")  return json(await getResume(req, env), 200, cors);
      if (path === "/resume" && req.method === "POST") return json(await saveResume(req, env), 200, cors);
      if (path === "/profile" && req.method === "GET")  return json(await getProfile(req, env), 200, cors);
      if (path === "/profile" && req.method === "POST") return json(await saveProfile(req, env), 200, cors);
      if (path === "/attribution" && req.method === "POST") return json(await saveAttribution(req, env), 200, cors);
      if (path === "/onboarding-answers" && req.method === "POST") return json(await saveOnboardingAnswers(req, env), 200, cors);
      if (path === "/consent/config")                  return json(await getConsentConfig(), 200, cors);
      if (path === "/consent" && req.method === "GET")  return json(await getConsent(req, env), 200, cors);
      if (path === "/consent" && req.method === "POST") return json(await setConsent(req, env), 200, cors);
      if (path === "/testimonial" && req.method === "GET")  return json(await getTestimonial(req, env), 200, cors);
      if (path === "/testimonial" && req.method === "POST") return json(await setTestimonial(req, env), 200, cors);
      if (path === "/admin/testimonials")              return json(await adminListTestimonials(req, env), 200, cors);
      if (path === "/jobs" && req.method === "GET")  return json(await getJobs(req, env), 200, cors);
      if (path === "/jobs" && req.method === "POST") return json(await saveJobs(req, env), 200, cors);
      if (path === "/downloads/increment")     return json(await incrementDownload(req, env), 200, cors);
      if (path === "/stripe/checkout")         return json(await createCheckout(req, env), 200, cors);
      if (path === "/stripe/portal")           return json(await createPortal(req, env), 200, cors);
      if (path === "/feedback" && req.method === "POST")     return json(await saveFeedback(req, env), 200, cors);
      if (path === "/feedback/list" && req.method === "GET") return json(await listFeedback(req, env), 200, cors);
      if (path === "/admin/analytics")         return json(await adminAnalytics(req, env), 200, cors);
      if (path === "/admin/users")             return json(await adminListUsers(req, env), 200, cors);
      if (path === "/admin/users/delete")      return json(await adminDeleteUser(req, env), 200, cors);
      if (path === "/admin/ai-disable")        return json(await adminSetAIDisabled(req, env), 200, cors);
      if (path === "/admin/maintenance")       return json(await adminSetMaintenance(req, env), 200, cors);
      if (path === "/admin/admin-access")      return json(await adminSetAdminAccess(req, env), 200, cors);
      if (path === "/admin/test-win-nudge")    return json(await adminTestWinNudge(req, env), 200, cors);
      if (path === "/referral/code" && req.method === "POST") return json(await referralGetCode(req, env), 200, cors);
      if (path === "/referral/stats")            return json(await referralStats(req, env), 200, cors);
      if (path === "/interview-win" && req.method === "POST") return json(await recordInterviewWin(req, env), 200, cors);
      if (path === "/interview-wins")          return json(await getInterviewWins(req, env), 200, cors);
      if (path === "/auth/gdrive/start")       return json(await gdriveStart(req, env), 200, cors);
      if (path === "/export-gdoc" && req.method === "POST") return json(await exportToGdoc(req, env), 200, cors);
      if (path.startsWith("/ai/stream/"))      return aiStream(req, env, path.slice(11), cors);
      if (path.startsWith("/ai/"))             return json(await ai(req, env, path.slice(4)), 200, cors);
      return json({ error: "Not found" }, 404, cors);
    } catch (e) {
      return json({ error: e.message || "Error" }, e.status || 500, cors);
    }
  },

  // Cron: Fridays 16:00 UTC = weekly win nudge + review nudge; daily 14:00 UTC = re-engagement drip + post-download review.
  // All inert until env.RESEND_API_KEY is configured.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runWeeklyWinNudge(env).catch(() => {}));
    ctx.waitUntil(runPostDownloadReviewNudge(env).catch(() => {}));
    // Re-engagement drip disabled until ready to activate
    // ctx.waitUntil(runReEngagementDrip(env).catch(() => {}));
  },
};

// ============ Helpers ============
function corsHeaders(env, req) {
  const allowed = (env.ALLOWED_ORIGIN || "*").split(",").map(s => s.trim());
  const reqOrigin = req && req.headers.get("Origin");
  let origin = "*";
  if (allowed.includes("*")) origin = "*";
  else if (reqOrigin && allowed.includes(reqOrigin)) origin = reqOrigin;
  else origin = allowed[0];
  return {
    "Access-Control-Allow-Origin": origin,
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}
// Baseline security headers for every API response. This is a JSON auth API:
// responses must never be sniffed, framed, cached by intermediaries, or leak a referrer.
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
};
function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status, headers: { "Content-Type": "application/json", ...SECURITY_HEADERS, ...headers },
  });
}
function withCors(res, cors) {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(cors)) h.set(k, v);
  return new Response(res.body, { status: res.status, headers: h });
}
function err(status, message) { const e = new Error(message); e.status = status; return e; }

// ============ Crypto (PBKDF2 + signed token) ============
async function hashPassword(password, saltHex) {
  const salt = saltHex ? hexToBuf(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password),
    { name: "PBKDF2" }, false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, key, 256);
  return { salt: bufToHex(saltHex ? hexToBuf(saltHex) : salt), hash: bufToHex(new Uint8Array(bits)) };
}
async function verifyPassword(password, saltHex, hashHex) {
  const { hash } = await hashPassword(password, saltHex);
  return timingEqual(hash, hashHex);
}
function timingEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
function bufToHex(buf) { return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join(""); }
function hexToBuf(hex) { const a = new Uint8Array(hex.length/2); for (let i=0;i<a.length;i++) a[i]=parseInt(hex.substr(i*2,2),16); return a; }
function b64url(buf) { return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
function b64urlDecode(s) { s = s.replace(/-/g,'+').replace(/_/g,'/'); while (s.length%4) s+='='; return Uint8Array.from(atob(s), c=>c.charCodeAt(0)); }

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
}
async function hmacB64Url(secret, data) { return b64url(await hmac(secret, data)); }
async function hmacHex(secret, data) { return bufToHex(await hmac(secret, data)); }

async function signToken(payload, secret) {
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  return `${body}.${await hmacB64Url(secret, body)}`;
}
async function verifyToken(token, secret) {
  if (!token || !token.includes(".")) throw err(401, "Invalid token");
  const [body, sig] = token.split(".");
  if (sig !== await hmacB64Url(secret, body)) throw err(401, "Invalid token");
  const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body)));
  if (payload.exp && payload.exp < Date.now()/1000) throw err(401, "Token expired");
  return payload;
}

async function authenticate(req, env) {
  const h = req.headers.get("Authorization") || "";
  const token = h.replace(/^Bearer\s+/i, "");
  const payload = await verifyToken(token, env.JWT_SECRET);
  // Immediately revoke admin sessions if super disabled the ADMIN tier
  if (payload.role === "admin") {
    const adminDisabled = await env.HIREFLOW_KV.get("system:admin_disabled");
    if (adminDisabled === "1") throw err(401, "Invalid token");
  }
  return payload;
}

// ============ User helpers ============
async function getUser(env, email) {
  const raw = await env.HIREFLOW_KV.get(`user:${email.toLowerCase()}`);
  return raw ? JSON.parse(raw) : null;
}
async function putUser(env, user) {
  await env.HIREFLOW_KV.put(`user:${user.email.toLowerCase()}`, JSON.stringify(user));
}

// ---- Retention / activity tracking ----
// Records that a user was active. This is what powers the returning-user, WAU, and MAU
// metrics the admin needs (repeat usage, not just signups). `days` is a bounded list of
// distinct active UTC days (kept for the 7/30-day windows); `activeDayCount` is the total
// distinct days ever active (>= 2 means they came back at least once); `lastSeen` is recency.
// Pure mutation, no KV write, so callers that already persist the user fold it into their
// existing write. Returns true when this is the user's first activity of the day.
function _touchActivity(user) {
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  user.days = Array.isArray(user.days) ? user.days : [];
  const newDay = user.days[user.days.length - 1] !== today && !user.days.includes(today);
  if (newDay) {
    user.days.push(today);
    if (user.days.length > 60) user.days = user.days.slice(-60);
    user.activeDayCount = (Number(user.activeDayCount) || 0) + 1;
  }
  user.lastSeen = now;
  return newDay;
}

// Same, but persists when worthwhile: a new active day, or when lastSeen has gone stale
// (> 1h). Used on endpoints like /me and /auth/login that don't otherwise write the user,
// so activity is captured while keeping KV writes to ~once/hour/user.
async function touchActivity(env, user, req) {
  if (!user) return;
  if (req && req.cf) {
    const cf = req.cf;
    user.geo = {
      country: cf.country || null,
      city: cf.city || null,
      region: cf.region || null,
      timezone: cf.timezone || null,
      continent: cf.continent || null,
    };
  }
  const wasStale = !user.lastSeen || (Date.now() - Number(user.lastSeen)) > 3600000;
  const newDay = _touchActivity(user);
  if (newDay || wasStale) await putUser(env, user);
}
function isPaidPlan(user) {
  if (!user) return false;
  if (user.plan === "lifetime") return true;
  if (user.plan === "premium") {
    return !user.currentPeriodEnd || user.currentPeriodEnd > Math.floor(Date.now() / 1000);
  }
  return false;
}

// ============ Early-bird promo: first N signups get free Premium ============
// Config lives in KV ("promo:earlybird") so the cap, deadline, and on/off can be
// tuned from the admin panel with no redeploy. These are the defaults used until an
// admin saves a config. endsAt/limit are the gate; `granted` is the running count.
const EARLYBIRD_DEFAULTS = {
  enabled: true,
  limit: 100,
  endsAt: 0,       // 0 = "end of current month", resolved per-request (see below)
  grantDays: 60,   // 2 months of free Premium
  granted: 0,
};
// End of the current UTC month, in unix seconds. Computed at REQUEST time, never at
// module top level: Cloudflare Workers evaluate Date as 0 during global-scope init,
// so a precomputed default would land in Jan 1970 and the promo would read as closed.
function _endOfThisMonth() {
  const d = new Date();
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000) - 1;
}
async function _getEarlyBird(env) {
  let cfg = { ...EARLYBIRD_DEFAULTS };
  try {
    const raw = await env.HIREFLOW_KV.get("promo:earlybird");
    if (raw) cfg = { ...cfg, ...JSON.parse(raw) };
  } catch (_) {}
  if (!cfg.endsAt) cfg.endsAt = _endOfThisMonth();   // resolve the "end of month" default
  return cfg;
}
function _earlyBirdOpen(cfg, now) {
  return !!cfg.enabled && (cfg.granted || 0) < cfg.limit && Math.floor(now / 1000) <= cfg.endsAt;
}
// Grant the comp to a freshly-created user if a spot is still open. Mutates `user`
// (caller writes it) and bumps the KV counter. NOTE: KV has no atomic increment, so a
// burst of simultaneous signups could over-grant by a handful; harmless for a promo,
// and real volume never approaches it. Tagged promoEarlyBird so analytics can keep
// these OUT of revenue (they're comped, not paying).
async function _grantEarlyBirdIfEligible(env, user) {
  try {
    const cfg = await _getEarlyBird(env);
    const now = Date.now();
    if (!_earlyBirdOpen(cfg, now)) return false;
    user.plan = "premium";
    user.currentPeriodEnd = Math.floor(now / 1000) + (cfg.grantDays || 60) * 86400;
    user.promoEarlyBird = true;
    user.promoGrantedAt = now;
    cfg.granted = (cfg.granted || 0) + 1;
    await env.HIREFLOW_KV.put("promo:earlybird", JSON.stringify(cfg));
    return true;
  } catch (_) { return false; }   // never let a promo hiccup break signup
}
// Public: how many early-bird spots remain (drives the scarcity banner). No auth.
async function getEarlyBirdStatus(req, env) {
  const cfg = await _getEarlyBird(env);
  const open = _earlyBirdOpen(cfg, Date.now());
  return {
    active: open,
    limit: cfg.limit,
    claimed: Math.min(cfg.granted || 0, cfg.limit),
    remaining: Math.max(0, cfg.limit - (cfg.granted || 0)),
    endsAt: cfg.endsAt,
    grantDays: cfg.grantDays || 60,
  };
}

// ============ Signup email validation ============
// Block junk, disposable, and unreachable emails at account creation. Google signups
// skip all of this (Google has already verified the address). Everything fails OPEN on
// an infrastructure hiccup so a DNS blip never blocks a legitimate user.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// Known disposable / throwaway / placeholder domains. A static list of the common ones
// catches the large majority of burner signups (and the @test.com junk) at zero cost.
const DISPOSABLE_DOMAINS = new Set([
  "test.com", "example.com", "example.org", "example.net", "hireflow.test", "test.test",
  "mailinator.com", "guerrillamail.com", "guerrillamailblock.com", "sharklasers.com",
  "10minutemail.com", "tempmail.com", "temp-mail.org", "tempmail.net", "throwawaymail.com",
  "yopmail.com", "getnada.com", "nada.email", "trashmail.com", "trashmail.de", "maildrop.cc",
  "dispostable.com", "fakeinbox.com", "mailnesia.com", "mintemail.com", "mohmal.com",
  "spamgourmet.com", "emailondeck.com", "mytemp.email", "tempinbox.com", "33mail.com",
  "getairmail.com", "tempr.email", "moakt.com", "inboxbear.com", "email-temp.com",
  "tmailor.com", "burnermail.io", "harakirimail.com", "discard.email", "spam4.me",
  "grr.la", "pokemail.net", "byom.de", "mailcatch.com", "tempmailo.com", "1secmail.com",
  "neowd.com", "emlhub.com", "emlpro.com",
]);
// DNS-over-HTTPS check (Cloudflare 1.1.1.1): does the domain actually accept mail?
// True if it has MX records, or A/AAAA as a lenient fallback (some small domains accept
// mail on the A record). Only returns false when DoH answers cleanly with nothing usable.
async function _domainAcceptsMail(domain) {
  try {
    const q = (type) => fetch(
      "https://cloudflare-dns.com/dns-query?name=" + encodeURIComponent(domain) + "&type=" + type,
      { headers: { accept: "application/dns-json" } }
    ).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const mx = await q("MX");
    if (mx && Array.isArray(mx.Answer) && mx.Answer.some((a) => a.type === 15)) return true;
    const a = await q("A");
    if (a && Array.isArray(a.Answer) && a.Answer.length) return true;
    // Both queries came back cleanly with nothing usable. Reject only when the answer is
    // definitive: Status 0 (domain exists, no mail records) or Status 3 (NXDOMAIN, no such
    // domain). Anything else (null fetch, SERVFAIL, etc.) fails OPEN so a blip never blocks.
    if (mx && a && (mx.Status === 0 || mx.Status === 3)) return false;
    return true;
  } catch (_) { return true; }
}
// Common typosquats of major email providers. These domains often have MX records
// (they're real domains that catch mistyped emails) so DNS validation passes them.
const TYPOSQUAT_MAP = {
  "gmail.com": ["gail.com","gmal.com","gmial.com","gmaill.com","gamil.com","gnail.com","gmali.com","gimail.com","gmsil.com","gmil.com","gmaul.com","gmakl.com","gmai.com","gmailcom","g]mail.com"],
  "yahoo.com": ["yaho.com","yahooo.com","yhaoo.com","yahooc.om","yhoo.com","yaho0.com"],
  "outlook.com": ["outllook.com","outlok.com","outloo.com","outlookcom","oultook.com"],
  "hotmail.com": ["hotmal.com","homail.com","hotmai.com","hotmial.com","hotmailcom","hotamil.com"],
};
const TYPOSQUAT_DOMAINS = new Map();
for (const [correct, typos] of Object.entries(TYPOSQUAT_MAP)) {
  for (const t of typos) TYPOSQUAT_DOMAINS.set(t, correct);
}

// Validate + normalize (trim/lowercase) an email for signup, or throw a friendly 400.
async function _validateSignupEmail(email) {
  const norm = String(email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(norm) || norm.length > 254) throw err(400, "Please enter a valid email address.");
  const domain = norm.slice(norm.lastIndexOf("@") + 1);
  if (DISPOSABLE_DOMAINS.has(domain)) throw err(400, "Please use a permanent email address. Disposable inboxes aren't allowed.");
  const correction = TYPOSQUAT_DOMAINS.get(domain);
  if (correction) throw err(400, `Did you mean @${correction}? "${domain}" looks like a typo.`);
  if (!(await _domainAcceptsMail(domain))) throw err(400, "That email domain doesn't seem to accept mail. Please check for a typo.");
  return norm;
}

// ============ Anti-abuse: one account per IP ============
// Cloudflare sets CF-Connecting-IP to the real client IP at the edge.
function _clientIp(req) {
  return (req.headers.get("CF-Connecting-IP") || req.headers.get("x-real-ip") || "").trim();
}
// IPs are PII, so we never store them raw: the KV key is an HMAC of the IP keyed
// with JWT_SECRET (not reversible, not enumerable without the secret).
async function _ipAccountKey(env, ip) {
  return "ipacct:" + (await hmacHex(env.JWT_SECRET, "ip " + ip));
}
// Enforced UNLESS explicitly disabled (set the ONE_ACCOUNT_PER_IP var to "off" to
// flip this off instantly without a redeploy — e.g. if it starts blocking real
// users behind shared office/school/mobile IPs). Fails OPEN on any error or when
// the edge gives us no IP, so a glitch never blocks a legitimate signup.
async function _assertIpMayCreateAccount(req, env) {
  if (env.ONE_ACCOUNT_PER_IP === "off") return;
  const ip = _clientIp(req);
  if (!ip) return;
  try {
    const existing = await env.HIREFLOW_KV.get(await _ipAccountKey(env, ip));
    if (existing) throw err(429, "An account has already been created from this network. If you think this is a mistake, contact support@appliohq.com.");
  } catch (e) {
    if (e && e.status === 429) throw e;   // real block, re-throw
    // KV/DNS/etc. failure: fail open.
  }
}
async function _recordIpAccount(req, env, email) {
  if (env.ONE_ACCOUNT_PER_IP === "off") return;
  const ip = _clientIp(req);
  if (!ip) return;
  try { await env.HIREFLOW_KV.put(await _ipAccountKey(env, ip), email); } catch (_) {}
}

// ============ Referral program ============
const REFERRAL_REWARD_DAYS = 7;

function _genRefCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  const arr = crypto.getRandomValues(new Uint8Array(6));
  for (let i = 0; i < 6; i++) code += chars[arr[i] % chars.length];
  return code;
}

async function referralGetCode(req, env) {
  const payload = await authenticate(req, env);
  const user = await getUser(env, payload.email);
  if (!user) throw err(404, "User not found");
  if (user.referralCode) return { code: user.referralCode };
  const code = _genRefCode();
  user.referralCode = code;
  await putUser(env, user);
  await env.HIREFLOW_KV.put("ref:" + code, payload.email);
  return { code };
}

async function referralStats(req, env) {
  const payload = await authenticate(req, env);
  const user = await getUser(env, payload.email);
  if (!user) throw err(404, "User not found");
  return {
    code: user.referralCode || null,
    count: user.referralCount || 0,
    rewardDays: REFERRAL_REWARD_DAYS,
  };
}

async function _applyReferral(env, newUser, refCode) {
  if (!refCode) return;
  const code = String(refCode).trim().toUpperCase();
  if (code.length !== 6) return;
  const referrerEmail = await env.HIREFLOW_KV.get("ref:" + code);
  if (!referrerEmail) return;
  if (referrerEmail === newUser.email) return;
  newUser.referredBy = code;
  const referrer = await getUser(env, referrerEmail);
  if (!referrer) return;
  referrer.referralCount = (referrer.referralCount || 0) + 1;
  _addPremiumDays(referrer, REFERRAL_REWARD_DAYS);
  await putUser(env, referrer);
  _addPremiumDays(newUser, REFERRAL_REWARD_DAYS);
}

// ── Interview success tracker ───────────────────────────────────────
async function recordInterviewWin(req, env) {
  const user = await authUser(req, env);
  const { outcome } = await req.json();
  if (!["interview", "offer", "no"].includes(outcome)) throw Object.assign(new Error("Invalid outcome"), { status: 400 });
  if (!user.interviewWins) user.interviewWins = [];
  user.interviewWins.push({ outcome, ts: Math.floor(Date.now() / 1000) });
  if (user.interviewWins.length > 50) user.interviewWins = user.interviewWins.slice(-50);
  await putUser(env, user);
  // Aggregate global counter (best-effort)
  if (outcome === "interview" || outcome === "offer") {
    const key = "stats:interview_wins";
    const cur = parseInt(await env.HIREFLOW_KV.get(key) || "0", 10);
    await env.HIREFLOW_KV.put(key, String(cur + 1));
    // Best possible moment to ask for a review: right after a real win.
    _sendWinReviewEmail(env, user.email).catch(() => {});
  }
  return { ok: true };
}

async function getInterviewWins(req, env) {
  const user = await authUser(req, env);
  const globalCount = parseInt(await env.HIREFLOW_KV.get("stats:interview_wins") || "0", 10);
  return {
    personal: user.interviewWins || [],
    globalCount,
  };
}

// Send a Trustpilot review invite after a positive win is logged.
// Fire-and-forget: called inside recordInterviewWin, errors are swallowed.
async function _sendWinReviewEmail(env, email) {
  if (!env.RESEND_API_KEY) return;
  // Only send once per user ever (this is a high-intent moment, not a repeat nudge).
  const key = `review_win_sent:${email}`;
  if (await env.HIREFLOW_KV.get(key)) return;
  await env.HIREFLOW_KV.put(key, "1");
  await sendReviewEmail(env, email, "win");
}

function _addPremiumDays(user, days) {
  const now = Math.floor(Date.now() / 1000);
  const base = (user.plan === "premium" || user.plan === "lifetime")
    ? Math.max(user.currentPeriodEnd || 0, now)
    : now;
  if (user.plan === "lifetime") return;
  user.plan = "premium";
  user.currentPeriodEnd = base + days * 86400;
}

// ============ Auth ============
async function signup(req, env) {
  const { email, password, category, consent, referralCode } = await req.json();
  if (!email || !password) throw err(400, "Email and password required");
  if (password.length < 8) throw err(400, "Password must be at least 8 characters");
  const cleanEmail = await _validateSignupEmail(email);   // blocks junk/disposable/unreachable
  const ALLOWED_CATEGORIES = ["student","internship","no-experience","software-engineer","finance","project-manager","nurse","teacher","career-changer","other"];
  if (!category || !ALLOWED_CATEGORIES.includes(category)) throw err(400, "Please select a category");
  if (await getUser(env, cleanEmail)) throw err(409, "Account already exists");
  await _assertIpMayCreateAccount(req, env);   // one account per IP (unless disabled)
  const { salt, hash } = await hashPassword(password);
  const user = { email: cleanEmail, salt, hash, category, createdAt: Date.now(), plan: "free", downloadsUsed: 0 };
  if (req.cf) user.geo = { country: req.cf.country||null, city: req.cf.city||null, region: req.cf.region||null, timezone: req.cf.timezone||null, continent: req.cf.continent||null };
  const gotPromo = await _grantEarlyBirdIfEligible(env, user);
  try { await _applyReferral(env, user, referralCode); } catch (_) {}
  await putUser(env, user);
  await _recordIpAccount(req, env, cleanEmail);
  try { await applySignupConsent(env, cleanEmail, consent); } catch (_) {}
  const token = await signToken({ email: cleanEmail, exp: Math.floor(Date.now()/1000)+86400*30 }, env.JWT_SECRET);
  return { token, email: cleanEmail, promoEarlyBird: gotPromo };
}
// Google Sign-In: the browser sends the Google ID token (JWT). We verify it with
// Google (signature + expiry), confirm it was issued for OUR client id, then
// find-or-create the user and mint the SAME session token the rest of the app uses,
// so an OAuth user is indistinguishable from an email/password user downstream.
async function googleAuth(req, env) {
  const { credential, referralCode } = await req.json();
  if (!credential) throw err(400, "Missing Google credential");
  const clientId = env.GOOGLE_CLIENT_ID;
  if (!clientId) throw err(500, "Google sign-in is not configured");
  const resp = await fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(credential));
  if (!resp.ok) throw err(401, "Google sign-in failed");
  const p = await resp.json();
  if (p.aud !== clientId) throw err(401, "Google sign-in failed");
  if (p.iss !== "accounts.google.com" && p.iss !== "https://accounts.google.com") throw err(401, "Google sign-in failed");
  if (p.email_verified !== "true" && p.email_verified !== true) throw err(401, "Google email not verified");
  const email = (p.email || "").toLowerCase();
  if (!email) throw err(401, "Google sign-in failed");
  let user = await getUser(env, email);
  let gotPromo = false;
  if (!user) {
    await _assertIpMayCreateAccount(req, env);   // one account per IP (unless disabled)
    user = { email, oauth: "google", name: p.name || "", createdAt: Date.now(), plan: "free", downloadsUsed: 0 };
    if (req.cf) user.geo = { country: req.cf.country||null, city: req.cf.city||null, region: req.cf.region||null, timezone: req.cf.timezone||null, continent: req.cf.continent||null };
    gotPromo = await _grantEarlyBirdIfEligible(env, user);
    try { await _applyReferral(env, user, referralCode); } catch (_) {}
    await putUser(env, user);
    await _recordIpAccount(req, env, email);
  }
  await touchActivity(env, user, req);
  const token = await signToken({ email, exp: Math.floor(Date.now()/1000) + 86400*30 }, env.JWT_SECRET);
  return { token, email, promoEarlyBird: gotPromo };
}
async function login(req, env) {
  const { email, password } = await req.json();
  if (!email || !password) throw err(400, "Email and password required");

  // SUPER admin: both email and password are secret env vars
  if (env.SUPERADMIN_EMAIL && env.SUPERADMIN_PASSWORD
      && email === env.SUPERADMIN_EMAIL
      && timingEqual(password, env.SUPERADMIN_PASSWORD)) {
    const token = await signToken({
      email: env.SUPERADMIN_EMAIL,
      role: "super",
      exp: Math.floor(Date.now()/1000) + 3600 * 24 * 7   // 7 days (super has no kill switch, keep tighter)
    }, env.JWT_SECRET);
    return { token, email: env.SUPERADMIN_EMAIL, role: "super" };
  }

  // Regular ADMIN: literal "ADMIN" username + secret password
  // Blocked if super-admin has disabled the ADMIN tier.
  if (email === "ADMIN" && env.ADMIN_PASSWORD
      && timingEqual(password, env.ADMIN_PASSWORD)) {
    const adminDisabled = await env.HIREFLOW_KV.get("system:admin_disabled");
    if (adminDisabled === "1") throw err(401, "Invalid email or password");
    const token = await signToken({
      email: "ADMIN",
      role: "admin",
      exp: Math.floor(Date.now()/1000) + 3600 * 24 * 30   // 30 days (revocable anytime via the ADMIN-tier kill switch)
    }, env.JWT_SECRET);
    return { token, email: "ADMIN", role: "admin" };
  }

  // Normal user lookup
  const user = await getUser(env, email);
  if (!user) throw err(401, "Invalid email or password");
  if (!await verifyPassword(password, user.salt, user.hash)) throw err(401, "Invalid email or password");
  await touchActivity(env, user, req);
  const token = await signToken({ email, exp: Math.floor(Date.now()/1000)+86400*30 }, env.JWT_SECRET);
  return { token, email };
}

// ============ Me ============
async function me(req, env) {
  const payload = await authenticate(req, env);

  // Admin tokens don't have a real user record
  if (payload.role === "admin" || payload.role === "super") {
    return {
      email: payload.email,
      plan: "premium",
      isPaid: true,
      role: payload.role,
      downloadsUsed: 0,
      downloadLimit: 999999,
      currentPeriodEnd: null,
      hasStripeCustomer: false,
    };
  }

  const user = await getUser(env, payload.email);
  if (!user) throw err(404, "User not found");
  await touchActivity(env, user, req);   // returning-session signal (this endpoint runs on every app load)
  const limit = parseInt(env.FREE_DOWNLOAD_LIMIT || "10", 10);
  return {
    email: user.email,
    plan: user.plan || "free",
    isPaid: isPaidPlan(user),
    role: null,
    downloadsUsed: user.downloadsUsed || 0,
    downloadLimit: limit,
    currentPeriodEnd: user.currentPeriodEnd || null,
    hasStripeCustomer: !!user.stripeCustomerId,
    aiTrials: user.aiTrials || {},
    freeAiTrials: FREE_AI_TRIALS,
    coverLettersUsed: user.coverLettersUsed || 0,
    referralCode: user.referralCode || null,
    referralCount: user.referralCount || 0,
    lastSeen: user.lastSeen || null,
  };
}

// ============ Premium demo magic-link (public, secret-keyed) ============
// A shareable link that logs a visitor into the pre-seeded demo account, which has
// plan = "lifetime" so every Premium/AI feature works (those are gated server-side).
// Gated by the exact demoKey stored on the demo user record, so only people with the
// link can enter. No password. To revoke: change/remove demoKey on user:demo@appliohq.com.
async function demoSession(req, env) {
  const body = await req.json().catch(() => ({}));
  const k = String(body.k || "").trim();
  const email = "demo@appliohq.com";
  const user = await getUser(env, email);
  if (!user || !user.demoKey) throw err(404, "Demo isn't set up.");
  if (!k || k !== user.demoKey) throw err(401, "This demo link isn't valid.");
  if (user.plan !== "lifetime") { user.plan = "lifetime"; await putUser(env, user); }
  const token = await signToken({ email, exp: Math.floor(Date.now() / 1000) + 86400 * 30 }, env.JWT_SECRET);
  return { token, email };
}

// ============ System status (public, no auth needed) ============
async function getStatus(req, env) {
  const now = Math.floor(Date.now()/1000);
  const aiUntil = parseInt(await env.HIREFLOW_KV.get("system:ai_disabled_until") || "0", 10);
  const maintUntil = parseInt(await env.HIREFLOW_KV.get("system:maintenance_until") || "0", 10);
  const adminDisabled = (await env.HIREFLOW_KV.get("system:admin_disabled")) === "1";
  return {
    aiDisabled: aiUntil > now,
    aiDisabledUntil: aiUntil > now ? aiUntil : null,
    maintenance: maintUntil > now,
    maintenanceUntil: maintUntil > now ? maintUntil : null,
    adminEnabled: !adminDisabled,
    now,
  };
}

// ============ Admin endpoints ============
async function requireAdmin(req, env, requireSuper = false) {
  const payload = await authenticate(req, env);
  if (requireSuper && payload.role !== "super") throw err(403, "Super admin only");
  if (payload.role !== "admin" && payload.role !== "super") throw err(403, "Admin only");
  return payload;
}

// Read every user record from KV. Lists all keys (paginated), then fetches the
// values in PARALLEL batches, one sequential get() per user does not scale (a few
// hundred users would exceed the Worker's wall-time budget and the admin request
// would hang). Batching keeps it fast and bounded. One corrupt record is skipped.
async function _readAllUserRecords(env) {
  const keys = [];
  let cursor;
  do {
    const page = await env.HIREFLOW_KV.list({ prefix: "user:", cursor });
    for (const k of page.keys) keys.push(k.name);
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  const users = [];
  const BATCH = 60;
  for (let i = 0; i < keys.length; i += BATCH) {
    const raws = await Promise.all(keys.slice(i, i + BATCH).map(name => env.HIREFLOW_KV.get(name)));
    for (const raw of raws) {
      if (!raw) continue;
      let u; try { u = JSON.parse(raw); } catch { continue; }
      users.push(u);
    }
  }
  return users;
}

async function adminListUsers(req, env) {
  await requireAdmin(req, env);
  const records = await _readAllUserRecords(env);
  const users = records.map(u => ({
    email: u.email,
    plan: u.plan || "free",
    createdAt: u.createdAt || null,
    currentPeriodEnd: u.currentPeriodEnd || null,
    downloadsUsed: u.downloadsUsed || 0,
    // Onboarding answers: "What best describes you?" (signup) and "Where did you hear
    // about us?" (post-signup prompt), so the admin can see who's signing up and how.
    category: u.category || null,
    attribution: u.attribution || null,
    hasStripeCustomer: !!u.stripeCustomerId,
    updatedAt: u.updatedAt || u.createdAt || null,
    aiFeatures: u.aiFeatures || {},
    aiTotal: u.aiFeatures ? Object.values(u.aiFeatures).reduce((a, b) => a + (Number(b) || 0), 0) : 0,
    aiLastFeature: u.aiLastFeature || null,
    aiLastAt: u.aiLastAt || null,
  }));
  users.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));   // newest first
  return { users, total: users.length };
}

// Aggregate user stats for the admin dashboard. Available to admin + super.
// Anonymous website traffic counter. No PII, no cookies, no auth. The front-end
// (js/theme.js) beacons this on every page load with two hint flags:
//   nv=1  -> this browser has never been seen before (unique visitor, all-time)
//   nd=1  -> first view from this browser today (unique visitor, today)
// KV has no atomic increment, so this is read-modify-write: fine for an approximate
// traffic metric at this scale (occasional same-second collisions may undercount).
async function trackPageview(req, env) {
  const u = new URL(req.url);
  const today = new Date().toISOString().slice(0, 10);
  const bump = async (key) => {
    const cur = parseInt(await env.HIREFLOW_KV.get(key) || "0", 10) || 0;
    await env.HIREFLOW_KV.put(key, String(cur + 1));
  };
  await bump("stats:pv:total");
  await bump(`stats:pv:${today}`);
  if (u.searchParams.get("nv") === "1") await bump("stats:uv:total");
  if (u.searchParams.get("nd") === "1") await bump(`stats:uv:${today}`);
  return { ok: true };
}

async function adminAnalytics(req, env) {
  await requireAdmin(req, env);
  const now = Date.now();
  const DAY = 86400000;

  const plans = { free: 0, premium: 0, lifetime: 0 };
  let total = 0, totalDownloads = 0;
  let signupsToday = 0, last7Signups = 0, last30Signups = 0, prev7Signups = 0;
  let activeSubs = 0, stripeLinked = 0, everDownloaded = 0, dormant = 0;
  let usedAi = 0, activated = 0;   // activation = has used AI or exported at least once
  // Retention / repeat usage (the metrics investors flagged as missing).
  let activeToday = 0, wau = 0, mau = 0, returning = 0, aiRepeat = 0, totalAiUses = 0;
  let activePremiumSubs = 0;   // recurring subs still in their paid period -> drives MRR
  let compedPremium = 0;       // early-bird comps: active Premium but NOT paying
  const todayStr = new Date(now).toISOString().slice(0, 10);
  // Monthly prices (mirror the pricing page). MRR counts recurring Premium only; Lifetime
  // is one-time revenue, reported separately so the two aren't conflated.
  const PREMIUM_MO = 9.99, LIFETIME_ONCE = 39.99;

  // Pre-seed the last 30 UTC days to 0 so the sparkline is continuous.
  const signupsByDay = {};
  for (let i = 29; i >= 0; i--) {
    signupsByDay[new Date(now - i * DAY).toISOString().slice(0, 10)] = 0;
  }

  // Read all user records in parallel batches (fast + bounded), then aggregate.
  const attribution = {};
  const geoCountry = {}, geoCity = {};
  const usersByFeature = {};   // distinct users who have used each AI feature at least once
  const records = await _readAllUserRecords(env);
  for (const u of records) {
    total++;
    if (u.attribution) attribution[u.attribution] = (attribution[u.attribution] || 0) + 1;
    if (u.geo && u.geo.country) {
      geoCountry[u.geo.country] = (geoCountry[u.geo.country] || 0) + 1;
      if (u.geo.city) {
        const key = u.geo.city + ", " + u.geo.country;
        geoCity[key] = (geoCity[key] || 0) + 1;
      }
    }
    if (u.aiFeatures) {
      for (const k in u.aiFeatures) {
        if ((Number(u.aiFeatures[k]) || 0) > 0) usersByFeature[k] = (usersByFeature[k] || 0) + 1;
      }
    }
    const plan = (u.plan === "premium" || u.plan === "lifetime") ? u.plan : "free";
    plans[plan]++;
    const dl = Number(u.downloadsUsed) || 0;
    totalDownloads += dl;
    if (dl > 0) everDownloaded++;
    if (u.aiUsed) usedAi++;
    if (u.aiUsed || dl > 0) activated++;
    if (u.stripeCustomerId) stripeLinked++;
    // Active paid: lifetime never expires; premium counts if its period end is in the future.
    const premiumActive = plan === "premium" && (Number(u.currentPeriodEnd) || 0) * 1000 > now;
    if (plan === "lifetime") activeSubs++;
    else if (premiumActive) {
      activeSubs++;
      // Early-bird comps are Premium but not paying, keep them OUT of MRR/paying counts
      // so revenue isn't overstated. Tally them separately.
      if (u.promoEarlyBird && !u.stripeCustomerId) compedPremium++;
      else activePremiumSubs++;
    }

    // ---- Retention / repeat usage ----
    // `lastSeen`/`days`/`activeDayCount` come from touchActivity on /me, login, and AI use.
    const lastSeen = Number(u.lastSeen) || 0;
    const days = Array.isArray(u.days) ? u.days : [];
    const seenInWindow = (w) => lastSeen && (now - lastSeen) <= w * DAY
      || days.some(d => { const t = Date.parse(d + "T00:00:00Z"); return t && (now - t) <= w * DAY; });
    if (days.includes(todayStr) || (lastSeen && new Date(lastSeen).toISOString().slice(0, 10) === todayStr)) activeToday++;
    if (seenInWindow(7)) wau++;
    if (seenInWindow(30)) mau++;
    // Returning = active on 2+ distinct days (came back at least once after signup day).
    if ((Number(u.activeDayCount) || 0) >= 2) returning++;
    const aiCount = Number(u.aiUseCount) || 0;
    totalAiUses += aiCount;
    if (aiCount >= 2) aiRepeat++;   // used AI more than once = repeat value, not one-and-done
    const created = Number(u.createdAt) || 0;
    if (created) {
      const age = now - created;
      if (new Date(created).toISOString().slice(0, 10) === todayStr) signupsToday++;
      if (age <= 7 * DAY)  last7Signups++;
      else if (age <= 14 * DAY) prev7Signups++;
      if (age <= 30 * DAY) last30Signups++;
      const day = new Date(created).toISOString().slice(0, 10);
      if (day in signupsByDay) signupsByDay[day]++;
    }
    // Dormant: joined more than 7 days ago and never downloaded anything.
    if (created && now - created > 7 * DAY && dl === 0) dormant++;
  }

  const paid = plans.premium + plans.lifetime;
  const conversionRate = total ? Math.round((paid / total) * 1000) / 10 : 0;
  const avgDownloads = total ? Math.round((totalDownloads / total) * 10) / 10 : 0;
  // Retention rates. returnRate = share of all users who came back on a 2nd day.
  const returnRate = total ? Math.round((returning / total) * 1000) / 10 : 0;
  const aiRepeatRate = usedAi ? Math.round((aiRepeat / usedAi) * 1000) / 10 : 0;
  const stickiness = mau ? Math.round((wau / mau) * 1000) / 10 : 0;   // WAU/MAU
  const avgAiPerUser = usedAi ? Math.round((totalAiUses / usedAi) * 10) / 10 : 0;
  // Revenue. MRR is recurring Premium only; Lifetime is one-time, reported separately.
  const mrr = Math.round(activePremiumSubs * PREMIUM_MO * 100) / 100;
  const lifetimeRevenue = Math.round(plans.lifetime * LIFETIME_ONCE * 100) / 100;
  const payingCustomers = Math.max(0, activeSubs - compedPremium);   // comps aren't paying
  // Activation = signed-up users who actually reached a value moment (used any AI
  // feature OR exported a resume). The number to watch to know onboarding is working.
  const activationRate = total ? Math.round((activated / total) * 1000) / 10 : 0;
  // Week-over-week signup momentum (last 7d vs the 7 days before that).
  const signupTrend = prev7Signups ? Math.round(((last7Signups - prev7Signups) / prev7Signups) * 100) : (last7Signups ? 100 : 0);

  // Anonymous website traffic (from the page-view beacon in js/theme.js).
  const num = async (key) => parseInt(await env.HIREFLOW_KV.get(key) || "0", 10) || 0;
  const pageViews = await num("stats:pv:total");
  const visitors = await num("stats:uv:total");
  const pageViewsToday = await num(`stats:pv:${todayStr}`);
  const visitorsToday = await num(`stats:uv:${todayStr}`);
  let pageViewsLast7 = 0;
  const pvByDay = {};
  for (let i = 6; i >= 0; i--) {
    const day = new Date(now - i * DAY).toISOString().slice(0, 10);
    const v = await num(`stats:pv:${day}`);
    pvByDay[day] = v; pageViewsLast7 += v;
  }

  // AI feature usage (real successful uses, from _bumpAiUsage on the /ai/ endpoints).
  const aiUses = await num("stats:ai:total");
  const aiToday = await num(`stats:ai:${todayStr}`);
  let aiLast7 = 0;
  for (let i = 6; i >= 0; i--) {
    aiLast7 += await num(`stats:ai:${new Date(now - i * DAY).toISOString().slice(0, 10)}`);
  }
  const AI_ACTIONS = ["tailor", "ats", "analyze", "improve", "cover-letter", "letter", "interview",
    "assistant", "autopilot", "skills", "skill-gap", "salary", "win", "parse"];
  const aiByAction = {};
  for (const a of AI_ACTIONS) {
    const v = await num(`stats:ai:action:${a}`);
    if (v) aiByAction[a] = v;
  }

  // Early-bird promo status for the admin panel.
  const eb = await _getEarlyBird(env);

  // Non-AI feature usage counters (from /track beacon).
  const FEATURE_NAMES = [
    "template_select", "download_pdf", "export_gdoc", "export_print",
    "job_tracker_open", "job_tracker_save", "cover_letter_open",
    "interview_prep_open", "salary_open", "skill_gap_open",
    "version_restore", "resume_import", "referral_open",
    "onboarding_complete",
  ];
  // Template variants tracked separately.
  const TEMPLATE_IDS = ["harvard", "stanford", "modern", "minimal", "deedy",
    "twocolumn", "healthcare", "sales", "ats", "classic", "creative", "tech"];
  const featureUsage = {};
  for (const f of FEATURE_NAMES) {
    const v = await num(`stats:feature:${f}`);
    if (v) featureUsage[f] = v;
  }
  const templatePicks = {};
  for (const t of TEMPLATE_IDS) {
    const v = await num(`stats:feature:template_select:${t}`);
    if (v) templatePicks[t] = v;
  }
  // 7-day feature activity for key actions.
  const featureLast7 = {};
  for (const f of ["download_pdf", "export_gdoc", "template_select", "cover_letter_open", "interview_prep_open"]) {
    let total7 = 0;
    for (let i = 6; i >= 0; i--) {
      const day = new Date(now - i * DAY).toISOString().slice(0, 10);
      total7 += await num(`stats:feature:${f}:${day}`);
    }
    if (total7) featureLast7[f] = total7;
  }
  // Per-user feature breadth: count users who have used each non-AI feature.
  const usersByNonAiFeature = {};
  for (const u of records) {
    if (!u.features) continue;
    for (const k in u.features) {
      if ((Number(u.features[k]) || 0) > 0) usersByNonAiFeature[k] = (usersByNonAiFeature[k] || 0) + 1;
    }
  }

  return {
    total, plans, conversionRate, totalDownloads, avgDownloads,
    signupsToday, last7Signups, last30Signups, prev7Signups, signupTrend,
    activeSubs, stripeLinked, everDownloaded, activationRate, dormant,
    usedAi, activated,
    // Retention / repeat usage
    activeToday, wau, mau, returning, returnRate, stickiness,
    aiRepeat, aiRepeatRate, avgAiPerUser, totalAiUses,
    // Revenue
    payingCustomers, activePremiumSubs, compedPremium, mrr, lifetimeRevenue,
    // Early-bird promo
    earlyBird: {
      enabled: !!eb.enabled, limit: eb.limit,
      claimed: Math.min(eb.granted || 0, eb.limit),
      remaining: Math.max(0, eb.limit - (eb.granted || 0)),
      endsAt: eb.endsAt, grantDays: eb.grantDays || 60,
      open: _earlyBirdOpen(eb, now),
    },
    signupsByDay, attribution, geoCountry, geoCity,
    pageViews, visitors, pageViewsToday, visitorsToday, pageViewsLast7, pvByDay,
    aiUses, aiToday, aiLast7, aiByAction, usersByFeature,
    featureUsage, templatePicks, featureLast7, usersByNonAiFeature,
  };
}

async function adminDeleteUser(req, env) {
  await requireAdmin(req, env);   // any admin (not super-only) can delete users
  const { email } = await req.json();
  if (!email) throw err(400, "Email required");
  const key = email.toLowerCase();
  await env.HIREFLOW_KV.delete(`user:${key}`);
  await env.HIREFLOW_KV.delete(`resume:${key}`);
  return { ok: true, email };
}

async function adminSetAIDisabled(req, env) {
  await requireAdmin(req, env, true);
  const { minutes } = await req.json();
  const m = parseInt(minutes, 10);
  if (m && m > 0) {
    const until = Math.floor(Date.now()/1000) + (m * 60);
    await env.HIREFLOW_KV.put("system:ai_disabled_until", String(until));
    return { ok: true, aiDisabledUntil: until };
  }
  await env.HIREFLOW_KV.delete("system:ai_disabled_until");
  return { ok: true, aiDisabledUntil: null };
}

async function adminSetMaintenance(req, env) {
  await requireAdmin(req, env, true);
  const { minutes } = await req.json();
  const m = parseInt(minutes, 10);
  if (m && m > 0) {
    const until = Math.floor(Date.now()/1000) + (m * 60);
    await env.HIREFLOW_KV.put("system:maintenance_until", String(until));
    return { ok: true, maintenanceUntil: until };
  }
  await env.HIREFLOW_KV.delete("system:maintenance_until");
  return { ok: true, maintenanceUntil: null };
}

async function adminSetAdminAccess(req, env) {
  await requireAdmin(req, env, true);
  const { enabled } = await req.json();
  if (enabled === false) {
    await env.HIREFLOW_KV.put("system:admin_disabled", "1");
  } else {
    await env.HIREFLOW_KV.delete("system:admin_disabled");
  }
  return { ok: true, adminEnabled: enabled !== false };
}

// ============ Resume ============
async function saveResume(req, env) {
  const payload = await authenticate(req, env);
  const { resume } = await req.json();
  await env.HIREFLOW_KV.put(`resume:${payload.email.toLowerCase()}`, JSON.stringify(resume));
  return { ok: true };
}
async function getResume(req, env) {
  const payload = await authenticate(req, env);
  const raw = await env.HIREFLOW_KV.get(`resume:${payload.email.toLowerCase()}`);
  return { resume: raw ? JSON.parse(raw) : null };
}

// ============ Career profile (dashboard: goals, target role, win journal) ============
// Small per-user document that makes the copilot "know you" across devices. Kept
// separate from the resume so the dashboard can sync it independently.
async function getProfile(req, env) {
  const payload = await authenticate(req, env);
  const raw = await env.HIREFLOW_KV.get(`profile:${payload.email.toLowerCase()}`);
  return { profile: raw ? JSON.parse(raw) : null };
}
async function saveProfile(req, env) {
  const payload = await authenticate(req, env);
  const body = await req.json().catch(() => ({}));
  const profile = body && typeof body.profile === "object" && body.profile ? body.profile : {};
  // Guard against runaway size (the win journal is capped client-side, but be safe).
  const str = JSON.stringify(profile);
  if (str.length > 60000) throw err(413, "Profile too large");
  await env.HIREFLOW_KV.put(`profile:${payload.email.toLowerCase()}`, str);
  return { ok: true };
}

// ============ Signup attribution ("where did you hear about us?") ============
// Stored on the user record so the admin analytics can aggregate the breakdown.
async function saveAttribution(req, env) {
  const payload = await authenticate(req, env);
  const body = await req.json().catch(() => ({}));
  const source = String(body.source || "").trim().slice(0, 40);
  if (!source) return { ok: false };
  const user = await getUser(env, payload.email).catch(() => null);
  if (user) { user.attribution = source; user.attributionAt = Date.now(); await putUser(env, user); }
  return { ok: true };
}

// ============ Onboarding answers ============
// The mandatory first-run questionnaire (job-search stage, biggest challenge, and how
// they heard about us). Stored under onboarding:<email> for product analytics. The
// client fires this and does not block on it, so keep it simple and forgiving.
async function saveOnboardingAnswers(req, env) {
  const payload = await authenticate(req, env);
  const body = await req.json().catch(() => ({}));
  const clean = (v) => String(v == null ? "" : v).slice(0, 80);
  const answers = (body && typeof body.answers === "object" && body.answers) ? body.answers : body;
  const record = {
    email: payload.email.toLowerCase(),
    stage: clean(answers.stage),
    challenge: clean(answers.challenge),
    heardFrom: clean(answers.heardFrom),
    ts: Date.now(),
  };
  await env.HIREFLOW_KV.put(`onboarding:${payload.email.toLowerCase()}`, JSON.stringify(record));
  return { ok: true };
}

// ============================================================================
// Email consent + testimonial permission
// ----------------------------------------------------------------------------
// FOUR distinct classes of email, kept separate on purpose:
//   1. ESSENTIAL (transactional): verification, password reset, security notices,
//      receipts, account-status, user-requested actions. Always operational, never
//      requires consent, and MUST NOT carry promotional content. Not a category
//      below (there is nothing to opt out of).
//   2. MARKETING: product updates, offers, newsletters, career tips, re-engagement.
//   3. RESEARCH: feedback/survey/user-interview/early-testing invitations.
//   4. TESTIMONIAL_CONTACT: permission to *contact* someone about sharing their
//      experience. This is ONLY permission to reach out, it is NOT permission to
//      publish anything (see the testimonial approval flow further down).
//
// Categories 2-4 are strictly OPT-IN (unchecked by default, never a condition of
// using the account). Every consent change is written to a fast current-state doc
// (consent:<email>) for enforcement AND appended to an immutable audit log
// (consentlog:<email>:<ts>:<category>) that is never overwritten.
// ============================================================================

// The exact wording shown to users, versioned. Store this verbatim with each
// consent event so we can always prove what a user agreed to and when. Bump
// CONSENT_VERSION whenever any wording changes (old records keep their old text).
const CONSENT_VERSION = "2026-08-01";
const CONSENT_COPY = {
  marketing:           "Send me Applio career tips, product updates, and offers by email.",
  research:            "Contact me about feedback, research, or early product testing.",
  testimonial_contact: "Contact me about sharing my Applio experience as a testimonial or case study.",
};
const CONSENT_CATEGORIES = ["marketing", "research", "testimonial_contact"];

// Record a single consent decision: update the current-state doc AND append an
// immutable audit-log entry. status=false records a withdrawal (with its timestamp).
async function _recordConsent(env, email, category, status, source) {
  email = String(email || "").toLowerCase();
  if (!email || !CONSENT_CATEGORIES.includes(category)) return;
  const now = Date.now();
  const wording = CONSENT_COPY[category];
  let doc;
  try { doc = JSON.parse(await env.HIREFLOW_KV.get(`consent:${email}`) || "null"); } catch { doc = null; }
  doc = doc || { email };
  const entry = { status: !!status, ts: now, version: CONSENT_VERSION, wording, source: String(source || "").slice(0, 40) };
  if (!status) entry.withdrawnAt = now;   // explicit withdrawal timestamp
  doc[category] = entry;
  doc.updatedAt = now;
  await env.HIREFLOW_KV.put(`consent:${email}`, JSON.stringify(doc));
  // Append-only audit trail, one row per decision, keyed by timestamp+category so
  // history is preserved rather than overwritten.
  await env.HIREFLOW_KV.put(
    `consentlog:${email}:${now}:${category}`,
    JSON.stringify({ email, category, status: !!status, ts: now, version: CONSENT_VERSION, wording, source: entry.source })
  );
}

// THE enforcement gate. Any non-essential email job MUST call this and skip users
// whose category status is not explicitly true. Absence of a record = no consent.
async function hasConsent(env, email, category) {
  try {
    const doc = JSON.parse(await env.HIREFLOW_KV.get(`consent:${String(email).toLowerCase()}`) || "null");
    return !!(doc && doc[category] && doc[category].status === true);
  } catch { return false; }
}

// Apply the three optional consents captured on the signup form. We record ALL three
// (true if the box was checked, false if shown-and-left-unchecked) so the signup-time
// choice is fully auditable. source = "signup".
async function applySignupConsent(env, email, consent) {
  if (!consent || typeof consent !== "object") consent = {};
  for (const cat of CONSENT_CATEGORIES) {
    await _recordConsent(env, email, cat, consent[cat] === true, "signup");
  }
}

// Public: the current wording + version, so the signup form renders the exact text
// we store (guarantees the displayed and recorded wording match).
async function getConsentConfig() {
  return { version: CONSENT_VERSION, copy: CONSENT_COPY, categories: CONSENT_CATEGORIES };
}

// Authenticated: read the current consent state for the preferences page.
async function getConsent(req, env) {
  const payload = await authenticate(req, env);
  const email = payload.email.toLowerCase();
  let doc = {};
  try { doc = JSON.parse(await env.HIREFLOW_KV.get(`consent:${email}`) || "{}") || {}; } catch { doc = {}; }
  const state = {};
  for (const c of CONSENT_CATEGORIES) state[c] = !!(doc[c] && doc[c].status);
  return {
    email,
    version: CONSENT_VERSION,
    copy: CONSENT_COPY,
    state,
    // Essential email is always on and cannot be disabled; surfaced for clarity only.
    essential: { alwaysOn: true, description: "Account-critical emails (verification, password reset, security, receipts). These are never promotional and cannot be turned off." },
  };
}

// Authenticated: update one or more categories from the preferences page. Each change
// is recorded + audit-logged. Unsubscribes take effect immediately.
async function setConsent(req, env) {
  const payload = await authenticate(req, env);
  const email = payload.email.toLowerCase();
  const body = await req.json().catch(() => ({}));
  const updates = (body && typeof body.updates === "object" && body.updates) ? body.updates : {};
  const source = String(body.source || "preferences").slice(0, 40);
  for (const cat of CONSENT_CATEGORIES) {
    if (cat in updates) await _recordConsent(env, email, cat, updates[cat] === true, source);
  }
  return await getConsent(req, env);
}

// ---- Category-aware one-click unsubscribe -----------------------------------
// Stable, unguessable per-(email,category) token derived from JWT_SECRET.
async function consentUnsubToken(env, email, category) {
  return (await hmacHex(env.JWT_SECRET || "x", `unsub:${category}:${String(email).toLowerCase()}`)).slice(0, 32);
}

// ---- Outreach rate-limiting / duplicate prevention --------------------------
// Before sending any outreach in a category, confirm we haven't recently emailed
// this person in it. Prevents repeated/duplicate outreach across job runs.
async function canSendOutreach(env, email, category) {
  return !(await env.HIREFLOW_KV.get(`outreach_last:${category}:${String(email).toLowerCase()}`));
}
async function markOutreachSent(env, email, category, minDays) {
  await env.HIREFLOW_KV.put(
    `outreach_last:${category}:${String(email).toLowerCase()}`,
    String(Date.now()),
    { expirationTtl: Math.max(3600, (minDays || 7) * 86400) }
  );
}

// Required footer for any NON-ESSENTIAL commercial email: sender identity, a valid
// postal address, and a working one-click unsubscribe for THIS category. Transactional
// emails must never include this (they carry no promotional content and no unsub).
async function commercialEmailFooter(env, email, category) {
  const addr = env.MAILING_ADDRESS || "Applio";
  const base = env.API_BASE_URL || "https://hireflow-api.pritamavuthu7.workers.dev";
  const unsub = `${base}/unsubscribe?e=${encodeURIComponent(email)}&t=${await consentUnsubToken(env, email, category)}&c=${category}`;
  return `<hr style="border:0;border-top:1px solid #e9ebf1;margin:30px 0 14px;">
    <p style="color:#9aa0ad;font-size:12px;line-height:1.6;margin:0;">
      You're receiving this because you opted in to ${category.replace("_", " ")} emails from Applio.
      <a href="${unsub}" style="color:#9aa0ad;">Unsubscribe</a>, takes effect immediately.<br>${addr}
    </p>`;
}

// ============================================================================
// Testimonial / case-study PUBLICATION approval
// ----------------------------------------------------------------------------
// CRITICAL RULE: a user's quote, name, title, company, photo, or outcome claim is
// NEVER publishable based on an email reply, marketing consent, or "testimonial_contact"
// permission. Those only allow us to ASK. Publication requires an explicit, itemized
// approval recorded here, naming exactly what may be published and on which channels.
// canPublishTestimonial() is the single gate; nothing should publish without it.
// ============================================================================
const TESTIMONIAL_CHANNELS = ["website", "social", "sales", "ads"];

async function getTestimonial(req, env) {
  const payload = await authenticate(req, env);
  const email = payload.email.toLowerCase();
  let doc = null;
  try { doc = JSON.parse(await env.HIREFLOW_KV.get(`testimonial:${email}`) || "null"); } catch { doc = null; }
  return { email, testimonial: doc || { status: "none" }, channels: TESTIMONIAL_CHANNELS };
}

// User submits their testimonial approval decision. Actions:
//   approve  -> explicit permission to publish the itemized content on named channels
//   revise   -> save changes but keep it unpublished/pending
//   decline  -> user declines to provide a testimonial
//   withdraw -> user pulls a previously given (as-yet-unpublished) approval
// Every state change is appended to an immutable log (testimoniallog:<email>:<ts>).
async function setTestimonial(req, env) {
  const payload = await authenticate(req, env);
  const email = payload.email.toLowerCase();
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "").toLowerCase();
  const now = Date.now();
  let doc = null;
  try { doc = JSON.parse(await env.HIREFLOW_KV.get(`testimonial:${email}`) || "null"); } catch { doc = null; }
  doc = doc || { email, status: "none" };

  if (action === "decline") {
    doc.status = "declined"; doc.updatedAt = now;
  } else if (action === "withdraw") {
    // A user can withdraw approval for anything not yet published.
    doc.status = "withdrawn"; doc.withdrawnAt = now; doc.updatedAt = now;
  } else if (action === "approve" || action === "revise") {
    const clean = (s, n) => String(s == null ? "" : s).slice(0, n);
    doc.quote = clean(body.quote, 1000);
    doc.attribution = (body.attribution === "anonymous") ? "anonymous" : "name";
    doc.name = doc.attribution === "anonymous" ? "" : clean(body.name, 120);
    doc.title = clean(body.title, 120);
    doc.company = clean(body.company, 120);
    doc.photoConsent = body.photoConsent === true;
    doc.outcomeClaim = clean(body.outcomeClaim, 300);   // e.g. "Landed a role at X", only publishable if approved here
    doc.channels = Array.isArray(body.channels) ? body.channels.filter(c => TESTIMONIAL_CHANNELS.includes(c)) : [];
    if (action === "approve") {
      // Explicit publication permission requires an actual quote and at least one channel.
      if (!doc.quote.trim()) throw err(400, "Add the quote you're approving before publishing.");
      if (!doc.channels.length) throw err(400, "Pick at least one channel you're approving.");
      doc.status = "approved";
      doc.approvedAt = now;
      doc.version = CONSENT_VERSION;
    } else {
      doc.status = "submitted";   // saved but NOT approved for publication
    }
    doc.updatedAt = now;
  } else {
    throw err(400, "Unknown testimonial action.");
  }

  await env.HIREFLOW_KV.put(`testimonial:${email}`, JSON.stringify(doc));
  // Immutable record of exactly what was approved/changed and when.
  await env.HIREFLOW_KV.put(`testimoniallog:${email}:${now}`, JSON.stringify({ ...doc, loggedAt: now }));
  return { ok: true, testimonial: doc };
}

// THE publication gate. Returns true ONLY when there is an explicit, current approval
// with a real quote and named channels. Any code that would surface a testimonial
// publicly must pass through this. Never publish on any other signal.
function canPublishTestimonial(doc, channel) {
  if (!doc || doc.status !== "approved") return false;
  if (!doc.quote || !String(doc.quote).trim()) return false;
  if (!Array.isArray(doc.channels) || !doc.channels.length) return false;
  if (channel && !doc.channels.includes(channel)) return false;
  return true;
}

// Admin: list testimonials that are actually approved for publication, so the team can
// publish them MANUALLY on the approved channels. There is no auto-publish anywhere.
async function adminListTestimonials(req, env) {
  await requireAdmin(req, env);
  const out = [];
  let cursor;
  do {
    const list = await env.HIREFLOW_KV.list({ prefix: "testimonial:", cursor, limit: 1000 });
    cursor = list.list_complete ? null : list.cursor;
    for (const k of list.keys) {
      try {
        const doc = JSON.parse(await env.HIREFLOW_KV.get(k.name) || "null");
        if (doc) out.push({ ...doc, publishable: canPublishTestimonial(doc) });
      } catch { /* skip */ }
    }
  } while (cursor);
  out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return { testimonials: out };
}

// ============ Job tracker (cross-device sync of the application pipeline) ============
// Stored as { jobs:[...], updatedAt } so the client can do last-write-wins.
async function getJobs(req, env) {
  const payload = await authenticate(req, env);
  const raw = await env.HIREFLOW_KV.get(`jobs:${payload.email.toLowerCase()}`);
  return raw ? JSON.parse(raw) : { jobs: null, updatedAt: 0 };
}
async function saveJobs(req, env) {
  const payload = await authenticate(req, env);
  const body = await req.json().catch(() => ({}));
  const jobs = Array.isArray(body.jobs) ? body.jobs : [];
  const doc = { jobs, updatedAt: body.updatedAt || Date.now() };
  const str = JSON.stringify(doc);
  if (str.length > 200000) throw err(413, "Too many jobs to sync");
  await env.HIREFLOW_KV.put(`jobs:${payload.email.toLowerCase()}`, str);
  return { ok: true };
}

// ============ Downloads ============
async function incrementDownload(req, env) {
  const payload = await authenticate(req, env);
  const user = await getUser(env, payload.email);
  if (!user) throw err(404, "User not found");
  const limit = parseInt(env.FREE_DOWNLOAD_LIMIT || "10", 10);
  const paid = isPaidPlan(user);
  const used = user.downloadsUsed || 0;
  if (!paid && used >= limit) {
    return { ok: false, downloadsUsed: used, allowed: false, message: "Download limit reached" };
  }
  user.downloadsUsed = used + 1;
  if (!user.firstDownloadAt) user.firstDownloadAt = Date.now();
  await putUser(env, user);
  return { ok: true, downloadsUsed: user.downloadsUsed, allowed: true };
}

// ============ Stripe ============
async function stripeCall(env, method, path, body) {
  const opts = {
    method,
    headers: {
      "Authorization": `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
  };
  if (body) opts.body = formEncode(body);
  const r = await fetch(`https://api.stripe.com${path}`, opts);
  const data = await r.json();
  if (!r.ok) throw err(r.status, data.error?.message || "Stripe error");
  return data;
}
function formEncode(obj, prefix) {
  const parts = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v == null) continue;
    if (typeof v === "object") parts.push(formEncode(v, key));
    else parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
  }
  return parts.join("&");
}

async function createCheckout(req, env) {
  const payload = await authenticate(req, env);
  const { plan } = await req.json();
  if (plan !== "premium" && plan !== "lifetime") throw err(400, "Invalid plan");
  const user = await getUser(env, payload.email);
  if (!user) throw err(404, "User not found");

  const isLifetime = plan === "lifetime";
  const priceId = isLifetime ? env.LIFETIME_PRICE_ID : env.PREMIUM_PRICE_ID;
  const site = env.SITE_URL || "https://appliohq.com";

  const params = {
    "mode": isLifetime ? "payment" : "subscription",
    "success_url": `${site}/success?plan=${plan}&session_id={CHECKOUT_SESSION_ID}`,
    "cancel_url": `${site}/pricing`,
    "client_reference_id": user.email,
    "metadata[email]": user.email,
    "metadata[plan]": plan,
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": 1,
  };
  if (user.stripeCustomerId) params["customer"] = user.stripeCustomerId;
  else params["customer_email"] = user.email;

  const session = await stripeCall(env, "POST", "/v1/checkout/sessions", params);
  return { url: session.url };
}

// Reconcile this user's account with Stripe (for cases where the webhook
// didn't fire or failed signature verification). Looks up the Stripe customer
// by email and pulls plan info from there.
async function syncWithStripe(req, env) {
  const payload = await authenticate(req, env);
  const user = await getUser(env, payload.email);
  if (!user) throw err(404, "User not found");

  // 1) Find the Stripe customer with matching email
  const search = await stripeCall(env, "GET",
    `/v1/customers?email=${encodeURIComponent(user.email)}&limit=1`);
  if (!search.data || !search.data.length) {
    return { ok: false, message: "No Stripe customer found for " + user.email + ". If you paid, make sure the same email was used at checkout." };
  }
  const customer = search.data[0];
  user.stripeCustomerId = customer.id;
  await env.HIREFLOW_KV.put(`stripeCustomer:${customer.id}`, user.email);

  // 2) Look for an active subscription (Premium)
  const subs = await stripeCall(env, "GET",
    `/v1/subscriptions?customer=${customer.id}&status=active&limit=1`);
  if (subs.data && subs.data.length) {
    const sub = subs.data[0];
    user.plan = "premium";
    user.stripeSubscriptionId = sub.id;
    user.currentPeriodEnd = sub.current_period_end;
    user.updatedAt = Date.now();
    await putUser(env, user);
    return {
      ok: true,
      linked: true,
      plan: "premium",
      hasStripeCustomer: true,
      currentPeriodEnd: sub.current_period_end,
      message: "Synced, Premium subscription active",
    };
  }

  // 3) Look for completed one-time checkout sessions (Lifetime)
  const sessions = await stripeCall(env, "GET",
    `/v1/checkout/sessions?customer=${customer.id}&limit=20`);
  const lifetimeSession = (sessions.data || []).find(
    s => s.payment_status === "paid" && s.mode === "payment"
  );
  if (lifetimeSession) {
    user.plan = "lifetime";
    user.currentPeriodEnd = null;
    user.updatedAt = Date.now();
    await putUser(env, user);
    return { ok: true, linked: true, plan: "lifetime", hasStripeCustomer: true, message: "Synced, Lifetime access active" };
  }

  // 4) Customer exists but no active subscription or paid one-time
  user.updatedAt = Date.now();
  await putUser(env, user);
  return {
    ok: true,
    linked: true,
    plan: user.plan || "free",
    hasStripeCustomer: true,
    message: "Customer linked, but no active subscription found. If you just paid, wait ~30 seconds and try again.",
  };
}

async function createPortal(req, env) {
  const payload = await authenticate(req, env);
  const user = await getUser(env, payload.email);
  if (!user || !user.stripeCustomerId) throw err(400, "No billing customer found");
  const site = env.SITE_URL || "https://appliohq.com";
  const session = await stripeCall(env, "POST", "/v1/billing_portal/sessions", {
    "customer": user.stripeCustomerId,
    "return_url": `${site}/editor`,
  });
  return { url: session.url };
}

// ============ Stripe Webhook ============
async function handleWebhook(req, env) {
  const sig = req.headers.get("Stripe-Signature");
  const body = await req.text();
  if (!sig) throw err(400, "Missing signature");
  if (!await verifyStripeSig(body, sig, env.STRIPE_WEBHOOK_KEY)) throw err(400, "Invalid signature");

  const event = JSON.parse(body);
  const obj = event.data.object;

  switch (event.type) {
    case "checkout.session.completed": {
      const email = obj.client_reference_id || obj.metadata?.email || obj.customer_email;
      const plan = obj.metadata?.plan || (obj.mode === "subscription" ? "premium" : "lifetime");
      if (!email) break;
      const user = await getUser(env, email);
      if (!user) break;
      user.plan = plan;
      user.stripeCustomerId = obj.customer;
      if (plan === "premium" && obj.subscription) {
        user.stripeSubscriptionId = obj.subscription;
        // Fetch subscription to get period end
        try {
          const sub = await stripeCall(env, "GET", `/v1/subscriptions/${obj.subscription}`);
          user.currentPeriodEnd = sub.current_period_end;
        } catch {}
      } else if (plan === "lifetime") {
        user.currentPeriodEnd = null;
      }
      user.updatedAt = Date.now();
      await putUser(env, user);
      break;
    }
    case "customer.subscription.updated":
    case "customer.subscription.created": {
      const email = await emailFromCustomerId(env, obj.customer);
      if (!email) break;
      const user = await getUser(env, email);
      if (!user) break;
      user.currentPeriodEnd = obj.current_period_end;
      user.stripeSubscriptionId = obj.id;
      if (obj.status === "active" || obj.status === "trialing") user.plan = "premium";
      await putUser(env, user);
      break;
    }
    case "customer.subscription.deleted": {
      const email = await emailFromCustomerId(env, obj.customer);
      if (!email) break;
      const user = await getUser(env, email);
      if (!user) break;
      // Only downgrade if currently premium (lifetime stays)
      if (user.plan === "premium") {
        user.plan = "free";
        user.currentPeriodEnd = null;
      }
      await putUser(env, user);
      break;
    }
  }
  return json({ received: true });
}

async function emailFromCustomerId(env, customerId) {
  if (!customerId) return null;
  // Check our reverse-index in KV (set on checkout)
  const idx = await env.HIREFLOW_KV.get(`stripeCustomer:${customerId}`);
  if (idx) return idx;
  // Fallback: ask Stripe for the customer's email
  try {
    const cust = await stripeCall(env, "GET", `/v1/customers/${customerId}`);
    if (cust.email) {
      await env.HIREFLOW_KV.put(`stripeCustomer:${customerId}`, cust.email);
      return cust.email;
    }
  } catch {}
  return null;
}

async function verifyStripeSig(body, sigHeader, secret) {
  // Stripe-Signature: t=TIMESTAMP,v1=SIG,v1=SIG,...
  const parts = sigHeader.split(",").reduce((m, p) => {
    const [k, v] = p.split("=");
    if (!m[k]) m[k] = [];
    m[k].push(v);
    return m;
  }, {});
  const t = parts.t?.[0];
  const sigs = parts.v1 || [];
  if (!t || !sigs.length) return false;
  // Reject events outside Stripe's recommended 5-minute tolerance so a captured,
  // validly-signed request body can't be replayed later. Stripe re-signs each
  // delivery attempt with a fresh timestamp, so legitimate retries are unaffected.
  const ts = Number(t);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;
  const expected = await hmacHex(secret, `${t}.${body}`);
  for (const s of sigs) if (timingEqual(s, expected)) return true;
  return false;
}

// ============ AI (gated by plan + global kill switch) ============
async function ai(req, env, action) {
  const payload = await authenticate(req, env);

  // Admin/super bypass plan and global-disable checks
  const isAdmin = payload.role === "admin" || payload.role === "super";

  // Global AI kill switch, return a generic error so users don't learn it was disabled on purpose.
  if (!isAdmin) {
    const aiUntil = parseInt(await env.HIREFLOW_KV.get("system:ai_disabled_until") || "0", 10);
    if (aiUntil > Math.floor(Date.now()/1000)) {
      throw err(503, "Service temporarily unavailable. Please try again later.");
    }
  }

  // Read the request body once (req.json() can only be consumed a single time).
  const body = await req.json();

  // Admin tokens have no user record, let them through
  if (isAdmin) {
    return await aiDispatch(env, action, body);
  }

  const user = await getUser(env, payload.email);
  if (!user) throw err(404, "User not found");
  const paid = isPaidPlan(user);

  // Free for everyone (matches the pricing page + in-app copy): resume import
  // (parse), interview prep, and "AI Improve" on the summary. Every other PRO_AI
  // action requires Premium.
  const freeForAll = action === "parse" || action === "interview" ||
    (action === "improve" && (body.target === "summary" || body.target === "personal"));
  // One-time free "instant score": the ATS score the editor auto-runs right after a resume
  // is built or imported, so EVERY user reaches a real AI value moment without spending a
  // trial. Free exactly once per account (guarded by user.autoScoreUsed); after that, ATS
  // follows normal gating. It still counts as activation + a real AI use in the metrics.
  const isFirstScore = action === "ats" && body && body.auto === true && !user.autoScoreUsed;
  // PRO features: free users get a few free tries (mirrors the client). Only block
  // once they're out. The trial is consumed on SUCCESS (below), never on an error.
  let trialFeature = null, trialLimit = 0;
  if (PRO_AI.has(action) && !paid && !freeForAll && !isFirstScore) {
    trialLimit = (FREE_TRIAL_LIMITS[action] != null) ? FREE_TRIAL_LIMITS[action] : FREE_AI_TRIALS;
    const trialUsed = (user.aiTrials && user.aiTrials[action]) || 0;
    if (trialUsed >= trialLimit) {
      throw err(402, trialLimit > 0
        ? "You've used your free tries of this feature. Upgrade to Premium for unlimited AI."
        : "Upgrade to Premium to use this AI feature.");
    }
    trialFeature = action;
  }
  // On a SUCCESSFUL AI call: mark the account as activated (first-ever AI use, for the
  // activation metric) and consume a free trial if this was a trial feature. Reports the
  // new trial count so the client can update its "N free tries left" UI. One KV write,
  // and only when something actually changed.
  const finishAiCall = async (result) => {
    _recordUserFeature(user, action);
    if (isFirstScore) user.autoScoreUsed = true;   // one-time free score consumed
    let _trial = null;
    if (trialFeature) {
      user.aiTrials = user.aiTrials || {};
      user.aiTrials[trialFeature] = (user.aiTrials[trialFeature] || 0) + 1;
      _trial = { feature: trialFeature, used: user.aiTrials[trialFeature], limit: trialLimit, remaining: Math.max(0, trialLimit - user.aiTrials[trialFeature]) };
    }
    await putUser(env, user);
    return _trial ? { ...result, _trial } : result;
  };

  // Per-account daily AI cap: soft cost/abuse guard. Count is per UTC day, expires
  // after 2 days, and is checked/incremented per request. Failures are fail-open
  // (a KV hiccup never blocks a legit call). Real users never approach these caps.
  const rlDay = new Date().toISOString().slice(0, 10);
  const rlKey = `airate:${(payload.email || "").toLowerCase()}:${rlDay}`;
  const rlUsed = parseInt(await env.HIREFLOW_KV.get(rlKey).catch(() => "0") || "0", 10);
  const rlCap = paid ? PAID_AI_DAILY : FREE_AI_DAILY;
  if (rlUsed >= rlCap) {
    throw err(429, paid
      ? "You've reached today's AI usage limit. It resets at midnight UTC, sorry for the interruption."
      : "You've reached today's free AI limit. Upgrade to Premium for a much higher limit, or come back tomorrow.");
  }
  const bumpRate = () => env.HIREFLOW_KV
    .put(rlKey, String(rlUsed + 1), { expirationTtl: 172800 }).catch(() => {});

  // Cover Letter Maker: free users get a couple of letters as a taste, then must
  // upgrade. Counted only on a SUCCESSFUL generation. Paid users are unlimited.
  if (action === "cover-letter" && !paid) {
    const used = user.coverLettersUsed || 0;
    if (used >= FREE_COVER_LETTERS) {
      throw err(402, "You've used your free cover letters. Upgrade to Premium for unlimited cover letters.");
    }
    await bumpRate();
    const result = await aiDispatch(env, action, body);
    await _bumpAiUsage(env, action);
    user.coverLettersUsed = used + 1;
    _recordUserFeature(user, action);
    await putUser(env, user);
    return { ...result, freeRemaining: Math.max(0, FREE_COVER_LETTERS - user.coverLettersUsed) };
  }

  await bumpRate();
  const result = await aiDispatch(env, action, body);
  await _bumpAiUsage(env, action);
  return await finishAiCall(result);
}

// Count real, successful AI feature uses (per-action + total + per-day) so the admin
// can see how much the AI is actually used. Admin/test calls aren't counted (they
// return before reaching here). Fail-open: a KV hiccup never breaks the AI response.
// Record per-USER AI feature usage on the user record so the admin can see WHO uses
// WHICH feature (site-wide totals live in _bumpAiUsage). Mutates the user; the caller
// is responsible for the putUser write.
function _recordUserFeature(user, action) {
  user.aiUsed = true;
  user.aiFeatures = user.aiFeatures || {};
  user.aiFeatures[action] = (user.aiFeatures[action] || 0) + 1;
  user.aiLastFeature = action;
  user.aiLastAt = Date.now();
  user.aiUseCount = (Number(user.aiUseCount) || 0) + 1;   // total AI actions ever (repeat-usage signal)
  _touchActivity(user);   // AI use is real activity; caller already persists the user
}

async function _bumpAiUsage(env, action) {
  try {
    const bump = async (key) => {
      const cur = parseInt(await env.HIREFLOW_KV.get(key) || "0", 10) || 0;
      await env.HIREFLOW_KV.put(key, String(cur + 1));
    };
    await bump("stats:ai:total");
    await bump(`stats:ai:action:${action}`);
    await bump(`stats:ai:${new Date().toISOString().slice(0, 10)}`);
  } catch (_) {}
}

// Increment a named feature counter. Writes three keys: all-time total,
// today's total, and per-user (if email provided) — so the admin can see
// both site-wide volume and per-user breadth for every tracked action.
async function _bumpFeature(env, name, email) {
  try {
    const day = new Date().toISOString().slice(0, 10);
    const bump = async (key) => {
      const cur = parseInt(await env.HIREFLOW_KV.get(key) || "0", 10) || 0;
      await env.HIREFLOW_KV.put(key, String(cur + 1));
    };
    await bump(`stats:feature:${name}`);
    await bump(`stats:feature:${name}:${day}`);
    if (email) {
      // Per-user feature breadth: track which non-AI features each user has touched.
      const raw = await env.HIREFLOW_KV.get(`user:${email.toLowerCase()}`);
      if (raw) {
        const u = JSON.parse(raw);
        u.features = u.features || {};
        u.features[name] = (u.features[name] || 0) + 1;
        await env.HIREFLOW_KV.put(`user:${email.toLowerCase()}`, JSON.stringify(u));
      }
    }
  } catch (_) {}
}

// POST /track — lightweight feature-use beacon from the frontend.
// Authenticated (needs a valid session token) so we can tie events to a user
// and prevent spoofing. Fire-and-forget on the client: client never awaits the result.
const TRACK_ALLOWLIST = new Set([
  // Editor actions
  "template_select", "section_visit", "version_restore", "version_save",
  // Export
  "download_pdf", "export_gdoc", "export_print",
  // Tools
  "job_tracker_open", "job_tracker_save", "cover_letter_open",
  "interview_prep_open", "salary_open", "skill_gap_open",
  "referral_open", "feedback_open",
  // Onboarding
  "onboarding_complete", "resume_import",
]);
async function trackFeature(req, env) {
  let payload;
  try { payload = await authenticate(req, env); } catch { return { ok: false }; }
  const body = await req.json().catch(() => ({}));
  const name = String(body.name || "").toLowerCase().replace(/[^a-z0-9_]/g, "");
  const meta = body.meta || {};   // e.g. { template: "harvard" } for template_select
  if (!name || !TRACK_ALLOWLIST.has(name)) return { ok: false, reason: "unknown event" };

  // For events that carry a variant (template name, section name), track the variant
  // as its own counter so we can see e.g. template_select:harvard vs template_select:twocolumn.
  const variant = meta.variant ? String(meta.variant).toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40) : null;
  const email = payload.email || null;

  const tasks = [_bumpFeature(env, name, email)];
  if (variant) tasks.push(_bumpFeature(env, `${name}:${variant}`, null));
  await Promise.all(tasks);
  return { ok: true };
}

// ============ Feedback ============
// Stored as feedback:<ts>:<email> so the admin inbox can list newest-first.
async function saveFeedback(req, env) {
  const payload = await authenticate(req, env);
  const body = await req.json().catch(() => ({}));
  const user = await getUser(env, payload.email).catch(() => null);
  const ts = Date.now();
  const email = (payload.email || "unknown").toLowerCase();
  const record = {
    ts,
    email,
    plan: (user && user.plan) || "free",
    rating: body.rating === "up" || body.rating === "down" ? body.rating : "none",
    message: String(body.message || "").slice(0, 4000),
    context: String(body.context || "").slice(0, 200),
    page: String(body.page || "").slice(0, 200),
  };
  await env.HIREFLOW_KV.put(`feedback:${ts}:${email}`, JSON.stringify(record));
  return { ok: true };
}

async function listFeedback(req, env) {
  await requireAdmin(req, env);
  const list = await env.HIREFLOW_KV.list({ prefix: "feedback:", limit: 1000 });
  const feedback = [];
  for (const k of list.keys) {
    const raw = await env.HIREFLOW_KV.get(k.name);
    if (!raw) continue;
    try { feedback.push(JSON.parse(raw)); } catch {}
  }
  feedback.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  return { feedback };
}

// ============ Weekly "log your win" email nudge (cron-driven) ============
// Retention loop: if someone who has used the Win Journal hasn't logged a win in a
// week, send ONE gentle prompt. Fully inert until env.RESEND_API_KEY is set.
// Respects unsubscribes and never emails the same person more than ~weekly.
const WIN_NUDGE_MAX_SENDS = 200;   // per run, bounds cost + protects sender reputation
const WIN_NUDGE_SCAN_CAP = 3000;   // profiles scanned per run

// Short, stable, unguessable per-email unsubscribe token derived from JWT_SECRET.
async function winUnsubToken(env, email) {
  return (await hmacHex(env.JWT_SECRET || "x", "winunsub:" + email.toLowerCase())).slice(0, 32);
}

function unsubPage(title, msg) {
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<title>${title}</title>`
    + `<div style="font:16px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:12vh auto;padding:0 24px;color:#111;text-align:center;">`
    + `<div style="font-weight:800;font-size:20px;margin-bottom:8px;">${title}</div>`
    + `<p style="color:#555;">${msg}</p>`
    + `<p style="margin-top:24px;"><a href="https://appliohq.com/dashboard" style="color:#4f46e5;font-weight:600;">Back to Applio &rarr;</a></p></div>`,
    { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

async function handleUnsubscribe(url, env) {
  const email = (url.searchParams.get("e") || "").toLowerCase().trim();
  const token = url.searchParams.get("t") || "";
  const category = (url.searchParams.get("c") || "").trim();
  if (!email || !token) return unsubPage("Invalid link", "This unsubscribe link is missing information.");

  // Category-aware unsubscribe (marketing / research / testimonial_contact). Takes effect
  // immediately: records a withdrawal in the consent system. Never touches essential email.
  if (CONSENT_CATEGORIES.includes(category)) {
    const good = await consentUnsubToken(env, email, category);
    if (token.length !== good.length || token !== good) return unsubPage("Invalid link", "This unsubscribe link isn't valid. If you keep getting emails, just reply and we'll remove you.");
    await _recordConsent(env, email, category, false, "unsubscribe-link");
    return unsubPage("You're unsubscribed", "You won't get " + category.replace("_", " ") + " emails anymore. This took effect immediately, and it doesn't affect essential account emails. You can change your choices anytime on your email preferences page.");
  }

  // Legacy path: the weekly Win-Journal reminder link (no category param).
  const good = await winUnsubToken(env, email);
  if (token.length !== good.length || token !== good) return unsubPage("Invalid link", "This unsubscribe link isn't valid. If you keep getting emails, just reply and we'll remove you.");
  await env.HIREFLOW_KV.put(`winmail_off:${email}`, "1");
  // Also clear the in-app opt-in so the dashboard toggle reflects the unsubscribe.
  try {
    const raw = await env.HIREFLOW_KV.get(`profile:${email}`);
    if (raw) { const p = JSON.parse(raw); if (p && p.emailWeeklyWin) { p.emailWeeklyWin = false; await env.HIREFLOW_KV.put(`profile:${email}`, JSON.stringify(p)); } }
  } catch { /* non-critical */ }
  return unsubPage("You're unsubscribed", "You won't get the weekly win reminder anymore. You can still turn them back on from your dashboard.");
}

// Admin-only: fire one nudge email on demand to confirm delivery works, without
// waiting for the weekly cron. Bypasses all eligibility rules (it's a raw send test).
async function adminTestWinNudge(req, env) {
  await requireAdmin(req, env);
  const body = await req.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) throw err(400, "Provide a valid email address");
  if (!env.RESEND_API_KEY) return { ok: false, error: "RESEND_API_KEY is not set on the worker." };
  const res = await sendWinNudgeEmail(env, email, 3);
  return res.ok
    ? { ok: true, email, from: env.MAIL_FROM || "Applio <noreply@appliohq.com>" }
    : { ok: false, error: "Resend rejected it: " + (res.error || ("HTTP " + res.status)) + " (from: " + (env.MAIL_FROM || "Applio <noreply@appliohq.com>") + ")" };
}

async function runWeeklyWinNudge(env) {
  if (!env.RESEND_API_KEY) return { ok: false, reason: "email not configured" };
  const now = Date.now();
  const WEEK = 7 * 86400000;
  let cursor, scanned = 0, sent = 0;
  do {
    const list = await env.HIREFLOW_KV.list({ prefix: "profile:", cursor, limit: 1000 });
    cursor = list.list_complete ? null : list.cursor;
    for (const k of list.keys) {
      if (scanned >= WIN_NUDGE_SCAN_CAP || sent >= WIN_NUDGE_MAX_SENDS) { cursor = null; break; }
      scanned++;
      const email = k.name.slice("profile:".length);
      if (!email || !email.includes("@")) continue;
      if (await env.HIREFLOW_KV.get(`winmail_off:${email}`)) continue;   // hard opt-out (win-nudge unsubscribe link)
      // Consent-system enforcement: the win reminder is a re-engagement (marketing-class)
      // email, so an explicit marketing opt-out suppresses it globally. The per-email
      // emailWeeklyWin opt-in below is the specific consent; this is the category gate.
      try {
        const cdoc = JSON.parse(await env.HIREFLOW_KV.get(`consent:${email}`) || "null");
        if (cdoc && cdoc.marketing && cdoc.marketing.status === false) continue;
      } catch { /* fail open on parse error */ }
      if (await env.HIREFLOW_KV.get(`winmail_last:${email}`)) continue;  // emailed within the weekly window
      let profile;
      try { profile = JSON.parse(await env.HIREFLOW_KV.get(k.name) || "null"); } catch { continue; }
      if (!profile || profile.emailWeeklyWin !== true) continue;   // OPT-IN required, only email users who explicitly turned reminders on
      const wins = Array.isArray(profile.achievements) ? profile.achievements : [];
      if (!wins.length) continue;                          // (belt-and-suspenders: need a win to nudge about anyway)
      const lastWin = wins.reduce((m, w) => Math.max(m, (w && w.ts) || 0), 0);
      if (lastWin && now - lastWin < WEEK) continue;       // logged one recently, leave them be
      if ((await sendWinNudgeEmail(env, email, wins.length)).ok) {
        sent++;
        await env.HIREFLOW_KV.put(`winmail_last:${email}`, String(now), { expirationTtl: 561600 }); // ~6.5 days
      }
    }
  } while (cursor);
  return { ok: true, scanned, sent };
}

async function sendWinNudgeEmail(env, email, winCount) {
  const from = env.MAIL_FROM || "Applio <noreply@appliohq.com>";
  const unsub = `https://hireflow-api.pritamavuthu7.workers.dev/unsubscribe?e=${encodeURIComponent(email)}&t=${await winUnsubToken(env, email)}`;
  const addr = env.MAILING_ADDRESS || "";
  const dash = "https://appliohq.com/dashboard";
  const brag = "https://appliohq.com/brag-doc";

  // Rotate the subject line week to week so it stays fresh in a crowded inbox.
  const SUBJECTS = [
    "What did you get done this week?",
    "Don't let this week's wins slip away",
    "2 minutes now saves you hours at resume time",
    "Quick, what went well this week?",
  ];
  const subject = SUBJECTS[Math.floor(Date.now() / (7 * 86400000)) % SUBJECTS.length];

  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f4f5f8;">
  <div style="font:16px/1.65 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:36px 26px;color:#20242e;background:#ffffff;">
    <div style="font-weight:800;font-size:20px;color:#4f46e5;letter-spacing:-.3px;margin-bottom:26px;">Applio</div>

    <p style="font-size:21px;font-weight:700;color:#0f172a;line-height:1.35;margin:0 0 16px;">Before the week gets away from you&nbsp;, what went well?</p>

    <p style="margin:0 0 16px;color:#3a4150;">When it's finally time to update your resume or ask for a raise, hardly anyone can remember what they actually did months ago. The fix is almost embarrassingly simple: <strong>jot down one win a week, while it's fresh.</strong></p>

    <p style="margin:0 0 10px;color:#3a4150;">Think back on this week, did you&hellip;</p>
    <ul style="margin:0 0 22px;padding-left:22px;color:#3a4150;">
      <li style="margin-bottom:5px;">ship or wrap up something?</li>
      <li style="margin-bottom:5px;">hit a number, or nudge one in the right direction?</li>
      <li style="margin-bottom:5px;">unblock a teammate or fix something painful?</li>
      <li>pick up a new tool, or get handed something bigger?</li>
    </ul>
    <p style="margin:0 0 26px;color:#3a4150;">Any one of those counts. Logging it takes about 30 seconds.</p>

    <p style="margin:0 0 28px;"><a href="${dash}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 24px;border-radius:8px;">Log this week's win &rarr;</a></p>

    <p style="margin:0 0 4px;color:#3a4150;">Here's the payoff: every win you log becomes a ready-to-use resume bullet and hard proof for your next review, promotion case, or raise, and it all compiles into a <a href="${brag}" style="color:#4f46e5;">one-page brag doc</a> the moment you need it. Miss the week and the memory's usually gone for good.</p>

    <p style="margin:24px 0 0;color:#3a4150;">See you next week,<br>The Applio team</p>

    <hr style="border:0;border-top:1px solid #e9ebf1;margin:30px 0 14px;">
    <p style="color:#9aa0ad;font-size:12px;line-height:1.6;margin:0;">You're getting this because you use Applio's Win Journal. It's one short email a week, and only when you haven't logged a win. <a href="${unsub}" style="color:#9aa0ad;">Unsubscribe anytime</a>.${addr ? "<br>" + addr : ""}</p>
  </div></body></html>`;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [email], subject, html }),
    });
    if (r.ok) return { ok: true };
    let detail = "";
    try { const j = await r.json(); detail = j.message || j.error || JSON.stringify(j); }
    catch { detail = (await r.text().catch(() => "")) || `HTTP ${r.status}`; }
    return { ok: false, status: r.status, error: detail };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}

// ============ Re-engagement drip (daily cron) ============
// Sends a single contextual email to users who signed up but went inactive.
// Drip stages (by days since signup, only the first matching stage fires):
//   Day 3:  "Your resume is waiting" — nudge to finish building
//   Day 7:  "Tailor to your dream job" — introduce tailoring
//   Day 14: "Your resume is getting stale" — come back and refresh
// Each stage fires at most once per user (tracked in KV). Requires marketing
// consent. Fully inert until RESEND_API_KEY is set.
const DRIP_SCAN_CAP = 5000;
const DRIP_MAX_SENDS = 50;

async function runReEngagementDrip(env) {
  if (!env.RESEND_API_KEY) return { ok: false, reason: "email not configured" };
  const now = Date.now();
  const DAY = 86400000;
  let cursor, scanned = 0, sent = 0;
  do {
    const list = await env.HIREFLOW_KV.list({ prefix: "user:", cursor, limit: 1000 });
    cursor = list.list_complete ? null : list.cursor;
    for (const k of list.keys) {
      if (scanned >= DRIP_SCAN_CAP || sent >= DRIP_MAX_SENDS) { cursor = null; break; }
      scanned++;
      const email = k.name.slice("user:".length);
      if (!email || !email.includes("@")) continue;
      let user;
      try { user = JSON.parse(await env.HIREFLOW_KV.get(k.name) || "null"); } catch { continue; }
      if (!user || !user.createdAt) continue;
      const age = now - user.createdAt;
      const inactive = now - (user.lastSeen || user.createdAt);
      if (inactive < 2 * DAY) continue;
      try {
        const cdoc = JSON.parse(await env.HIREFLOW_KV.get(`consent:${email}`) || "null");
        if (cdoc && cdoc.marketing && cdoc.marketing.status === false) continue;
      } catch {}
      let stage = null;
      if (age >= 14 * DAY && inactive >= 10 * DAY) stage = "drip_14";
      else if (age >= 7 * DAY && inactive >= 5 * DAY) stage = "drip_7";
      else if (age >= 3 * DAY && inactive >= 2 * DAY) stage = "drip_3";
      if (!stage) continue;
      if (await env.HIREFLOW_KV.get(`${stage}:${email}`)) continue;
      if (!(await canSendOutreach(env, email, "marketing"))) continue;
      const ok = await sendDripEmail(env, email, stage, user);
      if (ok) {
        sent++;
        await env.HIREFLOW_KV.put(`${stage}:${email}`, String(now));
        await markOutreachSent(env, email, "marketing", 5);
      }
    }
  } while (cursor);
  return { ok: true, scanned, sent };
}

async function sendDripEmail(env, email, stage, user) {
  const from = env.MAIL_FROM || "Applio <noreply@appliohq.com>";
  const editor = "https://appliohq.com/editor";
  const footer = await commercialEmailFooter(env, email, "marketing");
  const name = (user.name || "").split(/\s/)[0] || "there";

  const templates = {
    drip_3: {
      subject: "Your resume is waiting for you",
      body: `<p>Hey ${name},</p>
        <p>You started building your resume on Applio a few days ago, nice! But it looks like there's more to do.</p>
        <p>Most people who finish their resume in the first week are <strong>3x more likely</strong> to land interviews. The hardest part is already done, you signed up.</p>
        <p style="margin:24px 0;"><a href="${editor}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 24px;border-radius:8px;">Finish your resume &rarr;</a></p>
        <p>Takes about 10 minutes. Your progress is saved right where you left it.</p>`,
    },
    drip_7: {
      subject: "One resume won't cut it anymore",
      body: `<p>Hey ${name},</p>
        <p>Did you know recruiters spend an average of <strong>7 seconds</strong> scanning a resume? The ones that get interviews are tailored to each job description.</p>
        <p>Applio's AI Tailor rewrites your bullets to match the exact keywords and skills each employer is looking for, in about 30 seconds.</p>
        <p style="margin:24px 0;"><a href="${editor}#tailor" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 24px;border-radius:8px;">Try AI Tailor &rarr;</a></p>
        <p>Paste a job description, click Tailor, and see the difference.</p>`,
    },
    drip_14: {
      subject: "Your resume is getting stale",
      body: `<p>Hey ${name},</p>
        <p>It's been a couple of weeks since you last touched your resume. Job markets move fast, and a stale resume can cost you opportunities.</p>
        <p>Hop back in and let AI Improve polish your bullets with stronger action verbs and quantified results. It takes about 2 minutes.</p>
        <p style="margin:24px 0;"><a href="${editor}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 24px;border-radius:8px;">Refresh your resume &rarr;</a></p>
        <p>Your resume is still saved. One click and you're back.</p>`,
    },
  };

  const t = templates[stage];
  if (!t) return false;
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f4f5f8;">
    <div style="font:16px/1.65 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:36px 26px;color:#20242e;background:#fff;">
      <div style="font-weight:800;font-size:20px;color:#4f46e5;letter-spacing:-.3px;margin-bottom:26px;">Applio</div>
      ${t.body}
      <p style="margin:24px 0 0;color:#3a4150;">Happy job hunting,<br>The Applio team</p>
      ${footer}
    </div></body></html>`;

  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [email], subject: t.subject, html }),
    });
    return r.ok;
  } catch { return false; }
}

async function aiDispatch(env, action, body) {
  switch (action) {
    case "improve":   return aiImprove(env, body);
    case "win":       return aiWin(env, body);
    case "skills":    return aiSkills(env, body);
    case "skill-gap": return aiSkillGap(env, body);
    case "salary":    return aiSalary(env, body);
    case "tailor":    return aiTailor(env, body);
    case "ats":       return aiATS(env, body);
    case "analyze":   return aiAnalyze(env, body);
    case "modernize": return aiModernize(env, body);
    case "parse":     return aiParse(env, body);
    case "interview": return aiInterview(env, body);
    case "interview-feedback": return aiInterviewFeedback(env, body);
    case "cover-letter": return aiCoverLetter(env, body);
    case "letter":       return aiLetter(env, body);
    case "assistant": return aiAssistant(env, body);
    case "autopilot": return aiAutopilot(env, body);
    default: throw err(404, "Unknown AI action");
  }
}

// Extract the generated text from a Workers AI response, robust to model shape.
// Older Llama models returned { response: "text" }; newer ones (e.g. Llama 4 Scout)
// can return response as an object/array or use OpenAI-style choices. Never assume
// it's a string, calling .trim() on a non-string was what broke every AI call.
function _aiText(res) {
  if (res == null) return "";
  if (typeof res === "string") return res;
  const asText = (v) => {
    if (typeof v === "string") return v;
    if (Array.isArray(v)) return v.map((p) => (typeof p === "string" ? p : (p && (p.text || p.content)) || "")).join("");
    if (v && typeof v === "object") return v.text || v.content || v.response || "";
    return "";
  };
  // Common Workers AI fields, then OpenAI-compatible shape.
  let t = asText(res.response) || asText(res.result && res.result.response) || asText(res.result) || asText(res.output_text);
  if (!t && Array.isArray(res.choices) && res.choices[0]) {
    const c = res.choices[0].message ? res.choices[0].message.content : res.choices[0].text;
    t = asText(c);
  }
  return typeof t === "string" ? t : "";
}

async function runAI(env, system, user, opts = {}) {
  // Try the requested (or default) model; if it errors, fall back to the fast model.
  const wanted = opts.model || FAST_MODEL;
  // Always try the other model as a fallback too, so a single deprecated/failing
  // model id can never take down every AI feature (as the 2026-05-30 deprecation did).
  const other = wanted === FAST_MODEL ? SMART_MODEL : FAST_MODEL;
  const chain = [wanted, other];
  const payload = {
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    max_tokens: opts.max_tokens || 800,
    temperature: opts.temperature ?? 0.3,
  };
  // Only route through AI Gateway when a REAL gateway id is configured. The
  // placeholder "default" usually does NOT correspond to an existing gateway, and
  // a missing/broken gateway makes EVERY AI call fail. Calling Workers AI directly
  // is strictly safer (you only lose gateway caching/analytics), so we skip it.
  const gwId = env.AI_GATEWAY_ID && env.AI_GATEWAY_ID !== "default" ? env.AI_GATEWAY_ID : null;
  let lastErr;
  for (const model of chain) {
    // If a gateway is configured, try via the gateway first, then retry the same
    // model DIRECTLY, so a gateway outage can never take down all AI.
    const attempts = gwId ? [{ gateway: { id: gwId } }, {}] : [{}];
    for (const runOpts of attempts) {
      try {
        const res = await env.AI.run(model, payload, runOpts);
        const out = _aiText(res).trim();
        if (out) return out;
        // Empty: log the shape once so an unexpected response format is diagnosable.
        try { console.error(`${model} empty/unknown response shape:`, JSON.stringify(res).slice(0, 300)); } catch (_) {}
        lastErr = new Error(`${model} returned empty response`);
      } catch (e) {
        lastErr = e;
        console.error(`AI model ${model} failed${runOpts.gateway ? " (via gateway)" : " (direct)"}:`, e.message || e);
      }
    }
  }
  // 429 / quota / neuron / limit → the account's Workers AI allowance is exhausted;
  // surface that distinctly so the UI can say "limit reached", not "busy, try again".
  const msg = (lastErr && (lastErr.message || String(lastErr))) || "unknown";
  if (/429|quota|neuron|limit|exceeded|too many/i.test(msg)) {
    throw err(429, `AI usage limit reached: ${msg}`);
  }
  throw err(502, `AI model error: ${msg}`);
}

// Streaming variant of runAI — returns a ReadableStream of SSE chunks.
// Each chunk is `data: <token>\n\n`; the stream ends with `data: [DONE]\n\n`.
// Tries FAST_MODEL first, then falls back to SMART_MODEL if streaming fails or
// yields nothing. If both streaming attempts fail, falls back to non-streaming
// runAI (which has its own model-fallback chain). This mirrors runAI's
// resilience so a single flaky model can't take down all streaming AI.
async function runAIStream(env, system, user, opts = {}) {
  const wanted = opts.model || FAST_MODEL;
  const other = wanted === FAST_MODEL ? SMART_MODEL : FAST_MODEL;
  const chain = [wanted, other];
  const payload = {
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    max_tokens: opts.max_tokens || 800,
    temperature: opts.temperature ?? 0.3,
    stream: true,
  };
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  const send = (chunk) => writer.write(enc.encode(`data: ${JSON.stringify(chunk)}\n\n`));
  const done = () => { writer.write(enc.encode("data: [DONE]\n\n")); writer.close(); };

  (async () => {
    let lastErr;
    // Try each model in the chain. Success = we emitted at least one token or
    // fell back inline to a full text response. Failure = throw or empty stream.
    for (const model of chain) {
      try {
        const res = await env.AI.run(model, payload);
        let emitted = false;
        if (res && typeof res[Symbol.asyncIterator] === "function") {
          for await (const part of res) {
            const token = part && (part.response || (part.choices && part.choices[0] && part.choices[0].delta && part.choices[0].delta.content) || "");
            if (token) { await send(token); emitted = true; }
          }
        } else {
          // Non-streaming response from this model: emit full text as one chunk.
          const text = _aiText(res).trim();
          if (text) { await send(text); emitted = true; }
        }
        if (emitted) { done(); return; }
        // Empty response — try the next model.
        lastErr = new Error(`${model} returned empty stream`);
        console.error(`AI stream ${model} empty response, falling back`);
      } catch (e) {
        lastErr = e;
        console.error(`AI stream ${model} failed, falling back:`, e.message || e);
      }
    }
    // Both streaming models failed. Last-resort: try non-streaming runAI, which
    // has its own model-fallback chain and different gateway attempts.
    try {
      const text = await runAI(env, system, user, opts);
      if (text) { await send(text); done(); return; }
    } catch (e) { lastErr = e; }

    // Everything failed. Emit an error the client can classify.
    const msg = (lastErr && (lastErr.message || String(lastErr))) || "AI error";
    await writer.write(enc.encode(`data: ${JSON.stringify({ error: msg })}\n\n`));
    writer.write(enc.encode("data: [DONE]\n\n"));
    writer.close();
  })();

  return readable;
}

// Handler for /ai/stream/{action} — same auth/gating as /ai/{action} but streams SSE.
async function aiStream(req, env, action, cors) {
  const sseHeaders = {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    ...cors,
  };
  const fail = (status, msg) => new Response(`data: ${JSON.stringify({ error: msg })}\n\ndata: [DONE]\n\n`, { status, headers: sseHeaders });

  let payload;
  try { payload = await authenticate(req, env); } catch (e) { return fail(401, e.message || "Unauthorized"); }

  const isAdmin = payload.role === "admin" || payload.role === "super";
  if (!isAdmin) {
    const aiUntil = parseInt(await env.HIREFLOW_KV.get("system:ai_disabled_until") || "0", 10);
    if (aiUntil > Math.floor(Date.now() / 1000)) return fail(503, "Service temporarily unavailable.");
  }

  let body;
  try { body = await req.json(); } catch { return fail(400, "Invalid request body"); }

  if (!isAdmin) {
    const user = await getUser(env, payload.email).catch(() => null);
    if (!user) return fail(404, "User not found");
    const paid = isPaidPlan(user);
    const freeForAll = action === "improve" && (body.target === "summary" || body.target === "personal");
    if (!paid && !freeForAll) {
      const trialLimit = (FREE_TRIAL_LIMITS[action] != null) ? FREE_TRIAL_LIMITS[action] : FREE_AI_TRIALS;
      const trialUsed = (user.aiTrials && user.aiTrials[action]) || 0;
      if (trialUsed >= trialLimit) return fail(402, "Upgrade to Premium for unlimited AI.");
    }
    const rlDay = new Date().toISOString().slice(0, 10);
    const rlKey = `airate:${(payload.email || "").toLowerCase()}:${rlDay}`;
    const rlUsed = parseInt(await env.HIREFLOW_KV.get(rlKey).catch(() => "0") || "0", 10);
    const rlCap = paid ? PAID_AI_DAILY : FREE_AI_DAILY;
    if (rlUsed >= rlCap) return fail(429, "Daily AI limit reached. Try again tomorrow.");
    env.HIREFLOW_KV.put(rlKey, String(rlUsed + 1), { expirationTtl: 172800 }).catch(() => {});
  }

  // Build the same prompt that aiDispatch/aiImprove would use, then stream it.
  // Currently only "improve" is called from the frontend streaming path.
  let sysPrompt, userPrompt, aiOpts = {};
  if (action === "improve") {
    const { target, text, context } = body;
    if (!text || !String(text).trim()) return fail(400, "No text to improve");
    const ctx = context || {};
    const role = String(ctx.role || "").slice(0, 120);
    const company = String(ctx.company || "").slice(0, 120);
    const roleLine = role ? `CONTEXT: This content is for the role "${role}"${company ? ` at ${company}` : ""}. Make every line clearly relevant to that role and the seniority it implies.` : "";
    const isSummary = target === "summary" || target === "personal";
    sysPrompt = isSummary
      ? `You are an elite executive resume writer. Rewrite the candidate's professional summary into a sharp, recruiter-facing pitch.\n${roleLine}\n\nWRITE IT SO IT:\n- Is 2-3 sentences, 40-60 words MAX, tight, zero filler.\n- Opens with a strong identity statement using only facts in the input.\n- Names 2-3 standout specific strengths (skills, domains, or scope), concrete nouns, not adjectives.\n- Ends with the value the candidate brings to a hiring manager.\n- Active voice; third-person implied (no "I", no "you").\n- BANNED buzzwords: "results-driven", "dynamic", "passionate", "synergy", "self-starter", "team player", "detail-oriented", "hard-working", "go-getter".\n- Plain text only, no markdown, no headers, no quotation marks.\n\nOUTPUT: Only the rewritten summary. Nothing else.`
      : `You are an elite executive resume writer. Rewrite the ${target} content into tight, achievement-focused bullets a top recruiter would love.\n${roleLine}\n\nEvery bullet: [strong action verb] + [what you did] + [the measurable result or scope].\n\nHARD RULES:\n- Output 3-6 bullets, one per line, each starting with "• ".\n- Each bullet is ONE sentence, 12-20 words.\n- Begin each bullet with a DISTINCT strong past-tense verb. Never reuse a verb.\n- Lead with impact. Include a metric ONLY if present in or directly implied by the input. NEVER invent numbers.\n- Plain text only. No markdown, no headers.\n\nOUTPUT: Only the bullets. Nothing else.`;
    userPrompt = `Original content:\n${text}\n\nRewrite it.`;
  } else {
    return fail(404, "Streaming not supported for this action");
  }

  const stream = await runAIStream(env, sysPrompt, userPrompt, aiOpts);
  return new Response(stream, { headers: sseHeaders });
}

// Multi-turn variant of runAI: takes a full messages array (system + conversation).
async function runAIChat(env, messages, opts = {}) {
  const wanted = opts.model || FAST_MODEL;
  const other = wanted === FAST_MODEL ? SMART_MODEL : FAST_MODEL;
  const chain = [wanted, other];
  const payload = { messages, max_tokens: opts.max_tokens || 700, temperature: opts.temperature ?? 0.4 };
  const gwId = env.AI_GATEWAY_ID && env.AI_GATEWAY_ID !== "default" ? env.AI_GATEWAY_ID : null;
  let lastErr;
  for (const model of chain) {
    const attempts = gwId ? [{ gateway: { id: gwId } }, {}] : [{}];
    for (const runOpts of attempts) {
      try {
        const res = await env.AI.run(model, payload, runOpts);
        const out = _aiText(res).trim();
        if (out) return out;
        lastErr = new Error(`${model} returned empty response`);
      } catch (e) { lastErr = e; console.error(`AI chat ${model} failed:`, e.message || e); }
    }
  }
  const msg = (lastErr && (lastErr.message || String(lastErr))) || "unknown";
  if (/429|quota|neuron|limit|exceeded|too many/i.test(msg)) throw err(429, `AI usage limit reached: ${msg}`);
  throw err(502, `AI model error: ${msg}`);
}

// runAI + JSON parse, with ONE stricter retry if the first reply doesn't parse
// (covers prose wrappers, code fences, and truncation). Returns { obj, raw };
// obj is null only if both attempts fail, so callers keep their existing fallback.
async function runAIJSON(env, system, user, opts = {}) {
  const raw = await runAI(env, system, user, opts);
  let obj = safeJSON(raw);
  if (obj != null) return { obj, raw };
  const strictSys = system + `\n\nCRITICAL: Respond with ONLY the JSON value, no prose, no explanation, no markdown code fences. Start with { or [ and return complete, valid JSON. Do not stop early.`;
  const raw2 = await runAI(env, strictSys, user, {
    ...opts,
    max_tokens: Math.min(4096, Math.round((opts.max_tokens || 800) * 1.35)),
    temperature: Math.min(opts.temperature ?? 0.2, 0.1),
  });
  obj = safeJSON(raw2);
  return obj != null ? { obj, raw: raw2 } : { obj: null, raw };
}

// Response cache for deterministic, expensive AI calls (same input → same output).
// Keyed by SHA-256 of (namespace + input), stored in KV with a short TTL. Fail-open:
// any KV hiccup just falls through to a live AI call, never an error.
async function _aiCacheKey(ns, input) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ns + "\u0000" + input));
  return "aicache:" + ns + ":" + [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 40);
}
async function aiCacheGet(env, ns, input) {
  try { const hit = await env.HIREFLOW_KV.get(await _aiCacheKey(ns, input)); return hit ? JSON.parse(hit) : null; }
  catch (_) { return null; }
}
async function aiCachePut(env, ns, input, out, ttl = 3600) {
  try { if (out != null) await env.HIREFLOW_KV.put(await _aiCacheKey(ns, input), JSON.stringify(out), { expirationTtl: ttl }); }
  catch (_) {}
}

// ============ Career assistant (conversational copilot) ============
async function aiAssistant(env, { messages, resume }) {
  const history = (Array.isArray(messages) ? messages : [])
    .filter(m => m && (m.role === "user" || m.role === "assistant") && m.content)
    .slice(-12)
    .map(m => ({ role: m.role, content: String(m.content).slice(0, 4000) }));
  if (!history.length || history[history.length - 1].role !== "user") {
    throw err(400, "Send a message to the assistant.");
  }
  const resumeCtx = resume && Object.keys(resume).length
    ? JSON.stringify(resume).slice(0, 5000)
    : "(the user hasn't built a resume yet, encourage them to start one in the Resume Builder)";
  const sys = `${GROUNDING}

You are Applio's AI career assistant, a sharp, encouraging career coach for job seekers.
You help with: resume feedback and rewrites, tailoring to a job, interview prep, job-search strategy, cover letters, LinkedIn, career direction, and salary/negotiation.

Style:
- Concise and direct. Short paragraphs and bullet points, never walls of text.
- Warm and motivating, but honest. No fluff, no restating the question.
- Ground every answer in the user's actual resume below; reference their real roles/skills.
- If asked to write or rewrite something, output the finished text.
- If a question needs info you don't have, ask ONE focused follow-up.
- If a question is unrelated to careers/jobs, gently steer back.
- Point users to Applio's tools when relevant (Resume Builder, AI Tailor, ATS Check, Analysis, Interview Prep, Best Match, Job Tracker).

The user's current resume (JSON):
${resumeCtx}`;
  const reply = await runAIChat(env, [{ role: "system", content: sys }, ...history],
    { model: SMART_MODEL, max_tokens: 700, temperature: 0.35 });
  return { reply };
}

// ============ Improve writing ============
async function aiImprove(env, { target, text, context }) {
  if (!text || !text.trim()) {
    return { text: "Add some content first, then click AI Improve to refine it." };
  }
  const isSummary = target === "summary" || target === "personal";
  const ctx = context || {};
  // Role/company context makes bullets relevant to the actual position instead of generic.
  const role = String(ctx.role || "").slice(0, 120);
  const company = String(ctx.company || "").slice(0, 120);
  const roleLine = role
    ? `CONTEXT: This content is for the role "${role}"${company ? ` at ${company}` : ""}. Make every line clearly relevant to that role and the seniority it implies.`
    : "";

  const body = isSummary
    ? `You are an elite executive resume writer. Rewrite the candidate's professional summary into a sharp, recruiter-facing pitch.
${roleLine}

WRITE IT SO IT:
- Is 2-3 sentences, 40-60 words MAX, tight, zero filler.
- Opens with a strong identity statement: "[Title/role] with [X years / core domain]…" using only facts in the input.
- Names 2-3 standout, specific strengths (skills, domains, or scope), concrete nouns, not adjectives.
- Ends with the value the candidate brings to a hiring manager for this kind of role.
- Active voice; third-person implied (no "I", no "you").
- BANNED buzzwords: "results-driven", "dynamic", "passionate", "synergy", "self-starter", "team player", "detail-oriented", "hard-working", "go-getter".
- Preserves the candidate's real facts, never invent titles, numbers, employers, or achievements.
- Plain text only, no markdown, no headers, no quotation marks.

Before answering, silently check: under 60 words? no banned buzzword? no invented fact? Fix any that fail.

OUTPUT: Only the rewritten summary. Nothing else.`
    : `You are an elite executive resume writer. Rewrite the ${target} content into tight, achievement-focused bullets a top recruiter would love.
${roleLine}

Every bullet follows the impact formula:  [strong action verb] + [what you did] + [the measurable result or scope].

HARD RULES, follow exactly:
- Output 3-6 bullets, one per line, each starting with "• ".
- Each bullet is ONE sentence, 12-20 words. Never a second sentence or trailing "which…" clause.
- Begin each bullet with a DISTINCT strong past-tense verb (Led, Built, Shipped, Reduced, Designed, Drove, Architected, Launched, Cut, Scaled, Automated, Negotiated). Never reuse a verb.
- Lead with impact. Include a metric (%, $, time, scale, users, headcount) ONLY if present in or directly implied by the input. NEVER invent numbers.
- Keep real facts; prefer concrete outcomes over stacked adjectives.
- BANNED openers/phrases (never use): "Responsible for", "Worked on", "Helped", "Assisted with", "Tasked with", "Duties included", "Successfully", "In order to", "Various", "Leveraged", "Utilized", "Spearheaded".
- Plain text only. No markdown, no headers, no preamble, no closing remarks.

Before answering, silently self-check each bullet: unique strong verb? one sentence, ≤20 words? no banned phrase? no invented number? Fix any that fail.

EXAMPLES (weak input → strong bullet):
  "Responsible for the website and worked on making it faster."
    → "• Rebuilt the marketing site in Next.js, cutting page load time 40%."
  "Helped the sales team with reports and did some analysis to find trends."
    → "• Built weekly sales dashboards in SQL, surfacing trends that lifted quota attainment."
  "Managed engineers and shipped features."
    → "• Led a team of engineers to ship three core features across two product launches."

OUTPUT: Only the bullets, one per line, each starting with "• ". Nothing else.`;
  const sys = GROUNDING + "\n\n" + body;
  // Stronger model + low temperature + tight token budget so the AI stays accurate and
  // can't ramble into fabricated paragraphs.
  const opts = isSummary
    ? { model: SMART_MODEL, max_tokens: 240, temperature: 0.3 }
    : { model: SMART_MODEL, max_tokens: 360, temperature: 0.25 };
  const out = await runAI(env, sys, `Candidate content:\n${text}\n\nRewrite it.`, opts);
  let cleaned = out
    .replace(/^(here'?s?( is)?|sure[,!]?|certainly[,!]?|of course[,!]?)[^]*?:\s*/i, "")
    .replace(/^["']|["']$/g, "")
    .trim();
  // For bullets, enforce format + strip banned openers in CODE so a chatty model can
  // never slip fluff past us: one tight sentence per bullet, ≤20 words, distinct verbs.
  if (!isSummary) cleaned = _tightenBullets(cleaned);
  return { text: cleaned };
}

// ============ Polish one win-journal note into a resume-ready bullet ============
// Free for all (it drives the win-logging habit and shows AI value). Grounded so
// it never invents facts, it only rewrites what the user actually wrote.
async function aiWin(env, { text, context }) {
  if (!text || !text.trim()) return { text: "" };
  const role = String((context && context.role) || "").slice(0, 120);
  const roleLine = role ? `CONTEXT: this is for a "${role}" role, keep it relevant to that.\n` : "";
  const sys = GROUNDING + `

You are an elite resume writer. Turn the candidate's rough note about something they accomplished into ONE polished, achievement-focused resume bullet.
${roleLine}HARD RULES:
- Output EXACTLY one bullet, starting with "• ".
- One sentence, 12-20 words, leading with a strong past-tense verb (Led, Built, Shipped, Reduced, Designed, Drove, Launched, Cut, Scaled, Automated, Improved).
- Lead with impact. Keep any real metric from the note; NEVER invent numbers, tools, names, dates, or scope that aren't in the note.
- No buzzwords (results-driven, dynamic, passionate, team player, detail-oriented, hard-working).
- Plain text only, output only the bullet, nothing else.`;
  const out = await runAI(env, sys, `Rough note:\n${text}\n\nPolish it into one bullet.`, { model: SMART_MODEL, max_tokens: 90, temperature: 0.25 });
  const bullet = (_tightenBullets(out).split("\n")[0] || "").replace(/^•\s*/, "").trim();
  return { text: bullet || text.trim() };
}

// Backstop that guarantees concise bullets regardless of model output: strips list
// markers/markdown, keeps only the first sentence of each bullet (trailing sentences
// are almost always padding), hard-caps ~20 words, and limits to 6 bullets.
// Weak/filler openers to strip so a bullet always leads with a strong verb.
const _WEAK_OPENERS = /^(responsible for|worked on|tasked with|assisted with|assisted in|helped to|helped with|helped|duties included|in charge of|was |were |involved in|participated in|successfully )/i;
function _tightenBullets(out) {
  const lines = out.split("\n").map(l => l.trim()).filter(Boolean);
  const bullets = [];
  const usedVerbs = new Set();
  for (const line of lines) {
    let s = line.replace(/^\s*(?:[••*\-]+|\d+[.)])\s*/, "").replace(/\*\*/g, "").trim();
    if (!s) continue;
    // Strip a weak/filler opener and re-capitalize what remains (leads with the real action).
    let prev;
    do { prev = s; s = s.replace(_WEAK_OPENERS, "").trim(); } while (s !== prev && _WEAK_OPENERS.test(s));
    if (!s) continue;
    const m = s.match(/^(.*?[.!?])(?:\s+\S[^]*)?$/);      // keep first sentence only
    if (m) s = m[1].trim();
    const words = s.split(/\s+/);
    if (words.length > 20) s = words.slice(0, 20).join(" ").replace(/[,;:]+$/, "") + ".";
    if (!/[.!?]$/.test(s)) s += ".";
    s = s.charAt(0).toUpperCase() + s.slice(1);
    // De-duplicate the leading verb so bullets don't all start with the same word.
    const verb = s.split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, "");
    if (verb && usedVerbs.has(verb) && bullets.length) continue;
    if (verb) usedVerbs.add(verb);
    bullets.push("• " + s);
    if (bullets.length >= 6) break;
  }
  return bullets.length ? bullets.join("\n") : out;
}

// ============ Generative-output safety net =====================================
// Defense in depth for the prose generators (cover letter, letter, summary). The
// GROUNDING prompt + self-checks steer the model; these catch the failures that slip
// through, so a real professional never sees a placeholder, a refusal, a JSON blob, or
// a "Here's your..." preamble in what they're about to send to an employer.

// Strip the artifacts a chatty/small model tends to leak around good output.
function _cleanProse(text) {
  let s = String(text == null ? "" : text);
  s = s.replace(/^```[a-z]*\s*|\s*```$/gi, "");                 // code fences
  // Leading preamble like "Sure! Here's your cover letter:" up to the first blank line.
  s = s.replace(/^\s*(sure|certainly|of course|absolutely|here(?:'s| is)|below is|i'?d be happy to)[^\n]*:\s*\n+/i, "");
  s = s.replace(/^\s*["'“”]+|["'“”]+\s*$/g, "");                // wrapping quotes
  return s.trim();
}

// Unfilled placeholders the model was told never to emit: [Company], {{name}}, <role>,
// XXXX, [Your achievement], etc. Presence means the output is not send-ready.
const _PLACEHOLDER_RE = /\[[^\]\n]{1,40}\]|\{\{[^}\n]{1,40}\}\}|<[A-Za-z][^>\n]{0,38}>|\bX{3,}\b|\b(?:your name here|insert [a-z ]+|company name|job title)\b/i;
// The model refused or broke character instead of producing content.
const _REFUSAL_RE = /\b(as an ai|i (?:can'?t|cannot|am unable|'m unable)|i do not have|i'm sorry,? but|language model)\b/i;

// Returns a reason string if the text is not safe to show, else "". Callers throw a
// friendly error on a non-empty reason rather than surfacing broken content.
function _brokenReason(text, { minLen = 40 } = {}) {
  const s = String(text || "").trim();
  if (s.replace(/\s+/g, "").length < minLen) return "too-short";
  if (_REFUSAL_RE.test(s)) return "refusal";
  if (_PLACEHOLDER_RE.test(s)) return "placeholder";
  if (/^\s*[{[][\s\S]*[}\]]\s*$/.test(s)) return "json-leak";   // raw JSON leaked into a prose field
  return "";
}

// ============ Suggest skills ============
async function aiSkills(env, { experience }) {
  const cacheKey = JSON.stringify(experience || {}).slice(0, 3000);
  const cached = await aiCacheGet(env, "skills", cacheKey);
  if (cached) return cached;
  const sys = GROUNDING + "\n\n" + `You extract resume-ready skills that are DEMONSTRATED in the candidate's work history.

Return a clean comma-separated list of 10-16 skills, each one directly evidenced by the described work, a tool they clearly used, a methodology they clearly applied, or a responsibility they clearly held.

Rules:
- Only include a skill if the experience gives real evidence for it. Do NOT list skills just because they are common for the job title. When in doubt, leave it out.
- Use the candidate's own tools/technologies verbatim; never swap in adjacent tools they didn't mention (e.g. don't add "Kubernetes" just because they mention Docker).
- Use industry-standard naming (e.g. "Project Management", not "managing projects").
- No duplicates. No generic filler like "Teamwork", "Hard worker", "Detail-oriented".
- No explanations, no numbering, no preamble.

OUTPUT: Just the comma-separated list. Nothing else.`;
  const raw = await runAI(env, sys,
    `Experience:\n${JSON.stringify(experience).slice(0, 3000)}`,
    { model: SMART_MODEL, max_tokens: 250, temperature: 0.15 });
  // Strip preambles and quotation marks
  const cleaned = raw
    .replace(/^[^a-z]*here[^:]*:\s*/i, "")
    .replace(/^["']|["']$/g, "")
    .split("\n")[0]
    .trim();
  const out = { skills: cleaned };
  await aiCachePut(env, "skills", cacheKey, cleaned ? out : null, 86400);
  return out;
}

// ============ Skill-gap coach ============
// Compares a target role against the skills already on the resume and surfaces the
// highest-impact missing skills. Free (drives the career-copilot loop). Grounded:
// "relevant" must be verbatim from the user's own list; it never invents skills the
// candidate has, and frames gaps as "verify you have it / learn it", not "claim it".
// ============ Salary insights ============
// Estimated pay ranges for a role + location, to help decide if an opportunity is
// worth pursuing. These are MODEL ESTIMATES from general knowledge, not a live market
// feed, so the output always carries that caveat and the frontend shows it plainly.
async function aiSalary(env, { role, location, level, resume }) {
  const target = String(role || "").trim().slice(0, 120);
  if (!target) throw err(400, "Enter a job title to see salary ranges.");
  const loc = String(location || "").trim().slice(0, 120);
  const lvl = String(level || "").trim().slice(0, 40);
  // Light resume context (seniority signal only) improves the estimate without PII.
  let years = "";
  try {
    const exp = (resume && Array.isArray(resume.experience)) ? resume.experience : [];
    if (exp.length) years = `${exp.length} listed role(s)`;
  } catch (_) {}

  const cacheKey = (target + "|" + loc + "|" + lvl).toLowerCase().slice(0, 300);
  const cached = await aiCacheGet(env, "salary", cacheKey);
  if (cached) return cached;

  const sys = GROUNDING + "\n\n" + `You are a compensation analyst. Give a realistic ESTIMATED annual pay range for a role, based on your general knowledge of typical market compensation. You do not have live market data, so these are informed estimates, be honest about that.

Return STRICT JSON only, no markdown, in exactly this shape:
{
  "role": "<normalized role title>",
  "location": "<normalized location, or 'Not specified'>",
  "currency": "<ISO code appropriate to the location, e.g. USD, GBP, EUR, INR>",
  "period": "year",
  "low": <integer, ~10th-25th percentile base pay>,
  "median": <integer, typical base pay>,
  "high": <integer, ~75th-90th percentile base pay>,
  "level": "<seniority you assumed, e.g. Entry / Mid / Senior>",
  "factors": [ "<3-5 short bullets on what moves pay up or down for this role>" ],
  "negotiation": "<one concrete, specific negotiation tip for this role>",
  "confidence": "<low | medium | high, based on how standardized pay is for this role/market>"
}

Rules:
- Numbers are BASE salary (exclude bonus/equity) unless the role is normally quoted with tips/commission, then note that in factors.
- Keep low < median < high, all realistic and internally consistent for the stated location's cost of living and currency.
- If no location is given, estimate a national average for a major English-speaking market and set location to "Not specified (national average)".
- Never fabricate a false precision; round to sensible increments.
- factors are specific to THIS role, not generic ("years of experience" alone is too vague).`;

  const user = `ROLE: ${target}
LOCATION: ${loc || "(not specified)"}
SENIORITY HINT: ${lvl || years || "(infer from role title)"}

Return the JSON.`;

  const raw = await runAI(env, sys, user, { model: SMART_MODEL, max_tokens: 600, temperature: 0.2 });
  let data = null;
  try { data = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, "").trim()); }
  catch { const m = raw.match(/\{[\s\S]*\}/); if (m) { try { data = JSON.parse(m[0]); } catch {} } }
  if (!data || typeof data.median !== "number") {
    throw err(502, "Couldn't estimate a range for that role, try a more common job title.");
  }
  const int = (v) => { const n = Math.round(Number(v) || 0); return n > 0 ? n : 0; };
  let low = int(data.low), median = int(data.median), high = int(data.high);
  // Guarantee low <= median <= high even if the model slips.
  const sorted = [low, median, high].filter(n => n > 0).sort((a, b) => a - b);
  if (sorted.length === 3) { low = sorted[0]; median = sorted[1]; high = sorted[2]; }
  // Plausibility guard: reject nonsensical figures rather than show a made-up number as
  // fact. Annual pay in any real market sits well inside these bounds; a spread wider
  // than 6x low..high signals the model guessed. Fail cleanly instead of misinforming.
  if (median < 5000 || median > 5000000 || (low && high && high > low * 6)) {
    throw err(502, "Couldn't estimate a reliable range for that. Try a more specific or common job title.");
  }
  const out = {
    role: String(data.role || target).slice(0, 120),
    location: String(data.location || (loc || "Not specified")).slice(0, 120),
    currency: String(data.currency || "USD").slice(0, 8).toUpperCase(),
    period: "year",
    low, median, high,
    level: String(data.level || lvl || "").slice(0, 40),
    factors: Array.isArray(data.factors) ? data.factors.map(f => String(f).slice(0, 200)).filter(Boolean).slice(0, 5) : [],
    negotiation: String(data.negotiation || "").slice(0, 300),
    confidence: ["low", "medium", "high"].includes(String(data.confidence)) ? data.confidence : "medium",
    estimate: true,
    disclaimer: "AI estimate from general market knowledge, not live data. Verify against listings and sites like Levels.fyi, Glassdoor, or the BLS before deciding.",
  };
  await aiCachePut(env, "salary", cacheKey, out, 86400);
  return out;
}

async function aiSkillGap(env, { role, skills, context, jobDescription }) {
  const target = String(role || "").trim().slice(0, 120);
  const jd = String(jobDescription || "").trim().slice(0, 6000);
  if (!target && !jd) return { missing: [], relevant: [], note: "no-input" };
  const have = Array.isArray(skills) ? skills.map(s => String(s || "").slice(0, 60)).filter(Boolean).slice(0, 80) : [];
  const ctx = String(context || "").slice(0, 1800);
  const cacheKey = ((jd ? "jd" : "role") + "|" + target + "|" + have.join(",") + "|" + (jd ? jd.slice(0, 1600) : ctx)).slice(0, 2400);
  const cached = await aiCacheGet(env, "skillgap", cacheKey);
  if (cached) return cached;

  const shape = `Return STRICT JSON only, no markdown, in exactly this shape:
{
  "missing": [ { "skill": "<short skill or tool name>", "why": "<one concise sentence on why it matters>" } ],
  "relevant": [ "<the candidate's CURRENT skills that fit, verbatim from their list>" ]
}`;
  let sys, user;
  if (jd) {
    // Posting-specific: draw requirements ONLY from the pasted job description (real
    // text the user provided), so nothing is invented about what the job wants.
    sys = GROUNDING + "\n\n" + `You are an expert recruiter and ATS analyst. Compare a candidate's current resume skills against a SPECIFIC job posting, and surface the most important skills/tools/qualifications the POSTING requires that are MISSING from the candidate's skills.

${shape}

Rules:
- Draw "missing" ONLY from skills/requirements that actually appear in the job posting text below AND are not already in the candidate's current skills. NEVER invent a requirement the posting doesn't state.
- Order by how central each is to the posting. 6-10 items.
- Each "skill" is a concrete tool, technology, methodology, or credential the posting names, never a vague trait.
- "why" is one short sentence on how the posting uses or requires it.
- "relevant" contains ONLY the candidate's CURRENT skills (verbatim) that the posting also asks for.`;
    user = `JOB POSTING:
${jd}

CANDIDATE'S CURRENT RESUME SKILLS: ${have.length ? have.join(", ") : "(none listed)"}

Return the JSON.`;
  } else {
    sys = GROUNDING + "\n\n" + `You are an expert technical recruiter and career coach. Compare a candidate's TARGET ROLE against the skills currently listed on their resume, and surface the highest-impact skills/tools that strong candidates for that role usually have but that are MISSING from their list.

${shape}

Rules:
- 6-10 "missing" items, most-important first. Each "skill" is a concrete tool, technology, methodology, or credential, never a vague trait like "communication".
- A skill is "missing" only if it's commonly expected for the role AND not already in the candidate's current skills. Never repeat something already listed.
- "relevant" contains ONLY skills the candidate actually listed (verbatim), never invent skills they didn't provide.
- Match the seniority implied by the role. Be realistic and specific.
- "why" is one short plain sentence, no fluff.`;
    user = `TARGET ROLE: ${target}
CURRENT RESUME SKILLS: ${have.length ? have.join(", ") : "(none listed)"}
RESUME CONTEXT: ${ctx || "(none)"}

Return the JSON.`;
  }
  const raw = await runAI(env, sys, user, { model: SMART_MODEL, max_tokens: 750, temperature: 0.3 });
  let data = null;
  try { data = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, "").trim()); }
  catch { const m = raw.match(/\{[\s\S]*\}/); if (m) { try { data = JSON.parse(m[0]); } catch {} } }
  if (!data || !Array.isArray(data.missing)) return { missing: [], relevant: have.slice(0, 20) };
  const out = {
    missing: data.missing.filter(x => x && x.skill).slice(0, 10).map(x => ({ skill: String(x.skill).slice(0, 60), why: String(x.why || "").slice(0, 200) })),
    relevant: Array.isArray(data.relevant) ? data.relevant.map(s => String(s).slice(0, 60)).filter(Boolean).slice(0, 20) : [],
  };
  await aiCachePut(env, "skillgap", cacheKey, out.missing.length ? out : null, 86400);
  return out;
}

// ============ Tailor to job ============
async function aiTailor(env, { jobDescription, resume }) {
  const sys = GROUNDING + "\n\n" + `You are a resume strategist. The candidate wants to tailor their resume to a specific job posting.

Analyze the job description and the candidate's resume, then output STRICT JSON in exactly this shape:

{
  "summary": "<2-3 sentence professional summary, rewritten to mirror the language of the JD while staying truthful to the candidate's actual experience. ~40-60 words. No 'I'. No buzzwords.>",
  "matchedKeywords": ["<keyword 1>", "<keyword 2>", "..."],
  "missingKeywords": ["<important JD keyword the resume doesn't mention>", "..."],
  "emphasize": [
    "<short, actionable note: 'Lead with your AWS migration work, JD heavily emphasizes cloud infra'>",
    "<another note>",
    "<another note>"
  ],
  "bulletSuggestions": [
    {"before": "<the candidate's original bullet, close to as written>", "after": "<the rewritten, JD-aligned version at the Strong bar>"},
    {"before": "...", "after": "..."},
    {"before": "...", "after": "..."}
  ]
}

Calibrate bulletSuggestions to THIS quality bar (rewrite the candidate's own bullets this way):
  Weak:   "Responsible for managing the deployment process and helping the team."
  Strong: "Owned CI/CD for 12 services, cutting deploy time 45% and incidents 30%."
Every strong bullet: past-tense action verb + specific scope + a quantified result, mirroring the JD's language, using ONLY facts the candidate actually stated.

Rules:
- matchedKeywords: 6-10 entries the JD asks for that the resume already shows
- missingKeywords: 3-6 important JD keywords the resume is missing (exact JD terminology)
- emphasize: 3 short coaching notes, each one sentence
- bulletSuggestions: 3 specific bullet rewrites grounded in the candidate's actual experience, at the "Strong" bar above
- Never invent experience, employers, tools, or metrics they don't have. If a bullet has no number, keep it qualitative rather than fabricating one.
- OUTPUT ONLY THE JSON OBJECT. No markdown fences, no preamble.`;

  const { obj: j, raw } = await runAIJSON(env, sys,
    `Job Description:\n${(jobDescription || '').slice(0, 4000)}\n\nCandidate Resume:\n${JSON.stringify(resume).slice(0, 7000)}`,
    { model: SMART_MODEL, max_tokens: 1400, temperature: 0.2 });
  if (!j) return { text: raw, summary: null };

  const matchedKeywords = Array.isArray(j.matchedKeywords) ? j.matchedKeywords : [];
  const missingKeywords = Array.isArray(j.missingKeywords) ? j.missingKeywords : [];
  const emphasize = Array.isArray(j.emphasize) ? j.emphasize : [];
  // Normalize bullets to {before, after}; tolerate the model returning plain strings.
  const bulletSuggestions = (Array.isArray(j.bulletSuggestions) ? j.bulletSuggestions : [])
    .map(b => typeof b === "string" ? { before: "", after: b } : { before: b.before || "", after: b.after || "" })
    .filter(b => b.after);

  // Legacy text blob so an older frontend still renders something sensible.
  const lines = [];
  if (matchedKeywords.length) lines.push(`Matched keywords:\n${matchedKeywords.map(k => `  ✓ ${k}`).join("\n")}`);
  if (missingKeywords.length) lines.push(`\nMissing keywords (add these if true):\n${missingKeywords.map(k => `  ✗ ${k}`).join("\n")}`);
  if (emphasize.length) lines.push(`\nWhat to emphasize:\n${emphasize.map(e => `  • ${e}`).join("\n")}`);
  if (bulletSuggestions.length) lines.push(`\nSuggested bullet rewrites:\n${bulletSuggestions.map(b => `  → ${b.after}`).join("\n")}`);

  return { text: lines.join("\n"), summary: j.summary || null, matchedKeywords, missingKeywords, emphasize, bulletSuggestions };
}

// ============ ATS check ============
async function aiATS(env, { jobDescription, resume }) {
  const cacheKey = (jobDescription || '').slice(0, 4000) + "\u0000" + JSON.stringify(resume || {}).slice(0, 7000);
  const cached = await aiCacheGet(env, "ats", cacheKey);
  if (cached) return cached;
  const sys = GROUNDING + "\n\n" + `You are an ATS (Applicant Tracking System) and resume scoring expert.

Score the candidate's resume against the job description (or generic best practices if no JD). Be honest and specific. Output STRICT JSON:

{
  "score": <integer 0-100>,
  "breakdown": {
    "keywords": <0-100>,
    "experience": <0-100>,
    "formatting": <0-100>,
    "completeness": <0-100>
  },
  "feedback": "<concise summary of what's working and what's not, 2-3 sentences>",
  "wins": ["<specific thing the resume does well>", "<another>", "<another>"],
  "issues": ["<specific weakness, name the section and what to fix>", "<another>", "<another>", "<another>"],
  "missingKeywords": ["<keyword from JD missing from resume>", "<another>"]
}

Scoring rubric, compute each sub-score 0-100, then score = the WEIGHTED sum:
- keywords (30%): exact-match coverage of the JD's required skills/titles/tools. A missing must-have keyword is a hard penalty.
- experience (30%): does the described experience actually match the role's level and responsibilities?
- formatting (20%): ATS-safe structure (standard section headers, no tables/columns/images, real dates, parseable).
- completeness (20%): contact info, all core sections present, quantified bullets.
Band check: 90-100 ready to submit · 70-89 minor tweaks · 50-69 significant work · <50 major gaps.
Be strict and consistent: the SAME resume must always get the SAME score.

Rules:
- score is the weighted overall from the rubric above (not a plain average)
- wins/issues must reference specific resume content, not generic advice
- missingKeywords: list the exact JD terms absent from the resume, most important first
- If no JD provided, score against general resume best practices (action verbs, quantification, brevity, ATS-safe formatting, completeness)
- OUTPUT ONLY THE JSON OBJECT. No markdown fences.`;

  const { obj: j, raw } = await runAIJSON(env, sys,
    `Job Description:\n${(jobDescription || '(no JD provided, score against general best practices)').slice(0, 4000)}\n\nCandidate Resume:\n${JSON.stringify(resume).slice(0, 7000)}`,
    { model: SMART_MODEL, max_tokens: 1100, temperature: 0 });
  if (!j) return { score: 50, feedback: raw };

  // Return STRUCTURED output so the frontend can render bars, cards, and chips
  // instead of a flat text blob. `feedback` stays as the short prose summary only.
  const out = {
    score: j.score ?? 50,
    breakdown: (j.breakdown && typeof j.breakdown === "object") ? {
      keywords: j.breakdown.keywords,
      experience: j.breakdown.experience,
      formatting: j.breakdown.formatting,
      completeness: j.breakdown.completeness,
    } : null,
    feedback: typeof j.feedback === "string" ? j.feedback : "",
    wins: Array.isArray(j.wins) ? j.wins.slice(0, 6) : [],
    issues: Array.isArray(j.issues) ? j.issues.slice(0, 6) : [],
    missingKeywords: Array.isArray(j.missingKeywords) ? j.missingKeywords.slice(0, 12) : [],
  };
  await aiCachePut(env, "ats", cacheKey, out, 86400);
  return out;
}

// ============ Analyze ============
async function aiAnalyze(env, { resume }) {
  const cacheKey = JSON.stringify(resume || {}).slice(0, 9000);
  const cached = await aiCacheGet(env, "analyze", cacheKey);
  if (cached) return cached;
  const sys = GROUNDING + "\n\n" + `You are a senior career coach and resume reviewer. The candidate uploaded their resume and wants a full critique.

Output STRICT JSON:

{
  "overallScore": <0-100>,
  "summary": "<2-3 sentence overall impression>",
  "strengths": [
    "<specific strength, referencing a section or bullet from the resume>",
    "<another>",
    "<another>"
  ],
  "weaknesses": [
    "<specific weakness with a section name, e.g. 'Experience bullets at Acme lack metrics'>",
    "<another>",
    "<another>"
  ],
  "topFixes": [
    {"action": "<one concrete change>", "where": "<which section>", "impact": "<why it matters>", "priority": "high|medium|low", "example": "<a concrete rewritten line the candidate can paste in>"},
    {"action": "...", "where": "...", "impact": "...", "priority": "...", "example": "..."},
    {"action": "...", "where": "...", "impact": "...", "priority": "...", "example": "..."}
  ],
  "missingSections": ["<section the resume is missing that would help, e.g. 'Skills', 'Projects'>"]
}

Score with this rubric (compute each 0-100, then overallScore = the weighted sum):
- Impact & metrics (35%): do bullets quantify results (%, $, scale, time), or are they duty lists?
- Relevance & keywords (25%): does it target real roles with the right terminology?
- Clarity & writing (20%): strong action verbs, concise, no filler ("responsible for", "worked on").
- Completeness & structure (20%): all key sections present, logical order, no gaps.
Be a tough but fair reviewer: a generic duties-based resume scores 40-60, not 80.

Rules:
- Be specific, not generic. Always cite the actual section/role you're critiquing (name the company/bullet).
- topFixes should be the 3 highest-leverage changes, ordered by impact. Set "priority" and give an "example" rewrite for each.
- Example rewrites must be paste-ready and grounded in the candidate's real content, never invented facts/metrics.
- OUTPUT ONLY THE JSON OBJECT. No markdown fences.`;

  const { obj: j, raw } = await runAIJSON(env, sys,
    `Candidate Resume:\n${JSON.stringify(resume).slice(0, 9000)}`,
    { model: SMART_MODEL, max_tokens: 2000, temperature: 0.1 });
  // Return the STRUCTURED object so the frontend renders the polished score ring +
  // Strengths / Weaknesses / Top Fixes cards. If the model didn't return valid JSON,
  // hand back the raw text and let the frontend's tolerant parser recover it.
  if (!j) return { text: raw };
  const out = {
    overallScore: j.overallScore,
    summary: j.summary,
    strengths: Array.isArray(j.strengths) ? j.strengths : [],
    weaknesses: Array.isArray(j.weaknesses) ? j.weaknesses : [],
    topFixes: Array.isArray(j.topFixes) ? j.topFixes : [],
    missingSections: Array.isArray(j.missingSections) ? j.missingSections : [],
  };
  await aiCachePut(env, "analyze", cacheKey, out, 86400);
  return out;
}

// ============ Age-Proof / Modernize ============
// Helps experienced, late-career candidates present as current and avoid the details
// that quietly trigger age bias in screening. Reviews the resume for dated signals and
// returns concrete, respectful fixes + a modernized summary. Grounded, never invents.
async function aiModernize(env, { resume }) {
  const cacheKey = JSON.stringify(resume || {}).slice(0, 9000);
  const cached = await aiCacheGet(env, "modernize", cacheKey);
  if (cached) return cached;
  const sys = GROUNDING + "\n\n" + `You help experienced professionals present their resume so it reads as current and relevant and does not invite age discrimination in screening. Review ONLY what is actually present and flag signals that can make the candidate look dated or reveal age unnecessarily, plus outdated phrasing.

Consider: graduation years and other age-revealing dates; roles older than ~15 years that could be trimmed or summarized; "20+ years"/"seasoned"/"proven track record" style phrasing; duty-based, passive wording ("responsible for"); outdated tools/terminology; dated resume conventions (objective statement, "References available on request", full mailing address); and excessive length/full multi-decade history.

Output STRICT JSON:
{
  "riskLevel": "low|moderate|high",
  "riskScore": <0-100, higher = more age-bias signals present>,
  "summary": "<2-3 encouraging sentences on how the resume currently reads on currency/age>",
  "signals": [
    {"issue": "<the specific thing in THEIR resume>", "where": "<section/role/phrase>", "why": "<why it can read as dated or reveal age>", "fix": "<the concrete change>", "severity": "high|medium|low"}
  ],
  "modernSummary": "<a rewritten, age-neutral professional summary they can paste in: 2-3 sentences, leading with recent impact, grounded ONLY in their real experience, no invented facts or numbers>"
}

Rules:
- 3 to 6 signals, most impactful first. Always cite the candidate's ACTUAL content. Never invent facts.
- Respectful and constructive: this is about presentation, not hiding who they are or lying about dates.
- OUTPUT ONLY THE JSON OBJECT. No markdown fences.`;
  const { obj: j, raw } = await runAIJSON(env, sys,
    `Candidate Resume:\n${JSON.stringify(resume).slice(0, 9000)}`,
    { model: SMART_MODEL, max_tokens: 1800, temperature: 0.15 });
  if (!j) return { text: raw };
  const out = {
    riskLevel: (["low", "moderate", "high"].includes(j.riskLevel) ? j.riskLevel : "moderate"),
    riskScore: typeof j.riskScore === "number" ? j.riskScore : 50,
    summary: j.summary || "",
    signals: Array.isArray(j.signals) ? j.signals.slice(0, 6) : [],
    modernSummary: j.modernSummary || "",
  };
  await aiCachePut(env, "modernize", cacheKey, out, 86400);
  return out;
}

// ============ Parse (resume import, most important!) ============
async function aiParse(env, { text }) {
  if (!text || text.trim().length < 30) {
    throw err(400, "Paste at least a few lines from your resume, 'test' isn't enough text to parse.");
  }
  const cached = await aiCacheGet(env, "parse", text.slice(0, 8000));
  if (cached) return cached;
  const sys = `You are an expert resume parser. The user pasted plain text from a resume (could be from a PDF copy-paste, so formatting may be messy, line breaks in odd places, bullet markers like •, *, -, ▪, →, or no markers, dates in any format).

Extract everything into this EXACT JSON schema. Fill every field you can confidently extract. Use "" for unknown strings and [] for empty arrays.

SCHEMA:
{
  "personal": {
    "fullName": "<full name from top of resume>",
    "email": "<email address>",
    "phone": "<phone number, keep original format>",
    "location": "<city, state OR city, country>",
    "linkedin": "<linkedin URL or username>",
    "github": "<github URL or username>",
    "website": "<personal website URL>",
    "summary": "<professional summary / objective / about section, kept verbatim>"
  },
  "experience": [
    {
      "title": "<job title>",
      "company": "<company name>",
      "start": "<start date, e.g. 'Jan 2022' or '2022'>",
      "end": "<end date or 'Present'>",
      "location": "<city, state or 'Remote'>",
      "description": "<all bullets joined with newlines, each starting with '• '>"
    }
  ],
  "education": [
    {
      "school": "<school name>",
      "degree": "<degree type, B.S., M.S., Ph.D., B.A., etc.>",
      "field": "<major / field of study>",
      "gpa": "<GPA if mentioned>",
      "start": "<start year>",
      "end": "<end year or graduation year>",
      "notes": "<honors, thesis, relevant coursework>"
    }
  ],
  "skills": {
    "categories": [
      {"name": "All", "items": ["<skill 1>", "<skill 2>", "..."]}
    ]
  },
  "projects": [
    {
      "name": "<project name>",
      "role": "<role/title>",
      "tech": "<tech stack, comma-separated>",
      "link": "<URL>",
      "description": "<what the project did, key outcomes>"
    }
  ],
  "certifications": [
    {"name": "<cert name>", "issuer": "<issuing org>", "date": "<date>", "url": "<credential URL>"}
  ],
  "awards": [
    {"name": "<award name>", "issuer": "<issuing org>", "date": "<date>", "description": "<short description>"}
  ],
  "leadership": [
    {"role": "<role>", "org": "<organization>", "start": "<date>", "end": "<date>", "description": "<what you did>"}
  ],
  "volunteer": [
    {"role": "<role>", "org": "<organization>", "start": "<date>", "end": "<date>", "description": "<what you did>"}
  ],
  "publications": [
    {"title": "<title>", "venue": "<journal/conference>", "date": "<date>", "url": "<URL>", "abstract": ""}
  ]
}

CRITICAL RULES:
1. Section detection: identify sections by their headers (e.g. "EXPERIENCE", "WORK HISTORY", "Professional Experience" → experience). Common synonyms:
   - Experience: Work Experience, Professional Experience, Employment, Work History, Career
   - Education: Academic Background, Schooling
   - Skills: Technical Skills, Core Competencies, Technologies, Proficiencies
   - Projects: Personal Projects, Side Projects, Notable Projects
   - Leadership: Activities, Extracurriculars, Leadership Experience
   - Volunteer: Community Service, Volunteer Work
2. Bullet extraction: detect bullets by markers (•, *, -, ▪, →, ●) OR by short paragraph breaks. Strip the original marker; output as "• <text>" joined by "\\n".
3. Dates: keep the original format. If you see "May 2022 - Present", set start="May 2022", end="Present".
4. Name + contact: usually the first 1-5 lines of the resume.
5. Skills: extract every listed skill, comma/pipe/bullet separated. Put all under one category "All" unless the resume explicitly groups them.
6. NEVER hallucinate or embellish. Copy the candidate's wording; do not rewrite, improve, or invent. If a field is not clearly in the text, leave it empty (""), never guess a value, date, title, company, or metric.
7. Don't truncate descriptions, keep all bullet content.

OUTPUT FORMAT:
- ONLY the JSON object.
- NO markdown code fences (no \`\`\`).
- NO preamble like "Here's the parsed JSON".
- Start directly with {.`;

  const { obj: j } = await runAIJSON(env, sys,
    `Resume text:\n${text.slice(0, 8000)}`,
    { model: SMART_MODEL, max_tokens: 3500, temperature: 0.1 });
  const out = { resume: j };
  // Parsing is deterministic (temp 0.1): the same pasted text always yields the same
  // structure, so cache for a week to eliminate repeat imports of the same resume.
  await aiCachePut(env, "parse", text.slice(0, 8000), j ? out : null, 604800);
  return out;
}

// ============ Interview prep ============
async function aiInterview(env, { role, jobDescription, resume }) {
  const cacheKey = String(role || '').slice(0, 200) + "\u0000" +
    (jobDescription || '').slice(0, 2000) + "\u0000" + JSON.stringify(resume || {}).slice(0, 3500);
  const cached = await aiCacheGet(env, "interview", cacheKey);
  if (cached) return cached;
  const sys = GROUNDING + "\n\n" + `You are a senior interview coach. The candidate is preparing for an interview for a specific role.

Generate 10 high-quality practice interview questions, mixing:
- 3 behavioral (STAR-friendly: "Tell me about a time you…")
- 4 role-specific / technical
- 2 situational / hypothetical
- 1 closing / motivational

Format EXACTLY like this (no markdown, no JSON, plain text):

[Behavioral]
1. <Question>
   Tip: <One-line strategic tip, what they're really testing, what to emphasize from the candidate's resume>

2. <Question>
   Tip: <Tip>

3. <Question>
   Tip: <Tip>

[Role-Specific]
4. <Question>
   Tip: <Tip>

5. <Question>
   Tip: <Tip>

6. <Question>
   Tip: <Tip>

7. <Question>
   Tip: <Tip>

[Situational]
8. <Question>
   Tip: <Tip>

9. <Question>
   Tip: <Tip>

[Closing]
10. <Question>
    Tip: <Tip>

Rules:
- Questions should reference specifics from the candidate's actual resume when natural
- Tips should mention which resume bullet/experience to lean on for the answer
- Avoid generic questions like "What's your greatest weakness?", interviewers ask sharper questions today
- No preamble. Start directly with "[Behavioral]".`;

  const out = { text: await runAI(env, sys,
    `Role: ${role}\n\nJob Description:\n${(jobDescription || '(none provided)').slice(0, 2000)}\n\nCandidate Resume:\n${JSON.stringify(resume).slice(0, 3500)}`,
    { model: SMART_MODEL, max_tokens: 1400, temperature: 0.35 }) };
  // Short TTL: dedupes accidental double-submits / refreshes / back-navigation (the
  // real waste) without locking the user into one question set for long.
  await aiCachePut(env, "interview", cacheKey, out.text ? out : null, 3600);
  return out;
}

// ============ Interview answer feedback (scored) ============
async function aiInterviewFeedback(env, { question, answer, role }) {
  const sys = `You are a senior interview coach scoring a candidate's practice answer. Be honest, specific, and encouraging. Output STRICT JSON:

{
  "score": <integer 0-100>,
  "breakdown": {
    "structure": <0-100>,
    "impact": <0-100>,
    "clarity": <0-100>
  },
  "strengths": ["<specific thing the answer did well>", "<another>"],
  "improvements": ["<specific, actionable fix>", "<another>"],
  "feedback": "<2-3 sentence overall summary>"
}

Scoring rubric, compute each sub-score 0-100, then score = the WEIGHTED sum:
- structure (35%): does it follow STAR (Situation, Task, Action, Result) or otherwise tell a clear, complete story?
- impact (35%): are there concrete, quantified results and evidence of ownership?
- clarity (30%): is it concise, specific, and easy to follow (not rambling or vague)?
Band check: 90-100 excellent · 70-89 strong with minor gaps · 50-69 needs work · <50 major gaps.
Be strict and consistent: the SAME answer must always get the SAME score.

Rules:
- strengths/improvements must reference the candidate's ACTUAL words, not generic advice
- if the answer is empty or off-topic, score low and say why
- OUTPUT ONLY THE JSON OBJECT. No markdown fences.`;

  const { obj: j, raw } = await runAIJSON(env, sys,
    `Interview question:\n${String(question || '').slice(0, 800)}\n\nRole: ${String(role || 'the target role').slice(0, 120)}\n\nCandidate's answer:\n${String(answer || '').slice(0, 3000)}`,
    { model: SMART_MODEL, max_tokens: 700, temperature: 0.1 });
  if (!j) return { score: 50, feedback: raw };

  const parts = [];
  if (j.feedback) parts.push(j.feedback);
  if (j.breakdown) {
    parts.push(`\nBreakdown:`);
    parts.push(`  Structure (STAR): ${j.breakdown.structure}/100`);
    parts.push(`  Impact & results: ${j.breakdown.impact}/100`);
    parts.push(`  Clarity: ${j.breakdown.clarity}/100`);
  }
  if (j.strengths?.length) parts.push(`\nWhat's working:\n${j.strengths.map(s => `  ✓ ${s}`).join("\n")}`);
  if (j.improvements?.length) parts.push(`\nHow to improve:\n${j.improvements.map(i => `  → ${i}`).join("\n")}`);
  return { score: j.score ?? 50, feedback: parts.join("\n"), breakdown: j.breakdown || null };
}

// ============ Cover letter generator ============
async function aiCoverLetter(env, { role, company, jobDescription, tone, highlights, resume }) {
  const toneMap = {
    professional: "polished and professional",
    enthusiastic: "warm and enthusiastic, while staying professional",
    confident:    "confident and direct, leading with impact",
    warm:         "warm, personable, and genuine",
  };
  const toneDesc = toneMap[tone] || toneMap.professional;
  const name = (resume && (resume.name || (resume.personal && resume.personal.name))) || "";

  const sys = GROUNDING + "\n\n" + `You are an expert cover-letter writer. Write a complete, ready-to-send cover letter for the candidate, grounded ONLY in their real resume, never invent employers, titles, degrees, or metrics that aren't supported by the resume.

Requirements:
- Tone: ${toneDesc}.
- Length: 250-350 words, 3-4 short paragraphs.
- Structure: (1) a specific hook that connects the candidate to THIS role/company, (2) 1-2 paragraphs of evidence, concrete achievements and skills from the resume that map to the job's needs, with real numbers where the resume has them, (3) a confident closing with a call to action.
- Address it to "Dear Hiring Manager," unless a name is clearly provided.
- Sign off with "Sincerely," followed by the candidate's name${name ? ` (${name})` : ""}.
- Mirror the most important keywords and priorities from the job description naturally.
- NO placeholders or brackets like [Company] or [Your achievement], use the real details provided; if a detail is unknown, write around it gracefully.
- Plain text only. No markdown, no headings, no preamble like "Here's your cover letter". Output ONLY the letter.`;

  const userMsg = [
    `Target role: ${role || "(not specified)"}`,
    `Company: ${company || "(not specified)"}`,
    highlights ? `Candidate wants to emphasize: ${String(highlights).slice(0, 600)}` : "",
    `\nJob description:\n${(jobDescription || "(none provided, infer needs from the role title and resume)").slice(0, 3500)}`,
    `\nCandidate resume (ground everything in this):\n${JSON.stringify(resume || {}).slice(0, 6000)}`,
  ].filter(Boolean).join("\n");

  const out = await runAI(env, sys, userMsg, { model: SMART_MODEL, max_tokens: 900, temperature: 0.3 });
  const cleaned = _cleanProse(out);
  // Safety net: never hand back a placeholder-laden, refused, or empty cover letter.
  if (_brokenReason(cleaned, { minLen: 120 })) {
    throw err(502, "That didn't come out right. Please try again, it's usually a one-off.");
  }
  return { text: cleaned };
}

// ============ Letter Writer ============
// Personal professional letters that aren't cover letters: retirement, promotion
// requests, resignation, thank-you, reference requests, and more. Grounded in the
// details the user provides (and their resume for name/history if available), never
// inventing facts. Plain text, ready to send.
const LETTER_TYPES = {
  retirement: {
    label: "Retirement Letter",
    guide: "A gracious retirement announcement to an employer or manager. State the intent to retire and the intended last working day, express genuine gratitude for the years and the people, reflect briefly and warmly on the experience, and offer to help with the transition. Dignified, appreciative, forward-looking, never bitter.",
    words: "220-320",
  },
  promotion: {
    label: "Promotion Request",
    guide: "A confident, evidence-based letter asking to be considered for a promotion (or a specific higher role). Open with the ask, make the case with concrete accomplishments, added responsibilities, and measurable impact, show readiness for the next level, and close by inviting a conversation. Assertive but respectful, never entitled.",
    words: "220-320",
  },
  resignation: {
    label: "Resignation Letter",
    guide: "A short, professional two-weeks'-notice resignation. State that you are resigning and your last working day, keep the tone positive and appreciative regardless of the reason, offer to help transition, and burn no bridges. Brief and clean.",
    words: "140-220",
  },
  "thank-you": {
    label: "Thank-You Letter",
    guide: "A warm post-interview or professional thank-you note. Thank them specifically, reaffirm interest or appreciation, reference something concrete from the interaction, and close graciously. Sincere and concise.",
    words: "120-200",
  },
  reference: {
    label: "Reference Request",
    guide: "A polite letter asking someone to serve as a professional reference or write a recommendation. Remind them of your shared work, say what the reference is for, make it easy to say yes (offer to share your resume and details), and thank them warmly.",
    words: "150-230",
  },
  recommendation: {
    label: "Recommendation Letter",
    guide: "A letter recommending someone (that the author writes on another person's behalf). Establish the relationship and its length, give specific evidence of the person's strengths and impact, and give a clear, confident endorsement for the role or opportunity.",
    words: "220-320",
  },
};

async function aiLetter(env, { letterType, recipient, senderName, tone, details, resume }) {
  const spec = LETTER_TYPES[letterType] || LETTER_TYPES.retirement;
  const toneMap = {
    professional: "polished and professional",
    warm:         "warm, personable, and heartfelt",
    grateful:     "deeply grateful and gracious",
    confident:    "confident and direct",
    formal:       "formal and respectful",
  };
  const toneDesc = toneMap[tone] || toneMap.professional;
  const name = senderName ||
    (resume && (resume.name || (resume.personal && resume.personal.name))) || "";

  const sys = GROUNDING + "\n\n" +
`You are an expert letter writer. Write a complete, ready-to-send ${spec.label.toLowerCase()}.

What this letter is: ${spec.guide}

Requirements:
- Tone: ${toneDesc}.
- Length: ${spec.words} words.
- Ground every fact ONLY in the details and resume provided. NEVER invent dates, names, job titles, companies, numbers, or reasons that weren't given. If a needed detail (like a last working day) is missing, write around it gracefully rather than guessing.
- Address it to ${recipient ? `"${String(recipient).slice(0, 80)}"` : '"Dear [appropriate recipient]," using a natural, specific greeting if the recipient is clear from the details, otherwise "Dear Hiring Manager," or "To whom it may concern,"'}.
- Sign off warmly (e.g. "Sincerely," or "With gratitude,") followed by the sender's name${name ? ` (${name})` : ""}.
- NO markdown, NO headings, NO placeholders or brackets like [Company] or [Date] unless the user left that detail blank and it truly must be filled in by hand.
- Output ONLY the letter, no preamble like "Here's your letter".`;

  const userMsg = [
    `Letter type: ${spec.label}`,
    name ? `Sender's name: ${name}` : "",
    recipient ? `Recipient: ${String(recipient).slice(0, 120)}` : "",
    `\nDetails the sender provided (use these, don't invent beyond them):\n${String(details || "(none, infer a sensible, generic version from the letter type)").slice(0, 2500)}`,
    resume && Object.keys(resume || {}).length
      ? `\nSender's resume (for name, roles, and history, optional context):\n${JSON.stringify(resume).slice(0, 4000)}`
      : "",
  ].filter(Boolean).join("\n");

  const out = await runAI(env, sys, userMsg, { model: SMART_MODEL, max_tokens: 900, temperature: 0.35 });
  const cleaned = _cleanProse(out);
  // Safety net: never hand back a placeholder-laden, refused, or empty letter.
  if (_brokenReason(cleaned, { minLen: 80 })) {
    throw err(502, "That didn't come out right. Please try again, it's usually a one-off.");
  }
  return { text: cleaned };
}

// ============ Application Autopilot ============
// The flagship one-shot flow: given a job description + the user's resume, produce a
// complete application packet. Reuses the already-tuned ATS, Tailor, and Cover Letter
// analyses, run in PARALLEL, then derives an apply/stretch/skip verdict. Fail-soft:
// any sub-analysis that errors comes back null so the rest of the packet still lands.
// Cached as a unit so re-running the same job is free.
async function aiAutopilot(env, { jobDescription, resume, tone, role, company }) {
  if (!jobDescription || jobDescription.trim().length < 40) {
    throw err(400, "Paste the job description (at least a few lines) so Autopilot has something to work with.");
  }
  if (!resume || typeof resume !== "object" || !Object.keys(resume).length) {
    throw err(400, "Build or import your resume first, Autopilot tailors it to the job.");
  }
  const cacheKey = (jobDescription || "").slice(0, 4000) + "\u0000" +
    JSON.stringify(resume || {}).slice(0, 7000) + "\u0000" + (tone || "") + "\u0000" +
    (role || "") + "\u0000" + (company || "");
  const cached = await aiCacheGet(env, "autopilot", cacheKey);
  if (cached) return cached;

  const [atsR, tailorR, coverR] = await Promise.allSettled([
    aiATS(env, { jobDescription, resume }),
    aiTailor(env, { jobDescription, resume }),
    aiCoverLetter(env, { role: role || "", company: company || "", jobDescription, tone, resume }),
  ]);
  const ats    = atsR.status === "fulfilled" ? atsR.value : null;
  const tailor = tailorR.status === "fulfilled" ? tailorR.value : null;
  const cover  = coverR.status === "fulfilled" ? coverR.value : null;

  // Verdict from the ATS score: strong fit / worth a shot / long shot.
  const score = ats && typeof ats.score === "number" ? ats.score : null;
  let verdict = "stretch", label = "Worth a shot";
  if (score != null) {
    if (score >= 75)      { verdict = "apply";   label = "Strong fit, apply"; }
    else if (score >= 55) { verdict = "stretch"; label = "Worth a shot, a few gaps to close"; }
    else                  { verdict = "skip";    label = "Long shot, only if you can close the gaps"; }
  }

  const dedupe = (arr) => [...new Set((arr || []).filter(k => typeof k === "string" && k.trim()))];
  const missingKeywords = dedupe([...(ats && ats.missingKeywords || []), ...(tailor && tailor.missingKeywords || [])]).slice(0, 12);

  const out = {
    fit: { score, verdict, label },
    ats: ats ? { score: ats.score, breakdown: ats.breakdown, feedback: ats.feedback, wins: ats.wins || [], issues: ats.issues || [] } : null,
    tailor: tailor ? {
      summary: tailor.summary || null,
      matchedKeywords: tailor.matchedKeywords || [],
      emphasize: tailor.emphasize || [],
      bulletSuggestions: tailor.bulletSuggestions || [],
    } : null,
    missingKeywords,
    coverLetter: cover ? cover.text : null,
    failed: { ats: atsR.status === "rejected", tailor: tailorR.status === "rejected", cover: coverR.status === "rejected" },
  };
  // Only cache when at least one analysis succeeded (don't lock in a total failure).
  if (ats || tailor || cover) await aiCachePut(env, "autopilot", cacheKey, out, 86400);
  return out;
}

// ============ Trustpilot review emails ============
// TRUSTPILOT_URL should be set to your Trustpilot review page once created,
// e.g. https://www.trustpilot.com/evaluate/appliohq.com
// Falls back to a placeholder so the email still works before you have a profile.

function _trustpilotUrl(env) {
  return env.TRUSTPILOT_URL || "https://www.trustpilot.com/evaluate/appliohq.com";
}

// Shared unsubscribe token for review emails (separate category from win-nudge).
async function reviewUnsubToken(env, email) {
  return (await hmacHex(env.JWT_SECRET || "x", "reviewunsub:" + email.toLowerCase())).slice(0, 32);
}

// Two flavours: "win" (just logged an interview/offer) and "download" (7 days after first download).
async function sendReviewEmail(env, email, flavour) {
  const from = env.MAIL_FROM || "Applio <hello@appliohq.com>";
  const tp = _trustpilotUrl(env);
  const unsubToken = await reviewUnsubToken(env, email);
  const unsub = `https://hireflow-api.pritamavuthu7.workers.dev/unsubscribe?e=${encodeURIComponent(email)}&t=${unsubToken}&c=marketing`;
  const addr = env.MAILING_ADDRESS || "";

  let subject, html;

  if (flavour === "win") {
    subject = "Congrats on the interview. One quick favor?";
    html = `<!doctype html><html><body style="margin:0;padding:0;background:#f4f5f8;">
<div style="font:16px/1.65 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:36px 26px;color:#20242e;background:#ffffff;">
  <div style="font-weight:800;font-size:20px;color:#4f46e5;letter-spacing:-.3px;margin-bottom:26px;">Applio</div>

  <p style="font-size:21px;font-weight:700;color:#0f172a;line-height:1.35;margin:0 0 16px;">You landed an interview. That's the hard part.</p>

  <p style="margin:0 0 16px;color:#3a4150;">Getting that call is genuinely hard. A lot of people send dozens of applications without hearing back, so this is a real thing worth being proud of.</p>

  <p style="margin:0 0 16px;color:#3a4150;">If Applio played any part in getting you there, it would mean a lot if you left a quick review on Trustpilot. It takes about a minute, and it helps other job seekers find us.</p>

  <p style="margin:0 0 28px;"><a href="${tp}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 24px;border-radius:8px;">Leave a review &rarr;</a></p>

  <p style="margin:0 0 16px;color:#3a4150;">And good luck with the next step. We're rooting for you.</p>

  <p style="margin:24px 0 0;color:#3a4150;">Pritam<br><span style="color:#9aa0ad;font-size:14px;">Founder, Applio</span></p>

  <hr style="border:0;border-top:1px solid #e9ebf1;margin:30px 0 14px;">
  <p style="color:#9aa0ad;font-size:12px;line-height:1.6;margin:0;">You're getting this because you logged an interview win on Applio. <a href="${unsub}" style="color:#9aa0ad;">Unsubscribe anytime</a>.${addr ? "<br>" + addr : ""}</p>
</div></body></html>`;

  } else {
    // "download" flavour: 7 days after first resume download
    subject = "How is the job search going?";
    html = `<!doctype html><html><body style="margin:0;padding:0;background:#f4f5f8;">
<div style="font:16px/1.65 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:36px 26px;color:#20242e;background:#ffffff;">
  <div style="font-weight:800;font-size:20px;color:#4f46e5;letter-spacing:-.3px;margin-bottom:26px;">Applio</div>

  <p style="font-size:21px;font-weight:700;color:#0f172a;line-height:1.35;margin:0 0 16px;">Your resume has been out there for a week.</p>

  <p style="margin:0 0 16px;color:#3a4150;">We hope it's doing its job. If you've sent it out and heard back (or even if you haven't yet), we'd love to know how it's going.</p>

  <p style="margin:0 0 16px;color:#3a4150;">If you have a spare minute, a Trustpilot review helps other job seekers find Applio. Honest ones are the best kind.</p>

  <p style="margin:0 0 28px;"><a href="${tp}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 24px;border-radius:8px;">Share your experience &rarr;</a></p>

  <p style="margin:0 0 16px;color:#3a4150;">Either way, good luck out there. If you want to tweak anything on your resume before your next application, your draft is saved and ready.</p>

  <p style="margin:24px 0 0;color:#3a4150;">Pritam<br><span style="color:#9aa0ad;font-size:14px;">Founder, Applio</span></p>

  <hr style="border:0;border-top:1px solid #e9ebf1;margin:30px 0 14px;">
  <p style="color:#9aa0ad;font-size:12px;line-height:1.6;margin:0;">You're getting this because you downloaded a resume from Applio. <a href="${unsub}" style="color:#9aa0ad;">Unsubscribe anytime</a>.${addr ? "<br>" + addr : ""}</p>
</div></body></html>`;
  }

  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [email], subject, html }),
    });
    if (r.ok) return { ok: true };
    let detail = "";
    try { const j = await r.json(); detail = j.message || j.error || JSON.stringify(j); } catch { detail = `HTTP ${r.status}`; }
    return { ok: false, error: detail };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}

// Cron-driven: scan users who downloaded 7 days ago and haven't been nudged yet.
const REVIEW_NUDGE_MAX_SENDS = 100;
const REVIEW_NUDGE_SCAN_CAP = 3000;
const REVIEW_NUDGE_DELAY_MS = 7 * 86400 * 1000;

async function runPostDownloadReviewNudge(env) {
  if (!env.RESEND_API_KEY) return { ok: false, reason: "email not configured" };
  const now = Date.now();
  let cursor, scanned = 0, sent = 0;
  do {
    const list = await env.HIREFLOW_KV.list({ prefix: "user:", cursor, limit: 1000 });
    cursor = list.list_complete ? null : list.cursor;
    for (const k of list.keys) {
      if (scanned >= REVIEW_NUDGE_SCAN_CAP || sent >= REVIEW_NUDGE_MAX_SENDS) { cursor = null; break; }
      scanned++;
      const email = k.name.slice("user:".length);
      if (!email || !email.includes("@")) continue;
      // Only once per user ever
      if (await env.HIREFLOW_KV.get(`review_dl_sent:${email}`)) continue;
      // Consent gate
      try {
        const cdoc = JSON.parse(await env.HIREFLOW_KV.get(`consent:${email}`) || "null");
        if (cdoc && cdoc.marketing && cdoc.marketing.status === false) continue;
      } catch {}
      let user;
      try { user = JSON.parse(await env.HIREFLOW_KV.get(k.name) || "null"); } catch { continue; }
      if (!user || !user.downloadsUsed || user.downloadsUsed < 1) continue;
      // firstDownloadAt not always set; fall back to createdAt as a loose proxy
      const firstDl = user.firstDownloadAt || null;
      if (!firstDl) continue;
      if (now - firstDl < REVIEW_NUDGE_DELAY_MS) continue;     // too soon
      if (now - firstDl > REVIEW_NUDGE_DELAY_MS * 6) continue; // too old, skip stale accounts
      const res = await sendReviewEmail(env, email, "download");
      if (res.ok) {
        sent++;
        await env.HIREFLOW_KV.put(`review_dl_sent:${email}`, "1");
      }
    }
  } while (cursor);
  return { ok: true, scanned, sent };
}

// ============ Google Drive / Docs export ============
// Three-step flow:
//   1. gdriveStart  → returns Google OAuth URL; frontend opens it in a popup
//   2. gdriveCallback → exchanges code for tokens, stores refresh_token on user, closes popup
//   3. exportToGdoc → uses stored refresh_token to create a formatted Google Doc

const GDRIVE_REDIRECT = "https://hireflow-api.pritamavuthu7.workers.dev/auth/gdrive/callback";
const GDRIVE_SCOPES   = "https://www.googleapis.com/auth/drive.file";

async function _gdriveAccessToken(env, user) {
  if (!user.driveRefreshToken) throw err(400, "Google Drive not connected. Please reconnect.");
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     env.GOOGLE_DOCS_CLIENT_ID,
      client_secret: env.GOOGLE_DOCS_CLIENT_SECRET,
      refresh_token: user.driveRefreshToken,
      grant_type:    "refresh_token",
    }).toString(),
  });
  const data = await resp.json();
  if (!resp.ok || !data.access_token) throw err(502, "Failed to refresh Google token. Please reconnect.");
  return data.access_token;
}

async function gdriveStart(req, env) {
  const payload = await authenticate(req, env);
  // Encode the user's JWT as state so the callback can identify who is connecting.
  const state = btoa(JSON.stringify({ email: payload.email }));
  const params = new URLSearchParams({
    client_id:     env.GOOGLE_DOCS_CLIENT_ID,
    redirect_uri:  GDRIVE_REDIRECT,
    response_type: "code",
    scope:         GDRIVE_SCOPES,
    access_type:   "offline",
    prompt:        "consent",
    state,
  });
  return { authUrl: "https://accounts.google.com/o/oauth2/v2/auth?" + params.toString() };
}

async function gdriveCallback(req, url, env) {
  const code  = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const closePopup = (msg, isError) => new Response(
    `<html><head><title>Connecting…</title></head><body>
    <script>
      if(window.opener){window.opener.postMessage({type:${isError ? "'gdrive_error'" : "'gdrive_connected'"},${isError ? `error:${JSON.stringify(msg)}` : `msg:${JSON.stringify(msg)}`}},'*');setTimeout(()=>window.close(),500);}
      else{document.body.innerHTML='<p>${isError ? "Error: " + msg : msg}</p><p>You can close this tab.</p>';}
    </script>
    <p>${isError ? "Error: " + msg + " — you can close this tab." : msg}</p>
    </body></html>`,
    { status: 200, headers: { "Content-Type": "text/html" } }
  );

  if (error) return closePopup(error, true);
  if (!code || !state) return closePopup("Missing code or state", true);

  let email;
  try { email = JSON.parse(atob(state)).email; } catch { return closePopup("Invalid state", true); }
  if (!email) return closePopup("Invalid state", true);

  // Exchange authorization code for tokens
  const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id:     env.GOOGLE_DOCS_CLIENT_ID,
      client_secret: env.GOOGLE_DOCS_CLIENT_SECRET,
      redirect_uri:  GDRIVE_REDIRECT,
      grant_type:    "authorization_code",
    }).toString(),
  });
  const tokens = await tokenResp.json();
  if (!tokenResp.ok || !tokens.refresh_token) return closePopup("Token exchange failed: " + (tokens.error_description || tokens.error || "no refresh token"), true);

  const user = await getUser(env, email);
  if (!user) return closePopup("User not found", true);
  user.driveRefreshToken = tokens.refresh_token;
  await putUser(env, user);

  return closePopup("Google Drive connected!", false);
}

async function exportToGdoc(req, env) {
  const user = await authUser(req, env);
  const { resume } = await req.json();
  if (!resume) throw err(400, "Missing resume data");

  const accessToken = await _gdriveAccessToken(env, user);
  const p = resume.personal || {};
  const docTitle = (p.fullName ? p.fullName + " — Resume" : "Resume") + " (via Applio)";

  // Create an empty document
  const createResp = await fetch("https://docs.googleapis.com/v1/documents", {
    method: "POST",
    headers: { "Authorization": "Bearer " + accessToken, "Content-Type": "application/json" },
    body: JSON.stringify({ title: docTitle }),
  });
  if (!createResp.ok) throw err(502, "Failed to create Google Doc");
  const doc = await createResp.json();
  const docId = doc.documentId;

  // Build batchUpdate requests to populate the document
  const requests = _buildDocRequests(resume);

  if (requests.length > 0) {
    const updateResp = await fetch(`https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`, {
      method: "POST",
      headers: { "Authorization": "Bearer " + accessToken, "Content-Type": "application/json" },
      body: JSON.stringify({ requests }),
    });
    if (!updateResp.ok) {
      const e2 = await updateResp.text();
      throw err(502, "Failed to populate Google Doc: " + e2.slice(0, 200));
    }
  }

  return { docUrl: `https://docs.google.com/document/d/${docId}/edit`, docId };
}

// Build Google Docs API batchUpdate requests from resume JSON.
// Inserts content then styles headings — index 1 is always the document start.
function _buildDocRequests(resume) {
  const p = resume.personal || {};
  const exp = Array.isArray(resume.experience) ? resume.experience : [];
  const edu = Array.isArray(resume.education)  ? resume.education  : [];
  const skills = resume.skills && Array.isArray(resume.skills.categories) ? resume.skills.categories : [];
  const proj = Array.isArray(resume.projects) ? resume.projects : [];

  // We build the text content as segments, then insert in reverse order
  // (Docs API inserts at index so we go end-to-start to avoid re-indexing).
  // Simpler: insert the whole block as one text, then apply styles.
  const lines = [];

  const add = (text) => lines.push(text);

  add((p.fullName || "Your Name") + "\n");
  const contact = [p.email, p.phone, p.location, p.linkedin].filter(Boolean).join(" | ");
  if (contact) add(contact + "\n");
  add("\n");

  if (p.summary) { add("SUMMARY\n"); add(p.summary + "\n"); add("\n"); }

  if (exp.length) {
    add("EXPERIENCE\n");
    for (const e of exp) {
      const header = [e.title, e.company, e.location, [e.start, e.end].filter(Boolean).join(" – ")].filter(Boolean).join(" | ");
      add(header + "\n");
      if (e.description) add(e.description.replace(/^•\s*/gm, "• ") + "\n");
      add("\n");
    }
  }

  if (edu.length) {
    add("EDUCATION\n");
    for (const e of edu) {
      add([e.school, e.degree + (e.field ? " in " + e.field : ""), e.gpa ? "GPA " + e.gpa : "", [e.start, e.end].filter(Boolean).join(" – ")].filter(Boolean).join(" | ") + "\n");
    }
    add("\n");
  }

  const allSkills = skills.flatMap(c => c.items || []).join(", ");
  if (allSkills) { add("SKILLS\n"); add(allSkills + "\n"); add("\n"); }

  if (proj.length) {
    add("PROJECTS\n");
    for (const pr of proj) {
      add((pr.name || "") + (pr.tech ? " (" + pr.tech + ")" : "") + "\n");
      if (pr.description) add(pr.description + "\n");
      add("\n");
    }
  }

  const fullText = lines.join("");

  const requests = [
    // Insert the full text at position 1 (after empty paragraph)
    { insertText: { location: { index: 1 }, text: fullText } },
  ];

  // Style the name (first line) as Heading 1
  const nameEnd = (p.fullName || "Your Name").length + 1;
  requests.push({
    updateParagraphStyle: {
      range: { startIndex: 1, endIndex: nameEnd },
      paragraphStyle: { namedStyleType: "HEADING_1" },
      fields: "namedStyleType",
    }
  });

  // Style section headings (SUMMARY, EXPERIENCE, etc.)
  const sectionHeadings = ["SUMMARY", "EXPERIENCE", "EDUCATION", "SKILLS", "PROJECTS"];
  let searchFrom = nameEnd;
  for (const heading of sectionHeadings) {
    const idx = fullText.indexOf(heading + "\n", searchFrom - 1);
    if (idx < 0) continue;
    const startIndex = idx + 1; // +1 because doc content starts at index 1
    const endIndex = startIndex + heading.length + 1;
    requests.push({
      updateParagraphStyle: {
        range: { startIndex, endIndex },
        paragraphStyle: { namedStyleType: "HEADING_2" },
        fields: "namedStyleType",
      }
    });
    searchFrom = endIndex;
  }

  return requests;
}

// Robustly pull a JSON value out of a model reply. Handles: clean JSON, ```json
// fences, prose wrappers, arrays as well as objects, and trailing-comma / truncation
// damage. Returns null only if nothing salvageable parses.
function safeJSON(s) {
  if (typeof s !== "string" || !s.trim()) return null;
  let t = s.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);   // strip a code fence if present
  if (fence) t = fence[1].trim();
  try { return JSON.parse(t); } catch {}
  // Locate the first JSON value (object or array) and depth-scan to its match.
  const oi = t.indexOf("{"), ai = t.indexOf("[");
  const start = oi < 0 ? ai : (ai < 0 ? oi : Math.min(oi, ai));
  if (start < 0) return null;
  const open = t[start], close = open === "{" ? "}" : "]";
  let depth = 0, inStr = false, esc = false, end = -1;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) { end = i; break; } }
  }
  const cand = end > start ? t.slice(start, end + 1) : t.slice(start);   // truncated → keep the rest
  const tryParse = (x) => { try { return JSON.parse(x); } catch { return undefined; } };
  let v = tryParse(cand);
  if (v !== undefined) return v;
  v = tryParse(cand.replace(/,\s*([}\]])/g, "$1"));                       // repair trailing commas
  if (v !== undefined) return v;
  return null;
}