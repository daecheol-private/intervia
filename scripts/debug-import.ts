import "./_load-env.mjs";
import * as cheerio from "cheerio";

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error("usage: npx tsx scripts/debug-import.ts <url>");
    process.exit(1);
  }

  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      "Accept-Language": "ko-KR,ko;q=0.9",
    },
  });
  const html = await res.text();
  console.log(`HTML size: ${html.length} chars`);

  const $ = cheerio.load(html);
  $(
    "script, style, noscript, nav, header, footer, aside, iframe, form, button, " +
      "[role=banner], [role=navigation], [role=contentinfo], " +
      ".gnb, .lnb, .footer, .header, .nav, .menu, .ad, .advertise, .banner, " +
      ".sidebar, .related, .recommend, [class*='ad-'], [id*='ad_'], [id*='ads-']"
  ).remove();

  const candidates = [
    ".user_content",
    ".jv_cont",
    ".jv_detail",
    ".recruit_view",
    ".recruitment-content",
    "#wrap_jview",
    ".job-content",
    ".job_sec",
    "#contents",
    "main",
    "article",
    "[role=main]",
  ];

  for (const sel of candidates) {
    const $el = $(sel);
    if ($el.length) {
      const sizes: number[] = [];
      $el.each((_, el) => {
        sizes.push($(el).text().trim().length);
      });
      console.log(
        `  ${sel}: ${$el.length} matches, sizes=${sizes.join(",")} (max=${Math.max(...sizes)})`
      );
    }
  }

  const bodyText = $("body").text().trim();
  console.log(`\nbody text: ${bodyText.length} chars`);
  console.log(`first 500 chars of body:\n${bodyText.slice(0, 500)}`);
  console.log(`\n--- user_content first 500 ---`);
  console.log($(".user_content").text().trim().slice(0, 500));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
