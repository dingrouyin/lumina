import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env.local') });

let key = process.env.VERTEX_PRIVATE_KEY || '';
console.log('Raw key length:', key.length);
console.log('Raw first 50:', JSON.stringify(key.substring(0, 50)));

// Simulate vertex.js processing
if (key.startsWith('"') && key.endsWith('"')) key = key.slice(1, -1);
key = key.replace(/\\n/g, '\n').replace(/\r\n/g, '\n');
console.log('After processing, length:', key.length);
console.log('Newlines:', (key.match(/\n/g) || []).length);
console.log('Valid PEM:', key.includes('BEGIN PRIVATE KEY') && key.includes('END PRIVATE KEY'));

console.log('\nProject:', process.env.VERTEX_PROJECT_ID);
console.log('Email:', process.env.VERTEX_CLIENT_EMAIL);

// Test Vertex AI
const { VertexAI } = await import('@google-cloud/vertexai');
const vertex = new VertexAI({
  project: process.env.VERTEX_PROJECT_ID,
  location: 'us-central1',
  googleAuthOptions: {
    credentials: {
      client_email: process.env.VERTEX_CLIENT_EMAIL,
      private_key: key,
    }
  }
});

console.log('\nSending test request to gemini-2.5-pro...');
const model = vertex.preview.getGenerativeModel({ model: 'gemini-2.5-pro' });
try {
  const result = await Promise.race([
    model.generateContent({
      contents: [{ role: 'user', parts: [{ text: 'Reply with just: OK' }] }]
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT after 25s')), 25000))
  ]);
  const text = result.response.candidates[0].content.parts[0].text;
  console.log('SUCCESS! Response:', text);
} catch (e) {
  console.error('FAILED:', e.message?.substring(0, 300));
}
