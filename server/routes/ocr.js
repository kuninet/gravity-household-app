const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
require('dotenv').config();
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Configure Multer (Temporary storage)
const ocrTmpDir = path.join(__dirname, '..', '.ocr_tmp');
if (!fs.existsSync(ocrTmpDir)) {
    fs.mkdirSync(ocrTmpDir);
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        // Use a project-local directory not listed in .gitignore to satisfy Gemini CLI workspace rules
        cb(null, ocrTmpDir)
    },
    filename: function (req, file, cb) {
        // Keep the original extension so Gemini CLI recognizes the file type (e.g. .pdf, .jpeg)
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname))
    }
});
const upload = multer({ storage: storage });

// Initialize Gemini
const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
    console.warn("GEMINI_API_KEY is not set in .env file.");
}
const genAI = new GoogleGenerativeAI(API_KEY || "DUMMY_KEY");

// Helper to convert file to GenerativePart
function fileToGenerativePart(path, mimeType) {
    return {
        inlineData: {
            data: Buffer.from(fs.readFileSync(path)).toString("base64"),
            mimeType
        },
    };
}

// Helper to get available models
async function getAvailableModels() {
    let modelsArray = [
        { id: "gemini-cli", name: "Gemini CLI (Google One AI Pro)" }
    ];

    if (!API_KEY) return modelsArray;

    try {
        // Use REST API to list models as SDK might not expose it easily in this version
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`);
        const data = await response.json();
        if (data.models) {
            const apiModels = data.models
                .filter(m => m.name.includes('gemini') && m.supportedGenerationMethods.includes('generateContent'))
                .map(m => ({
                    id: m.name.replace('models/', ''),
                    name: m.displayName
                }));
            modelsArray = modelsArray.concat(apiModels);
            return modelsArray;
        }
    } catch (e) {
        console.error("Failed to fetch models:", e);
    }
    // Fallback list if API fails
    return [
        { id: "gemini-cli", name: "Gemini CLI (Google One AI Pro)" },
        { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash" },
        { id: "gemini-1.5-flash", name: "Gemini 1.5 Flash" },
        { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro" }
    ];
}

router.get('/models', async (req, res) => {
    const models = await getAvailableModels();
    res.json({ models });
});

router.post('/analyze', upload.single('image'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: "No image file provided." });
    }

    try {
        const prompt = `
        Analyze this receipt image and extract the items purchased, the date, and the store name.
        Return ONLY a JSON object with keys "items", "date", and "store".
        
        "items": An array of objects, where each object has:
        - "description": The name of the item (string)
        - "amount": The price of the item (number, remove currency symbols)
        
        "date": The date of the receipt in YYYY-MM-DD format (string). If year is missing, guess current year. If unknown, return null.
        "store": The name of the store (string). If unknown, return null.

        Example format:
        {
          "store": "Supermarket ABC",
          "date": "2024-05-20",
          "items": [
            { "description": "Apple", "amount": 100 },
            { "description": "Milk", "amount": 200 }
          ]
        }
        
        Ignore total amounts, taxes, or change for the items list. Just list the line items.
        If the image is not a receipt or unreadable, return {"items": [], "date": null, "store": null}.
        `;

        // Determine model to use
        const userModel = req.body.model;
        console.log(`[OCR] Request received. Selected model: ${userModel || 'None (Using default)'}`);

        let jsonStr = "";

        if (userModel === 'gemini-cli') {
            console.log(`[OCR] Using Gemini CLI (Headless Mode)`);
            const filePath = path.resolve(req.file.path);

            let cmd;
            if (process.platform === 'win32') {
                // Windows (cmd.exe) does not support multi-line strings well and uses double quotes.
                // Replace double quotes with escaped double quotes and remove newlines. Remove NUL redirection to fix node-pty crashes.
                const safePrompt = prompt.replace(/"/g, '\\"').replace(/\r?\n/g, ' ');
                cmd = `gemini -p "${safePrompt} @${filePath}" --yolo -o json`;
            } else {
                // Unix handles single-quoted multi-line strings easily. Remove /dev/null redirection.
                const safePrompt = prompt.replace(/'/g, "'\\''");
                cmd = `gemini -p '${safePrompt} @${filePath}' --yolo -o json`;
            }

            jsonStr = await new Promise((resolve, reject) => {
                // gemini CLI command could take a while
                exec(cmd, { cwd: process.cwd(), maxBuffer: 1024 * 1024 * 5, timeout: 120000 }, (error, stdout, stderr) => {
                    if (error) {
                        console.error("[OCR] gemini CLI command failed:", error);
                        console.error("[OCR] CLI STDERR:", stderr);
                        reject(new Error(`Gemini CLI failed: ${error.message}`));
                        return;
                    }
                    try {
                        const cliResult = JSON.parse(stdout);
                        // The gemini CLI JSON output contains a "response" field with markdown wrapped json string
                        const responseString = cliResult.response || "";
                        let innerJsonStr = responseString.replace(/```json/g, '').replace(/```/g, '').trim();
                        // If it's empty but API call succeeded, that's what we have
                        resolve(innerJsonStr || "{\n  \"items\": [],\n  \"date\": null,\n  \"store\": null\n}");
                    } catch (parseErr) {
                        console.error("[OCR] Failed to parse internal CLI result JSON:", parseErr);
                        console.error("[OCR] Raw CLI STDOUT:", stdout);
                        reject(parseErr);
                    }
                });
            });

            // Pre-validate the extracted json to avoid 500 downstream if it's just raw text
            try {
                JSON.parse(jsonStr);
            } catch (e) {
                console.warn("[OCR] CLI output is not valid JSON, returning empty items.", jsonStr);
                jsonStr = '{"items": [], "date": null, "store": null}';
            }

        } else {
            console.log(`[OCR] Using Internal @google/generative-ai SDK`);
            if (!API_KEY) {
                throw new Error("Server configuration error: API Key missing for SDK model.");
            }
            let modelsToTry = ["gemini-2.0-flash", "gemini-1.5-flash"]; // Default fallback chain

            if (userModel && userModel !== 'gemini-cli') {
                modelsToTry = [userModel];
            }

            console.log(`[OCR] Models to try: ${JSON.stringify(modelsToTry)}`);

            let result = null;
            let lastError = null;

            for (const modelName of modelsToTry) {
                try {
                    console.log(`Trying model: ${modelName}`);
                    const model = genAI.getGenerativeModel({ model: modelName });
                    const imagePart = fileToGenerativePart(req.file.path, req.file.mimetype);
                    result = await model.generateContent([prompt, imagePart]);
                    if (result) break; // Success
                } catch (e) {
                    console.warn(`Model ${modelName} failed:`, e.message);
                    lastError = e;
                }
            }

            if (!result) {
                throw new Error(`All models failed. Last error: ${lastError?.message}`);
            }
            const response = await result.response;
            const text = response.text();
            jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
        }

        // Cleanup uploaded file
        fs.unlinkSync(req.file.path);

        // Parse extracted JSON
        const data = JSON.parse(jsonStr);

        res.json(data);

    } catch (error) {
        console.error("OCR Error:", error);
        // Cleanup on error too
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        res.status(500).json({ error: "Failed to analyze receipt." });
    }
});

module.exports = router;
