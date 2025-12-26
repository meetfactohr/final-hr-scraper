const express = require('express');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
const { createObjectCsvWriter } = require('csv-writer');
const { validate } = require('deep-email-validator');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(express.static('public'));
app.use(express.json());

// --- SSE Real-time Updates ---
let clients = [];
app.get('/status', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const clientId = Date.now();
    clients.push({ id: clientId, res });
    req.on('close', () => clients = clients.filter(c => c.id !== clientId));
});

function sendUpdate(msg, type = 'progress', extra = {}) {
    clients.forEach(c => c.res.write(`data: ${JSON.stringify({ type, message: msg, ...extra })}\n\n`));
}

// --- EMAIL VERIFICATION ENGINE ---
async function verifyEmail(email) {
    try {
        const res = await validate({
            email: email,
            validateSMTP: true,      // The "Hunter" Handshake
            validateDisposable: true, // Block temp emails
            validateMx: true,         // Verify domain mail server
        });

        let status = res.valid ? "Valid" : "Invalid";
        let score = res.valid ? 100 : 0;
        let reason = res.reason || "Success";

        // Logic for Catch-all (Risky)
        // Many business servers (Outlook/Mimecast) accept all emails. 
        // If SMTP passes but MX is a known catch-all provider, we adjust the score.
        if (res.valid && res.validators.smtp.reason === 'Mailbox is a catch-all') {
            status = "Risky (Catch-all)";
            score = 70;
            reason = "Server accepts all addresses";
        }

        return { email, status, score, reason };
    } catch (error) {
        return { email, status: "Unknown", score: 0, reason: "Check Timeout" };
    }
}

// --- BATCH PROCESSOR ---
async function runEmailProcessor(emails, fileName) {
    const filePath = path.join(__dirname, 'results', fileName);
    if (!fs.existsSync('results')) fs.mkdirSync('results');

    const csvWriter = createObjectCsvWriter({
        path: filePath,
        header: [
            {id: 'email', title: 'Email Address'},
            {id: 'status', title: 'Status'},
            {id: 'score', title: 'Accuracy Score'},
            {id: 'reason', title: 'Detection Details'}
        ]
    });

    for (let i = 0; i < emails.length; i++) {
        const email = emails[i].trim();
        if (!email) continue;

        sendUpdate(`Verifying (${i + 1}/${emails.length}): ${email}`);
        
        const result = await verifyEmail(email);
        await csvWriter.writeRecords([result]);
        
        // Push result to UI table immediately
        sendUpdate("Email Verified", "row_found", { result });
        
        // Anti-block delay (Humans verify emails slower than bots)
        await new Promise(r => setTimeout(r, 1000));
    }

    sendUpdate("All emails verified.", "finish", { downloadUrl: `/download/${fileName}` });
}

// --- ROUTES ---
app.post('/upload', upload.single('csvfile'), (req, res) => {
    const emails = [];
    fs.createReadStream(req.file.path).pipe(csv())
        .on('data', (row) => { 
            const val = Object.values(row)[0];
            if(val && val.includes('@')) emails.push(val); 
        })
        .on('end', () => {
            const fileName = `verified_emails_${Date.now()}.csv`;
            res.json({ success: true, message: "Verification started..." });
            runEmailProcessor(emails, fileName);
        });
});

app.get('/download/:file', (req, res) => res.download(path.join(__dirname, 'results', req.params.file)));

app.listen(3000, () => console.log('Server running: http://localhost:3001'));