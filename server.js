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
app.use(express.json({ limit: "12mb" }));

app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", process.env.CORS_ORIGIN || "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
});

const PORT = 3000;

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const APP_BASE_URL = process.env.APP_BASE_URL || "http://localhost:5500";

let googleSpeechClientPromise = null;

async function getGoogleSpeechClient() {
    if (googleSpeechClientPromise) return googleSpeechClientPromise;

    googleSpeechClientPromise = (async () => {
        const { SpeechClient } = await import("@google-cloud/speech");
        const credentialJson = process.env.GOOGLE_CLOUD_SPEECH_CREDENTIALS_JSON;

        if (credentialJson) {
            const credentials = JSON.parse(credentialJson);
            if (credentials.private_key) {
                credentials.private_key = credentials.private_key.replace(/\\n/g, "\n");
            }

            return new SpeechClient({
                credentials,
                projectId: credentials.project_id || process.env.GOOGLE_CLOUD_PROJECT
            });
        }

        return new SpeechClient();
    })();

    return googleSpeechClientPromise;
}

function getGoogleAudioEncoding(mimeType = "") {
    const mime = String(mimeType || "").toLowerCase();
    if (mime.includes("webm")) return "WEBM_OPUS";
    if (mime.includes("ogg")) return "OGG_OPUS";
    if (mime.includes("wav")) return "LINEAR16";
    if (mime.includes("flac")) return "FLAC";
    return "ENCODING_UNSPECIFIED";
}

function uniqueSpeechAlternatives(results = []) {
    const seen = new Set();
    const alternatives = [];

    for (const result of results) {
        for (const alt of result.alternatives || []) {
            const transcript = String(alt.transcript || "").trim();
            if (!transcript) continue;
            const key = transcript.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            alternatives.push({
                transcript,
                confidence: alt.confidence || 0
            });
        }
    }

    return alternatives;
}

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

app.post("/api/google-speech", async (req, res) => {
    try {
        const { audioBase64, mimeType, languageCode } = req.body || {};

        if (!audioBase64) {
            return res.status(400).json({ error: "Missing audioBase64" });
        }

        const client = await getGoogleSpeechClient();
        const encoding = getGoogleAudioEncoding(mimeType);

        const [response] = await client.recognize({
            config: {
                encoding,
                languageCode: languageCode || "en-IN",
                alternativeLanguageCodes: ["en-US"],
                maxAlternatives: 5,
                model: "latest_short",
                useEnhanced: true
            },
            audio: {
                content: audioBase64
            }
        });

        const alternatives = uniqueSpeechAlternatives(response.results);
        const transcript = alternatives[0]?.transcript || "";

        res.json({
            transcript,
            alternatives,
            encoding
        });
    } catch (err) {
        console.error("Google Speech error:", err);
        res.status(500).json({
            error: err.details || err.message || "Google Speech failed"
        });
    }
});

app.listen(PORT, () => console.log("Server running on port " + PORT));
