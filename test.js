const text = "Email: maheshwarirayansh@gma’l.com";
const regex1 = /[a-z0-9._%+\-]+@[^\s@]+?\.[a-z]{2,6}\b/i;
const normalizedText = text.replace(/’/g, "'").replace(/‘/g, "'");
console.log(normalizedText.match(regex1));
