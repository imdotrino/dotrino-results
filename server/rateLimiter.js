'use strict';

// Rate limiting por IP, en memoria, token bucket (best-effort; igual al de geo).
// Dos clases: read (GET /official, las apps pueden pollear seguido) y write
// (POST /admin/result, caro: verifica firma). Defaults generosos, configurables.

const READ_PER_MIN = Number(process.env.RESULTS_RL_READ_PER_MIN || 1200);  // 20/s sostenido
const WRITE_PER_MIN = Number(process.env.RESULTS_RL_WRITE_PER_MIN || 60);  // 1/s sostenido
const DISABLED = process.env.RESULTS_RL_DISABLED === '1';
const TRUST_PROXY = process.env.RESULTS_TRUST_PROXY !== '0';

const CLASSES = {
    read:  { capacity: READ_PER_MIN,  refillPerSec: READ_PER_MIN / 60 },
    write: { capacity: WRITE_PER_MIN, refillPerSec: WRITE_PER_MIN / 60 },
};

const buckets = new Map();

function clientIp(req) {
    if (TRUST_PROXY) {
        const xff = req.headers['x-forwarded-for'];
        if (xff && typeof xff === 'string') {
            const first = xff.split(',')[0].trim();
            if (first) return first;
        }
    }
    return (req.socket && req.socket.remoteAddress) || 'unknown';
}

function take(cls, ip, now) {
    if (DISABLED) return { allowed: true, retryAfter: 0 };
    const conf = CLASSES[cls];
    if (!conf) return { allowed: true, retryAfter: 0 };
    const key = cls + ':' + ip;
    let b = buckets.get(key);
    if (!b) { b = { tokens: conf.capacity, last: now }; buckets.set(key, b); }
    const elapsed = Math.max(0, (now - b.last) / 1000);
    b.tokens = Math.min(conf.capacity, b.tokens + elapsed * conf.refillPerSec);
    b.last = now;
    if (b.tokens >= 1) { b.tokens -= 1; return { allowed: true, retryAfter: 0 }; }
    return { allowed: false, retryAfter: Math.ceil((1 - b.tokens) / conf.refillPerSec) };
}

function prune(now, idleMs = 10 * 60 * 1000) {
    for (const [key, b] of buckets) {
        const cls = key.slice(0, key.indexOf(':'));
        const conf = CLASSES[cls];
        if (conf && b.tokens >= conf.capacity && (now - b.last) > idleMs) buckets.delete(key);
    }
}

module.exports = { clientIp, take, prune, CLASSES };
