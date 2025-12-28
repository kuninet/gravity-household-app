const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();

const API_KEY = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(API_KEY);

async function listModels() {
    try {
        // There isn't a direct "listModels" on genAI instance in some SDK versions,
        // but usually it's handled via the API.
        // Actually, the SDK might not expose listModels easily in the simplified client.
        // Let's rely on documentation or try a known working one.
        // But wait, the error message PROMPTED "Call ListModels".
        // It seems Node SDK might have a ModelService.

        // For now, let's just try to instantiate a few likely candidates and see which one doesn't throw immediately,
        // or better, just rely on the error message which says "gemini-1.5-flash" is not found.

        // Changing strategy: access via REST to list models if SDK is obscure, or just try 'gemini-pro'.

        console.log("Checking models...");
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        console.log("Model initialized:", model.model);

        // Try a dummy generation
        const result = await model.generateContent("Hello");
        console.log("Response:", await result.response.text());

    } catch (error) {
        console.error("Error with gemini-1.5-flash:", error.message);
    }
}

listModels();
