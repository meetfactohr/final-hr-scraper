const express = require('express');
const multer = require('multer');
const puppeteer = require('puppeteer-extra');
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
const { createObjectCsvWriter } = require('csv-writer');
puppeteer.use(StealthPlugin());
const app = express();
const upload = multer({ dest: 'uploads/' });
app.use(express.static('public'));
app.use(express.json());
// Ensure the results directory exists
const resultsDir = path.join(__dirname, 'results');
if (!fs.existsSync(resultsDir)) {
fs.mkdirSync(resultsDir);
}
// For Real-time Status Updates
let clients = [];
app.get('/status', (req, res) => {
res.setHeader('Content-Type', 'text/event-stream');
res.setHeader('Cache-Control', 'no-cache');
res.setHeader('Connection', 'keep-alive');
const clientId = Date.now();
clients.push({ id: clientId, res });
req.on('close', () => clients = clients.filter(c => c.id !== clientId));
});
function sendUpdate(msg, type = 'progress') {
clients.forEach(c => c.res.write(data: ${JSON.stringify({ type, message: msg })}\n\n));
}
// --- SCRAPER ENGINE ---
async function runScraper(companies) {
const browser = await puppeteer.launch({
channel: 'chrome',
headless: false, // Set to true for production if no visual interaction is needed
args: ['--start-maximized', '--no-sandbox']
});
const page = await browser.newPage();
const results = []; // This will store the final structured data
for (let i = 0; i < companies.length; i++) {
    const company = companies[i];
    sendUpdate(`Analyzing (${i + 1}/${companies.length}): ${company}`);

    let foundDomain = "N/A";
    let ceoName = "N/A";
    let ceoLinkedIn = "N/A";

    try {
        // --- 1. Find Official Website (AI Mode: Targeted Google Search) ---
        await page.goto(`https://www.google.com/search?q=${encodeURIComponent(`"${company}" official website`)}`);
        if (page.url().includes("sorry/index")) {
            sendUpdate("CAPTCHA detected! Please solve it in the browser.", "captcha");
            await page.waitForFunction(() => !window.location.href.includes("sorry/index"), { timeout: 0 });
        }

        foundDomain = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('#search a'));
            for (const link of links) {
                // Prioritize links that are direct domains and exclude common social/directory sites
                if (link.href && 
                    !/google|linkedin|facebook|twitter|instagram|youtube|glassdoor|wikipedia|crunchbase|zoominfo|owler|indeed|justdial/.test(link.href) &&
                    link.href.includes(new URL(link.href).hostname) // Ensure it's a primary link to the domain
                ) {
                    return link.href;
                }
            }
            return "N/A";
        });
        if (foundDomain !== "N/A") {
            foundDomain = new URL(foundDomain).hostname.replace('www.', '');
        }

        // --- 2. Find CEO Name 
        await page.goto(`https://www.google.com/search?q=${encodeURIComponent(`site:in.linkedin.com/in/ "${company}" CEO`)}`);
        if (page.url().includes("sorry/index")) {
            sendUpdate("CAPTCHA detected! Please solve it in the browser.", "captcha");
            await page.waitForFunction(() => !window.location.href.includes("sorry/index"), { timeout: 0 });
        }

        const ceoInfo = await page.evaluate((currComp) => {
            const linkedinResults = [];
            document.querySelectorAll('h3').forEach(h3 => {
                const linkEl = h3.closest('a');
                const container = linkEl?.closest('div.g'); // The parent container for snippet
                if (!linkEl || !linkEl.href.includes('linkedin.com/in/')) return;

                const title = h3.innerText;
                const snippet = container ? container.innerText : "";
                const text = (title + " " + snippet).toLowerCase();
                
                // Basic scoring for relevance
                let score = 0;
                if (text.includes(currComp.toLowerCase())) score += 5;
                if (text.includes("ceo") || text.includes("chief executive officer")) score += 10;
                if (text.includes("founder")) score += 2; // CEOs are often founders

                // Try to extract name
                let name = title.split(/ [-|] /)[0].trim();
                if (name.includes(" at ")) name = name.split(" at ")[0].trim();

                if (score > 10 && name.split(' ').length >= 2) { // Ensure it's a plausible name
                    linkedinResults.push({ name, link: linkEl.href, score });
                }
            });

            // Sort by highest score to get the most relevant CEO
            linkedinResults.sort((a, b) => b.score - a.score);
            return linkedinResults.length > 0 ? linkedinResults[0] : null;

        }, company);

        if (ceoInfo) {
            ceoName = ceoInfo.name;
            ceoLinkedIn = ceoInfo.link;
        }

    } catch (e) {
        console.error(`Error processing ${company}:`, e);
        sendUpdate(`Error processing ${company}: ${e.message}`, 'error');
    } finally {
        results.push({
            company: company,
            domain: foundDomain,
            ceoName: ceoName,
            ceoLinkedIn: ceoLinkedIn
        });
    }
}

await browser.close();
return results; // Return the processed results directly
}
// --- ROUTES ---
app.post('/upload', upload.single('csvfile'), (req, res) => {
if (!req.file) {
return res.status(400).json({ success: false, message: 'No file uploaded.' });
}
const companies = [];
fs.createReadStream(req.file.path)
    .pipe(csv())
    .on('data', (row) => { 
        const name = Object.values(row)[0]; // Assumes company name is in the first column
        if(name) companies.push(name.trim()); 
    })
    .on('end', async () => {
        fs.unlink(req.file.path, (err) => { // Clean up the uploaded CSV
            if (err) console.error("Error deleting temp file:", err);
        });

        if (companies.length === 0) {
            sendUpdate("No companies found in the CSV file.", "error");
            return res.status(400).json({ success: false, message: 'No companies found in the CSV file.' });
        }

        const results = await runScraper(companies);
        const fileName = `results_${Date.now()}.csv`;
        const filePath = path.join(resultsDir, fileName); // Use the defined results directory

        const writer = createObjectCsvCsvWriter({
            path: filePath,
            header: [
                {id: 'company', title: 'Company'},
                {id: 'domain', title: 'Official Website'},
                {id: 'ceoName', title: 'CEO Name'},
                {id: 'ceoLinkedIn', title: 'CEO LinkedIn Profile'}
            ]
        });

        await writer.writeRecords(results);
        sendUpdate("Scraping completed and results saved!", "complete");
        res.json({ success: true, data: results, downloadUrl: `/download/${fileName}` });
    })
    .on('error', (err) => {
        console.error("Error reading CSV:", err);
        sendUpdate(`Error reading CSV: ${err.message}`, 'error');
        res.status(500).json({ success: false, message: 'Error processing CSV file.' });
    });
});
app.get('/download/:file', (req, res) => {
const filePath = path.join(resultsDir, req.params.file);
res.download(filePath, (err) => {
if (err) {
console.error("Error downloading file:", err);
res.status(404).send("File not found.");
}
});
});
app.listen(3000, () => console.log('Server running: http://localhost:3000'));
