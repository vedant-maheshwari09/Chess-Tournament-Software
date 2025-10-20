const res = await fetch("https://www.uschess.org/msa/thin.php?name=carlsen");
const text = await res.text();
const lines = text.split("\n").filter((line) => line.includes("|"));
console.log(lines.slice(0, 5));
