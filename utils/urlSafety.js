const dns = require("node:dns");
const dnsPromises = dns.promises;
const net = require("node:net");

function isPrivateServiceUrlAllowed() {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.ALLOW_PRIVATE_SERVICE_URLS === "true"
  );
}

function parseIpv4(address) {
  const parts = String(address)
    .split(".")
    .map((part) => Number.parseInt(part, 10));
  if (
    parts.length !== 4 ||
    !parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
  ) {
    return null;
  }
  return parts;
}

function normalizeIpAddress(address) {
  const value = String(address || "")
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");

  if (value.startsWith("::ffff:")) {
    return value.slice("::ffff:".length);
  }

  return value;
}

function isPrivateOrReservedIp(address) {
  const ip = normalizeIpAddress(address);
  const ipVersion = net.isIP(ip);

  if (ipVersion === 4) {
    const parts = parseIpv4(ip);
    if (!parts) return true;
    const [a, b, c, d] = parts;

    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 192 && b === 0 && c === 2) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224 ||
      (a === 255 && b === 255 && c === 255 && d === 255)
    );
  }

  if (ipVersion === 6) {
    const compact = ip.replace(/(^|:)0+(?=[0-9a-f])/g, "$1");
    return (
      compact === "::" ||
      compact === "::1" ||
      compact.startsWith("fc") ||
      compact.startsWith("fd") ||
      compact.startsWith("fe8") ||
      compact.startsWith("fe9") ||
      compact.startsWith("fea") ||
      compact.startsWith("feb") ||
      compact.startsWith("ff")
    );
  }

  return true;
}

function isLocalHostname(hostname) {
  const host = String(hostname || "")
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  return (
    host === "localhost" ||
    host === "localhost.localdomain" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local")
  );
}

function parseHttpUrl(value) {
  try {
    const parsed = new URL(value);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return {
        ok: false,
        reason: "Target URL harus memakai protokol http atau https",
      };
    }
    if (!parsed.hostname) {
      return { ok: false, reason: "Target URL harus memiliki hostname" };
    }
    if (parsed.username || parsed.password) {
      return {
        ok: false,
        reason: "Target URL tidak boleh menyertakan kredensial",
      };
    }
    return { ok: true, parsed };
  } catch (_) {
    return { ok: false, reason: "Target URL tidak valid" };
  }
}

function isSafeHttpUrlSync(value, { allowPrivate } = {}) {
  const parsedResult = parseHttpUrl(value);
  if (!parsedResult.ok) return parsedResult;

  if (allowPrivate ?? isPrivateServiceUrlAllowed()) {
    return { ok: true, parsed: parsedResult.parsed };
  }

  const hostname = parsedResult.parsed.hostname;
  if (isLocalHostname(hostname)) {
    return {
      ok: false,
      reason: "Target URL tidak boleh memakai hostname lokal",
    };
  }

  if (net.isIP(normalizeIpAddress(hostname))) {
    if (isPrivateOrReservedIp(hostname)) {
      return {
        ok: false,
        reason: "Target URL tidak boleh mengarah ke IP private/reserved",
      };
    }
  }

  return { ok: true, parsed: parsedResult.parsed };
}

async function assertSafeHttpUrl(value, { allowPrivate } = {}) {
  const syncResult = isSafeHttpUrlSync(value, { allowPrivate });
  if (!syncResult.ok) return syncResult;

  if (allowPrivate ?? isPrivateServiceUrlAllowed()) {
    return syncResult;
  }

  const hostname = syncResult.parsed.hostname;
  if (net.isIP(normalizeIpAddress(hostname))) return syncResult;

  try {
    const records = await dnsPromises.lookup(hostname, {
      all: true,
      verbatim: true,
    });
    const unsafe = records.find((record) =>
      isPrivateOrReservedIp(record.address),
    );
    if (unsafe) {
      return {
        ok: false,
        reason: `Target URL DNS resolve ke IP private/reserved (${unsafe.address})`,
      };
    }
    return syncResult;
  } catch (err) {
    return {
      ok: false,
      reason: `Hostname target tidak dapat di-resolve: ${err.message}`,
    };
  }
}

function createSafeLookup({ allowPrivate } = {}) {
  return (hostname, options, callback) => {
    dns.lookup(hostname, options, (err, address, family) => {
      if (err) return callback(err);

      const records = Array.isArray(address) ? address : [{ address, family }];
      const allowPrivateTargets = allowPrivate ?? isPrivateServiceUrlAllowed();
      const unsafe = !allowPrivateTargets
        ? records.find((record) => isPrivateOrReservedIp(record.address))
        : null;

      if (unsafe) {
        return callback(
          new Error(
            `DNS lookup blocked private/reserved target ${unsafe.address}`,
          ),
        );
      }

      if (Array.isArray(address)) return callback(null, address);
      return callback(null, address, family);
    });
  };
}

module.exports = {
  assertSafeHttpUrl,
  createSafeLookup,
  isPrivateOrReservedIp,
  isPrivateServiceUrlAllowed,
  isSafeHttpUrlSync,
};
