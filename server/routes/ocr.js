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

router.post('/analyze', upload.single('image'), async (req, res) => {
    if (!API_KEY) {
        return res.status(500).json({ error: "Server configuration error: API Key missing." });
    }
    if (!req.file) {
        return res.status(400).json({ error: "No image file provided." });
    }

    try {
        const prompt = `
        Analyze this receipt image and extract the items purchased.
        Return ONLY a JSON object with a key "items" containing an array of objects.
        Each object should have:
        - "description": The name of the item (string)
        - "amount": The price of the item (number, remove currency symbols)
        
        Example format:
        {
          "items": [
            { "description": "Apple", "amount": 100 },
            { "description": "Milk", "amount": 200 }
          ]
        }
        
        Ignore total amounts, taxes, or change. Just list the line items.
        If the image is not a receipt or unreadable, return {"items": []}.
        `;

        // Based on available models for this key
        const models = ["gemini-2.0-flash", "gemini-flash-latest", "gemini-2.0-flash-lite"];
        let result = null;
        let lastError = null;

        for (const modelName of models) {
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
