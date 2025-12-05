import { ScrapedData } from '../types';

export const scrapeWebsite = async (url: string): Promise<ScrapedData> => {
  // Try Jina Reader first (via Vite proxy in dev, or direct in prod)
  try {
    console.log('[scraper] Trying Jina Reader for:', url);
    const jinaUrl = `/api/scrape?url=${encodeURIComponent(url)}`;

    const response = await fetch(jinaUrl, {
      headers: {
        'Accept': 'text/plain',
      }
    });

    if (!response.ok) {
      throw new Error(`Jina returned ${response.status}`);
    }

    const text = await response.text();

    if (!text || text.length < 100) {
      throw new Error("Insufficient content from Jina");
    }

    // Jina returns markdown - extract title from first line if it's a heading
    const lines = text.split('\n');
    let title = url;
    let content = text;

    if (lines[0]?.startsWith('# ')) {
      title = lines[0].replace('# ', '').trim();
    } else if (lines[0]?.startsWith('Title: ')) {
      title = lines[0].replace('Title: ', '').trim();
    }

    // Limit context size
    const cleanText = content.substring(0, 20000);

    console.log('[scraper] ✅ Jina success, got', cleanText.length, 'chars');

    return {
      url,
      content: cleanText,
      title,
      success: true
    };

  } catch (jinaError) {
    console.warn('[scraper] Jina failed:', jinaError);
  }

  // Fallback: try allorigins proxy
  try {
    console.log('[scraper] Trying allorigins fallback...');
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;

    const response = await fetch(proxyUrl);
    const data = await response.json();

    if (!data.contents) {
      throw new Error("No content returned from proxy");
    }

    // Parse HTML to extract text
    const parser = new DOMParser();
    const doc = parser.parseFromString(data.contents, 'text/html');

    // Remove scripts, styles, and other non-content elements
    const scripts = doc.querySelectorAll('script, style, noscript, iframe, svg');
    scripts.forEach(script => script.remove());

    const title = doc.title || url;
    const bodyText = doc.body.innerText || "";

    // Clean up whitespace
    const cleanText = bodyText.replace(/\s+/g, ' ').trim().substring(0, 20000);

    console.log('[scraper] ✅ allorigins success, got', cleanText.length, 'chars');

    return {
      url,
      content: cleanText,
      title,
      success: true
    };

  } catch (error) {
    console.warn('[scraper] All scraping methods failed, falling back to Search Grounding:', error);
    return {
      url,
      content: "",
      title: url,
      success: false // Indicates we should rely on the model's search tool
    };
  }
};
