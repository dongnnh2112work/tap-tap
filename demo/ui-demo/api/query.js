'use strict';

/**
 * Customer-only lexical RAG for the ui-demo.
 * Ports the customer path of query.py: BM25 + character-trigram retrieve
 * and extractive answers with citations. Hardcoded audience=public.
 * No LLM, embeddings, vector DB, env vars, or API keys.
 */

const fs = require('fs');
const path = require('path');

const CORPUS_PATH = path.join(__dirname, 'public-chunks-only.jsonl');
const UNKNOWN = 'Không có thông tin này trong tài liệu dành cho khách.';
const PUBLIC_SLUGS = new Set([
  'voi',
  'ho',
  'capybara',
  'ca-sau',
  'cong',
  'gau-cho',
  'gau-meo',
  'gia-day',
  'ha-ma-lun',
  'hong-hac',
  'huou-cao-co',
  'meerkat',
  'meo-mika',
  'ngua-lun',
  'rua-sulcata',
  'te-giac',
  'thien-nga',
  'vuon-ma-vang'
]);
const SLUG_ALIASES = {
  'te-giac-trang': 'te-giac',
  'ho-vang': 'ho',
  'thien-nga-duong-hao': 'thien-nga',
  'co-gia-day-java': 'gia-day'
};

const STOP = new Set(
  'la gi o va cua co cho nhu the nao nhung mot cac duoc tai ve theo nay thi khi khong anh em ban hay bao nhieu ten de den se toi minh tu do choi thong tin tap tcv so thu thao cam vien'.split(
    ' '
  )
);
const SENSITIVE =
  /nomion|phygital|\bmst\b|\bdoi thu\b|\bcompetitor\b|\bchien luoc\b|\bchi phi\b|\bgia von\b|\bbang gia\b|\bngan sach\b|\bremake\b|\b031\d{7}\b|\bnoi bo\b|\bbusiness\b|\bcost\b/;

function norm(s) {
  s = String(s)
    .toLowerCase()
    .replace(/đ/g, 'd')
    .normalize('NFKD');
  let out = '';
  for (const ch of s) {
    if (ch.charCodeAt(0) >= 0x300 && ch.charCodeAt(0) <= 0x36f) continue;
    if (/\p{M}/u.test(ch)) continue;
    out += ch;
  }
  return out.replace(/[^a-z0-9]+/g, ' ').trim();
}

function blocked(text) {
  const n = norm(text);
  const compact = n.replace(/ /g, '');
  return Boolean(SENSITIVE.test(n) || compact.includes('nomion') || compact.includes('phygitallabs'));
}

function tokens(text) {
  return norm(text)
    .split(' ')
    .filter((w) => w && !STOP.has(w) && w.length > 1);
}

function grams(s) {
  s = norm(s);
  const set = new Set();
  for (let i = 0; i < s.length - 2; i += 1) set.add(s.slice(i, i + 3));
  return set;
}

function counterFrom(arr) {
  const c = new Map();
  for (const t of arr) c.set(t, (c.get(t) || 0) + 1);
  return c;
}

function mapSum(m) {
  let n = 0;
  for (const v of m.values()) n += v;
  return n;
}

function canonicalizeStation(station) {
  if (!station || typeof station !== 'string') return null;
  const slug = station.toLowerCase().trim();
  const mapped = SLUG_ALIASES[slug] || slug;
  return PUBLIC_SLUGS.has(mapped) ? mapped : null;
}

function loadChunks() {
  let raw;
  try {
    raw = fs.readFileSync(CORPUS_PATH, 'utf8');
  } catch (_) {
    const fallback = path.join(process.cwd(), 'api', 'public-chunks-only.jsonl');
    raw = fs.readFileSync(fallback, 'utf8');
  }
  const chunks = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const c = JSON.parse(line);
    if (!c || c.audience !== 'public') continue;
    if (blocked(`${c.text || ''} ${c.title || ''}`)) continue;
    chunks.push(c);
  }
  return chunks;
}

let CACHED_CHUNKS = null;
function getChunks() {
  if (!CACHED_CHUNKS) CACHED_CHUNKS = loadChunks();
  return CACHED_CHUNKS;
}

function retrieve(question, station, k) {
  const pool = getChunks();
  const docs = pool.map((c) => counterFrom(tokens(`${c.title} ${c.text}`)));
  let nq = norm(question);
  const howto =
    nq.includes('choi') &&
    (nq.includes('nhu the nao') || nq.includes('cach') || nq.includes('huong dan'));
  const searchQuestion = howto ? `${question} NFC đăng nhập Google quiz bộ sưu tập` : question;
  const qt = counterFrom(tokens(searchQuestion));
  if (qt.size === 0) return [];

  const df = new Map();
  for (const d of docs) {
    for (const t of d.keys()) df.set(t, (df.get(t) || 0) + 1);
  }
  const avg = docs.reduce((acc, d) => acc + mapSum(d), 0) / Math.max(docs.length, 1);
  nq = norm(question);

  const scored = [];
  for (let i = 0; i < pool.length; i += 1) {
    const c = pool[i];
    const d = docs[i];
    if (howto && c.type !== 'rules') continue;

    const length = mapSum(d);
    let score = 0;
    const matched = [];
    for (const t of qt.keys()) {
      if (d.has(t)) matched.push(t);
    }
    for (const t of matched) {
      const dft = df.get(t) || 0;
      const idf = Math.log(1 + (docs.length - dft + 0.5) / (dft + 0.5));
      const tf = d.get(t);
      score += (idf * tf * 2.5) / (tf + 1.5 * (0.25 + (0.75 * length) / Math.max(avg, 1)));
    }

    const qg = grams(question);
    const cg = grams(`${c.title} ${c.text}`);
    let inter = 0;
    for (const g of qg) if (cg.has(g)) inter += 1;
    const union = qg.size + cg.size - inter;
    score += (0.8 * inter) / Math.max(union, 1);

    if (c.station && c.type === 'station') score *= 1.25;
    if (station && c.station === station) score *= 1.65;
    if (howto && String(c.title).includes('Flow A')) score += 10;
    if (nq.includes('la ai') && norm(c.title).includes('la ai')) score += 8;
    if (c.metadata && c.metadata.catalog_only) score *= 0.35;
    if (c.metadata && c.metadata.legacy) score *= 0.45;
    if (nq.includes('bi mat') || nq.includes('secret') || nq.includes('easter')) {
      if (norm(c.text).includes('bi mat')) score += 6;
    }
    if ((nq.includes('cach') || nq.includes('nhu the nao')) && nq.includes('choi') && c.type === 'rules') {
      score += 5;
    }

    const coverage = matched.length / Math.max(qt.size, 1);
    const rareSingle =
      qt.size === 1 &&
      matched.length > 0 &&
      matched.every((t) => (df.get(t) || 0) <= docs.length * 0.1);
    if ((matched.length >= 2 || rareSingle) && coverage >= 0.35 && score >= 2) {
      scored.push({ score, coverage, chunk: c });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k).map(({ score, coverage, chunk }) => ({
    score: Math.round(score * 1000) / 1000,
    coverage: Math.round(coverage * 1000) / 1000,
    ...chunk
  }));
}

function ask(question, station) {
  const mode = 'customer';
  if (typeof question !== 'string' || !question.trim() || question.length > 2000) {
    const err = new Error('Question must be 1–2000 characters');
    err.statusCode = 400;
    throw err;
  }
  if (blocked(question)) {
    return {
      mode,
      answer: UNKNOWN,
      citations: [],
      status: 'restricted_or_unknown'
    };
  }

  const hits = retrieve(question, station, 5);
  if (!hits.length) {
    return { mode, answer: UNKNOWN, citations: [], status: 'unknown' };
  }

  // Extract source text only. Keep up to two close excerpts so public
  // disagreements (e.g. Chuông 66 vs 66–67) are both shown, not reconciled.
  const selected = [];
  for (const c of hits) {
    if (c.score < hits[0].score * 0.55) continue;
    if (selected.length >= 2) break;
    if (c.score < hits[0].score * 0.8) continue;
    if (selected.some((s) => s.text === c.text)) continue;
    selected.push(c);
  }

  const answer = [];
  const citations = [];
  selected.forEach((c, idx) => {
    const i = idx + 1;
    answer.push(`${c.text} [${i}]`);
    const meta = c.metadata || {};
    citations.push({
      number: i,
      id: c.id,
      source: publicBasename(c.source),
      title: c.title,
      urls: meta.urls || [],
      pointer: meta.json_pointer,
      evidence_note: meta.evidence_note
    });
  });

  const result = {
    mode,
    answer: answer.join('\n\n'),
    citations,
    status: 'ok'
  };
  if (blocked(result.answer)) {
    return {
      mode,
      answer: UNKNOWN,
      citations: [],
      status: 'restricted_or_unknown'
    };
  }
  return result;
}

function publicBasename(filePath) {
  if (filePath == null || filePath === '') return filePath == null ? '' : String(filePath);
  return path.posix.basename(String(filePath).replace(/\\/g, '/'));
}

function scrubWorkspaceInString(s) {
  return String(s)
    .replace(/\/workspace\/[^\s"'\\]*/g, (p) => {
      const base = path.posix.basename(p);
      return !base || base === 'workspace' ? '' : base;
    })
    .replace(/\/workspace\b/g, '');
}

function sanitizePublic(value, key) {
  if (value == null) return value;
  if (typeof value === 'string') {
    if (key === 'source') return publicBasename(value);
    return scrubWorkspaceInString(value);
  }
  if (Array.isArray(value)) return value.map((item) => sanitizePublic(item));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === 'retrieved') continue;
      out[k] = sanitizePublic(v, k);
    }
    return out;
  }
  return value;
}

function publicHttpPayload(result) {
  const payload = sanitizePublic({
    mode: result && result.mode,
    answer: result && result.answer,
    citations: result && result.citations ? result.citations : [],
    status: result && result.status,
    ...(result && result.error ? { error: result.error } : {})
  });
  delete payload.retrieved;
  let json = JSON.stringify(payload);
  if (json.includes('/workspace') || /"retrieved"\s*:/.test(json)) {
    json = json
      .replace(/\/workspace\/[^\s"'\\]*/g, (p) => path.posix.basename(p))
      .replace(/\/workspace\b/g, '');
    const parsed = JSON.parse(json);
    delete parsed.retrieved;
    json = JSON.stringify(parsed);
    if (json.includes('/workspace') || /"retrieved"\s*:/.test(json)) {
      return { answer: UNKNOWN, citations: [], status: 'error' };
    }
    return parsed;
  }
  return payload;
}

function jsonRes(res, status, obj) {
  const payload = publicHttpPayload(obj);
  const body = JSON.stringify(payload);
  if (body.includes('/workspace') || /"retrieved"\s*:/.test(body)) {
    const safe = JSON.stringify({ answer: UNKNOWN, citations: [], status: 'error' });
    if (typeof res.status === 'function' && typeof res.json === 'function') {
      return res.status(status).json(JSON.parse(safe));
    }
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(safe);
    return;
  }
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    return res.status(status).json(payload);
  }
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(body);
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function readJsonBody(req) {
  if (Object.prototype.hasOwnProperty.call(req, 'body') && req.body != null) {
    if (typeof req.body === 'string') {
      try {
        return JSON.parse(req.body || '{}');
      } catch (_) {
        return null;
      }
    }
    return req.body;
  }
  const raw = await new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 20000) {
        req.destroy();
        reject(new Error('Body too large'));
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

async function handler(req, res) {
  setCors(res);
  const method = req.method || 'GET';
  if (method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (method !== 'POST') {
    jsonRes(res, 405, { answer: UNKNOWN, citations: [], status: 'error', error: 'POST only' });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (_) {
    jsonRes(res, 400, { answer: UNKNOWN, citations: [], status: 'error', error: 'Invalid JSON' });
    return;
  }
  if (!body || typeof body !== 'object') {
    jsonRes(res, 400, { answer: UNKNOWN, citations: [], status: 'error', error: 'Invalid JSON' });
    return;
  }

  try {
    const station = canonicalizeStation(body.station);
    const result = ask(body.question, station);
    jsonRes(res, 200, result);
  } catch (err) {
    const code = err && err.statusCode ? err.statusCode : 500;
    jsonRes(res, code, {
      answer: UNKNOWN,
      citations: [],
      status: 'error',
      error: code === 400 ? err.message : 'Query failed'
    });
  }
}

handler.ask = ask;
handler.blocked = blocked;
handler.canonicalizeStation = canonicalizeStation;
handler.getChunks = getChunks;
handler.publicHttpPayload = publicHttpPayload;
handler.UNKNOWN = UNKNOWN;

module.exports = handler;
