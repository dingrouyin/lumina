import { execSync } from 'child_process';
import fs from 'fs';

const keyPath = 'z:\\sda4\\docker\\Gentleman_Memory\\root\\ai-keys\\project-909647ea-0609-49df-976-95eff1803c18.json';
const keyData = JSON.parse(fs.readFileSync(keyPath, 'utf8'));

const envs = {
    VERTEX_PROJECT_ID: keyData.project_id,
    VERTEX_CLIENT_EMAIL: keyData.client_email,
    VERTEX_PRIVATE_KEY: keyData.private_key
};

for (const [key, value] of Object.entries(envs)) {
    console.log(`Setting ${key}...`);
    try {
        execSync(`npx vercel env rm ${key} production -y`, { stdio: 'ignore' });
    } catch (e) { } 
    fs.writeFileSync('temp_val.txt', value);
    // Vercel CLI will read from stdin without prompting if we pipe a file
    execSync(`npx vercel env add ${key} production < temp_val.txt`);
    fs.unlinkSync('temp_val.txt');
}
console.log('Done syncing env vars!');
