const crypto = require("crypto");

const CSRF_COOKIE = "gw_csrf";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const EXEMPT_PREFIXES = ["/integrator"];
const EXEMPT_PATHS = new Set(["/login", "/register"]);

function getCookie(req, name) {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(";").map((cookie) => cookie.trim());
  const target = cookies.find((cookie) => cookie.startsWith(`${name}=`));
  if (!target) return null;
  return decodeURIComponent(target.substring(name.length + 1));
}

function csrfCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 8 * 60 * 60 * 1000,
  };
}

function safeTokenEquals(a, b) {
  const left = Buffer.from(String(a || ""), "utf8");
  const right = Buffer.from(String(b || ""), "utf8");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function shouldSkip(req) {
  if (SAFE_METHODS.has(req.method)) return true;
  if (EXEMPT_PATHS.has(req.path)) return true;
  return EXEMPT_PREFIXES.some((prefix) => req.path.startsWith(prefix));
}

function ensureCsrfToken(req, res, next) {
  let token = getCookie(req, CSRF_COOKIE);
  if (!token || token.length < 32) {
    token = crypto.randomBytes(32).toString("hex");
    res.cookie(CSRF_COOKIE, token, csrfCookieOptions());
  }
  req.csrfToken = token;
  res.locals.csrfToken = token;
  next();
}

function verifyCsrfToken(req, res, next) {
  if (shouldSkip(req)) return next();

  const cookieToken = getCookie(req, CSRF_COOKIE);
  const requestToken =
    req.headers["x-csrf-token"] || req.body?._csrf || req.query?._csrf;

  if (
    !cookieToken ||
    !requestToken ||
    !safeTokenEquals(cookieToken, requestToken)
  ) {
    if (req.accepts("html")) {
      return res
        .status(403)
        .send("CSRF token tidak valid. Refresh halaman lalu coba lagi.");
    }
    return res.status(403).json({
      status: "error",
      message: "CSRF token tidak valid. Refresh halaman lalu coba lagi.",
    });
  }

  next();
}

module.exports = {
  CSRF_COOKIE,
  ensureCsrfToken,
  verifyCsrfToken,
};
