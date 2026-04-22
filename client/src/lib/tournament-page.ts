const MAP_BUTTON_PLACEHOLDER = "__MAP_PLACEHOLDER__";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatInlineMarkdown(input: string): string {
  const imageHtml: string[] = [];
  const mapBlocks: string[] = [];

  let working = input.replace(/\{\{map-buttons:([^}]+)\}\}/gi, (_, query) => {
    const trimmed = typeof query === "string" ? query.trim() : "";
    if (!trimmed) return "";
    const placeholder = `${MAP_BUTTON_PLACEHOLDER}${mapBlocks.length}__`;
    const encoded = encodeURIComponent(trimmed);
    mapBlocks.push(
      `<div class="flex items-center gap-4 my-8 p-5 rounded-2xl border border-slate-100 bg-white shadow-sm ring-1 ring-slate-900/5">
        <div class="flex flex-col gap-1">
          <span class="text-[10px] font-bold uppercase tracking-widest text-slate-400">View Location</span>
          <div class="flex gap-3">
            <a href="https://www.google.com/maps/search/?api=1&query=${encoded}" target="_blank" class="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center text-red-500 hover:bg-red-50 hover:scale-110 transition-all shadow-inner" title="Google Maps">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
            </a>
            <a href="maps://maps.apple.com/?q=${encoded}" class="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center text-blue-500 hover:bg-blue-50 hover:scale-110 transition-all shadow-inner" title="Apple Maps (iOS)">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/></svg>
            </a>
          </div>
        </div>
        <div class="h-10 w-[1px] bg-slate-100 mx-2"></div>
        <span class="text-sm font-medium text-slate-600 truncate max-w-[200px]">${trimmed}</span>
      </div>`
        .replace(/\s{2,}/g, " ")
        .trim(),
    );
    return placeholder;
  });

  working = working.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => {
    const token = `__IMAGE_PLACEHOLDER_${imageHtml.length}__`;
    const trimmedSrc = typeof src === "string" ? src.trim() : "";
    if (!trimmedSrc) {
      return token;
    }
    const safeAlt = escapeHtml(alt ?? "");
    const safeSrc = escapeHtml(trimmedSrc);
    imageHtml.push(`<img src="${safeSrc}" alt="${safeAlt}" class="max-w-full rounded-md border" />`);
    return token;
  });

  let result = escapeHtml(working);
  result = result.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  result = result.replace(/\*(.+?)\*/g, "<em>$1</em>");
  result = result.replace(/~~(.+?)~~/g, "<del>$1</del>");
  result = result.replace(/<u>(.+?)<\/u>/g, "<u>$1</u>");
  result = result.replace(/`([^`]+)`/g, "<code>$1</code>");
  
  // Links: [text](url) - more robust to handle partial URLs during typing
  const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s\)]*|www\.[^\s\)]+|[^\s\)]+\.[^\s\)]+)\)/g;
  result = result.replace(linkRegex, (match, label, url) => {
    let safeUrl = url;
    if (url.startsWith('www.')) safeUrl = `https://${url}`;
    else if (!url.includes('://') && url.includes('.')) safeUrl = `https://${url}`;
    
    return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="text-primary hover:underline font-medium inline-flex items-center gap-1">
      ${label}
      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="opacity-50"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>
    </a>`;
  });

  // Support for color highlights: {{color-red:text}}, {{color-blue:text}}, {{color-green:text}}, {{color-yellow:text}}, {{color-purple:text}}
  result = result.replace(/\{\{color-(red|blue|green|yellow|purple):(.+?)\}\}/gi, (_, color, content) => {
    const colors: Record<string, string> = {
      red: "#ef4444",
      blue: "#3b82f6",
      green: "#22c55e",
      yellow: "#eab308",
      purple: "#a855f7"
    };
    return `<span style="color: ${colors[color] || color}; font-weight: 500;">${content}</span>`;
  });

  // Support for custom alignment tags: {{align-center:text}}, {{align-right:text}}, {{align-justify:text}}
  result = result.replace(/\{\{align-(left|center|right|justify):(.+?)\}\}/gi, (_, align, content) => {
    return `<div style="text-align: ${align}">${content}</div>`;
  });

  imageHtml.forEach((html, index) => {
    const token = `__IMAGE_PLACEHOLDER_${index}__`;
    while (result.includes(token)) {
      result = result.replace(token, html);
    }
  });

  mapBlocks.forEach((html, index) => {
    const token = `${MAP_BUTTON_PLACEHOLDER}${index}__`;
    while (result.includes(token)) {
      result = result.replace(token, html);
    }
  });

  return result;
}

export function renderTournamentPageContent(content: string): string {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let inUnordered = false;
  let inOrdered = false;
  let inBlockquote = false;
  let inCodeBlock = false;
  let inTable = false;

  const closeLists = () => {
    if (inUnordered) {
      html.push("</ul>");
      inUnordered = false;
    }
    if (inOrdered) {
      html.push("</ol>");
      inOrdered = false;
    }
  };

  const closeBlockquote = () => {
    if (inBlockquote) {
      html.push("</blockquote>");
      inBlockquote = false;
    }
  };

  const closeTable = () => {
    if (inTable) {
      html.push("</tbody></table></div>");
      inTable = false;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Code Block
    if (trimmed.startsWith("```")) {
      if (inCodeBlock) {
        html.push("</code></pre>");
        inCodeBlock = false;
      } else {
        closeLists();
        closeBlockquote();
        closeTable();
        html.push('<pre class="bg-slate-900 text-slate-100 p-4 rounded-md my-4 overflow-x-auto"><code>');
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      html.push(escapeHtml(line) + "\n");
      continue;
    }

    // Horizontal Rule
    if (trimmed === "---" || trimmed === "***" || trimmed === "___") {
      closeLists();
      closeBlockquote();
      closeTable();
      html.push('<hr class="my-8 border-t border-slate-200" />');
      continue;
    }

    // Table
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      if (!inTable) {
        closeLists();
        closeBlockquote();
        html.push('<div class="overflow-x-auto my-6"><table class="min-w-full border-collapse border border-slate-200">');
        
        // Parse Header
        const cells = trimmed.split("|").filter(c => c.trim().length > 0 || c === "").slice(0, -1);
        // Wait, split("|") on "| h1 | h2 |" gives ["", " h1 ", " h2 ", ""]
        const headerCells = trimmed.split("|").map(c => c.trim()).filter((c, idx, arr) => idx > 0 && idx < arr.length - 1);
        
        html.push('<thead class="bg-slate-50"><tr>');
        headerCells.forEach(cell => {
          html.push(`<th class="border border-slate-200 px-4 py-2 text-left font-semibold text-slate-900">${formatInlineMarkdown(cell)}</th>`);
        });
        html.push("</tr></thead><tbody>");
        inTable = true;
        
        // Skip separator line if next
        if (i + 1 < lines.length && lines[i + 1].trim().match(/^\|?[\s-:\\|]+$/)) {
          i++;
        }
      } else {
        const rowCells = trimmed.split("|").map(c => c.trim()).filter((c, idx, arr) => idx > 0 && idx < arr.length - 1);
        html.push("<tr>");
        rowCells.forEach(cell => {
          html.push(`<td class="border border-slate-200 px-4 py-2 text-slate-700">${formatInlineMarkdown(cell)}</td>`);
        });
        html.push("</tr>");
      }
      continue;
    } else if (inTable) {
      closeTable();
    }

    // Blockquote
    if (trimmed.startsWith(">")) {
      if (!inBlockquote) {
        closeLists();
        html.push('<blockquote class="border-l-4 border-slate-300 pl-4 py-1 my-4 italic text-slate-600">');
        inBlockquote = true;
      }
      const text = trimmed.replace(/^>\s*/, "");
      html.push(`${formatInlineMarkdown(text)}<br/>`);
      continue;
    } else {
      closeBlockquote();
    }

    if (!trimmed) {
      closeLists();
      // Only add a spacer if the previous line wasn't also empty
      if (html.length > 0 && !html[html.length - 1].includes('h-2')) {
        html.push('<div class="h-2"></div>');
      }
      continue;
    }

    // Headings
    if (/^#{1,6}\s/.test(trimmed)) {
      closeLists();
      const level = Math.min(6, trimmed.match(/^#+/)?.[0].length ?? 1);
      const text = trimmed.replace(/^#{1,6}\s*/, "");
      // Special styling for H1 and H2
      const baseClass = "font-bold text-slate-900 my-4";
      const levelClasses: Record<number, string> = {
        1: "text-3xl border-b pb-2",
        2: "text-2xl",
        3: "text-xl",
        4: "text-lg",
        5: "text-base",
        6: "text-sm"
      };
      html.push(`<h${level} class="${baseClass} ${levelClasses[level] || ""}">${formatInlineMarkdown(text)}</h${level}>`);
      continue;
    }

    // Unordered List & Checklist
    if (/^[-*]\s+/.test(trimmed)) {
      if (!inUnordered) {
        closeLists();
        html.push('<ul class="list-disc pl-6 my-4 space-y-1">');
        inUnordered = true;
      }
      let text = trimmed.replace(/^[-*]\s+/, "");
      
      // Check for Checklist
      if (text.startsWith("[ ] ")) {
        text = `<input type="checkbox" disabled class="mr-2" /> ${text.substring(4)}`;
      } else if (text.startsWith("[x] ") || text.startsWith("[X] ")) {
        text = `<input type="checkbox" checked disabled class="mr-2" /> ${text.substring(4)}`;
      }
      
      html.push(`<li class="text-slate-700 flex items-start">${formatInlineMarkdown(text)}</li>`);
      continue;
    }

    // Ordered List
    if (/^\d+\.\s+/.test(trimmed)) {
      if (!inOrdered) {
        closeLists();
        html.push('<ol class="list-decimal pl-6 my-4 space-y-1">');
        inOrdered = true;
      }
      const text = trimmed.replace(/^\d+\.\s+/, "");
      html.push(`<li class="text-slate-700">${formatInlineMarkdown(text)}</li>`);
      continue;
    }

    closeLists();
    html.push(`<p class="text-slate-700 leading-relaxed my-2">${formatInlineMarkdown(trimmed)}</p>`);
  }

  closeLists();
  closeBlockquote();
  closeTable();
  return html.join("");
}
