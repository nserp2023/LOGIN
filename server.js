import express from "express";
import fs from "fs";
import path from "path";
import os from "os";
import axios from "axios";
import FormData from "form-data";
import puppeteer from "puppeteer";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json({ limit: "45mb" }));

app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", process.env.CORS_ORIGIN || "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
});

const PORT = process.env.PORT || 3000;
app.use(express.static(process.cwd()));

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const APP_BASE_URL = process.env.APP_BASE_URL || "http://localhost:5500";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_VOICE_MODEL = process.env.GEMINI_VOICE_MODEL || "gemini-3.5-flash";
const GEMINI_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash";

function formatNumber(raw) {
    let num = String(raw || "").replace(/\D/g, "").replace(/^0+/, "");
    if (num.length === 10) num = "91" + num;
    return num;
}

async function generatePDF(id, type) {
    const browser = await puppeteer.launch({
        headless: "new",
        args: ["--no-sandbox"]
    });

    const page = await browser.newPage();

    const url = `${APP_BASE_URL}/print.html?id=${id}&type=${type}`;
    await page.goto(url, { waitUntil: "networkidle0" });

    const file = path.join(os.tmpdir(), `bill-${Date.now()}.pdf`);

    await page.pdf({
        path: file,
        format: "A4",
        printBackground: true
    });

    await browser.close();
    return file;
}

async function uploadMedia(file) {
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("file", fs.createReadStream(file));

    const res = await axios.post(
        `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/media`,
        form,
        {
            headers: {
                Authorization: `Bearer ${WHATSAPP_TOKEN}`,
                ...form.getHeaders()
            }
        }
    );

    return res.data.id;
}

async function sendDocument(to, mediaId) {
    return axios.post(
        `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`,
        {
            messaging_product: "whatsapp",
            to,
            type: "document",
            document: {
                id: mediaId,
                filename: "Invoice.pdf",
                caption: "Thank you for shopping with VAJRA LIGHTS"
            }
        },
        {
            headers: {
                Authorization: `Bearer ${WHATSAPP_TOKEN}`,
                "Content-Type": "application/json"
            }
        }
    );
}

app.post("/api/send-whatsapp-bill", async (req, res) => {
    let tempFile;

    try {
        const { id, type, mobile } = req.body;

        if (!id || !type || !mobile) {
            return res.status(400).json({ error: "Missing data" });
        }

        const to = formatNumber(mobile);

        tempFile = await generatePDF(id, type);
        const mediaId = await uploadMedia(tempFile);

        await sendDocument(to, mediaId);

        fs.unlinkSync(tempFile);

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        if (tempFile && fs.existsSync(tempFile)) fs.unlinkSync(tempFile);

        res.status(500).json({
            error: err.response?.data?.error?.message || err.message
        });
    }
});

app.post("/api/gemini-voice", async (req, res) => {
    try {
        const { audioBase64, mimeType, languageCode } = req.body || {};

        if (!GEMINI_API_KEY) {
            return res.status(500).json({ error: "GEMINI_API_KEY is missing in .env" });
        }

        if (!audioBase64) {
            return res.status(400).json({ error: "Missing audioBase64" });
        }

        const languageName = languageCode === "ml-IN" ? "Malayalam" : "Indian English";
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_VOICE_MODEL)}:generateContent`;

        const geminiRes = await axios.post(
            endpoint,
            {
                contents: [{
                    parts: [
                        {
                            text: `Transcribe this billing voice command in ${languageName}. Return only the spoken item name and quantity text. Do not add explanation.`
                        },
                        {
                            inlineData: {
                                mimeType: mimeType || "audio/webm",
                                data: audioBase64
                            }
                        }
                    ]
                }]
            },
            {
                headers: {
                    "Content-Type": "application/json",
                    "x-goog-api-key": GEMINI_API_KEY
                },
                timeout: 45000
            }
        );

        const parts = geminiRes.data?.candidates?.[0]?.content?.parts || [];
        const transcript = parts.map(part => part.text || "").join(" ").trim();

        res.json({
            transcript,
            alternatives: transcript ? [{ transcript, confidence: 0 }] : [],
            model: GEMINI_VOICE_MODEL
        });
    } catch (err) {
        const status = err.response?.status;
        const apiMessage = err.response?.data?.error?.message;
        const message = apiMessage || err.message || "Gemini voice failed";
        console.error("Gemini voice error:", err.response?.data || err.message);
        res.status(500).json({
            error: status ? `Gemini ${status}: ${message}` : message
        });
    }
});

app.post("/api/ai-catalog-page", async (req, res) => {
    try {
        const { pageImageBase64, mimeType, brand, pageNumber, candidates } = req.body || {};

        if (!GEMINI_API_KEY) {
            return res.status(500).json({ error: "GEMINI_API_KEY is missing in .env" });
        }
        if (!pageImageBase64 || !Array.isArray(candidates) || !candidates.length) {
            return res.status(400).json({ error: "Page image and candidate products are required" });
        }

        const safeCandidates = candidates.slice(0, 120).map(item => ({
            item_code: String(item.item_code || "").slice(0, 100),
            item_name: String(item.item_name || "").slice(0, 240),
            description: String(item.description || "").slice(0, 700)
        })).filter(item => item.item_code);

        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_IMAGE_MODEL)}:generateContent`;
        const prompt = `You are a precise electrical-product catalogue vision system.

Analyze catalogue page ${Number(pageNumber) || 1} for brand ${String(brand || "unknown")}.
Match visible SELLABLE PRODUCT IMAGES to exactly one item from the supplied stock candidate list.

Rules:
1. Use product name, model, series, colour, shape, ampere, watts, voltage and type as the primary evidence.
2. Manufacturer catalogue codes and internal stock codes may be different. Never require the codes to match.
3. Exclude lifestyle/interior photos, people, buildings, logos, icons, QR codes, diagrams without a sellable product, decorative backgrounds and unrelated illustrations.
4. Return a detection only when the visible product and nearby catalogue text support one candidate with confidence of at least 0.65.
5. The box_2d must tightly surround only the product photograph/render, not its surrounding text or the whole page.
6. box_2d uses normalized 0-1000 coordinates in this order: [ymin, xmin, ymax, xmax].
7. item_code must be copied exactly from the candidate list. Do not invent products.
8. If no candidate is reliable, return an empty array.

STOCK CANDIDATES:
${JSON.stringify(safeCandidates)}`;

        const geminiRes = await axios.post(
            endpoint,
            {
                contents: [{
                    parts: [
                        { text: prompt },
                        {
                            inlineData: {
                                mimeType: mimeType || "image/jpeg",
                                data: pageImageBase64
                            }
                        }
                    ]
                }],
                generationConfig: {
                    temperature: 0.1,
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: "ARRAY",
                        items: {
                            type: "OBJECT",
                            properties: {
                                item_code: { type: "STRING" },
                                confidence: { type: "NUMBER" },
                                reason: { type: "STRING" },
                                box_2d: {
                                    type: "ARRAY",
                                    items: { type: "NUMBER" }
                                }
                            },
                            required: ["item_code", "confidence", "reason", "box_2d"]
                        }
                    }
                }
            },
            {
                headers: {
                    "Content-Type": "application/json",
                    "x-goog-api-key": GEMINI_API_KEY
                },
                timeout: 120000
            }
        );

        const parts = geminiRes.data?.candidates?.[0]?.content?.parts || [];
        const rawText = parts.map(part => part.text || "").join("").trim();
        const parsed = JSON.parse(rawText || "[]");
        const allowedCodes = new Set(safeCandidates.map(item => item.item_code));
        const detections = (Array.isArray(parsed) ? parsed : [])
            .filter(row => allowedCodes.has(String(row.item_code || "")))
            .map(row => ({
                item_code: String(row.item_code),
                confidence: Math.max(0, Math.min(1, Number(row.confidence) || 0)),
                reason: String(row.reason || "").slice(0, 300),
                box_2d: Array.isArray(row.box_2d) ? row.box_2d.slice(0, 4).map(Number) : []
            }))
            .filter(row => row.confidence >= 0.65 && row.box_2d.length === 4 && row.box_2d.every(Number.isFinite));

        res.json({ detections, model: GEMINI_IMAGE_MODEL });
    } catch (err) {
        const status = err.response?.status;
        const apiMessage = err.response?.data?.error?.message;
        const message = apiMessage || err.message || "AI catalogue analysis failed";
        const retryMatch = String(message).match(/retry\s+in\s+([\d.]+)s/i);
        const retryAfterSeconds = retryMatch ? Math.ceil(Number(retryMatch[1]) || 0) : 0;
        console.error("AI catalogue error:", err.response?.data || err.message);
        res.status(status === 429 ? 429 : 500).json({
            error: status ? `Gemini ${status}: ${message}` : message,
            retryAfterSeconds
        });
    }
});

app.post("/api/ai-catalog-document", async (req, res) => {
    try {
        const { pdfBase64, mimeType, brand, candidates } = req.body || {};

        if (!GEMINI_API_KEY) {
            return res.status(500).json({ error: "GEMINI_API_KEY is missing in .env" });
        }
        if (!pdfBase64 || !Array.isArray(candidates) || !candidates.length) {
            return res.status(400).json({ error: "Complete PDF and loaded stock candidates are required" });
        }

        const safeCandidates = candidates.slice(0, 250).map(item => ({
            item_code: String(item.item_code || "").slice(0, 100),
            item_name: String(item.item_name || "").slice(0, 240),
            description: String(item.description || "").slice(0, 800)
        })).filter(item => item.item_code);
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_IMAGE_MODEL)}:generateContent`;
        const prompt = `You are a document-level electrical-product catalogue matching system.

Read the COMPLETE attached PDF before deciding any match. The selected brand/model filter is: ${String(brand || "unknown")}.

The catalogue may use layouts where:
- product descriptions and catalogue codes are on one side while matching product images are on the other side;
- one page contains descriptions and another page contains corresponding images;
- image labels use manufacturer product codes that differ from our internal item codes;
- alignment, rows, columns, headings, arrows, shared model/series names, colours and specifications establish the relationship.

For every supplied stock candidate, find its correct catalogue product image only when the full-document evidence is reliable.

Matching priority:
1. Product/series/model name and full description.
2. Colour, shape, type, ampere, watts, voltage and other specifications.
3. Manufacturer code relationships learned from the PDF layout.
4. Internal item_code is only an output identifier. Never require it to equal the catalogue code.

Image rules:
- Exclude lifestyle/interior photos, people, logos, icons, QR codes, backgrounds and unrelated illustrations.
- Return the 1-based PDF page containing the chosen product image.
- box_2d must tightly surround only that product image on its page, using normalized 0-1000 coordinates [ymin, xmin, ymax, xmax].
- item_code must be copied exactly from STOCK CANDIDATES.
- Return only confidence >= 0.65. If uncertain, omit that item.
- At most one best image per stock item.

STOCK CANDIDATES:
${JSON.stringify(safeCandidates)}`;

        const geminiRes = await axios.post(
            endpoint,
            {
                contents: [{
                    parts: [
                        { text: prompt },
                        {
                            inlineData: {
                                mimeType: mimeType || "application/pdf",
                                data: pdfBase64
                            }
                        }
                    ]
                }],
                generationConfig: {
                    temperature: 0.1,
                    maxOutputTokens: 32768,
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: "ARRAY",
                        items: {
                            type: "OBJECT",
                            properties: {
                                item_code: { type: "STRING" },
                                confidence: { type: "NUMBER" },
                                reason: { type: "STRING" },
                                catalogue_code: { type: "STRING" },
                                image_page: { type: "INTEGER" },
                                box_2d: {
                                    type: "ARRAY",
                                    items: { type: "NUMBER" }
                                }
                            },
                            required: ["item_code", "confidence", "reason", "image_page", "box_2d"]
                        }
                    }
                }
            },
            {
                headers: {
                    "Content-Type": "application/json",
                    "x-goog-api-key": GEMINI_API_KEY
                },
                timeout: 300000,
                maxBodyLength: Infinity
            }
        );

        const parts = geminiRes.data?.candidates?.[0]?.content?.parts || [];
        const rawText = parts.map(part => part.text || "").join("").trim();
        const parsed = JSON.parse(rawText || "[]");
        const allowedCodes = new Set(safeCandidates.map(item => item.item_code));
        const detections = (Array.isArray(parsed) ? parsed : [])
            .filter(row => allowedCodes.has(String(row.item_code || "")))
            .map(row => ({
                item_code: String(row.item_code),
                confidence: Math.max(0, Math.min(1, Number(row.confidence) || 0)),
                reason: String(row.reason || "").slice(0, 500),
                catalogue_code: String(row.catalogue_code || "").slice(0, 120),
                image_page: Math.max(1, Number(row.image_page) || 1),
                box_2d: Array.isArray(row.box_2d) ? row.box_2d.slice(0, 4).map(Number) : []
            }))
            .filter(row => row.confidence >= 0.65 && row.box_2d.length === 4 && row.box_2d.every(Number.isFinite));

        res.json({ detections, model: GEMINI_IMAGE_MODEL, analyzedAs: "complete_pdf" });
    } catch (err) {
        const status = err.response?.status;
        const apiMessage = err.response?.data?.error?.message;
        const message = apiMessage || err.message || "Full PDF AI analysis failed";
        const retryMatch = String(message).match(/retry\s+in\s+([\d.]+)s/i);
        const retryAfterSeconds = retryMatch ? Math.ceil(Number(retryMatch[1]) || 0) : 0;
        console.error("Full PDF AI catalogue error:", err.response?.data || err.message);
        res.status(status === 429 ? 429 : 500).json({
            error: status ? `Gemini ${status}: ${message}` : message,
            retryAfterSeconds
        });
    }
});

app.listen(PORT, () => console.log("Server running on port " + PORT));
