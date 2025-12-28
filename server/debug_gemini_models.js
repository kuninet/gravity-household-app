const https = require('https');
require('dotenv').config();

const API_KEY = process.env.GEMINI_API_KEY;

if (!API_KEY) {
    console.error("No API Key found in .env");
    process.exit(1);
}

const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`;

console.log(`Querying: ${url.replace(API_KEY, 'HIDDEN_KEY')}`);

https.get(url, (res) => {
    let data = '';

    res.on('data', (chunk) => {
        data += chunk;
    });

    res.on('end', () => {
        if (res.statusCode !== 200) {
            console.error(`Error: Status Code ${res.statusCode}`);
            console.error(`Response: ${data}`);
            return;
        }

        try {
            const json = JSON.parse(data);
            if (json.models) {
                console.log("Available Models:");
                json.models.forEach(m => {
                    console.log(`- ${m.name} (Methods: ${m.supportedGenerationMethods.join(', ')})`);
                });
            } else {
                console.log("No models found in response:", json);
            }
        } catch (e) {
            console.error("Error parsing JSON:", e.message);
            console.error("Raw data:", data);
        }
    });

}).on('error', (err) => {
    console.error("Network Error:", err.message);
});
