/**
 * Two-axis rate limiting backed by DynamoDB atomic counters + TTL.
 *
 * Ported from medical-llm/lib/rate-limit.ts. This is the load-bearing defence
 * for the public proxy: without it we'd have swapped "exposed API key" for
 * "open Gemini proxy", abusable in exactly the same way.
 *
 * - Per-IP: floods at the network level.
 * - Per-device id: catches IP-rotation abuse where one actor cycles exits but
 *   keeps the same browser (device ids are clearable, so this tier is tighter).
 *
 * Fail-open: if DynamoDB throws (throttling, IAM blip) we let the request
 * through and flag `degraded`. Per-call input caps + maxOutputTokens in the
 * handler still bound worst-case cost during a degraded window.
 */

import { createHash } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const REGION = process.env.AWS_REGION ?? 'ap-southeast-2';
const TABLE = process.env.DDB_TABLE_NAME ?? 'website-chat-ratelimit';

const toLimit = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const PER_IP_MINUTE_LIMIT = toLimit(process.env.PER_IP_MINUTE_LIMIT, 20);
const PER_IP_DAY_LIMIT = toLimit(process.env.PER_IP_DAY_LIMIT, 1000);
const PER_DEVICE_MINUTE_LIMIT = toLimit(process.env.PER_DEVICE_MINUTE_LIMIT, 20);
const PER_DEVICE_DAY_LIMIT = toLimit(process.env.PER_DEVICE_DAY_LIMIT, 300);

const MINUTE_TTL_SECONDS = 120;
const DAY_TTL_SECONDS = 90_000;

// Reuse a single DocumentClient — the underlying http handler pools connections
// across invocations within a warm Lambda container.
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
  marshallOptions: { removeUndefinedValues: true },
});

/** Hash the client IP so we never store raw addresses. */
export function hashIp(ip) {
  return createHash('sha256').update(String(ip)).digest('hex').slice(0, 32);
}

/**
 * Atomically increment a counter row and return its new value. Returns null if
 * DynamoDB is unavailable (caller treats that as fail-open).
 */
async function incrementCounter(pk, ttlSeconds) {
  const ttl = Math.floor(Date.now() / 1000) + ttlSeconds;
  try {
    const res = await ddb.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { pk },
        // ADD is atomic — increments and reads in one round trip. if_not_exists
        // on ttl prevents extending an existing window's expiry on each call.
        UpdateExpression: 'ADD #c :inc SET #t = if_not_exists(#t, :ttl)',
        ExpressionAttributeNames: { '#c': 'count', '#t': 'ttl' },
        ExpressionAttributeValues: { ':inc': 1, ':ttl': ttl },
        ReturnValues: 'UPDATED_NEW',
      })
    );
    const updated = res.Attributes?.count;
    return typeof updated === 'number' ? updated : 0;
  } catch {
    return null;
  }
}

/**
 * Increments per-IP and per-device counters and returns the first tier that
 * exceeded its limit, if any. The current request is counted regardless of
 * outcome (failed requests still consume budget — scanning isn't free).
 *
 * Buckets are keyed on epoch minute / epoch day (UTC). Bucket boundaries only
 * need to be consistent for abuse limiting, not aligned to a wall-clock day.
 */
export async function checkRateLimit(ipHash, deviceId) {
  const epochMinute = Math.floor(Date.now() / 60_000);
  const epochDay = Math.floor(Date.now() / 86_400_000);

  const ipMinuteKey = `rl#${ipHash}#min#${epochMinute}`;
  const ipDayKey = `rl#${ipHash}#day#${epochDay}`;
  const devMinuteKey = `rl#dev#${deviceId}#min#${epochMinute}`;
  const devDayKey = `rl#dev#${deviceId}#day#${epochDay}`;

  let degraded = false;

  const ipMinute = await incrementCounter(ipMinuteKey, MINUTE_TTL_SECONDS);
  if (ipMinute === null) degraded = true;
  else if (ipMinute > PER_IP_MINUTE_LIMIT) {
    return { allowed: false, tier: 'ip_minute', count: ipMinute, limit: PER_IP_MINUTE_LIMIT };
  }

  const ipDay = await incrementCounter(ipDayKey, DAY_TTL_SECONDS);
  if (ipDay === null) degraded = true;
  else if (ipDay > PER_IP_DAY_LIMIT) {
    return { allowed: false, tier: 'ip_day', count: ipDay, limit: PER_IP_DAY_LIMIT };
  }

  const devMinute = await incrementCounter(devMinuteKey, MINUTE_TTL_SECONDS);
  if (devMinute === null) degraded = true;
  else if (devMinute > PER_DEVICE_MINUTE_LIMIT) {
    return { allowed: false, tier: 'device_minute', count: devMinute, limit: PER_DEVICE_MINUTE_LIMIT };
  }

  const devDay = await incrementCounter(devDayKey, DAY_TTL_SECONDS);
  if (devDay === null) degraded = true;
  else if (devDay > PER_DEVICE_DAY_LIMIT) {
    return { allowed: false, tier: 'device_day', count: devDay, limit: PER_DEVICE_DAY_LIMIT };
  }

  return degraded ? { allowed: true, degraded: true } : { allowed: true };
}
