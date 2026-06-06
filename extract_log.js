import fs from 'fs';
import readline from 'readline';

async function extractLog() {
  const fileStream = fs.createReadStream('C:\\Users\\howdy\\.gemini\\antigravity\\brain\\51ebf8fc-626f-4cd2-bbdf-38e48209e448\\.system_generated\\tasks\\task-1959.log');
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    if (line.includes('[USCF Verification]')) {
      console.log(line);
    }
  }
}

extractLog();
