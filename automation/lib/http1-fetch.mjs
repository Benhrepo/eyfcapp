import tls from "node:tls";

const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function decodeChunked(buffer) {
  const chunks = [];
  let offset = 0;
  while (offset < buffer.length) {
    const lineEnd = buffer.indexOf("\r\n", offset);
    if (lineEnd < 0) throw new Error("Invalid chunked response from Full-Time");
    const size = Number.parseInt(buffer.subarray(offset, lineEnd).toString("ascii").split(";", 1)[0], 16);
    if (!Number.isFinite(size)) throw new Error("Invalid chunk size from Full-Time");
    if (size === 0) break;
    const start = lineEnd + 2;
    chunks.push(buffer.subarray(start, start + size));
    offset = start + size + 2;
  }
  return Buffer.concat(chunks);
}

function rawTlsRequest(url, timeoutMs = 35000) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const chunks = [];
    let settled = false;
    const socket = tls.connect({
      host: target.hostname,
      port: Number(target.port || 443),
      servername: target.hostname,
      ALPNProtocols: ["http/1.1"],
      rejectUnauthorized: true
    });
    const fail = error => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(error);
    };
    socket.setTimeout(timeoutMs, () => fail(new Error(`Full-Time request timed out after ${timeoutMs}ms`)));
    socket.on("error", fail);
    socket.on("secureConnect", () => {
      const request = [
        `GET ${target.pathname}${target.search} HTTP/1.1`,
        `Host: ${target.hostname}`,
        `User-Agent: ${USER_AGENT}`,
        "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language: en-GB,en;q=0.9",
        "Accept-Encoding: identity",
        "Connection: close",
        "Upgrade-Insecure-Requests: 1",
        "Sec-Fetch-Dest: document",
        "Sec-Fetch-Mode: navigate",
        "Sec-Fetch-Site: none",
        "Sec-Fetch-User: ?1",
        "",
        ""
      ].join("\r\n");
      socket.write(request);
    });
    socket.on("data", chunk => chunks.push(chunk));
    socket.on("end", () => {
      if (settled) return;
      settled = true;
      try {
        const raw = Buffer.concat(chunks);
        const split = raw.indexOf("\r\n\r\n");
        if (split < 0) throw new Error("Full-Time returned an invalid HTTP response");
        const headerText = raw.subarray(0, split).toString("latin1");
        const status = Number(headerText.match(/^HTTP\/\d(?:\.\d)?\s+(\d+)/i)?.[1] || 0);
        const headers = new Map();
        headerText.split("\r\n").slice(1).forEach(line => {
          const colon = line.indexOf(":");
          if (colon > 0) headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
        });
        let body = raw.subarray(split + 4);
        if (/chunked/i.test(headers.get("transfer-encoding") || "")) body = decodeChunked(body);
        resolve({ status, headers, body: body.toString("utf8") });
      } catch (error) {
        reject(error);
      }
    });
  });
}

function blockedMessage(status, body) {
  if (status === 403 && /cloudflare|attention required|you have been blocked|you have been prevented/i.test(body)) {
    return "FA Full-Time blocked this server through its Cloudflare protection. No app data was changed.";
  }
  return `FA Full-Time returned HTTP ${status || "unknown"}. No app data was changed.`;
}

export async function fetchFullTimePage(url, redirects = 0) {
  if (redirects > 5) throw new Error("Too many redirects from FA Full-Time");
  const response = await rawTlsRequest(url);
  if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
    return fetchFullTimePage(new URL(response.headers.get("location"), url).toString(), redirects + 1);
  }
  if (response.status !== 200) throw new Error(blockedMessage(response.status, response.body));
  if (/attention required|you have been blocked|you have been prevented/i.test(response.body)) throw new Error(blockedMessage(403, response.body));
  if (!response.body || response.body.length < 1000) throw new Error("FA Full-Time returned an unexpectedly empty page. No app data was changed.");
  return response.body;
}

