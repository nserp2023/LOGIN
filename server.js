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
app.use(express.json());

const PORT = 3000;

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const APP_BASE_URL = process.env.APP_BASE_URL || "http://localhost:5500";

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

app.listen(PORT, () => console.log("Server running on port " + PORT));