const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const fs = require('fs');

puppeteer.use(StealthPlugin());

// --- <¯ TARGET LIST ---
const TARGET_COMPANIES = [
    "South Eastern Roadways",
"Eggoz",
    "VK:a Architecture",
    "Loan Frame",
    "Winds E World",
    "AllCloud Enterprise Solutions",
    "Vara Infrovate",
    "SPR & CO",
    "1 Finance",
    "Talview",
    "Rajratan Global Wire",
    "Access Design Solutions",
    "GT Group",
    "Avenues India",
    "Stella Industries",
    "Greatship (India)",
    "Yhills Edutech",
    "Patel Integrated Logistics",
    "True Elements",
    "Skm Egg Products Export",
    "Rupee112",
    "Aachi Groups Of Companies",
    "Orient Exchange And Financial Services",
    "Perfect Relations",
    "Infibeam",
    "FinSurge",
    "INI Design Studio",
    "TransTech Projects",
    "Harsh Transport Private Limited",
    "Akya Retail",
    "Sunvik Steels",
    "Shakti Bhog Foods",
    "Web Date Systems",
    "Ridings Consulting Engineers India",
    "PAYBACK",
    "Vanguard Logistics Services",
    "Jayanti Herbs & Spice",
    "Vasavi Power Services",
    "Griffith Foods",
    "Southern Health Foods",
    "ANB Consulting Co.",
    "Beauto Systems",
    "Maestro Steel Detailing",
    "Cox & Kings Global Services",
    "Cyboard School",
    "Magistral",
    "DEEJOS Architects & Constructions",
    "Enlighted",
    "Western International Group",
    "Chitale Bandhu Mithaiwale",
    "Newly Weds Foods India",
    "ANCIT Consulting",
    "Ethics Group",
    "Rishi Kiran Logistics",
    "VYOM",
    "ABC for Technology Training",
    "Adage Automation",
    "Mavericks Education",
    "SPER Market Research",
    "Kotec Automotive Services",
    "Amer Juneidi for Food Industries",
    "Nandan Saha Steel",
    "TRC Worldwide Engineering",
    "Fourth Dimension Group",
    "Deson Marketing",
    "Wholsum Foods Pvt Ltd",
    "Sheetal Cool Products",
    "GTROPY",
    "Deccan Healthcare",
    "Geeta Shipping and Clearing Services"
];

const HR_KEYWORDS = ["Human Resources", "HR", "Talent", "People", "Recruit", "Acquisition"];
const SESSION_FILE = 'google_session.json'; 

const csvPath = 'final_company_data.csv';
const csvWriter = createCsvWriter({
    path: csvPath,
    header: [
        {id: 'company', title: 'Company Input'},
        {id: 'domain', title: 'Official Domain'},
        {id: 'name', title: 'Name'},
        {id: 'snippet', title: 'Raw Snippet'},
        {id: 'link', title: 'Profile Link'},
        {id: 'score', title: 'Confidence'}
    ],
    append: fs.existsSync(csvPath)
});

const wait = (min, max) => new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * (max - min + 1) + min)));

(async () => {
    console.log("=€ Starting Universal Structure Scraper...");

    const browser = await puppeteer.launch({
        headless: false,
        defaultViewport: null,
        args: ['--start-maximized', '--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    // Use a standard Desktop User Agent to ensure standard HTML structure
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Restore Cookies
    if (fs.existsSync(SESSION_FILE)) {
        console.log("<j Session Loaded.");
        const cookies = JSON.parse(fs.readFileSync(SESSION_FILE));
        await page.setCookie(...cookies);
    }

    for (const company of TARGET_COMPANIES) {
        console.log(`\n<â Analyzing: ${company}...`);
        let foundDomain = "N/A";

        // ==========================================
        // PHASE 1: DOMAIN (Tag-Based)
        // ==========================================
        try {
            await page.goto(`https://www.google.com/search?q=${encodeURIComponent(company + " official site")}`, { waitUntil: 'domcontentloaded' });
            if (await checkForCaptcha(page)) saveSession(page);

            foundDomain = await page.evaluate(() => {
                // Find the main search container
                const main = document.getElementById('search');
                if (!main) return "N/A";

                // Get all links inside the search container
                const links = Array.from(main.querySelectorAll('a'));
                
                for (const link of links) {
                    const href = link.href;
                    // Strict filtering to ignore Google's own links and directories
                    if (href && !href.includes("google") && !href.includes("linkedin") && !href.includes("facebook") && !href.includes("justdial") && !href.includes("glassdoor") && !href.includes("youtube")) {
                        return href; // Return first valid organic link
                    }
                }
                return "N/A";
            });

            if (foundDomain !== "N/A") {
                try {
                    foundDomain = new URL(foundDomain).hostname.replace('www.', '');
                } catch (e) {}
            }
            console.log(`   < Domain: ${foundDomain}`);

        } catch (e) {
            console.log("     Domain Error.");
        }

        // ==========================================
        // PHASE 2: HR X-RAY (Universal Selector)
        // ==========================================
        try {
            const query = `site:in.linkedin.com/in/ "${company}" "Human Resources"`;
            await page.goto(`https://www.google.com/search?q=${encodeURIComponent(query)}`, { waitUntil: 'domcontentloaded' });
            if (await checkForCaptcha(page)) saveSession(page);

            const leads = await page.evaluate((currCompany, keywords) => {
                const data = [];
                
                // UNIVERSAL SELECTOR: Find every H3 (Title), then find its parent Anchor (Link)
                const titles = document.querySelectorAll('h3');

                titles.forEach(h3 => {
                    try {
                        const linkEl = h3.closest('a'); // Find the link wrapping the title
                        if (!linkEl) return;

                        // Navigate up to find the container text (Snippet)
                        // usually the great-grandparent contains the snippet text
                        const container = linkEl.closest('div.g') || linkEl.parentElement.parentElement;
                        const fullContainerText = container ? container.innerText : "";

                        const rawTitle = h3.innerText; // "Jane Doe - HR - Company"
                        const link = linkEl.href;
                        
                        // Parse Name
                        let name = rawTitle.split(/ [-|] /)[0].trim();
                        if (name.includes(" at ")) name = name.split(" at ")[0].trim();

                        // --- AI SCORING (100/70/50/10) ---
                        let score = 10;
                        const textLower = (rawTitle + " " + fullContainerText).toLowerCase();
                        const companyLower = currCompany.toLowerCase();

                        const matchedCompany = textLower.includes(companyLower);
                        const matchedRole = keywords.some(k => textLower.includes(k.toLowerCase()));

                        if (matchedCompany && matchedRole) score = 100;
                        else if (matchedCompany) score = 70;
                        else if (matchedRole) score = 50;

                        // Save if valid person
                        if (!name.includes("Profiles") && !name.includes("Jobs") && !link.includes("/dir/") && score >= 50) {
                            data.push({
                                company: currCompany,
                                name: name,
                                snippet: rawTitle, // Title is cleaner than full text
                                link: link,
                                score: score + "%"
                            });
                        }
                    } catch (e) {}
                });
                return data;
            }, company, HR_KEYWORDS);

            if (leads.length > 0) {
                // Add domain info to all leads found
                const rows = leads.map(l => ({ ...l, domain: foundDomain }));
                await csvWriter.writeRecords(rows);
                console.log(`    Found ${leads.length} candidates. Saved.`);
            } else {
                console.log("     No candidates found (Page might be empty or Captcha blocked).");
                // Take a screenshot if it fails, so you can see why
                await page.screenshot({ path: `error_${company.replace(/\s/g, '')}.png` });
            }

        } catch (e) {
            console.log("     HR Error: " + e.message);
        }

        const delay = Math.floor(Math.random() * (4000 - 2000 + 1) + 2000);
        await wait(delay, delay + 500);
    }

    console.log("\n<‰ DONE! Check 'final_company_data.csv'");
    await browser.close();
})();

async function checkForCaptcha(page) {
    if (page.url().includes("sorry/index") || await page.$('#captcha-form')) {
        console.log("=Ñ CAPTCHA! Solve manually...");
        await page.waitForFunction(() => !window.location.href.includes("sorry/index"), { timeout: 0 });
        console.log(" Solved.");
        return true;
    }
    return false;
}

async function saveSession(page) {
    const cookies = await page.cookies();
    fs.writeFileSync(SESSION_FILE, JSON.stringify(cookies, null, 2));
}