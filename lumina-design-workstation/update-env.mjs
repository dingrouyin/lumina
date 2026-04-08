import { execSync } from 'child_process';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load envs
dotenv.config({ path: path.join(__dirname, '.env.local') });

const envs = [
  'VERTEX_PROJECT_ID',
  'VERTEX_CLIENT_EMAIL',
  'VERTEX_PRIVATE_KEY'
];

for (const key of envs) {
  const value = process.env[key];
  if (!value) {
    console.error('Missing local env:', key);
    continue;
  }
  
  console.log(`Processing ${key}...`);
  // Remove existing
  try {
    console.log(`Removing old ${key}...`);
    execSync(`npx vercel env rm ${key} production --yes`, { stdio: 'inherit' });
  } catch (e) {
    console.log(`(Failed to remove ${key}, maybe it didn't exist)`);
  }
  
  // Add new
  console.log(`Adding new ${key}...`);
  try {
    execSync(`npx vercel env add ${key} production`, { input: value, stdio: ['pipe', 'inherit', 'inherit'] });
    console.log(`Successfully added ${key}`);
  } catch (e) {
    console.error(`Failed to add ${key}`);
  }
}
console.log('Done uploading envs!');
