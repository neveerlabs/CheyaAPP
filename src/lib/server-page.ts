import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpsRequest, type IncomingMessage } from "node:https";

export interface PageMetadata {
  url: string;
  title: string;
  description: string;
  siteName: string;
  imageUrl: string | null;
  videoUrl: string | null;
  content: string;
}

function isPublicIp(address: string, family: number): boolean {
  if (family === 4) {
    const octets = address.split(".").map(Number);
    if (octets.length !== 4 || octets.some((part) => part < 0 || part > 255)) return false;
    const [first, second, third] = octets;
    return !(
      first === 0 ||
      first === 10 ||
      (first === 100 && second >= 64 && second <= 127) ||
      first === 127 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 192 && second === 0 && third === 0) ||
      (first === 192 && second === 0 && third === 2) ||
      (first === 198 && (second === 18 || second === 19)) ||
      (first === 198 && second === 51 && third === 100) ||
      (first === 203 && second === 0 && third === 113) ||
      first >= 224
    );
  }

  const normalized = address.toLowerCase().split("%")[0];
  const pieces = normalized.split("::");
  const left = pieces[0] ? pieces[0].split(":") : [];
  const right = pieces[1] ? pieces[1].split(":") : [];
  const groups = pieces.length === 2
    ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right]
    : left;
  if (groups.length !== 8) return false;
  const values = groups.map((group) => Number.parseInt(group || "0", 16));
  if (values.some((part) => !Number.isFinite(part) || part < 0 || part > 0xffff)) return false;
  const [first, second, third, fourth] = values;
  const mappedIpv4 =
    values.slice(0, 5).every((part) => part === 0) &&
    values[5] === 0xffff;
  if (mappedIpv4) {
    const mappedHigh = values[6];
    return isPublicIp(
      `${mappedHigh >> 8}.${mappedHigh & 255}.${values[7] >> 8}.${values[7] & 255}`,
      4,
    );
  }
  return !(
    values.every((part) => part === 0) ||
    (values.slice(0, 7).every((part) => part === 0) && values[7] === 1) ||
    (first & 0xfe00) === 0xfc00 ||
    (first & 0xffc0) === 0xfe80 ||
    (first & 0xff00) === 0xff00 ||
    (first === 0x2001 && (second & 0xfff0) === 0x0db0) ||
    (first === 0x2001 && second === 0x0db8) ||
    (first === 0x2001 && (second & 0xfff0) === 0x0010) ||
    (first === 0x2002) ||
    (first === 0x0064 && second === 0xff9b && third === 0 && fourth === 0)
  );
}

function validatePublicWebUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("The link is not a valid URL.");
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    url.protocol !== "https:" ||
    (url.port !== "" && url.port !== "443") ||
    url.username ||
    url.password ||
    !hostname.includes(".") ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".test") ||
    hostname === "metadata.google.internal" ||
    isIP(hostname) !== 0 ||
    hostname.startsWith("[")
  ) {
    throw new Error("Only public HTTPS website links can be previewed.");
  }
  return url;
}

async function validateResolvedPublicHost(
  url: URL,
): Promise<Array<{ address: string; family: number }>> {
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address, family }) => !isPublicIp(address, family))) {
    throw new Error("This link resolves to a non-public network address and cannot be previewed.");
  }
  return addresses;
}

function requestPublicPage(
  url: URL,
  address: { address: string; family: number },
): Promise<{ status: number; headers: IncomingMessage["headers"]; body: Uint8Array }> {
  return new Promise((resolve, reject) => {
    const request = httpsRequest(
      url,
      {
        method: "GET",
        headers: {
          Accept: "text/html,application/xhtml+xml;q=0.9",
          "User-Agent": "CheyaVerse-LinkPreview/1.0",
        },
        servername: url.hostname,
        lookup: (_hostname, options, callback) => {
          if (options.all) callback(null, [address]);
          else callback(null, address.address, address.family);
        },
      },
      (response) => {
        void (async () => {
          const status = response.statusCode ?? 502;
          if (status >= 300 && status < 400) {
            response.resume();
            resolve({ status, headers: response.headers, body: new Uint8Array() });
            return;
          }
          if (status < 200 || status >= 300) {
            response.resume();
            resolve({ status, headers: response.headers, body: new Uint8Array() });
            return;
          }
          const contentTypeValue = response.headers["content-type"];
          const contentType = (
            Array.isArray(contentTypeValue) ? contentTypeValue[0] : contentTypeValue
          )?.toLowerCase() ?? "";
          if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
            response.resume();
            resolve({ status, headers: response.headers, body: new Uint8Array() });
            return;
          }

          const chunks: Uint8Array[] = [];
          let totalBytes = 0;
          let truncated = false;
          try {
            for await (const chunk of response) {
              if (totalBytes >= 512_000) {
                truncated = true;
                response.destroy();
                break;
              }
              const remaining = 512_000 - totalBytes;
              const boundedChunk = chunk.subarray(0, remaining);
              chunks.push(boundedChunk);
              totalBytes += boundedChunk.byteLength;
              if (boundedChunk.byteLength < chunk.byteLength) {
                truncated = true;
                response.destroy();
                break;
              }
            }
          } catch (error) {
            if (!truncated) throw error;
          }

          const body = new Uint8Array(totalBytes);
          let offset = 0;
          for (const chunk of chunks) {
            body.set(chunk, offset);
            offset += chunk.byteLength;
          }
          resolve({ status, headers: response.headers, body });
        })().catch(reject);
      },
    );
    request.setTimeout(7000, () => request.destroy(new Error("The linked page timed out.")));
    request.on("error", reject);
    request.end();
  });
}

async function readHtml(
  url: URL,
): Promise<{ finalUrl: URL; html: string; contentType: string }> {
  let currentUrl = url;
  for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
    validatePublicWebUrl(currentUrl.href);
    const addresses = await validateResolvedPublicHost(currentUrl);
    const response = await requestPublicPage(currentUrl, addresses[0]);

    if (response.status >= 300 && response.status < 400) {
      const locationValue = response.headers.location;
      const location = Array.isArray(locationValue) ? locationValue[0] : locationValue;
      if (!location || redirectCount === 3) {
        throw new Error("The link redirected too many times to preview safely.");
      }
      currentUrl = new URL(location, currentUrl);
      continue;
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`The linked page returned HTTP ${response.status}.`);
    }
    const contentTypeValue = response.headers["content-type"];
    const contentType = (Array.isArray(contentTypeValue) ? contentTypeValue[0] : contentTypeValue)
      ?.toLowerCase() ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      return { finalUrl: currentUrl, html: "", contentType };
    }
    return {
      finalUrl: currentUrl,
      html: new TextDecoder().decode(response.body),
      contentType,
    };
  }

  throw new Error("The linked page could not be loaded.");
}

function decodeHtml(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => {
      const point = Number(code);
      return point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : " ";
    })
    .replace(/&#x([\da-f]+);/gi, (_, code: string) =>
      Number.parseInt(code, 16) <= 0x10ffff
        ? String.fromCodePoint(Number.parseInt(code, 16))
        : " ",
    )
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function metaValue(html: string, key: string): string {
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    const name =
      tag.match(/\b(?:property|name)\s*=\s*(["'])(.*?)\1/i)?.[2]?.toLowerCase() ?? "";
    if (name !== key.toLowerCase()) continue;
    const content = tag.match(/\bcontent\s*=\s*(["'])([\s\S]*?)\1/i)?.[2];
    if (content) return decodeHtml(content).slice(0, 2000);
  }
  return "";
}

export async function getPageMetadata(value: string): Promise<PageMetadata> {
  const requestedUrl = validatePublicWebUrl(value);
  const { finalUrl, html, contentType } = await readHtml(requestedUrl);
  const fileName = finalUrl.pathname.split("/").filter(Boolean).pop() || finalUrl.hostname;
  if (contentType.startsWith("image/")) {
    return {
      url: finalUrl.href,
      title: fileName,
      description: "Image",
      siteName: finalUrl.hostname,
      imageUrl: finalUrl.href,
      videoUrl: null,
      content: "",
    };
  }
  if (contentType.startsWith("video/")) {
    return {
      url: finalUrl.href,
      title: fileName,
      description: "Video",
      siteName: finalUrl.hostname,
      imageUrl: null,
      videoUrl: finalUrl.href,
      content: "",
    };
  }
  if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
    throw new Error("The link does not point to an HTML page or image/video.");
  }
  const title =
    metaValue(html, "og:title") ||
    metaValue(html, "twitter:title") ||
    decodeHtml(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "") ||
    finalUrl.hostname;
  const description =
    metaValue(html, "og:description") ||
    metaValue(html, "description") ||
    metaValue(html, "twitter:description");
  const resolveAssetUrl = (asset: string) => {
    if (!asset) return null;
    try {
      const url = new URL(asset, finalUrl);
      return url.protocol === "https:" ? url.href : null;
    } catch {
      return null;
    }
  };
  const imageUrl = resolveAssetUrl(metaValue(html, "og:image") || metaValue(html, "twitter:image"));
  const videoUrl = resolveAssetUrl(
    metaValue(html, "og:video:secure_url") ||
      metaValue(html, "og:video:url") ||
      metaValue(html, "og:video"),
  );
  const content = decodeHtml(
    html
      .replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  ).slice(0, 6000);

  return {
    url: finalUrl.href,
    title: title.slice(0, 300),
    description: description.slice(0, 1200),
    siteName: metaValue(html, "og:site_name") || finalUrl.hostname,
    imageUrl,
    videoUrl,
    content,
  };
}
