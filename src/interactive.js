import readline from 'readline';
import fs from 'fs';
import path from 'path';
import { ApnaKhataExtractor } from './extractor.js';

function askQuestion(rl, query) {
  return new Promise((resolve) => rl.question(query, resolve));
}

async function interactiveMain() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('=====================================================');
  console.log('   Apna Khata Jamabandi Extractor - Interactive Mode  ');
  console.log('=====================================================');

  const configPath = path.resolve(process.cwd(), 'config.json');
  let baseConfig = {};
  if (fs.existsSync(configPath)) {
    try {
      baseConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch {
      // ignore
    }
  }

  const district = (await askQuestion(rl, `Enter District name [${baseConfig.district || 'जयपुर'}]: `)) || baseConfig.district || 'जयपुर';
  const tehsil = (await askQuestion(rl, `Enter Tehsil name [${baseConfig.tehsil || 'जयपुर'}]: `)) || baseConfig.tehsil || 'जयपुर';
  const village = (await askQuestion(rl, `Enter Village name (leave empty to pick in browser): `)) || '';

  console.log('\nSearch criteria:');
  console.log('  1. Khata Number (खाता संख्या)');
  console.log('  2. Khasra Number (खसरा संख्या)');
  console.log('  3. Owner Name (नाम से)');
  console.log('  4. USN / GSN');
  const searchChoice = (await askQuestion(rl, 'Select search type (1/2/3/4) [1]: ')) || '1';

  let searchBy = 'khata';
  if (searchChoice === '2') searchBy = 'khasra';
  else if (searchChoice === '3') searchBy = 'name';
  else if (searchChoice === '4') searchBy = 'usn';

  const searchValue = (await askQuestion(rl, `Enter ${searchBy} value to search [1]: `)) || '1';

  const applicantName = (await askQuestion(rl, `Applicant Name [${baseConfig.applicant?.name || 'आवेदक'}]: `)) || baseConfig.applicant?.name || 'आवेदक';
  const applicantCity = (await askQuestion(rl, `Applicant City [${baseConfig.applicant?.city || 'जयपुर'}]: `)) || baseConfig.applicant?.city || 'जयपुर';

  rl.close();

  const activeConfig = {
    ...baseConfig,
    district,
    tehsil,
    village,
    searchBy,
    searchValue,
    applicant: {
      ...baseConfig.applicant,
      name: applicantName,
      city: applicantCity,
    },
    options: {
      ...baseConfig.options,
      headless: false, // Keep browser visible in interactive mode
    },
  };

  console.log('\n🚀 Starting extractor with selected settings...');
  const extractor = new ApnaKhataExtractor(activeConfig);
  await extractor.run();
}

interactiveMain().catch((err) => {
  console.error('Error in interactive mode:', err);
});

