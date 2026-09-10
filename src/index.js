import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ApnaKhataExtractor } from './extractor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Loads configuration from config.json or command line arguments
 */
function loadConfig() {
  const configPath = path.resolve(process.cwd(), 'config.json');
  let config = {};

  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, 'utf-8');
      config = JSON.parse(raw);
    } catch (e) {
      console.warn('⚠️ Warning: Failed to parse config.json, using defaults.');
    }
  }

  // Parse command line arguments (e.g. --district Jaipur --tehsil Jaipur --searchBy khata --searchValue 12)
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const key = args[i].replace(/^--/, '');
    const val = args[i + 1];
    if (val && !val.startsWith('--')) {
      if (key in config) {
        config[key] = val;
      }
      i++;
    }
  }

  return config;
}

async function main() {
  console.log('=====================================================');
  console.log('   Apna Khata (Rajasthan) Jamabandi Extractor       ');
  console.log('=====================================================');

  const config = loadConfig();
  console.log('Active Configuration:');
  console.log(` - District   : ${config.district || '(Not specified)'}`);
  console.log(` - Tehsil     : ${config.tehsil || '(Not specified)'}`);
  console.log(` - Village    : ${config.village || '(Not specified)'}`);
  console.log(` - Search By  : ${config.searchBy} (Value: ${config.searchValue})`);
  console.log(` - Output Dir : ${config.options?.outputDir || './output'}`);
  console.log('-----------------------------------------------------');

  const extractor = new ApnaKhataExtractor(config);
  await extractor.run();
}

main().catch((err) => {
  console.error('Fatal execution error:', err);
});

