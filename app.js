import { listBooks, getBook, putBook, patchBook } from "./library.js";
import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs";

const PDF_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";
pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER;

const $ = (selector) => document.querySelector(selector);
const savedBaseUrl = localStorage.getItem("pdf-studio-base-url");
const usesLegacyLocalUrl = !savedBaseUrl || /^http:\/\/(localhost|127\.0\.0\.1):11434\/v1$/.test(savedBaseUrl);
const defaultBaseUrl = usesLegacyLocalUrl ? "/api" : savedBaseUrl;
const els = {
  fileInput: $("#fileInput"), openPdfButton: $("#openPdfButton"), emptyOpenButton: $("#emptyOpenButton"),
  pdfViewport: $("#pdfViewport"), emptyReader: $("#emptyReader"), documentName: $("#documentName"),
  outlineList: $("#outlineList"), annotationList: $("#annotationList"), annotationCount: $("#annotationCountLabel"),
  pageCount: $("#pageCountLabel"), totalPages: $("#totalPagesLabel"), pageInput: $("#pageNumberInput"),
  previousPage: $("#previousPageButton"), nextPage: $("#nextPageButton"), zoomOut: $("#zoomOutButton"),
  zoomIn: $("#zoomInButton"), fitWidth: $("#fitWidthButton"), zoomLabel: $("#zoomLabel"), searchInput: $("#searchInput"),
  selectedText: $("#selectedText"), clearSelection: $("#clearSelectionButton"),
  question: $("#questionInput"), ask: $("#askButton"),
  selectionToolbar: $("#selectionToolbar"), contextChips: $("#contextChips"), conversationHistory: $("#conversationHistory"),
  status: $("#ollamaStatus"), modelChip: $("#modelNameChip"), settings: $("#settingsButton"),
  settingsDialog: $("#settingsDialog"), settingsForm: $("#settingsForm"), baseUrl: $("#baseUrlInput"), model: $("#modelInput"), toast: $("#toast")
};

const state = {
  pdf: null, fileName: "", page: 1, scale: 1.2, pageShell: null, selected: null,
  textCache: new Map(), annotations: [], documentKey: "", aiBusy: false, paragraphContext: "",
  contextToggles: { selection: true, paragraph: true, chapter: false, global: false },
  baseUrl: defaultBaseUrl, modelEnabled: localStorage.getItem("pdf-studio-model-enabled") !== "false",
  model: localStorage.getItem("pdf-studio-model") || "qwen3.5:9b-mlx", liveMessage: null, rendering: false,
  chatMessages: [], pageObserver: null, ocrBusy: false
};

function toast(message) {
  els.toast.textContent = message; els.toast.classList.add("show");
  clearTimeout(toast.timer); toast.timer = setTimeout(() => els.toast.classList.remove("show"), 2800);
}

function documentKey(fileName) { return `pdf-studio:${fileName}`; }
function loadAnnotations() { try { state.annotations = JSON.parse(localStorage.getItem(state.documentKey) || "[]"); } catch { state.annotations = []; } renderAnnotations(); }
function saveAnnotations() { localStorage.setItem(state.documentKey, JSON.stringify(state.annotations)); renderAnnotations(); }
function chatStorageKey() { return `pdf-studio-chat:${state.documentKey}`; }
function loadChatHistory() { try { state.chatMessages = JSON.parse(localStorage.getItem(chatStorageKey()) || "[]").filter(item => item && (item.role === "user" || item.role === "assistant") && typeof item.content === "string").slice(-40); } catch { state.chatMessages = []; } renderStoredChatHistory(); }
function saveChatHistory() { localStorage.setItem(chatStorageKey(), JSON.stringify(state.chatMessages.slice(-40))); }

function renderStoredChatHistory() {
  els.conversationHistory.innerHTML = "";
  if (!state.chatMessages.length) {
    els.conversationHistory.innerHTML = `<div id="emptyConversation" class="conversation-empty"><div class="response-placeholder-icon">✦</div><p>这里是你和本地模型的对话。</p><span>可以直接提问，也可以先在 PDF 中选择文字。</span></div>`;
    return;
  }
  for (const message of state.chatMessages) {
    const entry = document.createElement("div"); entry.className = `conversation-entry ${message.role === "user" ? "user" : "assistant"}`;
    const role = document.createElement("div"); role.className = "conversation-role"; role.textContent = message.role === "user" ? "我" : `本地助手 · ${state.model}`;
    const content = document.createElement("div"); content.className = "conversation-content";
    if (message.role === "assistant") content.innerHTML = renderRichText(message.content); else content.textContent = message.content;
    entry.append(role, content); els.conversationHistory.append(entry);
  }
  els.conversationHistory.scrollTop = els.conversationHistory.scrollHeight;
}

function setStatus(type, label) { els.status.className = `status-pill status-${type}`; els.status.querySelector("span:last-child").textContent = label; els.status.setAttribute("aria-label", label); }

async function checkOllama(autoStart = false) {
  if (!state.modelEnabled) { setStatus("idle", "连接已关闭 · 点击开启"); return false; }
  try {
    const statusUrl = state.baseUrl.startsWith("/") ? `${state.baseUrl.replace(/\/$/, "")}/ollama-status` : `${state.baseUrl.replace(/\/v1\/?$/, "")}/api/tags`;
    const response = await fetch(statusUrl, { signal: AbortSignal.timeout(2500) });
    if (!response.ok) throw new Error("not ready");
    setStatus("ready", "Ollama 已连接 · 点击断开"); state.connectionMode = "bridge"; return true;
  } catch (primaryError) {
    // Older copies of the demo may be served without server.py. Fall back to
    // Ollama's local endpoint so the chat still works when CORS is permitted.
    if (state.baseUrl.startsWith("/")) {
      try {
        const direct = await fetch("http://127.0.0.1:11434/api/tags", { signal: AbortSignal.timeout(2500) });
        if (!direct.ok) throw new Error("direct Ollama is not ready");
        setStatus("ready", "Ollama 已连接 · 点击断开"); state.connectionMode = "direct"; return true;
      } catch { /* try the bridge start action below */ }
    }
    if (autoStart && state.baseUrl.startsWith("/")) {
      setStatus("idle", "正在启动 Ollama…");
      try {
        const response = await fetch(`${state.baseUrl.replace(/\/$/, "")}/ollama-start`, { method: "POST", signal: AbortSignal.timeout(10000) });
        if (response.ok) { setStatus("ready", "Ollama 已连接 · 点击断开"); state.connectionMode = "bridge"; return true; }
      } catch { /* fall through to a clear status */ }
    }
    const hint = primaryError?.message?.includes("404") ? "本地桥接未启动 · 点击连接" : "Ollama 未连接 · 点击连接";
    setStatus("error", hint); return false;
  }
}

async function toggleModelConnection() {
  if (state.modelEnabled) { state.modelEnabled = false; localStorage.setItem("pdf-studio-model-enabled", "false"); setStatus("idle", "连接已关闭 · 点击开启"); toast("已断开阅读器与本地模型的连接"); return; }
  state.modelEnabled = true; localStorage.setItem("pdf-studio-model-enabled", "true"); const connected = await checkOllama(true); if (connected) toast("已连接本地模型");
}

function openFilePicker() { els.fileInput.click(); }

async function loadPdf(file, saved = null) {
  if (state.aiBusy || state.rendering || state.bookLoading) { toast("请等待当前操作完成再切换书籍"); return; }
  await saveReadingProgress();
  if (!file) return;
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) { toast("请选择 PDF 文件"); return; }
  try {
    state.bookLoading = true;
    els.pdfViewport.classList.add("loading");
    const buffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    const book = saved || { id: crypto.randomUUID(), name:file.name, pdf:file, page:1, scale:1.2, offset:0, pages:pdf.numPages, lastOpened:Date.now() };
    if (!saved) {
      const page=await pdf.getPage(1); const view=page.getViewport({scale:0.3}); const cover=document.createElement('canvas'); cover.width=view.width;cover.height=view.height;
      await page.render({canvasContext:cover.getContext('2d'),viewport:view}).promise;book.cover=cover.toDataURL('image/jpeg',0.7);
      await putBook(book);
    }
    state.pageObserver?.disconnect(); els.pdfViewport.replaceChildren(); clearSelection();
    state.pdf = pdf; state.bookId=book.id; state.scale=book.scale || 1.2;
    document.querySelector('#libraryHome').hidden=true;document.querySelector('.workspace').hidden=false;
    els.zoomLabel.textContent=`${Math.round(state.scale*100)}%`;
    state.fileName = file.name; state.documentKey = documentKey(book.id); state.page = 1; state.textCache.clear();
    els.documentName.textContent = file.name; els.documentName.classList.remove("muted");
    els.pageCount.textContent = `${state.pdf.numPages} 页`; els.totalPages.textContent = state.pdf.numPages; els.pageInput.max = state.pdf.numPages;
    loadAnnotations(); loadChatHistory(); await renderDocumentOutline(); await renderPage(book.page || 1); els.emptyReader?.remove();
    const restored=pageShellForNumber(book.page || 1);
    if(restored) els.pdfViewport.scrollTop += (book.offset || 0)*restored.clientHeight;
    await patchBook(book.id,{lastOpened:Date.now()});
    toast(`已打开 ${file.name}`);
  } catch (error) { console.error(error); toast("PDF 打开失败，请确认文件没有损坏"); }
  finally { state.bookLoading = false; els.pdfViewport.classList.remove("loading"); }
}

async function pageText(pageNumber) {
  if (state.textCache.has(pageNumber)) return state.textCache.get(pageNumber);
  const page = await state.pdf.getPage(pageNumber); const content = await page.getTextContent();
  const text = content.items.map(item => item.str).join(" ").replace(/\s+/g, " ").trim();
  state.textCache.set(pageNumber, text); return text;
}

function makeOutlineButton(label, pageNumber, depth = 0) {
  const button = document.createElement("button"); button.className = `outline-item ${depth ? "outline-indent" : ""}`;
  button.dataset.page = String(pageNumber);
  button.innerHTML = `<span>${escapeHtml(label || `第 ${pageNumber} 页`)}</span><span class="outline-page">${pageNumber}</span>`;
  button.addEventListener("click", () => renderPage(pageNumber)); return button;
}

async function resolveDestination(dest) {
  try { const resolved = typeof dest === "string" ? await state.pdf.getDestination(dest) : dest; if (!resolved) return null; return (await state.pdf.getPageIndex(resolved[0])) + 1; } catch { return null; }
}

async function appendOutline(items, container, depth = 0) {
  for (const item of items || []) {
    const page = await resolveDestination(item.dest); const button = makeOutlineButton(item.title, page || 1, depth); container.append(button);
    if (item.items?.length) await appendOutline(item.items, container, depth + 1);
  }
}

async function renderDocumentOutline() {
  els.outlineList.innerHTML = "";
  const outline = await state.pdf.getOutline();
  if (outline?.length) await appendOutline(outline, els.outlineList);
  else for (let page = 1; page <= state.pdf.numPages; page += 1) els.outlineList.append(makeOutlineButton(`第 ${page} 页`, page));
}

async function preparePageShell(pageNumber, shell) {
  const page = await state.pdf.getPage(pageNumber); const viewport = page.getViewport({ scale: state.scale });
  shell.dataset.page = String(pageNumber); shell.dataset.rendered = "false"; shell.style.width = `${viewport.width}px`; shell.style.height = `${viewport.height}px`;
  shell.innerHTML = `<div class="page-placeholder">第 ${pageNumber} 页</div>`;
}

async function renderPageIntoShell(pageNumber, shell) {
  if (!shell || shell.dataset.rendered === "true" || shell.dataset.rendering === "true") return;
  shell.dataset.rendering = "true";
  try {
    const page = await state.pdf.getPage(pageNumber); const viewport = page.getViewport({ scale: state.scale });
    shell.style.width = `${viewport.width}px`; shell.style.height = `${viewport.height}px`; shell.replaceChildren();
    const outputScale = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const canvas = document.createElement("canvas"); canvas.width = Math.floor(viewport.width * outputScale); canvas.height = Math.floor(viewport.height * outputScale); canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`;
    const textLayer = document.createElement("div"); textLayer.className = "text-layer";
    const highlightLayer = document.createElement("div"); highlightLayer.className = "highlight-layer";
    shell.append(canvas, highlightLayer, textLayer);
    const transform = outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0];
    await page.render({ canvasContext: canvas.getContext("2d"), viewport, transform }).promise;
    const content = await page.getTextContent();
    const textItems = content.items.filter(item => item.str);
    for (const item of textItems) {
      const transform = pdfjsLib.Util.transform(viewport.transform, item.transform); const fontSize = Math.max(5, Math.hypot(transform[2], transform[3]));
      const span = document.createElement("span"); span.textContent = item.str; span.dataset.text = item.str;
      span.style.left = `${transform[4]}px`; span.style.top = `${transform[5] - fontSize}px`; span.style.fontSize = `${fontSize}px`; span.style.height = `${fontSize * 1.2}px`; span.style.width = `${Math.max(item.width * state.scale, fontSize * .25)}px`;
      const angle = Math.atan2(transform[1], transform[0]); if (Math.abs(angle) > .001) span.style.transform = `rotate(${angle}rad)`;
      textLayer.append(span);
    }
    if (!textItems.length) addScanPageTools(pageNumber, shell, canvas);
    renderHighlights(shell); shell.dataset.rendered = "true";
  } finally {
    delete shell.dataset.rendering;
  }
}

function addScanPageTools(pageNumber, shell, canvas) {
  const tools = document.createElement("div"); tools.className = "scan-page-tools";
  const hint = document.createElement("span"); hint.textContent = "此页没有可选文字";
  const ocrButton = document.createElement("button"); ocrButton.className = "button button-soft button-small"; ocrButton.textContent = "识别文字";
  const visionButton = document.createElement("button"); visionButton.className = "button button-ghost button-small"; visionButton.textContent = "让模型分析此页";
  ocrButton.addEventListener("click", () => runOcr(pageNumber, shell, canvas, ocrButton));
  visionButton.addEventListener("click", () => askModel(`请分析 PDF 第 ${pageNumber} 页的内容。说明页面主题、关键结构、图表或公式，并指出无法确定的部分。`, `分析第 ${pageNumber} 页`, { imageData: canvas.toDataURL("image/png") }));
  tools.append(hint, ocrButton, visionButton); shell.append(tools);
}

async function runOcr(pageNumber, shell, canvas, button) {
  if (state.ocrBusy) return; state.ocrBusy = true; button.disabled = true; button.textContent = "识别中…";
  let worker;
  try {
    const { createWorker } = await import("https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/+esm");
    worker = await createWorker("eng+chi_sim");
    const result = await worker.recognize(canvas);
    const text = result.data.text.replace(/\s+/g, " ").trim();
    if (!text) throw new Error("没有识别到文字");
    state.textCache.set(pageNumber, text);
    const tools = shell.querySelector(".scan-page-tools");
    tools.querySelector("span").textContent = "已识别文字";
    const textBlock = document.createElement("div"); textBlock.className = "ocr-text"; textBlock.textContent = text; tools.after(textBlock);
    const useButton = document.createElement("button"); useButton.className = "button button-soft button-small"; useButton.textContent = "使用识别文字提问";
    useButton.addEventListener("click", () => { state.selected = { text, page: pageNumber, rects: [] }; state.pageShell = shell; updatePageIndicator(pageNumber); els.selectedText.textContent = text; els.selectedText.classList.remove("muted"); state.paragraphContext = text; updateContextChips(); els.question.focus(); });
    tools.append(useButton); button.remove();
  } catch (error) { toast(`OCR 失败：${error.message}`); button.disabled = false; button.textContent = "重试识别"; }
  finally { if (worker) await worker.terminate(); state.ocrBusy = false; }
}

function updatePageIndicator(pageNumber = state.page) {
  state.page = Math.max(1, Math.min(pageNumber, state.pdf?.numPages || 1));
  els.pageInput.value = state.page;
  els.outlineList.querySelectorAll(".outline-item").forEach(item => item.classList.toggle("active", Number(item.dataset.page) === state.page));
}

function pageShellForNumber(pageNumber) {
  return [...els.pdfViewport.querySelectorAll(".page-shell")].find(shell => Number(shell.dataset.page) === pageNumber) || null;
}

function scrollToPage(pageNumber, behavior = "smooth") {
  const shell = pageShellForNumber(pageNumber); if (!shell) return;
  state.pageShell = shell; updatePageIndicator(pageNumber);
  const viewportRect = els.pdfViewport.getBoundingClientRect(); const shellRect = shell.getBoundingClientRect();
  const top = els.pdfViewport.scrollTop + shellRect.top - viewportRect.top - 20;
  els.pdfViewport.scrollTo({ top: Math.max(0, top), behavior });
}

function observePageShells(shells) {
  state.pageObserver?.disconnect();
  state.pageObserver = new IntersectionObserver(entries => { entries.filter(entry => entry.isIntersecting).forEach(entry => { const shell = entry.target; void renderPageIntoShell(Number(shell.dataset.page), shell); }); }, { root: els.pdfViewport, rootMargin: "1000px 0px", threshold: 0.01 });
  shells.forEach(shell => state.pageObserver.observe(shell));
}

async function renderDocumentPages(targetPage = 1) {
  if (!state.pdf || state.rendering) return;
  state.rendering = true;
  try {
    state.pageObserver?.disconnect();
    const boundedTarget = Math.max(1, Math.min(targetPage, state.pdf.numPages));
    const shells = [];
    const fragment = document.createDocumentFragment();
    for (let pageNumber = 1; pageNumber <= state.pdf.numPages; pageNumber += 1) {
      const shell = document.createElement("div"); shell.className = "page-shell"; shell.dataset.page = String(pageNumber); shells.push(shell); fragment.append(shell);
    }
    els.pdfViewport.replaceChildren(fragment);
    for (const shell of shells) await preparePageShell(Number(shell.dataset.page), shell);
    observePageShells(shells); state.pageShell = pageShellForNumber(boundedTarget); updatePageIndicator(boundedTarget); scrollToPage(boundedTarget, "auto");
    await renderPageIntoShell(boundedTarget, pageShellForNumber(boundedTarget));
  } finally {
    state.rendering = false;
  }
}

async function renderPage(pageNumber) {
  if (!state.pdf || state.rendering) return;
  const boundedPage = Math.max(1, Math.min(pageNumber, state.pdf.numPages));
  const shell = pageShellForNumber(boundedPage);
  if (!shell) { await renderDocumentPages(boundedPage); return; }
  scrollToPage(boundedPage); await renderPageIntoShell(boundedPage, shell);
}

function renderHighlights(pageShell = state.pageShell) {
  const layer = pageShell?.querySelector(".highlight-layer"); if (!layer) return; layer.innerHTML = "";
  const pageNumber = Number(pageShell.dataset.page || state.page);
  for (const item of state.annotations.filter(annotation => annotation.page === pageNumber && annotation.type === "highlight")) {
    for (const rect of item.rects || []) { const element = document.createElement("div"); element.className = "highlight-rect"; element.style.left = `${rect.left * pageShell.clientWidth}px`; element.style.top = `${rect.top * pageShell.clientHeight}px`; element.style.width = `${rect.width * pageShell.clientWidth}px`; element.style.height = `${rect.height * pageShell.clientHeight}px`; layer.append(element); }
  }
}

function selectionRects(range, pageShell) {
  const pageRect = pageShell.getBoundingClientRect();
  return [...range.getClientRects()].filter(rect => rect.width > 1 && rect.height > 1).map(rect => ({ left: (rect.left - pageRect.left) / pageRect.width, top: (rect.top - pageRect.top) / pageRect.height, width: rect.width / pageRect.width, height: rect.height / pageRect.height }));
}

function captureSelection() {
  const selection = window.getSelection(); if (!selection || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0); const node = range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement; const pageShell = node?.closest(".page-shell"); if (!pageShell) return;
  const text = selection.toString().replace(/\s+/g, " ").trim(); if (!text) return;
  const page = Number(pageShell.dataset.page) || state.page; state.pageShell = pageShell; updatePageIndicator(page);
  state.selected = { text, page, rects: selectionRects(range, pageShell) }; els.selectedText.textContent = text; els.selectedText.classList.remove("muted");
  const selectionRect = range.getBoundingClientRect(); const readerRect = document.querySelector(".reader-column").getBoundingClientRect();
  els.selectionToolbar.style.left = `${selectionRect.left + selectionRect.width / 2 - readerRect.left}px`; els.selectionToolbar.style.top = `${Math.max(72, selectionRect.top - readerRect.top)}px`; els.selectionToolbar.classList.add("visible"); els.selectionToolbar.setAttribute("aria-hidden", "false");
  const selectedSnapshot = state.selected;
  pageText(page).then(fullText => { if (state.selected !== selectedSnapshot) return; const index = fullText.indexOf(text); const start = index < 0 ? 0 : Math.max(0, index - 260); const end = index < 0 ? Math.min(fullText.length, 900) : Math.min(fullText.length, index + text.length + 260); state.paragraphContext = fullText.slice(start, end); updateContextChips(); });
  updateContextChips();
}

function updateContextChips() {
  els.contextChips.querySelectorAll(".context-chip").forEach(chip => { const key = chip.dataset.context; chip.classList.toggle("active", state.contextToggles[key] && key !== "selection"); chip.classList.toggle("required", key === "selection"); });
}

function clearSelection() { state.selected = null; state.paragraphContext = ""; window.getSelection()?.removeAllRanges(); els.selectedText.textContent = "在 PDF 中拖动选择文字，翻译、解释和公式推导会使用这里的内容。"; els.selectedText.classList.add("muted"); els.selectionToolbar.classList.remove("visible"); els.selectionToolbar.setAttribute("aria-hidden", "true"); updateContextChips(); }

function addAnnotation(type) {
  if (!state.selected) { toast("先在 PDF 中选择一段文字"); return; }
  const note = type === "note" ? window.prompt("写下这段内容的笔记：", "") : ""; if (type === "note" && note === null) return;
  state.annotations.unshift({ id: crypto.randomUUID(), type, text: state.selected.text, note, page: state.selected.page, rects: state.selected.rects, createdAt: new Date().toISOString() }); saveAnnotations(); if (type === "highlight") renderHighlights(state.pageShell); toast(type === "note" ? "笔记已保存" : "已添加高亮");
}

function renderAnnotations() {
  els.annotationCount.textContent = state.annotations.length; els.annotationList.innerHTML = "";
  if (!state.annotations.length) { els.annotationList.innerHTML = `<div class="empty-small">选择文字后，可以添加高亮或笔记。</div>`; return; }
  state.annotations.slice(0, 30).forEach(annotation => {
    const card = document.createElement("div"); card.className = "annotation-card"; card.innerHTML = `<div class="annotation-type">${annotation.type === "note" ? "笔记" : "高亮"}</div><div class="annotation-preview">${escapeHtml(annotation.note || annotation.text)}</div><div class="annotation-meta">第 ${annotation.page} 页</div>`;
    card.addEventListener("click", () => renderPage(annotation.page)); els.annotationList.append(card);
  });
}

function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character])); }

function renderRichText(value) {
  const formulas = [];
  let source = String(value || "").replace(/\\\[([\s\S]*?)\\\]|\\\(([\s\S]*?)\\\)|\$\$([\s\S]*?)\$\$|\$([^$\n]+?)\$/g, (match, displayBracket, inlineBracket, displayDollar, inlineDollar) => {
    const display = Boolean(displayBracket || displayDollar); const expression = displayBracket || inlineBracket || displayDollar || inlineDollar || "";
    const token = `@@FORMULA_${formulas.length}@@`; formulas.push({ token, expression, display }); return token;
  });
  const inline = text => text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*([^*]+?)\*/g, "<em>$1</em>");
  const lines = escapeHtml(source).split("\n"); let html = ""; let list = null;
  const closeList = () => { if (list) { html += `</${list}>`; list = null; } };
  for (const line of lines) {
    const heading = line.match(/^(#{1,3})\s+(.+)$/); const bullet = line.match(/^\s*[-*]\s+(.+)$/); const numbered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (!line.trim()) { closeList(); html += "<br>"; continue; }
    if (heading) { closeList(); const level = heading[1].length; html += `<h${level}>${inline(heading[2])}</h${level}>`; continue; }
    if (bullet || numbered) { const nextList = bullet ? "ul" : "ol"; if (list !== nextList) { closeList(); list = nextList; html += `<${list}>`; } html += `<li>${inline((bullet || numbered)[1])}</li>`; continue; }
    closeList(); html += `<div>${inline(line)}</div>`;
  }
  closeList();
  for (const formula of formulas) {
    const rendered = window.katex ? window.katex.renderToString(formula.expression, { displayMode: formula.display, throwOnError: false }) : `<span class="math-fallback">${escapeHtml(formula.expression)}</span>`;
    html = html.replaceAll(formula.token, rendered);
  }
  return `<div class="rich-text">${html}</div>`;
}

function actionPrompt(action) {
  const prompts = {
    translate: "请把选中的 PDF 内容准确翻译成简体中文。保留公式、变量名、引用编号与原有结构，只输出翻译结果。",
    explain: "请用中文解释选中内容在上下文中的逻辑。先概括它在解决什么问题，再逐步说明每个关键概念；遇到公式时保留 LaTeX，并解释符号含义。",
    derive: "请对选中内容中出现的公式进行严谨的逐步推导。明确写出假设、每一步使用的定理或恒等式，并用 LaTeX 排版；若信息不足，请指出缺少的条件，不要臆造。",
    summarize: "请用中文总结选中内容，保留关键结论、条件和公式，控制在 5 个要点以内。"
  }; return prompts[action] || "请帮助我理解这段内容。";
}

function buildContextPrompt(question) {
  const parts = [question];
  if (state.contextToggles.paragraph && state.paragraphContext) parts.push(`\n--- 当前段落上下文（可关闭） ---\n${state.paragraphContext}`);
  if (state.contextToggles.selection && state.selected?.text) parts.push(`\n--- 精确选中文字（必选） ---\n${state.selected.text}`);
  return parts.join("\n");
}

function beginChatExchange(question) {
  $("#emptyConversation")?.remove();
  const exchange = document.createElement("div"); exchange.className = "chat-exchange";
  const userEntry = document.createElement("div"); userEntry.className = "conversation-entry user"; userEntry.innerHTML = `<div class="conversation-role">我</div><div class="conversation-content"></div>`; userEntry.querySelector(".conversation-content").textContent = question;
  const assistantEntry = document.createElement("div"); assistantEntry.className = "conversation-entry assistant loading"; assistantEntry.innerHTML = `<div class="conversation-role">本地助手 · ${escapeHtml(state.model)}</div><div class="conversation-content">本地模型正在思考…</div>`;
  exchange.append(userEntry, assistantEntry); els.conversationHistory.append(exchange); els.conversationHistory.scrollTop = els.conversationHistory.scrollHeight; return assistantEntry.querySelector(".conversation-content");
}

function updateLiveMessage(message, thinking = false) { if (!state.liveMessage) return; state.liveMessage.innerHTML = renderRichText(message); state.liveMessage.parentElement.classList.toggle("loading", thinking); els.conversationHistory.scrollTop = els.conversationHistory.scrollHeight; }

function readStreamChunk(parsed) {
  const choice = parsed.choices?.[0] || {}; const delta = choice.delta || {};
  const message = choice.message || parsed.message || {};
  const content = delta.content ?? message.content ?? parsed.content ?? "";
  const thinking = delta.reasoning_content ?? delta.reasoning ?? delta.thinking ?? message.reasoning_content ?? message.thinking ?? parsed.thinking ?? "";
  return { content, thinking, done: parsed.done === true || Boolean(choice.finish_reason) };
}

async function readStreamingResponse(response, onUpdate) {
  if (!response.body) return { content: "", thinking: "" };
  const reader = response.body.getReader(); const decoder = new TextDecoder();
  let buffer = ""; let content = ""; let thinking = ""; let finished = false;
  const consume = (text) => {
    buffer += text;
    const lines = buffer.split(/\r?\n/); buffer = lines.pop() || "";
    for (const rawLine of lines) {
      const line = rawLine.trim(); if (!line) continue;
      const payload = line.startsWith("data:") ? line.slice(5).trim() : line;
      if (!payload || payload === "[DONE]") { finished = true; continue; }
      let parsed; try { parsed = JSON.parse(payload); } catch { continue; }
      const chunk = readStreamChunk(parsed); content += chunk.content || ""; thinking += chunk.thinking || "";
      onUpdate(content, thinking);
      if (chunk.done) finished = true;
    }
  };
  while (!finished) {
    const { value, done } = await reader.read();
    if (done) break;
    consume(decoder.decode(value, { stream: true }));
  }
  consume(decoder.decode());
  if (buffer.trim()) {
    const payload = buffer.trim().startsWith("data:") ? buffer.trim().slice(5).trim() : buffer.trim();
    try { const chunk = readStreamChunk(JSON.parse(payload)); content += chunk.content || ""; thinking += chunk.thinking || ""; onUpdate(content, thinking); } catch { /* incomplete final line */ }
  }
  return { content, thinking };
}

async function askModel(prompt, displayQuestion = prompt, options = {}) {
  if (state.aiBusy) return; state.aiBusy = true; els.ask.disabled = true; state.liveMessage = beginChatExchange(displayQuestion);
  if (!state.modelEnabled) { updateLiveMessage("当前连接已关闭，请先点击顶部的模型连接按钮。", false); state.liveMessage = null; state.aiBusy = false; els.ask.disabled = false; return; }
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 60000);
  try {
    const currentMessage = { role: "user", content: prompt };
    if (options.imageData) currentMessage.images = [options.imageData.replace(/^data:image\/[^;]+;base64,/, "")];
    const messages = [{ role: "system", content: "你是一个严谨的本地 PDF 阅读助手。请用简体中文回答，公式使用 LaTeX。" }, ...state.chatMessages.slice(-12), currentMessage];
    const requestBody = JSON.stringify({ model: state.model, messages, temperature: .2, think: false, stream: true });
    const headers = { "Content-Type": "application/json", Authorization: "Bearer ollama" };
    const bridgeEndpoint = `${state.baseUrl.replace(/\/$/, "")}/chat`;
    const directEndpoint = "http://127.0.0.1:11434/api/chat";
    let response;
    try {
      const endpoint = state.connectionMode === "direct" ? directEndpoint : (state.baseUrl.startsWith("/") ? bridgeEndpoint : `${state.baseUrl.replace(/\/$/, "")}/chat/completions`);
      response = await fetch(endpoint, { method: "POST", signal: controller.signal, headers, body: requestBody });
      if (!response.ok && state.baseUrl.startsWith("/")) throw new Error(`bridge ${response.status}`);
    } catch (primaryError) {
      if (!state.baseUrl.startsWith("/")) throw primaryError;
      state.connectionMode = "direct";
      response = await fetch(directEndpoint, { method: "POST", signal: controller.signal, headers, body: requestBody });
    }
    if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
    let content = ""; let thinking = "";
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("ndjson") || contentType.includes("jsonl")) {
      ({ content, thinking } = await readStreamingResponse(response, (partialContent, partialThinking) => {
        updateLiveMessage(partialContent || (partialThinking ? `模型思考过程：\n\n${partialThinking}` : "模型正在生成…"), true);
      }));
    } else {
      const data = await response.json(); const message = data.choices?.[0]?.message || data.message || {};
      content = message.content || data.choices?.[0]?.text || ""; thinking = message.reasoning_content || message.thinking || "";
    }
    const answer = content || (thinking ? `模型思考过程：\n\n${thinking}` : "模型没有返回内容。");
    updateLiveMessage(answer); state.chatMessages.push({ role: "user", content: prompt }, { role: "assistant", content: answer }); saveChatHistory(); setStatus("ready", "Ollama 已连接 · 点击断开");
  } catch (error) { if (error.name !== "AbortError") console.error(error); const message = error.name === "AbortError" ? "模型响应超过 60 秒，已停止等待。" : `连接本地模型失败。\n\n请确认 Ollama 正在运行，并且已下载模型「${state.model}」。\n\n错误：${error.message}`; updateLiveMessage(message); setStatus("error", "Ollama 未连接 · 点击连接"); }
  finally { clearTimeout(timeout); state.liveMessage?.parentElement.classList.remove("loading"); state.liveMessage = null; state.aiBusy = false; els.ask.disabled = false; }
}

function runAction(action) { if (action === "highlight" || action === "note") { addAnnotation(action); return; } if (action === "ask") { els.question.focus(); return; } if (!state.selected?.text) { toast("先在 PDF 中选择一段文字"); return; } askModel(buildContextPrompt(actionPrompt(action)), actionPrompt(action)); }

async function searchDocument(query) {
  if (!state.pdf || !query.trim()) return;
  const normalized = query.trim().toLowerCase(); const matches = [];
  for (let page = 1; page <= state.pdf.numPages; page += 1) { const text = (await pageText(page)).toLowerCase(); if (text.includes(normalized)) matches.push(page); }
  els.outlineList.innerHTML = ""; if (!matches.length) { els.outlineList.innerHTML = `<div class="empty-small">没有找到“${escapeHtml(query)}”。</div>`; return; }
  const heading = document.createElement("div"); heading.className = "empty-small"; heading.textContent = `找到 ${matches.length} 页`; els.outlineList.append(heading); matches.forEach(page => els.outlineList.append(makeOutlineButton(`匹配：${query}`, page)));
}

function fitWidth() { if (!state.pdf || state.rendering) return; const pageWidth = Math.max(280, els.pdfViewport.clientWidth - 70); state.pdf.getPage(state.page).then(page => { const unscaled = page.getViewport({ scale: 1 }); state.scale = pageWidth / unscaled.width; els.zoomLabel.textContent = `${Math.round(state.scale * 100)}%`; renderDocumentPages(state.page); }); }

function updateVisiblePage() {
  if (!state.pdf || state.rendering) return;
  const viewportTop = els.pdfViewport.getBoundingClientRect().top + 24; let closest = null; let closestDistance = Infinity;
  els.pdfViewport.querySelectorAll(".page-shell").forEach(shell => { const rect=shell.getBoundingClientRect(); const distance = rect.top <= viewportTop && rect.bottom > viewportTop ? 0 : Math.min(Math.abs(rect.top-viewportTop), Math.abs(rect.bottom-viewportTop)); if (distance < closestDistance) { closest = shell; closestDistance = distance; } });
  if (!closest) return;
  const page = Number(closest.dataset.page); if (page !== state.page) { state.pageShell = closest; updatePageIndicator(page); }
}

let pageScrollFrame = 0;
els.pdfViewport.addEventListener("scroll", () => { if (pageScrollFrame) return; pageScrollFrame = requestAnimationFrame(() => { pageScrollFrame = 0; updateVisiblePage(); }); });

els.openPdfButton.addEventListener("click", openFilePicker); els.emptyOpenButton.addEventListener("click", openFilePicker); els.fileInput.addEventListener("change", event => loadPdf(event.target.files?.[0]));
els.previousPage.addEventListener("click", () => renderPage(state.page - 1)); els.nextPage.addEventListener("click", () => renderPage(state.page + 1));
els.pageInput.addEventListener("change", event => renderPage(Number(event.target.value) || 1));
els.zoomOut.addEventListener("click", () => { if (!state.pdf || state.rendering) return; state.scale = Math.max(.5, state.scale - .1); els.zoomLabel.textContent = `${Math.round(state.scale * 100)}%`; renderDocumentPages(state.page); });
els.zoomIn.addEventListener("click", () => { if (!state.pdf || state.rendering) return; state.scale = Math.min(3, state.scale + .1); els.zoomLabel.textContent = `${Math.round(state.scale * 100)}%`; renderDocumentPages(state.page); });
els.fitWidth.addEventListener("click", fitWidth); els.searchInput.addEventListener("keydown", event => { if (event.key === "Enter") searchDocument(event.target.value); });
document.addEventListener("mouseup", captureSelection); document.addEventListener("keyup", event => { if (event.key === "Shift") captureSelection(); });
els.clearSelection.addEventListener("click", clearSelection);
els.selectionToolbar.querySelectorAll("[data-selection-action]").forEach(button => button.addEventListener("click", () => runAction(button.dataset.selectionAction)));
els.contextChips.querySelectorAll(".context-chip").forEach(chip => chip.addEventListener("click", () => { const key = chip.dataset.context; if (chip.disabled || key === "selection") return; state.contextToggles[key] = !state.contextToggles[key]; updateContextChips(); }));
els.ask.addEventListener("click", () => { const question = els.question.value.trim(); if (!question) { toast("先写下你的问题"); return; } askModel(buildContextPrompt(question), question); els.question.value = ""; });
els.question.addEventListener("keydown", event => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") els.ask.click(); });
els.settings.addEventListener("click", () => { els.baseUrl.value = state.baseUrl; els.model.value = state.model; els.settingsDialog.showModal(); });
els.settingsForm.addEventListener("submit", event => { event.preventDefault(); state.baseUrl = els.baseUrl.value.trim().replace(/\/$/, "") || "/api"; state.model = els.model.value.trim() || "qwen3.5:9b-mlx"; localStorage.setItem("pdf-studio-base-url", state.baseUrl); localStorage.setItem("pdf-studio-model", state.model); els.modelChip.textContent = state.model; els.settingsDialog.close(); checkOllama(); toast("设置已保存"); });
window.addEventListener("resize", () => { if (state.pdf && state.pageShell && window.innerWidth < 860 && !state.rendering) renderDocumentPages(state.page); });
els.status.addEventListener("click", toggleModelConnection);

els.modelChip.textContent = state.model; checkOllama();

let progressTimer;
async function saveReadingProgress() {
 if(!state.bookId || state.rendering || document.querySelector('.workspace').hidden) return;
 const shell=pageShellForNumber(state.page);const top=els.pdfViewport.getBoundingClientRect().top;
 const offset=shell ? (top+20-shell.getBoundingClientRect().top)/shell.clientHeight : 0;
 try {await patchBook(state.bookId,{page:state.page,scale:state.scale,offset,lastOpened:Date.now()});}
 catch(error){console.error(error);toast('阅读进度保存失败，请检查可用存储空间');}
}
els.pdfViewport.addEventListener('scroll',()=>{clearTimeout(progressTimer);progressTimer=setTimeout(saveReadingProgress,250);});
async function showLibrary(mode='home') {
 if(state.aiBusy || state.rendering || state.bookLoading){toast('请等待当前操作完成');return;}
 await saveReadingProgress();
 document.querySelector('.workspace').hidden=true;document.querySelector('#libraryHome').hidden=false;
 document.querySelector('#libraryHeading').textContent=({home:'继续阅读',all:'全部书籍',recent:'最近阅读'})[mode];
 const grid=document.querySelector('#bookGrid');grid.replaceChildren();
 try {
 const books=(await listBooks()).sort((a,b)=>b.lastOpened-a.lastOpened);
 for(const book of (mode==='all'?books:books.slice(0,mode==='home'?6:20))){
  const card=document.createElement('button');card.className='book-card';
  const cover=document.createElement('img');cover.src=book.cover || '';cover.alt='书籍封面';
  const title=document.createElement('strong');title.textContent=book.name;
  const info=document.createElement('small');info.textContent=`第 ${book.page} / ${book.pages} 页 · ${new Date(book.lastOpened).toLocaleDateString()}`;
  const progress=document.createElement('progress');progress.max=book.pages;progress.value=book.page;
  card.append(cover,title,info,progress);card.onclick=async()=>{const stored=await getBook(book.id);await loadPdf(stored.pdf,stored);};grid.append(card);
 }
 if(!books.length)grid.textContent='书库还是空的。点击右上角“导入 PDF”添加第一本书。';
 }catch(error){grid.textContent='无法读取书库：'+error.message;}
}
document.querySelector('#homeButton').onclick=()=>showLibrary();
document.querySelectorAll('[data-library]').forEach(button=>button.onclick=()=>showLibrary(button.dataset.library));
document.addEventListener('visibilitychange',()=>{if(document.hidden)void saveReadingProgress();});
void showLibrary();
