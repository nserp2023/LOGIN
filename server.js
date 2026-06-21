import express from "express";
import fs from "fs";
import path from "path";
import os from "os";
import axios from "axios";
import FormData from "form-data";
import puppeteer from "puppeteer";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const app = express();
app.use(express.json({ limit: "45mb" }));

app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", process.env.CORS_ORIGIN || "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
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
const GEMINI_CATALOG_FALLBACK_MODEL = process.env.GEMINI_CATALOG_FALLBACK_MODEL || "gemini-3.1-flash-lite";
const GEMINI_IMAGE_GENERATION_MODEL = process.env.GEMINI_IMAGE_GENERATION_MODEL || "gemini-3.1-flash-image";
const GEMINI_CATALOG_VERIFY_MODEL = process.env.GEMINI_CATALOG_VERIFY_MODEL || GEMINI_IMAGE_MODEL;
const PRIMARY_SUPABASE_URL = process.env.PRIMARY_SUPABASE_URL || "https://kzxwjujjvnehhthazicc.supabase.co";
const PRIMARY_SUPABASE_PUBLISHABLE_KEY = process.env.PRIMARY_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_Iu3sQGl9gq_VsVYxR3j_7g_SLvgqp_9";
const REVIEW_SUPABASE_URL = process.env.REVIEW_SUPABASE_URL;
const REVIEW_SUPABASE_SERVICE_ROLE_KEY = process.env.REVIEW_SUPABASE_SERVICE_ROLE_KEY;
const reviewSb = REVIEW_SUPABASE_URL && REVIEW_SUPABASE_SERVICE_ROLE_KEY
    ? createClient(REVIEW_SUPABASE_URL, REVIEW_SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false }
    })
    : null;

axios.interceptors.response.use(response => response, async error => {
    const status = error.response?.status;
    const config = error.config;
    const primaryModelPath = `/models/${encodeURIComponent(GEMINI_IMAGE_MODEL)}:generateContent`;
    if (
        (status === 429 || status === 503)
        && config?.url?.includes(primaryModelPath)
        && !config.__catalogModelFallbackAttempted
        && GEMINI_CATALOG_FALLBACK_MODEL !== GEMINI_IMAGE_MODEL
    ) {
        console.warn(`Gemini ${status} on ${GEMINI_IMAGE_MODEL}; retrying with ${GEMINI_CATALOG_FALLBACK_MODEL}.`);
        return axios.request({
            ...config,
            url: config.url.replace(primaryModelPath, `/models/${encodeURIComponent(GEMINI_CATALOG_FALLBACK_MODEL)}:generateContent`),
            __catalogModelFallbackAttempted: true
        });
    }
    throw error;
});

const CATALOGUE_COLOURS = [
    "rose gold", "champagne gold", "antique gold", "satin gold", "light gold", "dark gold",
    "stainless steel", "brushed steel", "rosewood", "dark grey", "light grey",
    "red", "green", "blue", "silver", "black", "white", "grey", "gray", "gold",
    "bronze", "brown", "ivory", "beige", "copper", "chrome", "nickel", "brass",
    "orange", "yellow", "purple", "pink"
];

function extractCatalogueColour(value) {
    const text = String(value || "").toLowerCase().replace(/[_/-]+/g, " ");
    const colour = CATALOGUE_COLOURS.find(name => new RegExp(`\\b${name.replace(/ /g, "\\s+")}\\b`, "i").test(text));
    if (!colour) return "";
    return colour === "gray" ? "grey" : colour;
}

function extractModuleSize(value) {
    const match = String(value || "").match(/\b(\d{1,2})\s*(?:m|module(?:s)?)\b/i);
    return match ? Number(match[1]) : 0;
}

function hasCompatibleCatalogueEvidence(row, candidate) {
    const candidateText = `${candidate.item_name || ""} ${candidate.description || ""}`;
    const candidateColour = extractCatalogueColour(candidateText);
    const observedColour = extractCatalogueColour(row.observed_colour);
    if (candidateColour && observedColour && candidateColour !== observedColour) return false;

    const candidateModules = extractModuleSize(candidateText);
    const observedModules = extractModuleSize(row.observed_module_size);
    if (candidateModules && observedModules && candidateModules !== observedModules) return false;
    return true;
}

function parseModelJson(rawText, fallback = {}) {
    const text = String(rawText || "").trim();
    if (!text) return fallback;
    try {
        return JSON.parse(text);
    } catch (_) {
        const start = text.indexOf("{");
        const end = text.lastIndexOf("}");
        if (start >= 0 && end > start) {
            try {
                return JSON.parse(text.slice(start, end + 1));
            } catch (_) {}
        }
    }
    return fallback;
}

function getGeminiText(response) {
    return (response?.data?.candidates?.[0]?.content?.parts || [])
        .map(part => part.text || "")
        .join("")
        .trim();
}

function getGroundingSources(response) {
    const chunks = response?.data?.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    return [...new Map(chunks
        .map(chunk => chunk?.web)
        .filter(web => web?.uri)
        .map(web => [web.uri, {
            title: String(web.title || "Web source").slice(0, 200),
            url: String(web.uri).slice(0, 1500)
        }])).values()].slice(0, 8);
}

function formatNumber(raw) {
    let num = String(raw || "").replace(/\D/g, "").replace(/^0+/, "");
    if (num.length === 10) num = "91" + num;
    return num;
}

async function requirePrimarySupabaseUser(req, res) {
    const authorization = String(req.headers.authorization || "");
    if (!authorization.startsWith("Bearer ")) {
        res.status(401).json({ error: "A signed-in Supabase user is required" });
        return null;
    }
    try {
        const response = await axios.get(`${PRIMARY_SUPABASE_URL}/auth/v1/user`, {
            headers: { apikey: PRIMARY_SUPABASE_PUBLISHABLE_KEY, Authorization: authorization },
            timeout: 15000
        });
        if (!response.data?.id) throw new Error("Invalid authenticated user");
        return response.data;
    } catch (_) {
        res.status(401).json({ error: "Your login session is invalid or expired" });
        return null;
    }
}

app.post("/api/product-image-review-history", async (req, res) => {
    const user = await requirePrimarySupabaseUser(req, res);
    if (!user) return;
    if (!reviewSb) return res.status(503).json({ error: "Review Supabase is not configured on the server" });
    const itemCodes = [...new Set((Array.isArray(req.body?.itemCodes) ? req.body.itemCodes : [])
        .map(value => String(value || "").slice(0, 100))
        .filter(Boolean))].slice(0, 250);
    if (!itemCodes.length) return res.json({ reviews: [] });
    const { data, error } = await reviewSb
        .from("product_image_ai_reviews")
        .select("item_code,decision,image_sha256,verification_verdict,verification_confidence,created_at")
        .in("item_code", itemCodes)
        .not("image_sha256", "is", null)
        .order("created_at", { ascending: false })
        .limit(1000);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ reviews: data || [] });
});

app.post("/api/product-image-review", async (req, res) => {
    const user = await requirePrimarySupabaseUser(req, res);
    if (!user) return;
    if (!reviewSb) return res.status(503).json({ error: "Review Supabase is not configured on the server" });
    const input = req.body || {};
    const validDecisions = new Set(["accepted", "rejected", "ai_blocked", "generated_accepted"]);
    const validSourceTypes = new Set(["catalogue_crop", "official_url", "ai_generated", "manual"]);
    if (!input.item_code || !validDecisions.has(input.decision) || !validSourceTypes.has(input.source_type)) {
        return res.status(400).json({ error: "Invalid product image review" });
    }
    const payload = {
        item_code: String(input.item_code).slice(0, 100),
        item_name: String(input.item_name || "").slice(0, 300) || null,
        brand: String(input.brand || "").slice(0, 160) || null,
        decision: input.decision,
        source_type: input.source_type,
        image_url: String(input.image_url || "").slice(0, 2000) || null,
        image_sha256: /^[a-f0-9]{64}$/i.test(String(input.image_sha256 || "")) ? String(input.image_sha256).toLowerCase() : null,
        catalogue_page: Number.isInteger(Number(input.catalogue_page)) && Number(input.catalogue_page) > 0 ? Number(input.catalogue_page) : null,
        catalogue_code: String(input.catalogue_code || "").slice(0, 160) || null,
        catalogue_confidence: input.catalogue_confidence !== null && input.catalogue_confidence !== undefined && input.catalogue_confidence !== "" && Number.isFinite(Number(input.catalogue_confidence))
            ? Math.max(0, Math.min(1, Number(input.catalogue_confidence))) : null,
        verification_verdict: String(input.verification_verdict || "").slice(0, 40) || null,
        verification_confidence: input.verification_confidence !== null && input.verification_confidence !== undefined && input.verification_confidence !== "" && Number.isFinite(Number(input.verification_confidence))
            ? Math.max(0, Math.min(1, Number(input.verification_confidence))) : null,
        web_supported: input.web_supported === true,
        official_source_found: input.official_source_found === true,
        verification_reason: String(input.verification_reason || "").slice(0, 2000) || null,
        hard_conflicts: Array.isArray(input.hard_conflicts) ? input.hard_conflicts.slice(0, 20) : [],
        matched_attributes: Array.isArray(input.matched_attributes) ? input.matched_attributes.slice(0, 30) : [],
        evidence_sources: Array.isArray(input.evidence_sources) ? input.evidence_sources.slice(0, 12) : [],
        visual_observation: input.visual_observation && typeof input.visual_observation === "object" ? input.visual_observation : {},
        model_name: String(input.model_name || "").slice(0, 160) || null,
        reviewed_by: user.id
    };
    const { data, error } = await reviewSb
        .from("product_image_ai_reviews")
        .insert(payload)
        .select("id,created_at")
        .single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json({ review: data });
});

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
        const { pageImageBase64, mimeType, brand, pageNumber, candidates, documentContext } = req.body || {};

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

FULL-CATALOGUE CONTEXT (already analyzed before this page):
${String(documentContext || "No additional layout context supplied").slice(0, 5000)}

Rules:
1. Use product name, model, series, colour, shape, ampere, watts, voltage and type as the primary evidence.
2. Manufacturer catalogue codes and internal stock codes may be different. Never require the codes to match.
3. Exclude lifestyle/interior photos, people, buildings, logos, icons, QR codes, diagrams without a sellable product, decorative backgrounds and unrelated illustrations.
4. Return a detection only when the visible product and nearby catalogue text support one candidate with confidence of at least 0.65.
5. The box_2d must tightly surround only the product photograph/render, not its surrounding text or the whole page.
6. box_2d uses normalized 0-1000 coordinates in this order: [ymin, xmin, ymax, xmax].
7. item_code must be copied exactly from the candidate list. Do not invent products.
8. If no candidate is reliable, return an empty array.
9. Colour and module/size are HARD constraints. Never match RED to rose gold, gold, brown or another colour. Never match 1M to 2M, 16M or 18M. Omit the detection when either attribute conflicts.
10. observed_colour and observed_module_size must describe only what the catalogue visibly says, never values copied from the stock candidate.
11. The crop box must contain only the product render/photo. Exclude captions, colour swatches, catalogue codes, prices, tables and surrounding labels.
12. Assess the usable source image itself. image_quality_score is 0-1 based on sharpness, resolution, clean isolation and lack of text overlap. Explain blur, tiny size, pixelation or obstruction in quality_issue; otherwise return an empty string.

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
                                observed_colour: { type: "STRING" },
                                observed_module_size: { type: "STRING" },
                                image_quality_score: { type: "NUMBER" },
                                quality_issue: { type: "STRING" },
                                box_2d: {
                                    type: "ARRAY",
                                    items: { type: "NUMBER" }
                                }
                            },
                            required: ["item_code", "confidence", "reason", "observed_colour", "observed_module_size", "image_quality_score", "quality_issue", "box_2d"]
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
        const candidatesByCode = new Map(safeCandidates.map(item => [item.item_code, item]));
        const detections = (Array.isArray(parsed) ? parsed : [])
            .filter(row => allowedCodes.has(String(row.item_code || "")))
            .filter(row => hasCompatibleCatalogueEvidence(row, candidatesByCode.get(String(row.item_code || "")) || {}))
            .map(row => ({
                item_code: String(row.item_code),
                confidence: Math.max(0, Math.min(1, Number(row.confidence) || 0)),
                reason: String(row.reason || "").slice(0, 300),
                observed_colour: String(row.observed_colour || "").slice(0, 80),
                observed_module_size: String(row.observed_module_size || "").slice(0, 80),
                image_quality_score: Math.max(0, Math.min(1, Number(row.image_quality_score) || 0)),
                quality_issue: String(row.quality_issue || "").slice(0, 300),
                box_2d: Array.isArray(row.box_2d) ? row.box_2d.slice(0, 4).map(Number) : []
            }))
            .filter(row => row.confidence >= 0.65 && row.box_2d.length === 4 && row.box_2d.every(Number.isFinite));

        res.json({ detections, model: GEMINI_IMAGE_MODEL });
    } catch (err) {
        const status = err.response?.status;
        const apiMessage = err.response?.data?.error?.message;
        const message = apiMessage || err.message || "AI catalogue analysis failed";
        const retryMatch = String(message).match(/retry\s+in\s+([\d.]+)s/i);
        const retryAfterHeader = Number(err.response?.headers?.["retry-after"]);
        const retryAfterSeconds = retryMatch
            ? Math.ceil(Number(retryMatch[1]) || 0)
            : (Number.isFinite(retryAfterHeader) ? Math.ceil(retryAfterHeader) : (status === 503 ? 15 : 0));
        console.error("AI catalogue error:", err.response?.data || err.message);
        res.status(status === 429 || status === 503 ? status : 500).json({
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
First explain the catalogue layout and list every page relevant to the selected brand/model or supplied candidates. Always return this layout analysis even when no direct product match is confident. Page-level vision will use your analysis afterward for precise crops.
Also summarize the catalogue product family's visual design language: geometry, materials, finish, proportions, camera angle, lighting and background. This will guide review-only image generation for stock items whose exact image is absent.

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
- Colour and module/size are HARD constraints. RED is not rose gold, gold, brown or any other colour. 1M, 2M, 16M and 18M are different products and must never be interchanged.
- observed_colour and observed_module_size must come from visible catalogue evidence, not from the stock candidate. Omit a match if either value conflicts or cannot be established reliably.
- box_2d must contain only the product photo/render, excluding captions, swatches, tables, codes, prices and labels.
- Assess image_quality_score from 0-1 for sharpness, usable resolution, clean isolation and lack of text overlap. State any blur, pixelation, tiny source size or obstruction in quality_issue.

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
                        type: "OBJECT",
                        properties: {
                            layout_summary: { type: "STRING" },
                            code_image_relationship: { type: "STRING" },
                            visual_style_summary: { type: "STRING" },
                            relevant_pages: { type: "ARRAY", items: { type: "INTEGER" } },
                            detections: {
                                type: "ARRAY",
                                items: {
                                    type: "OBJECT",
                                    properties: {
                                        item_code: { type: "STRING" },
                                        confidence: { type: "NUMBER" },
                                        reason: { type: "STRING" },
                                        observed_colour: { type: "STRING" },
                                        observed_module_size: { type: "STRING" },
                                        image_quality_score: { type: "NUMBER" },
                                        quality_issue: { type: "STRING" },
                                        catalogue_code: { type: "STRING" },
                                        image_page: { type: "INTEGER" },
                                        box_2d: { type: "ARRAY", items: { type: "NUMBER" } }
                                    },
                                    required: ["item_code", "confidence", "reason", "observed_colour", "observed_module_size", "image_quality_score", "quality_issue", "image_page", "box_2d"]
                                }
                            }
                        },
                        required: ["layout_summary", "code_image_relationship", "visual_style_summary", "relevant_pages", "detections"]
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
        const parsed = JSON.parse(rawText || "{}");
        const allowedCodes = new Set(safeCandidates.map(item => item.item_code));
        const candidatesByCode = new Map(safeCandidates.map(item => [item.item_code, item]));
        const detections = (Array.isArray(parsed.detections) ? parsed.detections : [])
            .filter(row => allowedCodes.has(String(row.item_code || "")))
            .filter(row => hasCompatibleCatalogueEvidence(row, candidatesByCode.get(String(row.item_code || "")) || {}))
            .map(row => ({
                item_code: String(row.item_code),
                confidence: Math.max(0, Math.min(1, Number(row.confidence) || 0)),
                reason: String(row.reason || "").slice(0, 500),
                observed_colour: String(row.observed_colour || "").slice(0, 80),
                observed_module_size: String(row.observed_module_size || "").slice(0, 80),
                image_quality_score: Math.max(0, Math.min(1, Number(row.image_quality_score) || 0)),
                quality_issue: String(row.quality_issue || "").slice(0, 300),
                catalogue_code: String(row.catalogue_code || "").slice(0, 120),
                image_page: Math.max(1, Number(row.image_page) || 1),
                box_2d: Array.isArray(row.box_2d) ? row.box_2d.slice(0, 4).map(Number) : []
            }))
            .filter(row => row.confidence >= 0.65 && row.box_2d.length === 4 && row.box_2d.every(Number.isFinite));

        res.json({
            detections,
            documentAnalysis: {
                layout_summary: String(parsed.layout_summary || "").slice(0, 4000),
                code_image_relationship: String(parsed.code_image_relationship || "").slice(0, 3000),
                visual_style_summary: String(parsed.visual_style_summary || "").slice(0, 3000),
                relevant_pages: Array.isArray(parsed.relevant_pages)
                    ? [...new Set(parsed.relevant_pages.map(Number).filter(Number.isFinite))].slice(0, 100)
                    : []
            },
            model: GEMINI_IMAGE_MODEL,
            analyzedAs: "complete_pdf"
        });
    } catch (err) {
        const status = err.response?.status;
        const apiMessage = err.response?.data?.error?.message;
        const message = apiMessage || err.message || "Full PDF AI analysis failed";
        const retryMatch = String(message).match(/retry\s+in\s+([\d.]+)s/i);
        const retryAfterHeader = Number(err.response?.headers?.["retry-after"]);
        const retryAfterSeconds = retryMatch
            ? Math.ceil(Number(retryMatch[1]) || 0)
            : (Number.isFinite(retryAfterHeader) ? Math.ceil(retryAfterHeader) : (status === 503 ? 15 : 0));
        console.error("Full PDF AI catalogue error:", err.response?.data || err.message);
        res.status(status === 429 || status === 503 ? status : 500).json({
            error: status ? `Gemini ${status}: ${message}` : message,
            retryAfterSeconds
        });
    }
});

app.post("/api/ai-catalog-verify", async (req, res) => {
    try {
        const { imageBase64, mimeType, brand, item, catalogueContext, initialConfidence } = req.body || {};
        if (!GEMINI_API_KEY) {
            return res.status(500).json({ error: "GEMINI_API_KEY is missing in .env" });
        }
        if (!imageBase64 || !item?.item_code || !item?.item_name) {
            return res.status(400).json({ error: "A cropped image and stock item are required" });
        }

        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_CATALOG_VERIFY_MODEL)}:generateContent`;
        const imagePart = {
            inlineData: {
                mimeType: String(mimeType || "image/jpeg"),
                data: String(imageBase64)
            }
        };

        // Pass one deliberately hides the expected stock item to reduce confirmation bias.
        const visualPrompt = `Independently inspect this cropped electrical-product catalogue image. You are not told which stock item it is expected to represent.

Return JSON only with these keys:
product_type, visible_brand, visible_model_or_code, colour, module_size, specifications, visible_text, single_product, crop_clean, quality_score, problems.

Rules:
- Describe only visible evidence. Never guess unreadable text or hidden specifications.
- single_product is true only when exactly one sellable product is shown.
- crop_clean is false if captions, tables, prices, unrelated products, large borders, clipped product parts, or catalogue layout remain.
- quality_score is 0-1 based on sharpness, resolution, isolation, and completeness.
- specifications and problems must be arrays of short strings.`;

        const visualRes = await axios.post(endpoint, {
            contents: [{ parts: [{ text: visualPrompt }, imagePart] }],
            generationConfig: {
                temperature: 0,
                responseMimeType: "application/json",
                responseSchema: {
                    type: "OBJECT",
                    properties: {
                        product_type: { type: "STRING" },
                        visible_brand: { type: "STRING" },
                        visible_model_or_code: { type: "STRING" },
                        colour: { type: "STRING" },
                        module_size: { type: "STRING" },
                        specifications: { type: "ARRAY", items: { type: "STRING" } },
                        visible_text: { type: "ARRAY", items: { type: "STRING" } },
                        single_product: { type: "BOOLEAN" },
                        crop_clean: { type: "BOOLEAN" },
                        quality_score: { type: "NUMBER" },
                        problems: { type: "ARRAY", items: { type: "STRING" } }
                    },
                    required: ["product_type", "colour", "module_size", "specifications", "visible_text", "single_product", "crop_clean", "quality_score", "problems"]
                }
            }
        }, {
            headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
            timeout: 120000,
            maxBodyLength: Infinity
        });

        const visual = parseModelJson(getGeminiText(visualRes), {});
        const safeItem = {
            item_code: String(item.item_code).slice(0, 100),
            item_name: String(item.item_name).slice(0, 240),
            description: String(item.description || "").slice(0, 1200)
        };
        const verificationPrompt = `Verify whether the attached product image correctly represents this claimed stock item.

CLAIMED BRAND: ${String(brand || "unknown").slice(0, 120)}
CLAIMED ITEM: ${JSON.stringify(safeItem)}
BLIND VISUAL OBSERVATION: ${JSON.stringify(visual)}
CATALOGUE CONTEXT: ${String(catalogueContext || "").slice(0, 4000)}
FIRST-PASS CATALOGUE CONFIDENCE: ${Math.max(0, Math.min(1, Number(initialConfidence) || 0))}

Use Google Search to look for reliable current evidence, prioritizing the manufacturer's official website/catalogue, then authorized distributors. General marketplace listings alone are weak evidence. Compare product type, series/model/code, colour, module count or size, shape, wattage, ampere, voltage, and other available specifications.

Return one JSON object only:
{
  "verdict": "exact_match|likely_match|uncertain|mismatch",
  "confidence": 0.0,
  "web_supported": false,
  "official_source_found": false,
  "hard_conflicts": [],
  "matched_attributes": [],
  "reason": "short evidence-based explanation"
}

Use exact_match only when the visible product and reliable web evidence support the claimed variant with no hard conflict. A colour, module-size, product-type, or explicit model/specification conflict requires mismatch. If the precise variant cannot be established online, use likely_match or uncertain; never invent evidence.`;

        let grounded;
        try {
            grounded = await axios.post(endpoint, {
                contents: [{ parts: [{ text: verificationPrompt }, imagePart] }],
                tools: [{ google_search: {} }],
                generationConfig: { temperature: 0.05 }
            }, {
                headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
                timeout: 180000,
                maxBodyLength: Infinity
            });
        } catch (groundingError) {
            console.warn("Grounded catalogue verification unavailable:", groundingError.response?.data || groundingError.message);
            return res.json({
                verdict: "uncertain",
                confidence: 0,
                verified: false,
                autoApprove: false,
                webSupported: false,
                officialSourceFound: false,
                hardConflicts: [],
                matchedAttributes: [],
                reason: "Independent visual inspection completed, but grounded internet verification was unavailable.",
                visual,
                sources: [],
                model: GEMINI_CATALOG_VERIFY_MODEL
            });
        }

        const result = parseModelJson(getGeminiText(grounded), {});
        const sources = getGroundingSources(grounded);
        const verdict = ["exact_match", "likely_match", "uncertain", "mismatch"].includes(result.verdict)
            ? result.verdict
            : "uncertain";
        const confidence = Math.max(0, Math.min(1, Number(result.confidence) || 0));
        const hardConflicts = Array.isArray(result.hard_conflicts) ? result.hard_conflicts.map(String).slice(0, 12) : [];
        const matchedAttributes = Array.isArray(result.matched_attributes) ? result.matched_attributes.map(String).slice(0, 16) : [];
        const cropValid = visual.single_product === true
            && visual.crop_clean === true
            && Number(visual.quality_score) >= 0.65;
        const webSupported = result.web_supported === true && sources.length > 0;
        const officialSourceFound = result.official_source_found === true && sources.length > 0;
        const verified = verdict === "exact_match"
            && confidence >= 0.85
            && webSupported
            && cropValid
            && hardConflicts.length === 0;
        const autoApprove = verified
            && officialSourceFound
            && confidence >= 0.92
            && Number(initialConfidence) >= 0.9
            && Number(visual.quality_score) >= 0.75;

        res.json({
            verdict,
            confidence,
            verified,
            autoApprove,
            webSupported,
            officialSourceFound,
            hardConflicts,
            matchedAttributes,
            reason: String(result.reason || "No verification explanation returned.").slice(0, 1000),
            visual,
            sources,
            model: GEMINI_CATALOG_VERIFY_MODEL
        });
    } catch (err) {
        const status = err.response?.status;
        const apiMessage = err.response?.data?.error?.message;
        const message = apiMessage || err.message || "Catalogue image verification failed";
        console.error("Catalogue verification error:", err.response?.data || err.message);
        res.status(status === 429 || status === 503 ? status : 500).json({
            error: status ? `Gemini ${status}: ${message}` : message,
            retryAfterSeconds: status === 503 ? 15 : 0
        });
    }
});

app.post("/api/ai-catalog-generate", async (req, res) => {
    try {
        const { brand, item, documentAnalysis, referenceImages } = req.body || {};
        if (!GEMINI_API_KEY) {
            return res.status(500).json({ error: "GEMINI_API_KEY is missing in .env" });
        }
        if (!item?.item_code || !item?.item_name) {
            return res.status(400).json({ error: "A valid unmatched stock item is required" });
        }

        const references = (Array.isArray(referenceImages) ? referenceImages : [])
            .slice(0, 3)
            .filter(image => image?.data)
            .map(image => ({
                inlineData: {
                    mimeType: String(image.mimeType || "image/jpeg"),
                    data: String(image.data)
                }
            }));
        if (!references.length) {
            return res.status(400).json({ error: "Catalogue reference pages are required for generation" });
        }

        const safeItem = {
            item_code: String(item.item_code).slice(0, 100),
            item_name: String(item.item_name).slice(0, 240),
            description: String(item.description || "").slice(0, 1200)
        };
        const analysis = {
            layout_summary: String(documentAnalysis?.layout_summary || "").slice(0, 3000),
            visual_style_summary: String(documentAnalysis?.visual_style_summary || "").slice(0, 3000)
        };
        const prompt = `Create one clean, photorealistic e-commerce product image for this exact stock item:
BRAND/FAMILY: ${String(brand || "unknown").slice(0, 120)}
ITEM: ${JSON.stringify(safeItem)}

The attached images are reference pages from a catalogue that was studied in full. Use them only to understand the product family's physical design language. Full-document analysis:
${JSON.stringify(analysis)}

Requirements:
- Depict the exact product type, colour, module count/size and specifications stated in ITEM. These are hard constraints.
- Use the catalogue family's geometry, materials and finish without copying page text, tables or layout.
- Show one isolated product, centered, front three-quarter or catalogue-consistent angle, on a pure white background with soft studio lighting.
- No packaging, hands, room scene, captions, prices, borders, watermarks or extra accessories.
- Do not invent or render logos, brand names, model numbers or readable text.
- If a visual detail is unspecified, choose the simplest physically plausible detail consistent with the reference family.
- Return the image, not an explanation.`;

        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_IMAGE_GENERATION_MODEL)}:generateContent`;
        const geminiRes = await axios.post(
            endpoint,
            {
                contents: [{ parts: [{ text: prompt }, ...references] }],
                generationConfig: {
                    responseModalities: ["TEXT", "IMAGE"],
                    imageConfig: { aspectRatio: "1:1" }
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
        const imagePart = parts.find(part => part.inlineData?.data && String(part.inlineData?.mimeType || "").startsWith("image/"));
        if (!imagePart) throw new Error("Image model returned no image");
        res.json({
            imageBase64: imagePart.inlineData.data,
            mimeType: imagePart.inlineData.mimeType || "image/png",
            model: GEMINI_IMAGE_GENERATION_MODEL,
            generated: true
        });
    } catch (err) {
        const status = err.response?.status;
        const apiMessage = err.response?.data?.error?.message;
        const message = apiMessage || err.message || "Catalogue-style image generation failed";
        const retryMatch = String(message).match(/retry\s+in\s+([\d.]+)s/i);
        const retryAfterHeader = Number(err.response?.headers?.["retry-after"]);
        const retryAfterSeconds = retryMatch
            ? Math.ceil(Number(retryMatch[1]) || 0)
            : (Number.isFinite(retryAfterHeader) ? Math.ceil(retryAfterHeader) : (status === 503 ? 15 : 0));
        console.error("Catalogue image generation error:", err.response?.data || err.message);
        res.status(status === 429 || status === 503 ? status : 500).json({
            error: status ? `Gemini ${status}: ${message}` : message,
            retryAfterSeconds
        });
    }
});

app.listen(PORT, () => console.log("Server running on port " + PORT));
