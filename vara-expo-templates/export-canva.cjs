/* Export each template on the directions board as a Canva-importable static HTML file.

   Canva's importer turns a static HTML page into an editable design, one design page per
   top-level element marked data-document-role="page". Every slide/page is split into:
     - one full-bleed ART image: background, aurora, windows, tubes, logo (things nobody edits)
     - PHOTO images: each placeholder, so it can be swapped for a real photo in Canva
     - native TEXT boxes and RECTANGLES: everything else, positioned absolutely, so it stays editable

   usage:  python3 build.py --preview && node export-canva.cjs
   needs:  puppeteer-core (local install or NODE_PATH) and Google Chrome. Output goes to ./canva/<template>/ */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const HERE = __dirname;
const OUT = path.join(HERE, 'canva');
const BASE_URL = 'https://novas-mv.github.io/brand-hub/vara-expo-templates/canva/';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SCALE = 2;

const TEMPLATES = [
  { slug: 'deck-daybreak',          name: 'VARA Expo 2026 · Deck · Daybreak',          type: 'presentation' },
  { slug: 'deck-night-window',      name: 'VARA Expo 2026 · Deck · Night Window',      type: 'presentation' },
  { slug: 'report-annual-review',   name: 'VARA Expo 2026 · Report · Annual Review',   type: 'a4' },
  { slug: 'report-night-and-day',   name: 'VARA Expo 2026 · Report · Night & Day',     type: 'a4' },
  { slug: 'report-daybreak',        name: 'VARA Expo 2026 · Report · Daybreak',        type: 'a4' },
];

const FONTS = 'https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;700&display=swap';

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1200, deviceScaleFactor: SCALE });
  await page.goto('file://' + path.join(HERE, '_preview.html'), { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts.ready);

  /* pull every slide out of its scaled thumbnail frame and lay them out at 1:1 */
  const pages = await page.evaluate(() => {
    const st = document.createElement('style');
    st.textContent = `
      html,body{background:transparent!important}
      .wrap{display:none}
      #xbox{display:grid;gap:40px;padding:40px;justify-content:start}
      #xbox .s{position:relative!important;transform:none!important}
      .xart *{visibility:hidden!important}
      .xart .au,.xart .au *,.xart svg.tb,.xart svg.tb *,.xart img.logo,.xart [data-art],.xart [data-art] *,
      .xart .win,.xart .rail,.xart .rail .lbl{visibility:visible!important}
      .xph{background:transparent!important}
      .xph *{visibility:hidden!important}
      .xph .ph.xon,.xph .ph.xon *{visibility:visible!important}`;
    const box = document.createElement('div'); box.id = 'xbox';
    const out = [];
    document.querySelectorAll('section.dir').forEach((sec, t) => {
      sec.querySelectorAll('figure').forEach((fig, i) => {
        const s = fig.querySelector('.s');
        const w = s.offsetWidth, h = s.offsetHeight;
        s.style.width = w + 'px'; s.style.height = h + 'px';
        s.dataset.x = t + '-' + i;
        out.push({ t, i, w, h, label: fig.querySelector('figcaption').textContent.trim() });
      });
    });
    document.head.appendChild(st);   /* only after measuring: it hides the board */
    document.querySelectorAll('.s').forEach(s => box.appendChild(s));
    document.body.appendChild(box);
    /* gradients and charts drawn in SVG go into the art layer */
    document.querySelectorAll('#xbox .s *').forEach(el => {
      const cs = getComputedStyle(el);
      if (el.tagName === 'svg' && !el.classList.contains('tb')) el.dataset.art = '';
      else if (cs.backgroundImage !== 'none' && !el.closest('.ph')) el.dataset.art = '';
    });
    return out;
  });

  const results = [];
  for (const pg of pages) {
    const sel = `.s[data-x="${pg.t}-${pg.i}"]`;
    const data = await page.evaluate(extract, sel);

    /* art layer */
    await page.evaluate(sel => document.querySelector(sel).classList.add('xart'), sel);
    const r = await page.evaluate(sel => { const b = document.querySelector(sel).getBoundingClientRect();
      return { x: b.left + scrollX, y: b.top + scrollY, width: b.width, height: b.height }; }, sel);
    const dir = path.join(OUT, TEMPLATES[pg.t].slug);
    fs.mkdirSync(dir, { recursive: true });
    const n = String(pg.i + 1).padStart(2, '0');
    await page.screenshot({ path: path.join(dir, `p${n}-art.jpg`), clip: r, type: 'jpeg', quality: 90, captureBeyondViewport: true });
    await page.evaluate(sel => document.querySelector(sel).classList.remove('xart'), sel);

    /* photo placeholders, each on its own with transparent corners */
    for (let k = 0; k < data.photos.length; k++) {
      const ph = data.photos[k];
      await page.evaluate((sel, k) => { const s = document.querySelector(sel); s.classList.add('xph');
        s.querySelectorAll('.ph')[k].classList.add('xon'); }, sel, k);
      await page.screenshot({ path: path.join(dir, `p${n}-photo${k + 1}.png`), omitBackground: true, captureBeyondViewport: true,
        clip: { x: r.x + ph.x, y: r.y + ph.y, width: ph.w, height: ph.h } });
      await page.evaluate((sel, k) => { const s = document.querySelector(sel); s.classList.remove('xph');
        s.querySelectorAll('.ph')[k].classList.remove('xon'); }, sel, k);
    }
    results.push({ ...pg, n, data });
  }
  await browser.close();

  /* one HTML file per template */
  TEMPLATES.forEach((tpl, t) => {
    const own = results.filter(p => p.t === t);
    const url = f => BASE_URL + tpl.slug + '/' + f;
    const px = v => Math.round(v * 10) / 10 + 'px';
    const body = own.map(p => {
      const els = [`<img src="${url(`p${p.n}-art.jpg`)}" alt="" style="left:0;top:0;width:${p.w}px;height:${p.h}px">`];
      p.data.photos.forEach((ph, k) => els.push(
        `<img src="${url(`p${p.n}-photo${k + 1}.png`)}" alt="Photo placeholder" style="left:${px(ph.x)};top:${px(ph.y)};width:${px(ph.w)};height:${px(ph.h)}">`));
      for (const it of p.data.items) {
        if (it.k === 'rect') els.push(`<div style="left:${px(it.x)};top:${px(it.y)};width:${px(it.w)};height:${px(it.h)};background:${it.c};border-radius:${px(it.rad)}"></div>`);
        else els.push(`<div style="left:${px(it.x)};top:${px(it.y)};width:${px(it.w)};font-family:'${it.font}';font-size:${px(it.size)};font-weight:${it.weight};line-height:${px(it.lh)};letter-spacing:${px(it.ls)};color:${it.c};text-align:${it.align}">${it.html}</div>`);
      }
      return `<section data-document-role="page" data-label="${p.label}" style="width:${p.w}px;height:${p.h}px;background:${p.data.bg}">\n  ${els.join('\n  ')}\n</section>`;
    }).join('\n');
    const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${tpl.name}</title>
<link rel="stylesheet" href="${FONTS}">
<style>body{margin:0}section{position:relative;overflow:hidden}section>*{position:absolute;margin:0;box-sizing:border-box;white-space:normal}</style>
</head><body>
${body}
</body></html>
`;
    fs.writeFileSync(path.join(OUT, tpl.slug, 'index.html'), html);
    console.log(tpl.slug, own.length, 'pages');
  });
})();

/* runs in the page: one slide/page -> its editable layer */
function extract(sel) {
  const s = document.querySelector(sel);
  const S = s.getBoundingClientRect();
  const ART = '.au,svg.tb,img.logo,[data-art],.rail .lbl';
  const inArt = el => !!el.closest(ART);
  const inPh = el => !!el.closest('.ph');
  const opacityOf = el => { let o = 1; for (let e = el; e && e !== s.parentElement; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity); return o; };
  const rgba = (c, op) => {
    const m = c && c.match(/rgba?\(([^)]+)\)/); if (!m) return null;
    const p = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number);
    const a = (p.length > 3 ? p[3] : 1) * op;
    return a <= 0.004 ? null : `rgba(${p[0]},${p[1]},${p[2]},${Math.round(a * 1000) / 1000})`;
  };
  const radius = (cs, r) => { const v = cs.borderTopLeftRadius;
    return v.endsWith('%') ? Math.min(r.width, r.height) * parseFloat(v) / 100 : parseFloat(v) || 0; };

  /* a text block is the nearest non-inline ancestor of a run of text */
  const blocks = new Set();
  const tw = document.createTreeWalker(s, NodeFilter.SHOW_TEXT);
  for (let n; (n = tw.nextNode());) {
    if (!n.textContent.trim()) continue;
    let b = n.parentElement;
    while (b !== s && getComputedStyle(b).display === 'inline') b = b.parentElement;
    if (!inArt(b) && !inPh(b) && !b.closest('svg')) blocks.add(b);
  }

  const esc = t => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const ser = (node, op) => {
    let out = '';
    for (const ch of node.childNodes) {
      if (ch.nodeType === 3) {
        let t = ch.textContent.replace(/\s+/g, ' ');
        if (getComputedStyle(ch.parentElement).textTransform === 'uppercase') t = t.toUpperCase();
        out += esc(t);
      } else if (ch.nodeType === 1) {
        if (ch.tagName === 'BR') { out += '<br>'; continue; }
        const c = getComputedStyle(ch), pc = getComputedStyle(node);
        if (c.display !== 'inline') continue;
        const st = [];
        if (c.color !== pc.color) st.push('color:' + rgba(c.color, opacityOf(ch)));
        if (c.fontWeight !== pc.fontWeight) st.push('font-weight:' + c.fontWeight);
        if (c.fontSize !== pc.fontSize) st.push('font-size:' + c.fontSize);
        if (c.fontFamily !== pc.fontFamily) st.push(`font-family:'${c.fontFamily.split(',')[0].replace(/["']/g, '').trim()}'`);
        const inner = ser(ch, op);
        out += st.length ? `<span style="${st.join(';')}">${inner}</span>` : inner;
      }
    }
    return out;
  };

  const items = [], photos = [];
  const walk = el => {
    if (el !== s) {
      if (inArt(el)) return;
      if (el.classList.contains('ph')) {
        const r = el.getBoundingClientRect();
        photos.push({ x: r.left - S.left, y: r.top - S.top, w: r.width, h: r.height });
        return;
      }
      const cs = getComputedStyle(el);
      if (cs.display === 'none') return;
      const r = el.getBoundingClientRect(), op = opacityOf(el);
      if (!el.matches('.win,.rail')) {
        const bg = rgba(cs.backgroundColor, op);
        if (bg && r.width > 0 && r.height > 0)
          items.push({ k: 'rect', x: r.left - S.left, y: r.top - S.top, w: r.width, h: r.height, c: bg, rad: radius(cs, r) });
        for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
          const bw = parseFloat(cs['border' + side + 'Width']), col = rgba(cs['border' + side + 'Color'], op);
          if (!(bw > 0) || !col) continue;
          const x = side === 'Right' ? r.right - bw : r.left, y = side === 'Bottom' ? r.bottom - bw : r.top;
          const w = side === 'Top' || side === 'Bottom' ? r.width : bw, h = side === 'Top' || side === 'Bottom' ? bw : r.height;
          items.push({ k: 'rect', x: x - S.left, y: y - S.top, w, h, c: col, rad: 0 });
        }
      }
      if (blocks.has(el)) {
        const pl = parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth), pr = parseFloat(cs.paddingRight) + parseFloat(cs.borderRightWidth);
        const pt = parseFloat(cs.paddingTop) + parseFloat(cs.borderTopWidth);
        const align = { start: 'left', left: 'left', center: 'center', right: 'right', end: 'right', '-webkit-center': 'center' }[cs.textAlign] || 'left';
        /* a little slack so a slightly wider font metric in Canva doesn't wrap a line early */
        let x = r.left + pl - S.left, w = r.width - pl - pr;
        const slack = Math.max(6, w * 0.04);
        if (align === 'left') w += slack; else if (align === 'right') { x -= slack; w += slack; } else { x -= slack / 2; w += slack; }
        const size = parseFloat(cs.fontSize);
        const html = ser(el, op).replace(/\s*<br>\s*/g, '<br>').trim();
        if (html) items.push({
          k: 'text', x, y: r.top + pt - S.top, w, html,
          font: cs.fontFamily.split(',')[0].replace(/["']/g, '').trim(),
          size, weight: cs.fontWeight,
          lh: cs.lineHeight === 'normal' ? size * 1.2 : parseFloat(cs.lineHeight),
          ls: cs.letterSpacing === 'normal' ? 0 : parseFloat(cs.letterSpacing),
          c: rgba(cs.color, op), align,
        });
      }
    }
    for (const ch of el.children) walk(ch);
  };
  walk(s);
  return { items, photos, bg: getComputedStyle(s).backgroundColor };
}
