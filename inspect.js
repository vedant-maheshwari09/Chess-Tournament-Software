import fs from "fs";

const fide = fs.readFileSync("players_list-fide-oct-2025.txt", "utf8");
const linesF = fide.split("\n");
const header = linesF[0];
const sampleLine = linesF.find((line) => /[1-9]/.test(line.slice(105, 119))) ?? linesF[1];
console.log(header);
console.log(sampleLine);
function showCharIndices(str) {
  const indices = [];
  for (let i = 0; i < str.length; i++) {
    if (str[i] !== " ") {
      indices.push({ i, char: str[i] });
    }
  }
  return indices;
}
const showRange = (start, end) => {
  console.log(`range ${start}-${end}:`, JSON.stringify(sampleLine.slice(start, end)));
  console.log(showCharIndices(sampleLine.slice(start, end)));
};
showRange(76, 85);
showRange(105, 118);
showRange(117, 130);
showRange(129, 142);
