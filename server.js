const puppeteer = require("puppeteer");
const fs = require("fs-extra");
const { exec } = require("child_process");
const path = require("path");

const MAX_DOWNLOAD_SIZE_BYTES = 1 * 1024 * 1024 * 1024; // 1 GB
const DOWNLOAD_DIR = path.join(__dirname, "downloads");
let totalDownloaded = 0;
const downloadedLinks = new Set();

async function downloadFile(url) {
  return new Promise((resolve, reject) => {
    console.log(`[yt-dlp] Downloading: ${url}`);

    const command = `yt-dlp -P "${DOWNLOAD_DIR}" --no-part --max-filesize 2G ${url}`;
    const proc = exec(command);

    proc.stdout.on("data", (data) => {
      const sizeMatch = data.match(/(\d+(?:\.\d+)?)([KMG]i?B)/);
      if (sizeMatch) {
        const [_, amount, unit] = sizeMatch;
        let bytes = parseFloat(amount);
        if (unit.includes("KiB")) bytes *= 1024;
        else if (unit.includes("MiB")) bytes *= 1024 ** 2;
        else if (unit.includes("GiB")) bytes *= 1024 ** 3;

        totalDownloaded += bytes;
        console.log(`[yt-dlp] Total downloaded: ${(totalDownloaded / (1024 ** 2)).toFixed(2)} MB`);
      }
    });

    proc.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(`yt-dlp failed with code ${code}`);
    });
  });
}

function isMediaLink(url) {
  return (
    /v\.redd\.it|i\.redd\.it|redgifs\.com|imgur\.com|gfycat\.com|\.mp4|\.mkv|\.gif|\.jpg|\.jpeg|\.png/i.test(url)
  );
}

async function run() {
  await fs.ensureDir(DOWNLOAD_DIR);
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();

  await page.goto("https://www.reddit.com/user/TastyPocket_GF/submitted/", {
    waitUntil: "networkidle2",
  });

  let lastHeight = 0;
  while (totalDownloaded < MAX_DOWNLOAD_SIZE_BYTES) {
    console.log("🔄 Scrolling...");
    await page.evaluate(() => {
      window.scrollBy(0, window.innerHeight * 0.9);
    });
    await new Promise((resolve) => setTimeout(resolve, 4000 + Math.random() * 1000));

    const postLinks = await page.$$eval("a", (anchors) =>
      anchors
        .map((a) => a.href)
        .filter((href) => href && href.startsWith("https://"))
    );

    const mediaLinks = postLinks.filter((link) => isMediaLink(link));
    console.log(`🔍 Found ${mediaLinks.length} media links...`);

    for (const link of mediaLinks) {
      if (!downloadedLinks.has(link)) {
        downloadedLinks.add(link);
        try {
          await downloadFile(link);
          if (totalDownloaded >= MAX_DOWNLOAD_SIZE_BYTES) break;
        } catch (err) {
          console.error("❌ Download failed:", err);
        }
      }
    }

    const newHeight = await page.evaluate(() => document.body.scrollHeight);
    if (newHeight === lastHeight) break;
    lastHeight = newHeight;
  }

  console.log(`✅ Done. Total downloaded: ${(totalDownloaded / (1024 ** 2)).toFixed(2)} MB`);
  await browser.close();
}

run().catch(console.error);
