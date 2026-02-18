const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Configure Multer (Temporary storage)
const upload = multer({ dest: 'uploads/' });

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
    if (!API_KEY) return [];
    try {
        // Use REST API to list models as SDK might not expose it easily in this version
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`);
        const data = await response.json();
        if (data.models) {
            return data.models
                .filter(m => m.name.includes('gemini') && m.supportedGenerationMethods.includes('generateContent'))
                .map(m => ({
                    id: m.name.replace('models/', ''),
                    name: m.displayName
                }));
        }
    } catch (e) {
        console.error("Failed to fetch models:", e);
    }
    // Fallback list if API fails
    return [
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
    if (!API_KEY) {
        return res.status(500).json({ error: "Server configuration error: API Key missing." });
    }
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

        let modelsToTry = ["gemini-2.0-flash", "gemini-1.5-flash"]; // Default fallback chain

        if (userModel) {
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

        // Cleanup uploaded file
        fs.unlinkSync(req.file.path);

        // Parse JSON from text (Gemini might wrap in ```json ... ```)
        let jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
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
