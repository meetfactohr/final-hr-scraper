const express = require('express');
const multer = require('multer');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
const { createObjectCsvWriter } = require('csv-writer');

puppeteer.use(StealthPlugin());
const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(express.static('public'));
app.use(express.json());

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
    clients.forEach(c => c.res.write(`data: ${JSON.stringify({ type, message: msg })}\n\n`));
}

// --- SCRAPER ENGINE ---
async function runScraper(companies) {
    const browser = await puppeteer.launch({ 
        headless: false, 
        args: ['--start-maximized', '--no-sandbox'] 
    });
    const page = await browser.newPage();
    const rawData = [];
    const HR_KEYWORDS = ["Human Resources", "HR", "Talent", "People", "Recruit", "Acquisition"];

    for (let i = 0; i < companies.length; i++) {
        const company = companies[i];
        sendUpdate(`Analyzing (${i + 1}/${companies.length}): ${company}`);

        try {
            // 1. Find Domain
            await page.goto(`https://www.google.com/search?q=${encodeURIComponent(company + " official site")}`);
            if (page.url().includes("sorry/index")) {
                sendUpdate("CAPTCHA detected! Please solve it in the browser.", "captcha");
                await page.waitForFunction(() => !window.location.href.includes("sorry/index"), { timeout: 0 });
            }

            let foundDomain = await page.evaluate(() => {
                const links = Array.from(document.querySelectorAll('#search a'));
                for (const link of links) {
                    if (link.href && !/google|linkedin|facebook|justdial|youtube|glassdoor/.test(link.href)) return link.href;
                }
                return "N/A";
            });
            if (foundDomain !== "N/A") foundDomain = new URL(foundDomain).hostname.replace('www.', '');

            // 2. Find HR Lead
            const query = `site:in.linkedin.com/in/ "${company}" "Human Resources"`;
            await page.goto(`https://www.google.com/search?q=${encodeURIComponent(query)}`);

            const leads = await page.evaluate((currComp, keywords) => {
                const results = [];
                document.querySelectorAll('h3').forEach(h3 => {
                    const linkEl = h3.closest('a');
                    const container = linkEl?.closest('div.g');
                    if (!linkEl) return;

                    const title = h3.innerText;
                    const snippet = container ? container.innerText : "";
                    const text = (title + " " + snippet).toLowerCase();
                    
                    let score = 10;
                    if (text.includes(currComp.toLowerCase()) && keywords.some(k => text.includes(k.toLowerCase()))) score = 100;
                    else if (text.includes(currComp.toLowerCase())) score = 70;
                    else if (keywords.some(k => text.includes(k.toLowerCase()))) score = 50;

                    let name = title.split(/ [-|] /)[0].trim();
                    if (name.includes(" at ")) name = name.split(" at ")[0].trim();

                    if (score >= 50 && name.split(' ').length >= 2) {
                        results.push({ name, link: linkEl.href, score, company: currComp });
                    }
                });
                return results;
            }, company, HR_KEYWORDS);

            leads.forEach(l => rawData.push({ ...l, domain: foundDomain }));
        } catch (e) { console.error(e); }
    }

    await browser.close();
    return filterAgenticData(rawData);
}

function filterAgenticData(data) {
    const unique = new Map();
    // Sort by score 100 -> 70 -> 50
    data.sort((a, b) => b.score - a.score);
    data.forEach(item => {
        if (!unique.has(item.company)) unique.set(item.company, item);
    });
    return Array.from(unique.values());
}

// --- ROUTES ---
app.post('/upload', upload.single('csvfile'), (req, res) => {
    const companies = [];
    fs.createReadStream(req.file.path).pipe(csv())
        .on('data', (row) => { 
            const name = Object.values(row)[0];
            if(name) companies.push(name); 
        })
        .on('end', async () => {
            if (companies.length > 300) {
                return res.status(400).json({ success: false, message: "Limit exceeded: Max 300 companies allowed." });
            }
            const results = await runScraper(companies);
            const fileName = `results_${Date.now()}.csv`;
            const filePath = path.join(__dirname, 'results', fileName);

            const writer = createObjectCsvWriter({
            path: filePath,
            header: [
            {id: 'company', title: 'Company'},
            {id: 'domain', title: 'Domain'},
            {id: 'name', title: 'Name'},
            {id: 'link', title: 'LinkedIn Profile'}, // <--- ADD THIS LINE
            {id: 'score', title: 'Score'}
    ]
});

            await writer.writeRecords(results);
            res.json({ success: true, data: results, downloadUrl: `/download/${fileName}` });
        });
});

app.get('/download/:file', (req, res) => res.download(path.join(__dirname, 'results', req.params.file)));

app.listen(3000, () => console.log('Server running: http://localhost:3000'));