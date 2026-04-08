import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env.local') });

import handler from './api/vertex.js';
import generateImageHandler from './api/generate-image.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

app.all('/api/vertex', async (req, res) => {
    try {
        await handler(req, res);
    } catch (e) {
        console.error("Local API Error:", e);
        if (!res.headersSent) {
            res.status(500).json({ error: e.message || 'Server error' });
        }
    }
});

app.all('/api/generate-image', async (req, res) => {
    try {
        await generateImageHandler(req, res);
    } catch (e) {
        console.error("Local generate-image Error:", e);
        if (!res.headersSent) {
            res.status(500).json({ error: e.message || 'Server error' });
        }
    }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`\n[Lumina Local Backend] API Server listening on port ${PORT}\n`);
});
