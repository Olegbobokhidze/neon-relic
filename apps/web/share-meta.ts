import type { Plugin } from 'vite';

/**
 * Share/SEO metadata for link previews (Open Graph, Twitter/X, JSON-LD), robots.txt and sitemap.xml.
 *
 * `index.html` stays the single source for the page title, description and theme colour; this
 * plugin reads them from there and derives every share tag, so nothing can drift.
 *
 * Crawlers (Facebook, LinkedIn, WhatsApp, Telegram, Slack, X) need ABSOLUTE image URLs, so the
 * public origin is resolved at build time:
 *   SITE_URL=https://example.com/ pnpm build        (any host)
 *   Netlify: `URL` is set automatically            Vercel: `VERCEL_PROJECT_PRODUCTION_URL`
 * Without an origin the build still works; it falls back to relative URLs and warns.
 */
export type ShareMetaOptions = {
  /** Text read by screen readers and shown when the preview image cannot load. */
  imageAlt: string;
  /** schema.org `genre`, e.g. "Roulette". */
  genre: string;
  author: string;
  keywords: readonly string[];
  image?: { path: string; width: number; height: number; type: string };
  locale?: string;
};

type Env = Record<string, string | undefined>;

const readEnv = (): Env =>
  (globalThis as { process?: { env?: Env } }).process?.env ?? {};

/** Public origin with a trailing slash, or undefined when it cannot be known at build time. */
export function resolveSiteUrl(env: Env = readEnv()): string | undefined {
  const raw =
    env.SITE_URL ??
    (env.NETLIFY === 'true' ? env.URL : undefined) ??
    (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : undefined);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (!url.pathname.endsWith('/')) url.pathname += '/';
    return url.href;
  } catch {
    return undefined;
  }
}

const escapeAttr = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const decodeEntities = (s: string): string =>
  s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const pick = (html: string, re: RegExp): string => decodeEntities(re.exec(html)?.[1]?.trim() ?? '');

export function shareMeta(options: ShareMetaOptions): Plugin {
  const image = options.image ?? { path: 'og-image.jpg', width: 1200, height: 630, type: 'image/jpeg' };
  const locale = options.locale ?? 'en_US';
  let siteUrl: string | undefined;

  return {
    name: 'share-meta',
    configResolved(config) {
      siteUrl = resolveSiteUrl();
      if (config.command === 'build' && !siteUrl) {
        config.logger.warn(
          '[share-meta] No SITE_URL: link previews use relative image URLs, which most crawlers ignore. ' +
            'Set SITE_URL=https://your-domain/ (Netlify and Vercel are detected automatically).',
        );
      }
    },
    transformIndexHtml(html) {
      const title = pick(html, /<title>([\s\S]*?)<\/title>/);
      const description = pick(html, /<meta\s+name="description"\s+content="([^"]*)"/);
      const abs = (path: string): string => (siteUrl ? new URL(path, siteUrl).href : path);
      const imageUrl = abs(image.path);

      const meta: [attr: 'name' | 'property', key: string, value: string][] = [
        ['name', 'robots', 'index, follow, max-image-preview:large'],
        ['name', 'keywords', options.keywords.join(', ')],
        ['property', 'og:type', 'website'],
        ['property', 'og:site_name', title],
        ['property', 'og:locale', locale],
        ['property', 'og:title', title],
        ['property', 'og:description', description],
        ['property', 'og:image', imageUrl],
        ['property', 'og:image:type', image.type],
        ['property', 'og:image:width', String(image.width)],
        ['property', 'og:image:height', String(image.height)],
        ['property', 'og:image:alt', options.imageAlt],
        ['name', 'twitter:card', 'summary_large_image'],
        ['name', 'twitter:title', title],
        ['name', 'twitter:description', description],
        ['name', 'twitter:image', imageUrl],
        ['name', 'twitter:image:alt', options.imageAlt],
      ];
      if (siteUrl) meta.splice(3, 0, ['property', 'og:url', siteUrl]);

      const jsonLd = {
        '@context': 'https://schema.org',
        '@type': 'VideoGame',
        name: title,
        description,
        ...(siteUrl ? { url: siteUrl } : {}),
        image: imageUrl,
        genre: options.genre,
        gamePlatform: 'Web browser',
        applicationCategory: 'Game',
        operatingSystem: 'Any',
        inLanguage: 'en',
        isAccessibleForFree: true,
        keywords: options.keywords.join(', '),
        author: { '@type': 'Person', name: options.author },
        creator: { '@type': 'Person', name: options.author },
      };

      const lines = [
        ...(siteUrl ? [`<link rel="canonical" href="${escapeAttr(siteUrl)}" />`] : []),
        ...meta.map(([attr, key, value]) => `<meta ${attr}="${key}" content="${escapeAttr(value)}" />`),
        `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>`,
      ];
      return html.replace(/\s*<\/head>/, `\n    ${lines.join('\n    ')}\n  </head>`);
    },
    generateBundle() {
      const robots = ['User-agent: *', 'Allow: /', ...(siteUrl ? [`Sitemap: ${new URL('sitemap.xml', siteUrl).href}`] : [])];
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: `${robots.join('\n')}\n` });
      if (siteUrl) {
        const today = new Date().toISOString().slice(0, 10);
        this.emitFile({
          type: 'asset',
          fileName: 'sitemap.xml',
          source:
            '<?xml version="1.0" encoding="UTF-8"?>\n' +
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
            `  <url><loc>${escapeAttr(siteUrl)}</loc><lastmod>${today}</lastmod></url>\n` +
            '</urlset>\n',
        });
      }
    },
  };
}
