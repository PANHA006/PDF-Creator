const axios = require('axios');
const cheerio = require('cheerio');
const archiver = require('archiver');
const { execFile } = require('child_process');

const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1'
};

/**
 * Robust HTML fetcher with fallback to curl.exe to bypass Cloudflare 520 / TLS blocks on Windows
 */
async function fetchHtmlWithFallback(url, reqHeaders = {}) {
  // 1. Try Axios first
  try {
    const res = await axios.get(url, {
      headers: { ...DEFAULT_HEADERS, ...reqHeaders },
      timeout: 12000
    });
    if (res.status === 200 && res.data && typeof res.data === 'string' && res.data.length > 200) {
      return res.data;
    }
  } catch (err) {
    console.warn(`[MangaService] Axios get failed for ${url} (${err.message}). Trying fallback fetcher...`);
  }

  // 2. Try Node.js built-in fetch (Undici)
  try {
    const res = await fetch(url, {
      headers: { ...DEFAULT_HEADERS, ...reqHeaders }
    });
    if (res.ok) {
      const text = await res.text();
      if (text && text.length > 200) {
        return text;
      }
    }
  } catch (err) {
    console.warn(`[MangaService] Built-in fetch failed for ${url}:`, err.message);
  }

  // 3. Fallback to Windows curl.exe (Bypasses Cloudflare anti-bot / 520 TLS fingerprinting)
  return new Promise((resolve, reject) => {
    const args = [
      '-s',
      '-L',
      '--compressed',
      '-A', DEFAULT_HEADERS['User-Agent'],
      '-H', 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      '-H', 'Accept-Language: en-US,en;q=0.9',
      '--max-time', '15',
      url
    ];

    execFile('curl.exe', args, { maxBuffer: 25 * 1024 * 1024 }, (err, stdout) => {
      if (err) {
        return reject(new Error(`Failed to fetch website: ${err.message}`));
      }
      if (!stdout || stdout.length < 200) {
        return reject(new Error('Website returned empty or protected response'));
      }
      resolve(stdout);
    });
  });
}

/**
 * Robust and ultra-fast image downloader with fallback
 */
async function downloadImageBufferWithFallback(url, reqHeaders = {}) {
  // 1. Try axios with fast timeout
  try {
    const res = await axios.get(url, {
      headers: { ...DEFAULT_HEADERS, ...reqHeaders },
      responseType: 'arraybuffer',
      timeout: 6000
    });
    const ct = res.headers['content-type'] || '';
    if (res.status === 200 && res.data && res.data.length > 500 && !ct.startsWith('text/html')) {
      return { buffer: Buffer.from(res.data), contentType: ct };
    }
  } catch (e) {}

  // 2. Try Node native fetch
  try {
    const res = await fetch(url, {
      headers: { ...DEFAULT_HEADERS, ...reqHeaders },
      signal: AbortSignal.timeout(6000)
    });
    if (res.ok) {
      const arrayBuffer = await res.arrayBuffer();
      const ct = res.headers.get('content-type') || '';
      if (arrayBuffer.byteLength > 500 && !ct.startsWith('text/html')) {
        return { buffer: Buffer.from(arrayBuffer), contentType: ct || 'image/jpeg' };
      }
    }
  } catch (e) {}

  // 3. Fallback to curl with fast timeout (8s)
  return new Promise((resolve) => {
    const args = [
      '-s',
      '-L',
      '-A', DEFAULT_HEADERS['User-Agent'],
      '--max-time', '8',
      url
    ];

    execFile('curl.exe', args, { encoding: 'buffer', maxBuffer: 30 * 1024 * 1024 }, (err, stdout) => {
      if (!err && stdout && stdout.length > 500) {
        let mime = 'image/jpeg';
        if (url.includes('.png')) mime = 'image/png';
        else if (url.includes('.webp')) mime = 'image/webp';
        return resolve({ buffer: stdout, contentType: mime });
      }
      resolve(null);
    });
  });
}

/**
 * Fetch manga metadata and chapters from MangaDex API
 */
async function fetchMangaDex(urlOrId) {
  let mangaId = null;
  const match = urlOrId.match(/title\/([a-fA-F0-9\-]{36})/);
  if (match) {
    mangaId = match[1];
  } else {
    const uuidMatch = urlOrId.trim().match(/^([a-fA-F0-9\-]{36})$/);
    if (uuidMatch) {
      mangaId = uuidMatch[1];
    }
  }

  if (!mangaId) {
    throw new Error('Invalid MangaDex URL or ID format');
  }

  const mangaUrl = `https://api.mangadex.org/manga/${mangaId}?includes[]=cover_art&includes[]=author`;
  const { data: mangaData } = await axios.get(mangaUrl, { headers: { 'User-Agent': 'PDF-Creator-Manga-Downloader/1.0' } });

  const attr = mangaData.data.attributes;
  const title = attr.title?.en || Object.values(attr.title || {})[0] || 'Unknown Title';
  const description = attr.description?.en || Object.values(attr.description || {})[0] || '';

  let author = 'Unknown Author';
  for (const rel of mangaData.data.relationships || []) {
    if (rel.type === 'author' && rel.attributes?.name) {
      author = rel.attributes.name;
    }
  }

  const status = (attr.status || 'ongoing').charAt(0).toUpperCase() + (attr.status || 'ongoing').slice(1);

  let coverFilename = null;
  for (const rel of mangaData.data.relationships || []) {
    if (rel.type === 'cover_art' && rel.attributes?.fileName) {
      coverFilename = rel.attributes.fileName;
    }
  }

  const coverUrl = coverFilename ? `https://uploads.mangadex.org/covers/${mangaId}/${coverFilename}.256.jpg` : '';

  const feedUrl = `https://api.mangadex.org/manga/${mangaId}/feed?translatedLanguage[]=en&order[chapter]=asc&limit=500`;
  const { data: feedData } = await axios.get(feedUrl, { headers: { 'User-Agent': 'PDF-Creator-Manga-Downloader/1.0' } });

  const chapters = (feedData.data || []).map(ch => ({
    id: ch.id,
    volume: ch.attributes.volume || '',
    chapter: ch.attributes.chapter || '',
    title: ch.attributes.title || '',
    pages: ch.attributes.pages || 0
  }));

  chapters.sort((a, b) => {
    const na = parseFloat(a.chapter) || 0;
    const nb = parseFloat(b.chapter) || 0;
    return na - nb;
  });

  return {
    id: mangaId,
    title,
    author,
    status,
    description,
    coverUrl,
    chapters
  };
}

/**
 * Download chapter pages from MangaDex
 */
async function downloadMangaDexChapter(chapterId) {
  const atHomeUrl = `https://api.mangadex.org/at-home/server/${chapterId}`;
  const { data: atHomeData } = await axios.get(atHomeUrl, { headers: { 'User-Agent': 'PDF-Creator-Manga-Downloader/1.0' } });

  const baseUrl = atHomeData.baseUrl;
  const chHash = atHomeData.chapter.hash;
  const useSaver = Boolean(atHomeData.chapter.dataSaver);
  const pages = useSaver ? atHomeData.chapter.dataSaver : atHomeData.chapter.data;
  const modePath = useSaver ? 'data-saver' : 'data';

  const downloadTasks = pages.map(async (filename, idx) => {
    const pageUrl = `${baseUrl}/${modePath}/${chHash}/${filename}`;
    try {
      const res = await axios.get(pageUrl, {
        responseType: 'arraybuffer',
        headers: { 'User-Agent': 'PDF-Creator-Manga-Downloader/1.0' },
        timeout: 15000
      });
      const ext = filename.split('.').pop().toLowerCase();
      const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : (ext === 'webp' ? 'image/webp' : `image/${ext}`);
      const base64 = Buffer.from(res.data).toString('base64');
      return {
        idx,
        item: {
          name: `page_${idx + 1}.${ext}`,
          dataUrl: `data:${mime};base64,{base64}`.replace('{base64}', base64)
        }
      };
    } catch (err) {
      console.warn(`Error downloading MangaDex page ${idx + 1}:`, err.message);
      return { idx, item: null };
    }
  });

  const results = await Promise.all(downloadTasks);
  const pagesList = results
    .filter(r => r.item !== null)
    .sort((a, b) => a.idx - b.idx)
    .map(r => r.item);

  return pagesList;
}

/**
 * Universal Manga Fetcher (ComicK API + Web Scraping)
 */
async function fetchUniversalManga(url) {
  // 1. Special Handling for ComicK
  if (url.includes('comick.') || url.includes('comick.io') || url.includes('comick.app')) {
    const comicSlug = url.trim().replace(/\/$/, '').split('/').pop().split('?')[0];
    const apiUrl = `https://api.comick.fun/comic/${comicSlug}`;
    const { data: res } = await axios.get(apiUrl, { headers: DEFAULT_HEADERS, timeout: 12000 });
    const comicData = res.comic || {};
    const comicHid = comicData.hid;

    const title = comicData.title || 'Unknown Title';
    const desc = comicData.desc || '';
    const status = comicData.status === 2 ? 'Completed' : 'OnGoing';

    let coverUrl = '';
    if (comicData.md_covers && comicData.md_covers.length > 0) {
      const bkey = comicData.md_covers[0].bkey;
      coverUrl = `https://meo.comick.pictures/${bkey}`;
    }

    const author = (comicData.authors || []).map(a => a.name).filter(Boolean).join(', ') || 'Unknown Author';

    const chApi = `https://api.comick.fun/comic/${comicHid}/chapters?lang=en&limit=300`;
    const { data: chRes } = await axios.get(chApi, { headers: DEFAULT_HEADERS, timeout: 15000 });
    const rawChapters = chRes.chapters || [];

    const chapters = rawChapters.map(ch => ({
      id: `https://comick.io/chapter/${ch.hid}`,
      volume: ch.vol || '',
      chapter: String(ch.chap || ''),
      title: ch.title || `Chapter ${ch.chap || ''}`,
      pages: 0
    }));

    chapters.sort((a, b) => (parseFloat(a.chapter) || 0) - (parseFloat(b.chapter) || 0));

    return {
      id: url,
      title,
      author,
      status,
      description: desc,
      coverUrl,
      chapters
    };
  }

  // 2. Universal Scraper (WordPress, Madara, MangaStream, Manganato, Flame Comics, Reaper Scans)
  let parentUrl = url.replace(/(?:chapter|ch|episode|ep)[-_/][a-zA-Z0-9\-_.]+(?:\/?)$/i, '');
  if (!parentUrl.endsWith('/') && !parentUrl.endsWith('.html')) {
    parentUrl += '/';
  }
  const isChapterUrl = parentUrl !== url;
  const requestedChapterUrl = isChapterUrl ? url : '';

  const html = await fetchHtmlWithFallback(parentUrl, { Referer: parentUrl });
  const $ = cheerio.load(html);

  const titleEl = $(
    '.post-title h1, .story-info-right h1, .manga-info-top h1, h1.entry-title, .series-title, h1'
  ).first();
  const title = titleEl.text().trim() || 'Unknown Title';

  const coverEl = $(
    '.summary_image img, .story-info-left img, .manga-info-pic img, .post-thumbnail img, .thumb img, .series-thumb img'
  ).first();
  const coverUrl =
    coverEl.attr('data-src') ||
    coverEl.attr('data-lazy-src') ||
    coverEl.attr('srcset')?.split(' ')[0] ||
    coverEl.attr('src') ||
    '';

  const descEl = $(
    '.description-summary, .panel-story-info-description, #noidungm, .manga-excerpt, .entry-content p'
  ).first();
  const description = descEl.text().trim();

  let author = 'Unknown Author';
  let status = 'OnGoing';

  const fullText = $.text().toLowerCase();
  if (fullText.includes('completed') && !fullText.includes('ongoing')) {
    status = 'Completed';
  }

  $('.post-content_item, .variations-tableInfo tr, .manga-info-top li').each((_, el) => {
    const textBlock = $(el).text().trim().toLowerCase();
    if (textBlock.includes('author') || textBlock.includes('tác giả')) {
      author = $(el).text().split(':').pop().trim();
    }
    if (textBlock.includes('status')) {
      if (textBlock.includes('completed')) status = 'Completed';
      else if (textBlock.includes('ongoing')) status = 'OnGoing';
    }
  });

  // Prefer dedicated chapter containers if present to avoid pulling sidebar/related/footer links
  let chapterElements = $(
    '.listing-chapters_wrap a, .wp-manga-chapter a, .row-content-chapter a.chapter-name, .row-content-chapter a, .chapter-list .row a, .chapter-list a, #chapterlist a, .eph-num a, .bxcl ul li a, .sub-chap-list a, .chapters-list a'
  );

  if (!chapterElements || chapterElements.length === 0) {
    chapterElements = $(
      'a[href*="-chapter-"], a[href*="/chapter-"], a[href*="/ch-"], a[href*="-ch-"]'
    ).filter((_, el) => {
      // Exclude navigation, sidebar, related, footer, comments
      const inExcludedContainer = $(el).closest(
        'header, footer, nav, aside, .sidebar, #sidebar, .widget, .popular, .related, .recommend, .comments, .comment'
      ).length > 0;
      return !inExcludedContainer;
    });
  }

  const chapters = [];
  const seenUrls = new Set();
  const seenChapterNums = new Set();

  chapterElements.each((idx, el) => {
    const chUrl = $(el).attr('href')?.trim();
    if (!chUrl || seenUrls.has(chUrl) || chUrl.startsWith('#') || chUrl.startsWith('javascript:')) return;

    const chTitle = $(el).text().trim();
    const lowerTitle = chTitle.toLowerCase();

    // Skip generic navigation buttons like "Read First", "Read Last", etc.
    if (
      lowerTitle.includes('read first') ||
      lowerTitle.includes('read last') ||
      lowerTitle.includes('first chapter') ||
      lowerTitle.includes('latest chapter') ||
      lowerTitle.includes('newest chapter') ||
      lowerTitle.includes('prev chapter') ||
      lowerTitle.includes('next chapter')
    ) {
      return;
    }

    let chNum = '';
    const match = `${chTitle} ${chUrl}`.match(/(?:chapter|ch\.?|ep\.?)[-_ \t]*([0-9\.]+)/i);
    if (match) {
      chNum = match[1];
    } else {
      const fallbackNum = chTitle.match(/([0-9\.]+)/);
      chNum = fallbackNum ? fallbackNum[1] : String(idx + 1);
    }

    // Deduplicate by chapter number if already seen
    const cleanNumKey = chNum.replace(/^0+/, '') || '0';
    if (seenChapterNums.has(cleanNumKey)) {
      return;
    }

    seenUrls.add(chUrl);
    seenChapterNums.add(cleanNumKey);

    chapters.push({
      id: chUrl,
      volume: '',
      chapter: chNum,
      title: chTitle,
      pages: 0
    });
  });

  // Sort chapters numerically ascending (1, 2, 3...)
  chapters.sort((a, b) => {
    const numA = parseFloat(a.chapter);
    const numB = parseFloat(b.chapter);
    if (!isNaN(numA) && !isNaN(numB)) {
      return numA - numB;
    }
    if (!isNaN(numA)) return -1;
    if (!isNaN(numB)) return 1;
    return (a.chapter || '').localeCompare(b.chapter || '', undefined, { numeric: true });
  });

  return {
    id: parentUrl,
    title,
    author,
    status,
    description,
    coverUrl,
    chapters,
    requestedChapterUrl
  };
}

/**
 * Universal Chapter Downloader
 */
async function downloadUniversalChapter(chapterUrl) {
  let pageUrls = [];

  if (chapterUrl.includes('comick.io/chapter/')) {
    const chHid = chapterUrl.trim().replace(/\/$/, '').split('/').pop();
    const apiUrl = `https://api.comick.fun/chapter/${chHid}`;
    const { data: res } = await axios.get(apiUrl, { headers: DEFAULT_HEADERS, timeout: 12000 });
    const images = res.chapter?.images || [];
    pageUrls = images.filter(img => img.bkey).map(img => `https://meo.comick.pictures/${img.bkey}`);
  } else {
    const html = await fetchHtmlWithFallback(chapterUrl, { Referer: chapterUrl });
    const $ = cheerio.load(html);

    const imgElements = $(
      '.container-chapter-reader img, #readerarea img, .reading-content img, .page-break img, .rd-img img, .entry-content img, .chapter-image img, img.wp-manga-chapter-img'
    );

    imgElements.each((_, el) => {
      let imgUrl =
        $(el).attr('data-src') ||
        $(el).attr('data-lazy-src') ||
        $(el).attr('data-original') ||
        $(el).attr('src') ||
        '';
      imgUrl = imgUrl.trim();
      if (imgUrl && !imgUrl.startsWith('data:') && !imgUrl.toLowerCase().includes('logo') && !imgUrl.toLowerCase().includes('banner')) {
        pageUrls.push(imgUrl);
      }
    });
  }

  const downloadSinglePage = async (pageUrl, idx) => {
    if (!pageUrl) return null;
    let url = pageUrl;
    if (url.startsWith('//')) {
      url = `https:${url}`;
    }

    const reqHeaders = { Referer: chapterUrl };
    if (url.includes('mkklcdn') || url.includes('manganato')) {
      reqHeaders.Referer = 'https://chapmanganato.to/';
    }

    const downloaded = await downloadImageBufferWithFallback(url, reqHeaders);
    if (downloaded && downloaded.buffer) {
      const base64 = downloaded.buffer.toString('base64');
      let ext = 'jpg';
      if (downloaded.contentType.includes('png')) ext = 'png';
      else if (downloaded.contentType.includes('webp')) ext = 'webp';
      else if (downloaded.contentType.includes('gif')) ext = 'gif';

      return {
        idx,
        item: {
          name: `page_${idx + 1}.${ext}`,
          dataUrl: `data:${downloaded.contentType};base64,${base64}`
        }
      };
    }

    return null;
  };

  // Run in parallel chunks of 15 (high speed concurrency)
  const results = [];
  const chunkSize = 15;
  for (let i = 0; i < pageUrls.length; i += chunkSize) {
    const chunk = pageUrls.slice(i, i + chunkSize);
    const chunkResults = await Promise.all(chunk.map((pUrl, cIdx) => downloadSinglePage(pUrl, i + cIdx)));
    results.push(...chunkResults);
  }

  const pagesList = results
    .filter(Boolean)
    .sort((a, b) => a.idx - b.idx)
    .map(r => r.item);

  return pagesList;
}

/**
 * Generate ZIP file from array of data URL pages
 */
function createZipStream(filesData) {
  const archive = archiver('zip', { zlib: { level: 9 } });

  for (let idx = 0; idx < filesData.length; idx++) {
    const item = filesData[idx];
    const filename = item.name || `page_${idx + 1}.png`;
    const dataUrl = item.dataUrl || '';
    if (!dataUrl) continue;

    const parts = dataUrl.split(',');
    if (parts.length < 2) continue;

    const buffer = Buffer.from(parts[1], 'base64');
    archive.append(buffer, { name: filename });
  }

  archive.finalize();
  return archive;
}

module.exports = {
  fetchMangaDex,
  downloadMangaDexChapter,
  fetchUniversalManga,
  downloadUniversalChapter,
  createZipStream
};
