const dns = require('dns');
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}

class FirecrawlService {
  constructor() {
    this.baseUrl = 'https://api.firecrawl.dev/v1';
    this.cache = new Map(); // In-memory scrape cache: url -> { data, timestamp }
    this.cacheTtlMs = 24 * 60 * 60 * 1000; // 24 hours
    this.stats = {
      searchCalls: 0,
      scrapeCalls: 0,
      lastSearchAt: null,
      lastScrapeAt: null
    };
  }

  getApiKey() {
    return (process.env.FIRECRAWL_API_KEY || '').trim();
  }

  isConfigured() {
    const key = this.getApiKey();
    return Boolean(key && key.startsWith('fc-'));
  }

  getStats() {
    return {
      configured: this.isConfigured(),
      searchCalls: this.stats.searchCalls,
      scrapeCalls: this.stats.scrapeCalls,
      lastSearchAt: this.stats.lastSearchAt,
      lastScrapeAt: this.stats.lastScrapeAt
    };
  }

  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // 1. Search API
  async search(query, options = {}) {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error('مفتاح Firecrawl API غير مهيأ (FIRECRAWL_API_KEY is not set). يرجى إضافته في ملف .env في الخادم.');
    }

    const limit = Math.min(Math.max(parseInt(options.limit, 10) || 5, 1), 15);
    const timeoutMs = options.timeoutMs || 25000;

    let attempt = 0;
    const maxRetries = 2;

    while (attempt <= maxRetries) {
      attempt++;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        console.log(`[Firecrawl Search] Query: "${query}" (limit=${limit}, attempt=${attempt})`);
        const searchPayload = {
          query: query,
          limit: limit
        };
        if (options.scrapeOptions !== false) {
          searchPayload.scrapeOptions = options.scrapeOptions || { formats: ['markdown'] };
        }

        const res = await fetch(`${this.baseUrl}/search`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(searchPayload),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (res.status === 401) {
          throw new Error('مفتاح Firecrawl API غير صالح أو منتهي الصلاحية (401 Unauthorized).');
        }

        if (res.status === 429) {
          console.warn('[Firecrawl Search] Rate limited (429). Retrying after backoff...');
          if (attempt <= maxRetries) {
            await this.sleep(attempt * 2500);
            continue;
          }
          throw new Error('تم تجاوز الحد المسموح به لطلبات Firecrawl (429 Rate Limit / Credits Exceeded).');
        }

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`Firecrawl Search API error (${res.status}): ${errText.slice(0, 200)}`);
        }

        const data = await res.json();
        this.stats.searchCalls++;
        this.stats.lastSearchAt = new Date().toISOString();

        const results = Array.isArray(data.data) ? data.data : [];

        // Deduplicate and filter non-HTML or repetitive links
        const cleanResults = [];
        const seenDomains = new Set();

        for (const item of results) {
          if (!item.url) continue;
          try {
            const parsedUrl = new URL(item.url);
            // Skip non-web assets and short-form video pages
            if (/\.(pdf|jpg|jpeg|png|gif|zip|rar|mp4|mp3|docx|xlsx)$/i.test(parsedUrl.pathname) || /\/(reels?|shorts)\//i.test(parsedUrl.pathname)) {
              continue;
            }
            // Domain deduplication for diversity
            const hostname = parsedUrl.hostname.toLowerCase().replace(/^www\./, '');
            if (seenDomains.has(hostname)) {
              continue;
            }
            seenDomains.add(hostname);

            const markdownContent = typeof item.markdown === 'string' && item.markdown.trim() ? item.markdown.trim() : null;

            if (markdownContent) {
              this.cache.set(item.url, {
                data: {
                  url: item.url,
                  title: (item.title || '').trim(),
                  markdown: markdownContent
                },
                timestamp: Date.now()
              });
            }

            cleanResults.push({
              url: item.url,
              title: (item.title || '').trim(),
              description: (item.description || '').trim(),
              markdown: markdownContent
            });
          } catch (e) {
            // invalid URL format, ignore
          }
        }

        console.log(`[Firecrawl Search] Retrieved ${cleanResults.length} relevant unique URLs.`);
        return cleanResults;
      } catch (err) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
          console.warn(`[Firecrawl Search] Timeout after ${timeoutMs}ms (attempt ${attempt}).`);
          if (attempt <= maxRetries) {
            await this.sleep(1500);
            continue;
          }
          throw new Error('انتهت مهلة البحث في Firecrawl (Request Timeout).');
        }

        if (attempt > maxRetries) {
          throw err;
        }
        await this.sleep(attempt * 1500);
      }
    }

    return [];
  }

  // 2. Scrape API
  async scrape(url, options = {}) {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error('مفتاح Firecrawl API غير مهيأ (FIRECRAWL_API_KEY is missing).');
    }

    // Check memory cache to save credits
    const now = Date.now();
    if (this.cache.has(url)) {
      const cached = this.cache.get(url);
      if (now - cached.timestamp < this.cacheTtlMs) {
        console.log(`[Firecrawl Scrape] Cache hit for ${url}`);
        return cached.data;
      }
      this.cache.delete(url);
    }

    const timeoutMs = options.timeoutMs || 25000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      console.log(`[Firecrawl Scrape] Scraping URL: ${url}`);
      const res = await fetch(`${this.baseUrl}/scrape`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          url: url,
          formats: ['markdown'],
          onlyMainContent: true,
          waitFor: 1000
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (res.status === 429) {
        console.warn(`[Firecrawl Scrape] Rate limited for ${url}`);
        return null;
      }

      if (!res.ok) {
        console.warn(`[Firecrawl Scrape] Failed with status ${res.status} for ${url}`);
        return null;
      }

      const json = await res.json();
      this.stats.scrapeCalls++;
      this.stats.lastScrapeAt = new Date().toISOString();

      const scrapeData = json.data || {};
      const result = {
        success: true,
        url: url,
        title: scrapeData.metadata?.title || '',
        description: scrapeData.metadata?.description || '',
        markdown: scrapeData.markdown || '',
        scrapedAt: new Date().toISOString()
      };

      // Cache result
      this.cache.set(url, {
        timestamp: now,
        data: result
      });

      return result;
    } catch (err) {
      clearTimeout(timeoutId);
      console.warn(`[Firecrawl Scrape] Error scraping ${url}:`, err.message);
      return null;
    }
  }
}

module.exports = new FirecrawlService();
