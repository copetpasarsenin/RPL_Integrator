function joinUrl(baseUrl, path = '') {
    const base = String(baseUrl || '');
    const pathText = String(path || '');

    if (!pathText) return base;

    const cleanBase = base.replace(/\/+$/, '');
    const cleanPath = pathText.replace(/^\/+/, '');
    return `${cleanBase}/${cleanPath}`;
}

function appendQueryString(targetUrl, req) {
    const sourceUrl = req?.originalUrl || req?.url || '';
    const queryIndex = sourceUrl.indexOf('?');
    if (queryIndex === -1) return targetUrl;
    return `${targetUrl}${sourceUrl.substring(queryIndex)}`;
}

function getProxyTimeoutMs() {
    const timeout = Number.parseInt(process.env.PROXY_TIMEOUT_MS, 10);
    return Number.isFinite(timeout) && timeout > 0 ? timeout : 10000;
}

module.exports = {
    joinUrl,
    appendQueryString,
    getProxyTimeoutMs
};
