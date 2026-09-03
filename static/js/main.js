// PDF Creator Frontend Logic

document.addEventListener('DOMContentLoaded', () => {
    // State management
    let images = []; // Array of { id, file, name, dataUrl, rotation }
    let zoomLevel = 150; // Percentage
    let currentPage = 1;
    let currentTab = 'organize';
    let ocrResults = []; // Array of { id, pageNum, lang, text }
    let currentPdfBlob = null; // Stores the compiled PDF Blob from Python backend
    let currentGridCols = '40px 40px 70px 70px 90px 1fr 1fr';

    // IndexedDB setup for page images preview cache & PDF Library
    const dbName = "PdfOcrScannerDB";
    const storeName = "images";
    const pdfStoreName = "pdf_files";

    function openDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(dbName, 2);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(storeName)) {
                    db.createObjectStore(storeName);
                }
                if (!db.objectStoreNames.contains(pdfStoreName)) {
                    db.createObjectStore(pdfStoreName, { keyPath: "id", autoIncrement: true });
                }
            };
            request.onsuccess = (e) => resolve(e.target.result);
            request.onerror = (e) => reject(e.target.error);
        });
    }

    async function saveImagesToDB(imagesList) {
        try {
            const db = await openDB();
            const tx = db.transaction(storeName, "readwrite");
            const store = tx.objectStore(storeName);
            await store.clear();
            const serializableImages = imagesList.map(img => ({
                id: img.id,
                name: img.name,
                dataUrl: img.dataUrl,
                rotation: img.rotation || 0
            }));
            await store.put(serializableImages, "page_images");
        } catch (err) {
            console.error("IndexedDB Save Error:", err);
        }
    }

    async function loadImagesFromDB() {
        try {
            const db = await openDB();
            const tx = db.transaction(storeName, "readonly");
            const store = tx.objectStore(storeName);
            return new Promise((resolve) => {
                const req = store.get("page_images");
                req.onsuccess = () => resolve(req.result || []);
                req.onerror = () => resolve([]);
            });
        } catch (err) {
            console.error("IndexedDB Load Error:", err);
            return [];
        }
    }

    async function savePdfToDB(name, blob) {
        try {
            const db = await openDB();
            const tx = db.transaction(pdfStoreName, "readwrite");
            const store = tx.objectStore(pdfStoreName);
            const sizeMB = (blob.size / (1024 * 1024)).toFixed(2) + " MB";
            const item = {
                name: name,
                blob: blob,
                size: sizeMB,
                addedAt: Date.now()
            };
            return new Promise((resolve, reject) => {
                const req = store.add(item);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
        } catch (err) {
            console.error("IndexedDB Save PDF Error:", err);
        }
    }

    async function loadPdfsFromDB() {
        try {
            const db = await openDB();
            const tx = db.transaction(pdfStoreName, "readonly");
            const store = tx.objectStore(pdfStoreName);
            return new Promise((resolve) => {
                const req = store.getAll();
                req.onsuccess = () => resolve(req.result || []);
                req.onerror = () => resolve([]);
            });
        } catch (err) {
            console.error("IndexedDB Load PDFs Error:", err);
            return [];
        }
    }

    async function deletePdfFromDB(id) {
        try {
            const db = await openDB();
            const tx = db.transaction(pdfStoreName, "readwrite");
            const store = tx.objectStore(pdfStoreName);
            return new Promise((resolve, reject) => {
                const req = store.delete(id);
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
            });
        } catch (err) {
            console.error("IndexedDB Delete PDF Error:", err);
        }
    }

    async function clearAllPdfsFromDB() {
        try {
            const db = await openDB();
            const tx = db.transaction(pdfStoreName, "readwrite");
            const store = tx.objectStore(pdfStoreName);
            return new Promise((resolve, reject) => {
                const req = store.clear();
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
            });
        } catch (err) {
            console.error("IndexedDB Clear PDFs Error:", err);
        }
    }

    function saveOcrResults() {
        const cleanResults = ocrResults.map(r => ({
            id: r.id,
            lineNum: r.lineNum,
            pageNum: r.pageNum,
            lineText: r.lineText,
            transText: r.transText,
            lang: r.lang,
            box_2d: r.box_2d,
            shape: r.shape,
            fontSize: r.fontSize,
            fontFamily: r.fontFamily,
            textAlign: r.textAlign,
            color: r.color,
            isBold: r.isBold,
            x_pct: r.x_pct,
            y_pct: r.y_pct
        }));
        localStorage.setItem('ocrResults', JSON.stringify(cleanResults));
    }

    function saveState() {
        localStorage.setItem('currentPage', currentPage);
        if (ocrLangSelect) {
            localStorage.setItem('selectedLang', ocrLangSelect.value);
        }
    }

    function isGarbageText(text, lang) {
        const trimmed = text.trim();
        if (!trimmed) return true;

        // Since manga dialogues are in ALL CAPS, filter out any phrase containing lowercase English letters (a-z)
        if (/[a-z]/.test(trimmed)) {
            return true;
        }

        // Check if contains Khmer characters
        const hasKhmer = /[\u1780-\u17FF]/.test(trimmed);

        // If we are scanning Khmer (auto or khm+eng or khm):
        if (lang !== 'eng') {
            // If it has NO Khmer characters, and is very short (less than 15 characters), it's likely English noise/garbage
            if (!hasKhmer && trimmed.length < 15) {
                return true;
            }
        }

        // General noise filter:
        // If it's extremely short (e.g. under 4 characters) and contains only letters/punctuation/symbols (garbage like Blt, pe, ++, etc.)
        if (trimmed.length < 4) {
            // Unless it has a Khmer character, ignore extremely short garbage
            if (!hasKhmer) {
                return true;
            }
        }

        // If it contains symbols/colons and has no Khmer characters, and is under 12 characters:
        if (!hasKhmer && trimmed.length < 12) {
            // Check if it ends with colon or contains weird symbols like ++, tt, etc.
            if (trimmed.endsWith(':') || /[\+\*#@_\/\\]/.test(trimmed) || trimmed.split(/\s+/).every(w => w.length <= 3)) {
                return true;
            }
        }

        return false;
    }

    function dataURLtoBlob(dataurl) {
        const arr = dataurl.split(',');
        const mime = arr[0].match(/:(.*?);/)[1];
        const bstr = atob(arr[1]);
        let n = bstr.length;
        const u8arr = new Uint8Array(n);
        while (n--) {
            u8arr[n] = bstr.charCodeAt(n);
        }
        return new Blob([u8arr], { type: mime });
    }

    function renderPdfViewportPreviews() {
        pdfViewport.innerHTML = '';
        images.forEach((img, index) => {
            const pageEl = document.createElement('div');
            pageEl.className = 'pdf-page-render flex-shrink-0 w-[320px] h-auto bg-white dark:bg-slate-950 flex flex-col overflow-hidden relative transition-all duration-300';
            pageEl.style.width = `${(320 * zoomLevel) / 100}px`;
            pageEl.style.height = 'auto';
            
            pageEl.innerHTML = `
                <div class="absolute top-4 right-4 z-10 bg-slate-900/60 dark:bg-slate-800/80 backdrop-blur-md text-white font-bold text-xs px-2.5 py-1 rounded-full border border-white/10">
                    Page ${index + 1}
                </div>
                
                <div class="flex-1 p-0 flex items-center justify-center bg-white dark:bg-slate-950">
                    <img src="${img.dataUrl}" style="transform: rotate(${img.rotation}deg);" class="w-full h-full object-contain" alt="Page ${index + 1}">
                </div>
            `;
            pdfViewport.appendChild(pageEl);
        });

        currentPageNum.textContent = currentPage;
        totalPagesNum.textContent = images.length;
        prevPageBtn.disabled = (currentPage === 1);
        nextPageBtn.disabled = (currentPage === images.length || images.length <= 1);
    }

    function ensureItemBox2D(item, idx = 0) {
        if (!item) return;
        if (!item.box_2d || !Array.isArray(item.box_2d) || item.box_2d.length !== 4) {
            const itemIdx = (idx !== undefined && idx >= 0) ? idx : (item.lineNum ? item.lineNum - 1 : 0);
            const topPct = 12 + ((itemIdx % 7) * 12);
            const leftPct = 15;
            item.box_2d = [
                Math.round(topPct * 10),
                Math.round(leftPct * 10),
                Math.round((topPct + 10) * 10),
                Math.round((leftPct + 60) * 10)
            ];
        }
    }

    async function initApp() {
        const savedLang = localStorage.getItem('selectedLang');
        if (savedLang && ocrLangSelect) {
            ocrLangSelect.value = savedLang;
        }

        const savedResults = localStorage.getItem('ocrResults');
        if (savedResults) {
            try {
                ocrResults = JSON.parse(savedResults);
                ocrResults.forEach((r, idx) => {
                    ensureItemBox2D(r, idx);
                    if (!r.bgColor) r.bgColor = "#ffffff";
                    if (r.hasBg === undefined) r.hasBg = true;
                });
                saveOcrResults();
            } catch (e) {
                console.error("Failed to parse saved ocrResults", e);
            }
        }

        // Load PDF Grid from database on startup
        await loadAndRenderPdfGrid();

        if (ocrResults.length > 0) {
            renderOcrTable();
        }
    }

    // DOM Elements - Navigation & Theme
    const themeToggleBtn = document.getElementById('theme-toggle');
    const tabOrganize = document.getElementById('tab-organize');
    const tabOcr = document.getElementById('tab-ocr');
    const contentOrganize = document.getElementById('content-organize');
    const contentOcr = document.getElementById('content-ocr');

    // DOM Elements - Image Upload & Organize
    const dropzone = document.getElementById('dropzone');
    const fileInput = document.getElementById('file-input');
    const pdfGrid = document.getElementById('pdf-grid');
    const gridEmptyState = document.getElementById('grid-empty-state');
    const pdfCountBadge = document.getElementById('pdf-count');
    const clearAllBtn = document.getElementById('clear-all');

    // DOM Elements - PDF Preview
    const pdfViewport = document.getElementById('pdf-viewport');

    // DOM Elements - PDF Compilation Settings & Download
    const btnDownload = document.getElementById('btn-download');

    // DOM Elements - OCR Panel
    const ocrLangSelect = document.getElementById('ocr-lang');
    const ocrPageSelect = document.getElementById('ocr-page-select');
    const btnScan = document.getElementById('btn-scan');
    const modeStdOcr = document.getElementById('mode-std-ocr');
    const modeMangaOcr = document.getElementById('mode-manga-ocr');
    const btnScanLabel = document.getElementById('btn-scan-label');
    const btnApplyKhmerPdf = document.getElementById('btn-apply-khmer-pdf');
    const btnDownloadDocx = document.getElementById('btn-download-docx');
    const ocrProgressContainer = document.getElementById('ocr-progress-container');
    const ocrProgressBar = document.getElementById('ocr-progress-bar');
    const ocrProgressPercent = document.getElementById('ocr-progress-percent');
    const ocrStatusText = document.getElementById('ocr-status-text');
    const ocrEmptyTableState = document.getElementById('ocr-empty-table-state');
    const btnCopyText = document.getElementById('btn-copy-text');
    const btnSaveTxt = document.getElementById('btn-save-txt');
    const btnAiReview = document.getElementById('btn-ai-review');
    const btnMergeSelected = document.getElementById('btn-merge-selected');
    const ocrTableContainer = document.getElementById('ocr-table-container');
    const ocrTableBody = document.getElementById('ocr-table-body');
    const ocrSelectAll = document.getElementById('ocr-select-all');
    const btnDeleteAll = document.getElementById('ocr-btn-delete-all');
    const btnToggleFullscreen = document.getElementById('btn-toggle-fullscreen');
    const btnImportTxt = document.getElementById('btn-import-txt');
    const importTxtInput = document.getElementById('import-txt-input');
    const btnAddAbove = document.getElementById('btn-add-above');
    const btnAddBelow = document.getElementById('btn-add-below');

    // DOM Elements - Gemini API Key Management
    const btnHeaderApiKey = document.getElementById('btn-header-api-key');
    const headerApiStatus = document.getElementById('header-api-status');
    const modalApiKey = document.getElementById('modal-api-key');
    const btnCloseApiModal = document.getElementById('btn-close-api-modal');
    const btnModalApiCancel = document.getElementById('btn-modal-api-cancel');
    const btnModalApiSave = document.getElementById('btn-modal-api-save');
    const modalGeminiKeyInput = document.getElementById('modal-gemini-key-input');
    const geminiApiKeyInput = document.getElementById('gemini-api-key-input');
    const btnSaveKeyOcr = document.getElementById('btn-save-key-ocr');
    const apiKeyStatusText = document.getElementById('api-key-status-text');

    let serverHasKey = false;

    function getGeminiApiKey() {
        return (localStorage.getItem('gemini_api_key') || '').trim();
    }

    function setGeminiApiKey(key) {
        const cleaned = (key || '').trim();
        if (cleaned) {
            localStorage.setItem('gemini_api_key', cleaned);
        } else {
            localStorage.removeItem('gemini_api_key');
        }
        updateApiKeyUI();
    }

    function updateApiKeyUI() {
        const localKey = getGeminiApiKey();
        const hasKey = !!localKey || serverHasKey;

        if (geminiApiKeyInput) {
            geminiApiKeyInput.value = localKey || (serverHasKey ? '••••••••••••••••' : '');
        }
        if (modalGeminiKeyInput) {
            modalGeminiKeyInput.value = localKey;
        }

        if (apiKeyStatusText) {
            if (hasKey) {
                apiKeyStatusText.textContent = '✓ រួចរាល់ (Key Ready)';
                apiKeyStatusText.className = 'text-[10px] text-emerald-600 dark:text-emerald-400 font-bold';
            } else {
                apiKeyStatusText.textContent = '⚠️ ត្រូវការ Key (Required)';
                apiKeyStatusText.className = 'text-[10px] text-amber-600 dark:text-amber-400 font-semibold';
            }
        }

        if (headerApiStatus) {
            headerApiStatus.textContent = hasKey ? 'API Key ✓' : 'Set API Key';
        }
    }

    function openApiKeyModal() {
        if (!modalApiKey) return;
        const localKey = getGeminiApiKey();
        if (modalGeminiKeyInput) modalGeminiKeyInput.value = localKey;
        modalApiKey.classList.remove('hidden');
    }

    function closeApiKeyModal() {
        if (!modalApiKey) return;
        modalApiKey.classList.add('hidden');
    }

    async function checkGeminiStatus() {
        try {
            const res = await fetch('/api/gemini/status');
            const data = await res.json();
            if (data.status === 'success' && data.hasEnvKey) {
                serverHasKey = true;
            }
        } catch (e) {
            console.warn('Could not check gemini status:', e);
        }
        updateApiKeyUI();
    }

    // Gemini API Key Event Listeners
    if (btnHeaderApiKey) btnHeaderApiKey.addEventListener('click', openApiKeyModal);
    if (btnCloseApiModal) btnCloseApiModal.addEventListener('click', closeApiKeyModal);
    if (btnModalApiCancel) btnModalApiCancel.addEventListener('click', closeApiKeyModal);
    if (btnModalApiSave) {
        btnModalApiSave.addEventListener('click', () => {
            const val = modalGeminiKeyInput ? modalGeminiKeyInput.value : '';
            setGeminiApiKey(val);
            closeApiKeyModal();
            alert('✓ Gemini API Key ត្រូវបានរក្សាទុកដោយជោគជ័យ!');
        });
    }
    if (btnSaveKeyOcr) {
        btnSaveKeyOcr.addEventListener('click', () => {
            const val = geminiApiKeyInput ? geminiApiKeyInput.value : '';
            if (val && !val.includes('••••')) {
                setGeminiApiKey(val);
                alert('✓ Gemini API Key ត្រូវបានរក្សាទុកដោយជោគជ័យ!');
            } else if (!val) {
                setGeminiApiKey('');
                alert('បានលុប Gemini API Key');
            }
        });
    }

    // Initialize API Key status
    checkGeminiStatus();

    // -------------------------------------------------------------
    // 1. Theme Configuration (Dark / Light Mode)
    // -------------------------------------------------------------
    // Initialize dark mode if configured or fallback to system preferences
    if (localStorage.getItem('theme') === 'light') {
        document.documentElement.classList.remove('dark');
    } else {
        document.documentElement.classList.add('dark');
    }

    themeToggleBtn.addEventListener('click', () => {
        if (document.documentElement.classList.contains('dark')) {
            document.documentElement.classList.remove('dark');
            localStorage.setItem('theme', 'light');
        } else {
            document.documentElement.classList.add('dark');
            localStorage.setItem('theme', 'dark');
        }
    });

    // -------------------------------------------------------------
    // 2. Tab Navigation
    // -------------------------------------------------------------
    function switchTab(tab) {
        currentTab = tab;
        if (tab === 'organize') {
            // Activate Tab 1 Button
            tabOrganize.classList.add('bg-white', 'dark:bg-slate-800', 'shadow-sm', 'text-brand-600', 'dark:text-brand-400', 'border', 'border-slate-200/50', 'dark:border-slate-700/50');
            tabOrganize.classList.remove('text-slate-500', 'dark:text-slate-400');
            // Deactivate Tab 2 Button
            tabOcr.classList.remove('bg-white', 'dark:bg-slate-800', 'shadow-sm', 'text-brand-600', 'dark:text-brand-400', 'border', 'border-slate-200/50', 'dark:border-slate-700/50');
            tabOcr.classList.add('text-slate-500', 'dark:text-slate-400');
            
            // Show / Hide Content
            contentOrganize.classList.remove('hidden');
            contentOcr.classList.add('hidden');
        } else {
            // Activate Tab 2 Button
            tabOcr.classList.add('bg-white', 'dark:bg-slate-800', 'shadow-sm', 'text-brand-600', 'dark:text-brand-400', 'border', 'border-slate-200/50', 'dark:border-slate-700/50');
            tabOcr.classList.remove('text-slate-500', 'dark:text-slate-400');
            // Deactivate Tab 1 Button
            tabOrganize.classList.remove('bg-white', 'dark:bg-slate-800', 'shadow-sm', 'text-brand-600', 'dark:text-brand-400', 'border', 'border-slate-200/50', 'dark:border-slate-700/50');
            tabOrganize.classList.add('text-slate-500', 'dark:text-slate-400');
            
            // Show / Hide Content
            contentOcr.classList.remove('hidden');
            contentOrganize.classList.add('hidden');
            
            // Update OCR page selector dropdown based on current images
            updateOcrPageSelectOptions();
        }
        lucide.createIcons();
    }

    tabOrganize.addEventListener('click', () => switchTab('organize'));
    tabOcr.addEventListener('click', () => switchTab('ocr'));

    // -------------------------------------------------------------
    // 3. Image Upload (Drag & Drop + File Selector)
    // -------------------------------------------------------------
    
    // Highlight dropzone on drag events
    ['dragenter', 'dragover'].forEach(eventName => {
        dropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropzone.classList.add('dragover-active');
        }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropzone.classList.remove('dragover-active');
        }, false);
    });

    // Handle dropped files
    dropzone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        handleFiles(files);
    });

    // Handle file input selection
    fileInput.addEventListener('change', (e) => {
        handleFiles(e.target.files);
    });

    function handleFiles(files) {
        Array.from(files).forEach(file => {
            if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
                const reader = new FileReader();
                reader.readAsArrayBuffer(file);
                reader.onloadend = async () => {
                    const pdfBlob = new Blob([reader.result], { type: 'application/pdf' });
                    // Save to IndexedDB PDF store
                    const newId = await savePdfToDB(file.name, pdfBlob);
                    
                    // Reload PDF grid list
                    await loadAndRenderPdfGrid();
                    
                    // Auto-select uploaded PDF
                    const pdfList = await loadPdfsFromDB();
                    const targetPdf = pdfList.find(p => p.id === newId);
                    if (targetPdf) {
                        selectPdfFile(targetPdf);
                    }
                    
                    alert(`✨ បានបញ្ចូលឯកសារ PDF "${file.name}" ទៅកាន់បណ្ណាល័យដោយជោគជ័យ!`);
                };
            } else {
                alert(`សូមបញ្ចូលឯកសារ PDF តែប៉ុណ្ណោះ។ ឯកសារ "${file.name}" មិនត្រូវបានអនុញ្ញាតឡើយ។`);
            }
        });
    }



    // -------------------------------------------------------------
    // 4. PDF Library Grid Rendering & File Handlers
    // -------------------------------------------------------------
    let activePdfFile = null;
    let activePdfObjectUrl = null;

    async function loadAndRenderPdfGrid() {
        if (!pdfGrid) return;
        
        const pdfList = await loadPdfsFromDB();
        
        pdfGrid.innerHTML = '';
        pdfCountBadge.textContent = pdfList.length;
        
        if (pdfList.length === 0) {
            gridEmptyState.classList.remove('hidden');
            pdfGrid.appendChild(gridEmptyState);
            clearAllBtn.disabled = true;
            return;
        }
        
        gridEmptyState.classList.add('hidden');
        clearAllBtn.disabled = false;
        
        pdfList.forEach(item => {
            const card = document.createElement('div');
            card.className = 'pdf-card bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 rounded-xl flex flex-col justify-between shadow-sm relative group hover:border-brand-500 transition duration-300';
            
            const dateStr = new Date(item.addedAt).toLocaleDateString('km-KH', {
                year: 'numeric',
                month: 'short',
                day: 'numeric'
            });
            
            const isDocx = (item.name || '').toLowerCase().endsWith('.docx');
            const iconBg = isDocx ? 'bg-blue-50 dark:bg-blue-950/30 border-blue-100 dark:border-blue-900/40 text-blue-600' : 'bg-red-50 dark:bg-red-950/20 border-red-100 dark:border-red-900/30 text-red-500';
            const badgeType = isDocx ? 'DOCX' : 'PDF';
            const badgeBg = isDocx ? 'bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300' : 'bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300';
            
            card.innerHTML = `
                <div class="flex items-start gap-3">
                    <div class="w-10 h-10 rounded-lg ${iconBg} border flex items-center justify-center shrink-0">
                        <i data-lucide="${isDocx ? 'file-text' : 'file-code'}" class="w-6 h-6"></i>
                    </div>
                    <div class="overflow-hidden flex-1">
                        <div class="flex items-center gap-1.5">
                            <h4 class="font-bold text-xs text-slate-800 dark:text-slate-200 truncate flex-1" title="${item.name}">${item.name}</h4>
                            <span class="text-[9px] font-bold px-1.5 py-0.5 rounded ${badgeBg}">${badgeType}</span>
                        </div>
                        <p class="text-[10px] text-slate-400 dark:text-slate-500 mt-1">${item.size} • ${dateStr}</p>
                    </div>
                </div>
                
                <div class="flex items-center gap-1.5 mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/80">
                    <button class="btn-pdf-view flex-1 py-1.5 bg-slate-50 hover:bg-slate-100 dark:bg-slate-800/50 dark:hover:bg-slate-800 text-[10px] font-bold text-slate-600 dark:text-slate-300 rounded-lg border border-slate-200/60 dark:border-slate-700/60 transition flex items-center justify-center gap-1">
                        <i data-lucide="eye" class="w-3.5 h-3.5"></i> មើល
                    </button>
                    <button class="btn-pdf-dl py-1.5 px-2 bg-brand-50 hover:bg-brand-100 dark:bg-brand-950/30 dark:hover:bg-brand-950/60 text-brand-600 dark:text-brand-400 rounded-lg border border-brand-100 dark:border-brand-900/30 transition" title="ទាញយក">
                        <i data-lucide="download" class="w-3.5 h-3.5"></i>
                    </button>
                    <button class="btn-pdf-ocr py-1.5 px-2 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/30 dark:hover:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 rounded-lg border border-indigo-100 dark:border-indigo-900/30 transition" title="ស្កែន OCR">
                        <i data-lucide="scan-text" class="w-3.5 h-3.5"></i>
                    </button>
                    <button class="btn-pdf-del py-1.5 px-2 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/30 dark:hover:bg-rose-950/60 text-rose-600 dark:text-rose-400 rounded-lg border border-rose-100 dark:border-rose-900/30 transition" title="លុប">
                        <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                    </button>
                </div>
            `;
            
            card.querySelector('.btn-pdf-view').addEventListener('click', () => selectPdfFile(item));
            card.querySelector('.btn-pdf-dl').addEventListener('click', () => downloadPdfFile(item.blob, item.name));
            card.querySelector('.btn-pdf-ocr').addEventListener('click', () => extractAndScanOcrPdf(item.blob, item.name));
            card.querySelector('.btn-pdf-del').addEventListener('click', async () => {
                if (confirm(`តើអ្នកពិតជាចង់លុបឯកសារ "${item.name}" នេះមែនទេ?`)) {
                    await deletePdfFromDB(item.id);
                    if (activePdfFile && activePdfFile.id === item.id) {
                        clearActivePdf();
                    }
                    await loadAndRenderPdfGrid();
                }
            });
            
            pdfGrid.appendChild(card);
        });
        
        lucide.createIcons();
    }

    function selectPdfFile(item) {
        activePdfFile = item;
        currentPdfBlob = item.blob;
        
        renderPdfViewport(item.blob, item.name);
        
        const activePdfInfo = document.getElementById('active-pdf-info');
        const activePdfName = document.getElementById('active-pdf-name');
        const activePdfSize = document.getElementById('active-pdf-size');
        
        if (activePdfInfo) {
            activePdfName.textContent = item.name;
            activePdfSize.textContent = item.size;
            activePdfInfo.classList.remove('hidden');
        }
        
        if (btnDownload) {
            btnDownload.disabled = false;
        }

        // Enable scan UI when PDF is selected
        if (ocrPageSelect && btnScan) {
            ocrPageSelect.disabled = false;
            btnScan.disabled = false;
            updateOcrPageSelectOptions();
        }
        if (btnAiReview) {
            btnAiReview.disabled = (ocrResults.length === 0);
        }
        if (btnApplyKhmerPdf) {
            btnApplyKhmerPdf.disabled = (!currentPdfBlob || ocrResults.length === 0);
        }
        if (btnDownloadDocx) {
            btnDownloadDocx.disabled = false;
        }
    }

    function clearActivePdf() {
        activePdfFile = null;
        currentPdfBlob = null;
        renderPdfViewport(null);
        
        const activePdfInfo = document.getElementById('active-pdf-info');
        if (activePdfInfo) {
            activePdfInfo.classList.add('hidden');
        }
        if (btnDownload) {
            btnDownload.disabled = true;
        }
        if (btnDownloadDocx) {
            btnDownloadDocx.disabled = true;
        }
        if (btnAiReview) {
            btnAiReview.disabled = true;
        }
        if (btnApplyKhmerPdf) {
            btnApplyKhmerPdf.disabled = true;
        }

        // Disable scan UI
        updateOcrPageSelectOptions();
    }

    function downloadPdfFile(blob, filename) {
        try {
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        } catch (err) {
            alert('មានបញ្ហាក្នុងការទាញយក៖ ' + err.message);
        }
    }

    async function extractAndScanOcrPdf(pdfBlob, pdfName) {
        switchTab('ocr');
        currentPdfBlob = pdfBlob;
        activePdfFile = { name: pdfName, blob: pdfBlob };
        
        // Show progress bar container
        ocrProgressContainer.classList.remove('hidden');
        ocrProgressBar.style.width = '0%';
        ocrProgressPercent.textContent = '0%';
        ocrStatusText.textContent = 'កំពុងចាប់ផ្តើមស្កែនឯកសារ PDF ទាំងមូល (Starting direct PDF OCR)...';
        btnScan.disabled = true;
        
        const localKey = getGeminiApiKey();
        if (!localKey && !serverHasKey) {
            openApiKeyModal();
            btnScan.disabled = false;
            ocrProgressContainer.classList.add('hidden');
            alert('សូមបញ្ចូល Google Gemini API Key ជាមុនសិន ដើម្បីស្កែនអត្ថបទ។ (Please enter Gemini API Key)');
            return;
        }

        try {
            const lang = ocrLangSelect ? ocrLangSelect.value : 'auto';
            const formData = new FormData();
            formData.append('file', pdfBlob, pdfName);
            formData.append('lang', lang);
            formData.append('pages', 'all');
            
            // Set progress bar to 40% for visual feedback
            ocrProgressBar.style.width = '40%';
            ocrProgressPercent.textContent = '40%';
            ocrStatusText.textContent = 'កំពុងដំណើរការ OCR លើទំព័រ PDF ទាំងអស់...';

            const headers = {};
            if (localKey) headers['x-gemini-api-key'] = localKey;

            const response = await fetch('/api/scan-ocr-pdf', {
                method: 'POST',
                headers: headers,
                body: formData
            });
            
            const text = await response.text();
            let data;
            try {
                data = JSON.parse(text);
            } catch (jsonErr) {
                throw new Error(`Server returned error (${response.status}): ${text.slice(0, 120)}`);
            }
            if (!response.ok) {
                throw new Error(data.message || 'Failed to scan PDF file');
            }
            if (data.status === 'success' && data.results) {
                // Clear any running delete timers
                ocrResults.forEach(r => { if (r.deleteTimer) clearInterval(r.deleteTimer); });
                
                // Filter out garbage/noise text before saving
                ocrResults = data.results.filter(r => !isGarbageText(r.lineText, lang));
                saveOcrResults();
                renderOcrTable();
                updateOcrPageSelectOptions();
                
                ocrProgressBar.style.width = '100%';
                ocrProgressPercent.textContent = '100%';
                ocrStatusText.textContent = 'ស្កែនអក្សរបានជោគជ័យ!';
                
                setTimeout(() => {
                    ocrProgressContainer.classList.add('hidden');
                    btnScan.disabled = false;
                    alert(`✨ ការស្កែនអក្សរលើឯកសារ PDF បានបញ្ចប់ដោយជោគជ័យ!`);
                }, 600);
            } else {
                throw new Error(data.message || 'No results returned from server');
            }
        } catch (err) {
            ocrProgressContainer.classList.add('hidden');
            btnScan.disabled = false;
            console.error(err);
            alert('មានបញ្ហាក្នុងការស្កែនអត្ថបទ៖ ' + err.message);
        }
    }


    // -------------------------------------------------------------
    // Direct DOCX & Document Viewer State & Controls (Read-Only)
    // -------------------------------------------------------------
    let currentDocPages = [];
    let currentDocPageIndex = 0;
    let docZoomLevel = 100;
    let isDocFitWidth = true;
    let isContinuousScroll = true; // Default: Webtoon Continuous Vertical Scroll

    const btnZoomIn = document.getElementById('zoom-in');
    const btnZoomOut = document.getElementById('zoom-out');
    const btnZoomFit = document.getElementById('zoom-fit');
    const zoomValText = document.getElementById('zoom-val');
    const btnPrevPage = document.getElementById('prev-page');
    const btnNextPage = document.getElementById('next-page');
    const currentPageNumSpan = document.getElementById('current-page-num');
    const totalPagesNumSpan = document.getElementById('total-pages-num');
    const btnScrollMode = document.getElementById('btn-scroll-mode');
    const docActiveTitle = document.getElementById('doc-active-title');

    function updateWordViewerControls() {
        const total = currentDocPages.length;
        if (total === 0) {
            if (currentPageNumSpan) currentPageNumSpan.textContent = '1';
            if (totalPagesNumSpan) totalPagesNumSpan.textContent = '1';
            if (btnPrevPage) btnPrevPage.disabled = true;
            if (btnNextPage) btnNextPage.disabled = true;
            if (zoomValText) zoomValText.textContent = '100%';
            return;
        }

        if (currentPageNumSpan) currentPageNumSpan.textContent = (currentDocPageIndex + 1);
        if (totalPagesNumSpan) totalPagesNumSpan.textContent = total;
        if (btnPrevPage) btnPrevPage.disabled = (currentDocPageIndex <= 0);
        if (btnNextPage) btnNextPage.disabled = (currentDocPageIndex >= total - 1);
        if (zoomValText) zoomValText.textContent = `${docZoomLevel}%`;

        if (btnZoomFit) {
            if (isDocFitWidth) {
                btnZoomFit.classList.add('text-blue-600', 'dark:text-blue-400', 'bg-white', 'dark:bg-slate-700', 'shadow-xs');
            } else {
                btnZoomFit.classList.remove('text-blue-600', 'dark:text-blue-400', 'bg-white', 'dark:bg-slate-700', 'shadow-xs');
            }
        }

        // Update OCR page selector to sync with current viewed page
        if (ocrPageSelect) {
            const curOpt = ocrPageSelect.querySelector('option[value="current"]');
            if (curOpt) curOpt.textContent = `ទំព័របច្ចុប្បន្ន (${currentDocPageIndex + 1})`;
        }
    }

    let isNavigating = false;

    function updateScrollModeButtonUI() {
        if (!btnScrollMode) return;
        if (isContinuousScroll) {
            btnScrollMode.innerHTML = `<i data-lucide="scroll" class="w-3.5 h-3.5 text-blue-500"></i> <span id="scroll-mode-label">Webtoon</span>`;
            btnScrollMode.classList.add('bg-blue-50', 'dark:bg-blue-950/40', 'border-blue-300', 'text-blue-600');
        } else {
            btnScrollMode.innerHTML = `<i data-lucide="file" class="w-3.5 h-3.5 text-slate-500"></i> <span id="scroll-mode-label">ទំព័រទោល</span>`;
            btnScrollMode.classList.remove('bg-blue-50', 'dark:bg-blue-950/40', 'border-blue-300', 'text-blue-600');
        }
        lucide.createIcons();
    }

    if (btnScrollMode) {
        btnScrollMode.addEventListener('click', () => {
            isContinuousScroll = !isContinuousScroll;
            updateScrollModeButtonUI();
            renderWordDocViewer(false);
            if (isContinuousScroll) {
                scrollToPage(currentDocPageIndex);
            }
        });
    }
    async function extractImagesFromDocxBlob(docxBlob) {
        if (!window.JSZip) {
            throw new Error('JSZip library not available');
        }
        const zip = await JSZip.loadAsync(docxBlob);
        let orderedMediaFiles = [];

        // 1. Build Relationship map from word/_rels/document.xml.rels
        const relsMap = {};
        const relsFile = zip.file('word/_rels/document.xml.rels');
        if (relsFile) {
            const relsXml = await relsFile.async('text');
            const relMatches = relsXml.matchAll(/<Relationship\s+[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g);
            for (const match of relMatches) {
                const id = match[1];
                let target = match[2];
                if (!target.toLowerCase().startsWith('word/')) {
                    target = 'word/' + target.replace(/^\//, '');
                }
                relsMap[id] = target;
            }
        }

        // 2. Extract in strict sequential page order from word/document.xml
        const docFile = zip.file('word/document.xml');
        if (docFile) {
            const docXml = await docFile.async('text');
            const embedMatches = docXml.matchAll(/r:embed="([^"]+)"/g);
            for (const match of embedMatches) {
                const rId = match[1];
                const target = relsMap[rId];
                if (target && zip.files[target] && !orderedMediaFiles.includes(target)) {
                    orderedMediaFiles.push(target);
                }
            }
        }

        // 3. Fallback if document.xml didn't provide embed relationships
        if (orderedMediaFiles.length === 0) {
            orderedMediaFiles = Object.keys(zip.files).filter(f => f.toLowerCase().startsWith('word/media/') && !zip.files[f].dir);
            orderedMediaFiles.sort((a, b) => {
                const numA = parseInt((a.replace(/\D/g, '') || '0'), 10);
                const numB = parseInt((b.replace(/\D/g, '') || '0'), 10);
                return numA - numB;
            });
        }

        const pages = [];
        for (let i = 0; i < orderedMediaFiles.length; i++) {
            const file = zip.files[orderedMediaFiles[i]];
            if (!file) continue;
            const base64 = await file.async('base64');
            const ext = file.name.split('.').pop().toLowerCase();
            let mime = 'image/jpeg';
            if (ext === 'png') mime = 'image/png';
            else if (ext === 'webp') mime = 'image/webp';
            else if (ext === 'gif') mime = 'image/gif';

            pages.push({
                pageNum: i + 1,
                name: file.name,
                dataUrl: `data:${mime};base64,${base64}`
            });
        }
        return pages;
    }

    function renderWordDocViewer(preserveScroll = true) {
        if (!pdfViewport) return;

        let prevScrollTop = 0;
        const oldContainer = pdfViewport.querySelector('.word-editor-scroll-container');
        if (oldContainer && preserveScroll) {
            prevScrollTop = oldContainer.scrollTop;
        }

        pdfViewport.innerHTML = '';

        if (!currentDocPages || currentDocPages.length === 0) {
            pdfViewport.innerHTML = `
                <div id="pdf-empty-preview" class="flex-1 flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 p-6 text-center">
                    <i data-lucide="file-text" class="w-12 h-12 mb-3 stroke-1 opacity-60"></i>
                    <h3 class="text-xs font-semibold text-slate-700 dark:text-slate-300">មិនទាន់មានការជ្រើសរើស</h3>
                    <p class="text-[10px] text-slate-400 dark:text-slate-500 mt-1 max-w-xs">សូមជ្រើសរើសឯកសារ Word (.docx) ឬ Manga ពីបញ្ជីខាងស្តាំ ដើម្បីមើលទំព័រនៅទីនេះ</p>
                </div>
            `;
            updateWordViewerControls();
            updateScrollModeButtonUI();
            lucide.createIcons();
            return;
        }

        if (isContinuousScroll) {
            // WEBTOON / CONTINUOUS VERTICAL SCROLL MODE (Clean Read-Only Visual Preview)
            const container = document.createElement('div');
            container.className = "word-editor-scroll-container w-full h-full overflow-y-auto flex flex-col items-center gap-4 p-4 custom-scrollbar bg-slate-200/70 dark:bg-slate-950/80";

            currentDocPages.forEach((pageObj, pIdx) => {
                const pageNum = pIdx + 1;
                const sheet = document.createElement('div');
                sheet.id = `word-page-sheet-${pageNum}`;
                sheet.dataset.pageIndex = pIdx;
                sheet.className = "word-page-sheet bg-white dark:bg-slate-900 shadow-2xl rounded-sm border border-slate-300/80 dark:border-slate-800 transition-all duration-200 relative flex items-center justify-center overflow-hidden shrink-0 select-none cursor-pointer";
                sheet.style.width = isDocFitWidth ? '100%' : `${docZoomLevel}%`;
                sheet.style.maxWidth = isDocFitWidth ? '640px' : 'none';

                // Discreet Page Badge
                const pageBadge = document.createElement('div');
                pageBadge.className = "absolute top-2 left-2 px-2.5 py-1 bg-slate-900/80 hover:bg-slate-900 text-white text-[10px] font-bold rounded-lg z-30 shadow-md pointer-events-none backdrop-blur-sm border border-white/15 flex items-center gap-1.5 transition";
                pageBadge.innerHTML = `<i data-lucide="file-text" class="w-3 h-3 text-blue-400"></i> ទំព័រ ${pageNum}`;
                sheet.appendChild(pageBadge);

                const img = document.createElement('img');
                img.src = pageObj.dataUrl;
                img.alt = `Page ${pageNum}`;
                img.loading = "lazy";
                img.className = "w-full h-auto block select-none pointer-events-none";
                sheet.appendChild(img);

                // Clicking on a sheet updates active page
                sheet.addEventListener('click', () => {
                    currentDocPageIndex = pIdx;
                    updateWordViewerControls();
                });

                container.appendChild(sheet);
            });

            // IntersectionObserver to dynamically detect which page is in view while scrolling
            const observer = new IntersectionObserver((entries) => {
                if (isNavigating) return;
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const idx = parseInt(entry.target.dataset.pageIndex, 10);
                        if (!isNaN(idx) && idx !== currentDocPageIndex) {
                            currentDocPageIndex = idx;
                            updateWordViewerControls();
                        }
                    }
                });
            }, {
                root: container,
                threshold: 0.4
            });

            container.querySelectorAll('.word-page-sheet').forEach(s => observer.observe(s));
            pdfViewport.appendChild(container);

            if (preserveScroll && prevScrollTop > 0) {
                container.scrollTop = prevScrollTop;
            }
        } else {
            // SINGLE PAGE VIEW MODE (Clean Read-Only Visual Preview)
            const curPage = currentDocPages[currentDocPageIndex];
            if (!curPage) return;

            const container = document.createElement('div');
            container.className = "word-editor-scroll-container w-full h-full overflow-auto flex items-start justify-center p-4 custom-scrollbar bg-slate-200/70 dark:bg-slate-950/80";

            const sheet = document.createElement('div');
            sheet.id = `word-page-sheet-${currentDocPageIndex + 1}`;
            sheet.dataset.pageIndex = currentDocPageIndex;
            sheet.className = "word-page-sheet bg-white dark:bg-slate-900 shadow-2xl rounded-sm border border-slate-300/80 dark:border-slate-800 transition-all duration-200 relative flex items-center justify-center overflow-hidden my-auto select-none";
            sheet.style.width = isDocFitWidth ? '100%' : `${docZoomLevel}%`;
            sheet.style.maxWidth = isDocFitWidth ? '640px' : 'none';

            const img = document.createElement('img');
            img.src = curPage.dataUrl;
            img.alt = `Page ${currentDocPageIndex + 1}`;
            img.className = "w-full h-auto block select-none pointer-events-none";
            sheet.appendChild(img);

            container.appendChild(sheet);
            pdfViewport.appendChild(container);
        }

        updateWordViewerControls();
        updateScrollModeButtonUI();
        lucide.createIcons();
    }

    async function renderPdfViewport(blob, docName = '') {
        if (!blob) {
            currentDocPages = [];
            currentDocPageIndex = 0;
            if (docActiveTitle) docActiveTitle.textContent = '';
            renderWordDocViewer(false);
            return;
        }

        if (docActiveTitle && docName) {
            docActiveTitle.textContent = docName;
        }

        pdfViewport.innerHTML = `
            <div class="flex-1 flex flex-col items-center justify-center p-6 text-center text-slate-400 gap-3">
                <i data-lucide="loader" class="w-8 h-8 animate-spin text-brand-500"></i>
                <p class="text-xs font-bold text-slate-600 dark:text-slate-400">កំពុងផ្ទុកទំព័រឯកសារ...</p>
            </div>
        `;
        lucide.createIcons();

        // 1. Check if the file is a Word .docx file (Direct Instant Client-Side Extraction)
        const isDocx = (docName && docName.toLowerCase().endsWith('.docx')) ||
                       (blob.type && blob.type.includes('wordprocessingml'));

        if (isDocx) {
            try {
                const docxPages = await extractImagesFromDocxBlob(blob);
                if (docxPages && docxPages.length > 0) {
                    currentDocPages = docxPages;
                    currentDocPageIndex = 0;
                    renderWordDocViewer(false);
                    return;
                }
            } catch (docxErr) {
                console.warn('DOCX direct client extraction failed, falling back to server renderer:', docxErr.message);
            }
        }

        // 2. Standard PDF rendering via server
        try {
            const formData = new FormData();
            formData.append('file', blob, docName || 'document.pdf');

            const res = await fetch('/api/upload-pdf', {
                method: 'POST',
                body: formData
            });

            const data = await res.json();
            if (data.status === 'success' && data.pages && data.pages.length > 0) {
                currentDocPages = data.pages;
                currentDocPageIndex = 0;
                renderWordDocViewer(false);
            } else {
                throw new Error(data.message || 'Failed to render pages');
            }
        } catch (err) {
            console.error('Error rendering document viewer pages:', err);
            renderWordDocViewer(false);
        }
    }

    function scrollToPage(pageIndex) {
        if (!currentDocPages || currentDocPages.length === 0) return;
        currentDocPageIndex = Math.max(0, Math.min(currentDocPages.length - 1, pageIndex));
        
        if (isContinuousScroll) {
            const container = pdfViewport.querySelector('.word-editor-scroll-container');
            const targetSheet = document.getElementById(`word-page-sheet-${currentDocPageIndex + 1}`);
            if (container && targetSheet) {
                isNavigating = true;
                const targetScrollTop = targetSheet.offsetTop - container.offsetTop - 12;
                container.scrollTo({
                    top: targetScrollTop,
                    behavior: 'smooth'
                });
                setTimeout(() => { isNavigating = false; }, 500);
            }
            updateWordViewerControls();
        } else {
            renderWordDocViewer(false);
        }
    }

    // Zoom & Page Navigation Listeners
    if (btnPrevPage) {
        btnPrevPage.addEventListener('click', (e) => {
            e.preventDefault();
            if (currentDocPageIndex > 0) {
                scrollToPage(currentDocPageIndex - 1);
            }
        });
    }

    if (btnNextPage) {
        btnNextPage.addEventListener('click', (e) => {
            e.preventDefault();
            if (currentDocPageIndex < currentDocPages.length - 1) {
                scrollToPage(currentDocPageIndex + 1);
            }
        });
    }

    if (btnZoomIn) {
        btnZoomIn.addEventListener('click', () => {
            isDocFitWidth = false;
            docZoomLevel = Math.min(250, docZoomLevel + 25);
            renderWordDocViewer(true);
        });
    }

    if (btnZoomOut) {
        btnZoomOut.addEventListener('click', () => {
            isDocFitWidth = false;
            docZoomLevel = Math.max(50, docZoomLevel - 25);
            renderWordDocViewer(true);
        });
    }

    if (btnZoomFit) {
        btnZoomFit.addEventListener('click', () => {
            isDocFitWidth = true;
            docZoomLevel = 100;
            renderWordDocViewer(true);
        });
    }

    // Keyboard navigation (Left / Right arrows to switch pages)
    document.addEventListener('keydown', (e) => {
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
        if (e.key === 'ArrowLeft' && currentDocPageIndex > 0) {
            scrollToPage(currentDocPageIndex - 1);
        } else if (e.key === 'ArrowRight' && currentDocPageIndex < currentDocPages.length - 1) {
            scrollToPage(currentDocPageIndex + 1);
        }
    });

    clearAllBtn.addEventListener('click', async () => {
        if (confirm('តើអ្នកពិតជាចង់លុបឯកសារ PDF ទាំងអស់ចេញពីបណ្ណាល័យមែនទេ?')) {
            await clearAllPdfsFromDB();
            clearActivePdf();
            await loadAndRenderPdfGrid();
        }
    });

    // Handle bottom download button click
    btnDownload.addEventListener('click', () => {
        if (activePdfFile) {
            downloadPdfFile(activePdfFile.blob, activePdfFile.name);
        }
    });

    // -------------------------------------------------------------
    // 6. OCR Text Extraction Panel (Mock logic)
    // -------------------------------------------------------------
    
    function updateOcrPageSelectOptions() {
        ocrPageSelect.innerHTML = '';
        if ((!currentDocPages || currentDocPages.length === 0) && images.length === 0 && !currentPdfBlob) {
            const opt = document.createElement('option');
            opt.value = 'none';
            opt.textContent = 'គ្មានទំព័ររូបភាព';
            ocrPageSelect.appendChild(opt);
            ocrPageSelect.disabled = true;
            btnScan.disabled = true;
            return;
        }

        ocrPageSelect.disabled = false;
        btnScan.disabled = false;

        // 1. If we have active viewed pages from DOCX or PDF
        if (currentDocPages && currentDocPages.length > 0) {
            const optCurrent = document.createElement('option');
            optCurrent.value = 'current';
            optCurrent.textContent = `ទំព័របច្ចុប្បន្ន (${currentDocPageIndex + 1})`;
            ocrPageSelect.appendChild(optCurrent);

            const optAll = document.createElement('option');
            optAll.value = 'all';
            optAll.textContent = 'គ្រប់ទំព័រទាំងអស់';
            ocrPageSelect.appendChild(optAll);

            currentDocPages.forEach((_, idx) => {
                const opt = document.createElement('option');
                opt.value = idx + 1;
                opt.textContent = `ទំព័រទី ${idx + 1}`;
                ocrPageSelect.appendChild(opt);
            });
        } else if (images.length > 0) {
            const optCurrent = document.createElement('option');
            optCurrent.value = 'current';
            optCurrent.textContent = `ទំព័របច្ចុប្បន្ន (${currentPage})`;
            ocrPageSelect.appendChild(optCurrent);

            const optAll = document.createElement('option');
            optAll.value = 'all';
            optAll.textContent = 'គ្រប់ទំព័រទាំងអស់';
            ocrPageSelect.appendChild(optAll);

            images.forEach((_, idx) => {
                const opt = document.createElement('option');
                opt.value = idx + 1;
                opt.textContent = `ទំព័រទី ${idx + 1}`;
                ocrPageSelect.appendChild(opt);
            });
        } else if (currentPdfBlob) {
            let maxPage = 1;
            ocrResults.forEach(r => {
                if (r.pageNum > maxPage) maxPage = r.pageNum;
            });

            const optCurrent = document.createElement('option');
            optCurrent.value = 'current';
            optCurrent.textContent = `ទំព័របច្ចុប្បន្ន (${currentDocPageIndex + 1})`;
            ocrPageSelect.appendChild(optCurrent);

            const optAll = document.createElement('option');
            optAll.value = 'all';
            optAll.textContent = 'គ្រប់ទំព័រទាំងអស់';
            ocrPageSelect.appendChild(optAll);

            for (let idx = 1; idx <= maxPage; idx++) {
                const opt = document.createElement('option');
                opt.value = idx;
                opt.textContent = `ទំព័រទី ${idx}`;
                ocrPageSelect.appendChild(opt);
            }
        }
    }

    // Handle Start Scan Button click
    btnScan.addEventListener('click', async () => {
        if (!currentPdfBlob) {
            alert('⚠️ សូមជ្រើសរើសឯកសារ Word (.docx) ឬ PDF មួយពីបញ្ជីឯកសារជាមុនសិន មុននឹងចាប់ផ្តើមស្កែន!\n(Please select a Word or PDF file from the Document Library first.)');
            switchTab('organize');
            return;
        }

        // Confirm overwrite if we already have OCR results
        if (ocrResults.length > 0) {
            const proceed = confirm('ការស្កែនឡើងវិញនឹងលុប និងជំនួសរាល់អត្ថបទចាស់ៗទាំងអស់។ តើអ្នកពិតជាចង់បន្តការស្កែនមែនទេ?\n(Rescanning will clear and overwrite all existing transcripts. Do you want to proceed?)');
            if (!proceed) {
                return;
            }
        }

        const lang = ocrLangSelect.value;
        const targetPageVal = ocrPageSelect.value;

        const localKey = getGeminiApiKey();
        if (!localKey && !serverHasKey) {
            // Re-verify server status once more before blocking
            await checkGeminiStatus();
            if (!serverHasKey) {
                openApiKeyModal();
                alert('សូមបញ្ចូល Google Gemini API Key ជាមុនសិន ដើម្បីស្កែនអត្ថបទ និងបកប្រែ។ (Please enter your Gemini API Key first)');
                return;
            }
        }

        // Show progress bar container
        ocrProgressContainer.classList.remove('hidden');
        ocrProgressBar.style.width = '5%';
        ocrProgressPercent.textContent = '5%';
        ocrStatusText.textContent = 'កំពុងចាប់ផ្តើមស្កែន និងបកប្រែជាភាសាខ្មែរ...';
        btnScan.disabled = true;

        let pagesParam = 'all';
        if (targetPageVal === 'current') {
            pagesParam = String(currentPage);
        } else if (targetPageVal !== 'all' && targetPageVal !== 'none') {
            pagesParam = targetPageVal;
        }

        const formData = new FormData();
        formData.append('file', currentPdfBlob, activePdfFile ? activePdfFile.name : 'document.pdf');
        formData.append('lang', lang);
        formData.append('pages', pagesParam);

        // Natural Adaptive Progress Easing Engine with Dynamic Status Updates
        let currentProgress = 0;
        ocrProgressBar.style.width = '0%';
        ocrProgressPercent.textContent = '0%';
        ocrStatusText.textContent = `កំពុងចាប់ផ្តើមស្កែន និងវិភាគទំព័រ PDF...`;

        const totalPagesToScan = pagesParam === 'all' ? (activePdfFile?.pages?.length || 1) : pagesParam.split(',').length;
        const estimatedSeconds = Math.max(3, totalPagesToScan * 2);

        const startTime = Date.now();
        const progressInterval = setInterval(() => {
            const elapsedSec = (Date.now() - startTime) / 1000;
            // Smooth logarithmic progress curve based on real estimated workload
            const targetPct = Math.min(95, Math.floor(95 * (1 - Math.exp(-elapsedSec / (estimatedSeconds * 0.55)))));
            
            if (currentProgress < targetPct) {
                currentProgress = targetPct;
                ocrProgressBar.style.width = `${currentProgress}%`;
                ocrProgressPercent.textContent = `${currentProgress}%`;

                // Meaningful real-time stage updates
                if (currentProgress < 25) {
                    ocrStatusText.textContent = `កំពុងបំប្លែងទំព័រ PDF ទៅជារូបភាព Vision Map... (${currentProgress}%)`;
                } else if (currentProgress < 55) {
                    ocrStatusText.textContent = `Gemini Vision AI កំពុងស្កែន និងវិភាគ Speech Bubbles... (${currentProgress}%)`;
                } else if (currentProgress < 80) {
                    ocrStatusText.textContent = `កំពុងបកប្រែពាក្យពេចន៍ និងសម្រួលឃ្លាជាភាសាខ្មែរ... (${currentProgress}%)`;
                } else {
                    ocrStatusText.textContent = `កំពុងផ្ទៀងផ្ទាត់ និងចងក្រងតារាងអត្ថបទ... (${currentProgress}%)`;
                }
            } else if (currentProgress < 97) {
                // Micro-crawl to keep visual movement active without stalling
                currentProgress = Math.min(97, currentProgress + 0.1);
                ocrProgressBar.style.width = `${currentProgress.toFixed(1)}%`;
                ocrProgressPercent.textContent = `${Math.floor(currentProgress)}%`;
            }
        }, 120);

        const headers = {};
        if (localKey) headers['x-gemini-api-key'] = localKey;

        fetch('/api/scan-ocr-pdf', {
            method: 'POST',
            headers: headers,
            body: formData
        })
        .then(async res => {
            const text = await res.text();
            let data;
            try {
                data = JSON.parse(text);
            } catch (jsonErr) {
                throw new Error(`Server returned error (${res.status}): ${text.slice(0, 120)}`);
            }
            if (!res.ok) {
                throw new Error(data.message || `Server error scanning PDF (${res.status})`);
            }
            return data;
        })
        .then(data => {
            clearInterval(progressInterval);
            if (data.status === 'success' && data.results) {
                // Clear previous delete timers to prevent memory leaks
                ocrResults.forEach(r => { if (r.deleteTimer) clearInterval(r.deleteTimer); });

                let filteredResults = data.results;

                if (pagesParam === 'all') {
                    ocrResults = filteredResults;
                } else {
                    // Parse list of scanned pages
                    const scannedPages = pagesParam.split(',').map(num => parseInt(num.trim()));
                    // Filter out old records for these pages
                    ocrResults = ocrResults.filter(r => !scannedPages.includes(r.pageNum));
                    // Append new ones
                    ocrResults.push(...filteredResults);
                }

                // Sort and renumber phrase IDs
                renumberPhraseIds();
                saveOcrResults();
                renderOcrTable();
                updateOcrPageSelectOptions();

                ocrProgressBar.style.width = '100%';
                ocrProgressPercent.textContent = '100%';
                ocrStatusText.textContent = 'ស្កែនអត្ថបទបានជោគជ័យ!';

                logActivityEntry({
                    type: 'ocr',
                    title: `ស្កែនអត្ថបទ OCR៖ ${activePdfFile ? activePdfFile.name : 'PDF Document'}`,
                    subtitle: `បានស្រង់ & បកប្រែ ${ocrResults.length} ឃ្លាសន្ទនា`,
                    details: `Gemini Vision AI Engine`
                });

                setTimeout(() => {
                    ocrProgressContainer.classList.add('hidden');
                    btnScan.disabled = false;
                }, 1000);
            } else {
                throw new Error(data.message || 'Unknown scanning error');
            }
        })
        .catch(err => {
            clearInterval(progressInterval);
            ocrProgressContainer.classList.add('hidden');
            btnScan.disabled = false;
            console.error(err);
            alert('មានបញ្ហាក្នុងការស្កែនអត្ថបទ៖\n' + err.message);
        });
    });

    function renumberPhraseIds() {
        // Group ocrResults by pageNum
        const pagesMap = {};
        ocrResults.forEach(r => {
            if (!pagesMap[r.pageNum]) {
                pagesMap[r.pageNum] = [];
            }
            pagesMap[r.pageNum].push(r);
        });

        // Reassign lineNum and id based on current array order (preserves spliced inserts)
        ocrResults = [];
        Object.keys(pagesMap).forEach(pageNum => {
            const pageNumInt = parseInt(pageNum);
            const items = pagesMap[pageNum];
            // Do not sort by lineNum so that spliced/inserted items maintain their new array positions!
            items.forEach((item, idx) => {
                item.lineNum = idx + 1;
                item.id = `L${pageNumInt}-${idx + 1}`;
                ensureItemBox2D(item, idx);
                ocrResults.push(item);
            });
        });

        // Finally, sort ocrResults globally by pageNum (keeping pages in order)
        ocrResults.sort((a, b) => a.pageNum - b.pageNum);
    }

    function updateMergeButtonState() {
        const checkedBoxes = ocrTableBody.querySelectorAll('.ocr-row-checkbox:checked');
        btnMergeSelected.disabled = (checkedBoxes.length < 2);
        
        // Enable Add Above and Add Below only when exactly 1 checkbox is checked
        const singleSelected = (checkedBoxes.length === 1);
        btnAddAbove.disabled = !singleSelected;
        btnAddBelow.disabled = !singleSelected;
        
        const allBoxes = ocrTableBody.querySelectorAll('.ocr-row-checkbox');
        if (allBoxes.length > 0 && checkedBoxes.length === allBoxes.length) {
            ocrSelectAll.checked = true;
        } else {
            ocrSelectAll.checked = false;
        }
    }



    function adjustGridColumns() {
        currentGridCols = '36px 36px 75px 130px minmax(260px, 1fr) minmax(260px, 1fr)';

        const headerGrid = document.querySelector('#ocr-table-container .grid.sticky');
        if (headerGrid) {
            headerGrid.style.gridTemplateColumns = currentGridCols;
        }
        
        ocrTableContainer.style.setProperty('--ocr-grid-cols', currentGridCols);
    }

    function renderOcrTable() {
        if (ocrResults.length === 0) {
            ocrTableContainer.classList.add('hidden');
            ocrTableContainer.classList.remove('ocr-fullscreen');
            document.body.style.overflow = '';
            ocrEmptyTableState.classList.remove('hidden');
            btnMergeSelected.disabled = true;
            btnCopyText.disabled = true;
            btnSaveTxt.disabled = true;
            btnAiReview.disabled = true;
            if (ocrSelectAll) ocrSelectAll.checked = false;
            if (btnToggleFullscreen) {
                btnToggleFullscreen.classList.add('hidden');
                btnToggleFullscreen.innerHTML = `<i data-lucide="maximize" class="w-3.5 h-3.5"></i> ពេញអេក្រង់ (Fullscreen)`;
            }
            return;
        }

        adjustGridColumns();

        btnCopyText.disabled = false;
        btnSaveTxt.disabled = false;
        btnAiReview.disabled = !currentPdfBlob;

        ocrTableContainer.classList.remove('hidden');
        ocrEmptyTableState.classList.add('hidden');
        if (btnToggleFullscreen) btnToggleFullscreen.classList.remove('hidden');
        ocrTableBody.innerHTML = '';

        ocrResults.forEach((res, resIdx) => {
            ensureItemBox2D(res, resIdx);
            const rowEl = document.createElement('div');

            // Render a beautiful warning/undo banner if the row is in pending delete state
            if (res.isPendingDelete) {
                rowEl.className = 'px-4 py-2.5 flex items-center justify-between min-h-[50px] bg-rose-50/20 dark:bg-rose-950/10 text-rose-700 dark:text-rose-400 font-semibold text-xs border-b border-slate-200 dark:border-slate-800/80 transition duration-150 w-full';
                rowEl.innerHTML = `
                    <div class="flex items-center gap-2">
                        <i data-lucide="trash-2" class="w-4 h-4 text-rose-500 animate-pulse"></i>
                        <span>ឃ្លា ${res.id} ត្រូវបានលុបជាបណ្តោះអាសន្ន</span>
                    </div>
                    <button class="ocr-btn-undo px-3 py-1.5 bg-rose-100 hover:bg-rose-200 dark:bg-rose-950 dark:hover:bg-rose-900 text-rose-700 dark:text-rose-300 rounded-xl font-bold transition flex items-center gap-1 active:scale-95 text-xs">
                        <i data-lucide="rotate-ccw" class="w-3.5 h-3.5"></i> Undo (${res.countdown}s)
                    </button>
                `;

                rowEl.querySelector('.ocr-btn-undo').addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (res.deleteTimer) {
                        clearInterval(res.deleteTimer);
                        res.deleteTimer = null;
                    }
                    res.isPendingDelete = false;
                    res.countdown = 0;
                    renderOcrTable();
                    updateMergeButtonState();
                });

                ocrTableBody.appendChild(rowEl);
                return;
            }

            // Normal Row Layout (Delete on the left, Checkbox next, etc.)
            rowEl.className = 'grid justify-start gap-4 px-4 py-2 bg-white dark:bg-slate-950/40 hover:bg-slate-50 dark:hover:bg-slate-900/20 transition duration-150 border-b border-slate-200 dark:border-slate-800/80 w-full items-start';
            rowEl.style.gridTemplateColumns = currentGridCols;

            const estTextRows = Math.max(1, Math.ceil((res.lineText || '').length / 45));
            const estTransRows = Math.max(1, Math.ceil((res.transText || '').length / 45));

            const coordStr = res.box_2d && Array.isArray(res.box_2d) && res.box_2d.length === 4
                ? `[${res.box_2d.join(', ')}]`
                : `[0, 0, 0, 0]`;

            rowEl.innerHTML = `
                <div class="flex justify-center border-r border-slate-100 dark:border-slate-800/80 pr-2 pt-2 items-center">
                    <button class="ocr-btn-delete p-1.5 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/20 text-slate-400 hover:text-rose-500 transition" title="លុបឃ្លានេះ">
                        <i data-lucide="trash" class="w-3.5 h-3.5"></i>
                    </button>
                </div>
                <div class="flex items-center justify-center border-r border-slate-100 dark:border-slate-800/80 pr-2 pt-2">
                    <input type="checkbox" class="ocr-row-checkbox w-3.5 h-3.5 text-brand-600 border-slate-300 rounded focus:ring-brand-500 cursor-pointer" data-id="${res.id}">
                </div>
                <div class="border-r border-slate-100 dark:border-slate-800/80 pr-2 pt-1 flex flex-col justify-center">
                    <span class="font-mono text-[10px] text-slate-700 dark:text-slate-300 font-bold">${res.id}</span>
                    <span class="text-[9px] text-blue-600 dark:text-blue-400 font-semibold">ទំព័រ ${res.pageNum}</span>
                </div>
                <div class="border-r border-slate-100 dark:border-slate-800/80 pr-2 pt-2 flex items-center overflow-hidden">
                    <span class="px-1.5 py-0.5 bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/70 text-indigo-600 dark:text-indigo-400 rounded-md font-mono text-[10px] font-bold tracking-tight select-all truncate" title="កូអរដោណេពិតប្រាកដ [ymin, xmin, ymax, xmax] (0-1000 scale)">${coordStr}</span>
                </div>
                <div class="border-r border-slate-100 dark:border-slate-800/80 pr-4 flex items-start w-full">
                    <textarea class="ocr-text-input w-full min-h-[30px] bg-slate-50/50 dark:bg-slate-900/40 border border-slate-200/60 dark:border-slate-800/80 focus:border-brand-500 focus:bg-white dark:focus:bg-slate-900 rounded-lg px-2.5 py-1.5 text-xs leading-normal text-slate-800 dark:text-slate-100 font-medium transition focus:outline-none resize-none overflow-hidden" rows="${estTextRows}" placeholder="Original text...">${res.lineText || ''}</textarea>
                </div>
                <div class="flex items-start w-full">
                    <textarea class="ocr-trans-input w-full min-h-[30px] bg-slate-50/50 dark:bg-slate-900/40 border border-slate-200/60 dark:border-slate-800/80 focus:border-brand-500 focus:bg-white dark:focus:bg-slate-900 rounded-lg px-2.5 py-1.5 text-xs leading-normal text-slate-800 dark:text-slate-100 font-medium placeholder-slate-400 dark:placeholder-slate-600 transition focus:outline-none resize-none overflow-hidden" rows="${estTransRows}" placeholder="បញ្ចូលការបកប្រែ/កែសម្រួល...">${res.transText || ''}</textarea>
                </div>
            `;

            const textInput = rowEl.querySelector('.ocr-text-input');
            const transInput = rowEl.querySelector('.ocr-trans-input');

            const autoFitTextarea = (el) => {
                if (!el) return;
                el.style.height = 'auto';
                el.style.height = Math.max(30, el.scrollHeight + 4) + 'px';
            };

            autoFitTextarea(textInput);
            autoFitTextarea(transInput);

            textInput.addEventListener('input', (e) => {
                res.lineText = e.target.value;
                autoFitTextarea(e.target);
                saveOcrResults();
            });
            transInput.addEventListener('input', (e) => {
                res.transText = e.target.value;
                autoFitTextarea(e.target);
                saveOcrResults();
            });

            // Delete specific row trigger (Instant deletion)
            rowEl.querySelector('.ocr-btn-delete').addEventListener('click', (e) => {
                e.stopPropagation();
                
                if (res.deleteTimer) {
                    clearInterval(res.deleteTimer);
                    res.deleteTimer = null;
                }

                ocrResults = ocrResults.filter(r => r.id !== res.id);
                rowEl.remove();
                renumberPhraseIds();
                saveOcrResults();
                updateMergeButtonState();
            });

            // Checkbox change listener
            rowEl.querySelector('.ocr-row-checkbox').addEventListener('change', () => {
                updateMergeButtonState();
            });

            ocrTableBody.appendChild(rowEl);
        });

        // Global ResizeObserver pass on all table textareas to fit height dynamically
        if (window.ocrResizeObserver) {
            window.ocrResizeObserver.disconnect();
        }
        window.ocrResizeObserver = new ResizeObserver((entries) => {
            entries.forEach(entry => {
                const ta = entry.target;
                if (ta) {
                    ta.style.height = 'auto';
                    ta.style.height = (ta.scrollHeight + 4) + 'px';
                }
            });
        });

        ocrTableBody.querySelectorAll('textarea').forEach(ta => {
            window.ocrResizeObserver.observe(ta);
        });

        saveOcrResults();
        if (btnAiReview) {
            btnAiReview.disabled = (ocrResults.length === 0);
        }
        if (btnApplyKhmerPdf) {
            btnApplyKhmerPdf.disabled = (!currentPdfBlob || ocrResults.length === 0);
        }
        lucide.createIcons();
    }

    // Merge Selected Event Listener
    btnMergeSelected.addEventListener('click', () => {
        const checkedBoxes = ocrTableBody.querySelectorAll('.ocr-row-checkbox:checked');
        if (checkedBoxes.length < 2) return;

        const idsToMerge = Array.from(checkedBoxes).map(cb => cb.getAttribute('data-id'));
        
        // Find corresponding items in ocrResults
        const itemsToMerge = ocrResults.filter(r => idsToMerge.includes(r.id));
        
        if (itemsToMerge.length === 0) return;

        // Sort items by pageNum and lineNum to keep logical order
        itemsToMerge.sort((a, b) => {
            if (a.pageNum !== b.pageNum) return a.pageNum - b.pageNum;
            return a.lineNum - b.lineNum;
        });

        // The first item will be the merge target
        const targetItem = itemsToMerge[0];
        
        // Combine text values
        let mergedText = targetItem.lineText;
        let mergedTrans = targetItem.transText;
        
        for (let i = 1; i < itemsToMerge.length; i++) {
            const item = itemsToMerge[i];
            
            // Check for hyphen at the end of mergedText before joining
            if (mergedText.endsWith('-') || mergedText.endsWith('—')) {
                mergedText = mergedText.slice(0, -1) + item.lineText;
            } else {
                mergedText += ' ' + item.lineText;
            }
            
            if (item.transText) {
                if (mergedTrans) {
                    mergedTrans += ' ' + item.transText;
                } else {
                    mergedTrans = item.transText;
                }
            }
        }
        
        // Update the target item
        targetItem.lineText = mergedText;
        targetItem.transText = mergedTrans;

        // Delete all other items from ocrResults
        const idsToRemove = idsToMerge.filter(id => id !== targetItem.id);
        ocrResults = ocrResults.filter(r => !idsToRemove.includes(r.id));

        // Re-index remaining phrase IDs
        renumberPhraseIds();

        // Render table
        renderOcrTable();
        
        // Reset checkboxes and button state
        const ocrSelectAllRef = document.getElementById('ocr-select-all');
        if (ocrSelectAllRef) ocrSelectAllRef.checked = false;
        updateMergeButtonState();

        alert('✨ បានបញ្ចូលគ្នានូវឃ្លាដែលជ្រើសរើសដោយជោគជ័យ!');
    });

    // Setup Select All Checkbox Handler (bound once globally at startup)
    if (ocrSelectAll) {
        ocrSelectAll.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            const checkboxes = ocrTableBody.querySelectorAll('.ocr-row-checkbox');
            checkboxes.forEach(cb => {
                cb.checked = isChecked;
            });
            updateMergeButtonState();
        });
    }

    // Setup Delete All Header Button Handler (bound once globally at startup)
    if (btnDeleteAll) {
        btnDeleteAll.addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm('តើអ្នកពិតជាចង់លុបឃ្លាទាំងអស់មែនទេ? (Are you sure you want to delete all phrases?)')) {
                // Clear any running delete timers to prevent memory leak crashes
                ocrResults.forEach(r => { if (r.deleteTimer) clearInterval(r.deleteTimer); });
                ocrResults = [];
                renderOcrTable();
                updateMergeButtonState();
            }
        });
    }

    // Setup Fullscreen Toggle Button Handler (bound once globally at startup)
    if (btnToggleFullscreen) {
        btnToggleFullscreen.addEventListener('click', () => {
            const isFullscreen = ocrTableContainer.classList.toggle('ocr-fullscreen');
            
            if (isFullscreen) {
                // Change icon to minimize and update text
                btnToggleFullscreen.innerHTML = `<i data-lucide="minimize" class="w-3.5 h-3.5"></i> ចាកចេញពីពេញអេក្រង់ (Exit Fullscreen)`;
                // Enable body overflow hiding to prevent double scrollbars
                document.body.style.overflow = 'hidden';
            } else {
                // Change icon to maximize and update text
                btnToggleFullscreen.innerHTML = `<i data-lucide="maximize" class="w-3.5 h-3.5"></i> ពេញអេក្រង់ (Fullscreen)`;
                // Restore body overflow
                document.body.style.overflow = '';
            }
            
            lucide.createIcons();
        });
    }

    // Copy to clipboard (Export all lines)
    btnCopyText.addEventListener('click', () => {
        if (ocrResults.length === 0) return;
        
        const textLines = ocrResults.map(r => {
            const trans = r.transText ? ` -> [TRANS: ${r.transText}]` : "";
            return `[ID: ${r.id} | Page: ${r.pageNum} | Line: ${r.lineNum}] TEXT: ${r.lineText}${trans}`;
        }).join('\n');

        navigator.clipboard.writeText(textLines)
            .then(() => {
                alert('📋 បានចម្លងទិន្នន័យអត្ថបទទាំងអស់ទៅកាន់ Clipboard រួចរាល់!');
            })
            .catch(err => {
                alert('មានបញ្ហាក្នុងការចម្លងអត្ថបទ៖ ' + err);
            });
    });

    // Save transcript as .txt file (Export all lines)
    btnSaveTxt.addEventListener('click', () => {
        if (ocrResults.length === 0) return;

        const textLines = ocrResults.map(r => {
            const trans = r.transText ? ` -> [TRANS: ${r.transText}]` : "";
            return `[ID: ${r.id} | Page: ${r.pageNum} | Line: ${r.lineNum}] TEXT: ${r.lineText}${trans}`;
        }).join('\n');

        const blob = new Blob([textLines], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        
        const filename = (pdfFilename.value || 'transcript').trim() + '_transcript.txt';
        
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    });

    // Review and correct transcript using Gemini AI
    btnAiReview.addEventListener('click', () => {
        if (!currentPdfBlob) return;

        const currentPageItems = ocrResults.filter(r => r.pageNum === currentPage);
        if (currentPageItems.length === 0) {
            alert('គ្មានអត្ថបទស្កែនបាននៅលើទំព័របច្ចុប្បន្ន ដើម្បីផ្ទៀងផ្ទាត់ឡើយ។');
            return;
        }

        const proceed = confirm("តើអ្នកពិតជាចង់ផ្ទៀងផ្ទាត់ និងកែសម្រួលអត្ថបទនៅលើទំព័រនេះជាមួយ Gemini AI មែនទេ?\n(Do you want to review and correct the text on this page with Gemini AI?)");
        if (!proceed) return;

        const localKey = getGeminiApiKey();
        if (!localKey && !serverHasKey) {
            openApiKeyModal();
            alert('សូមបញ្ចូល Google Gemini API Key ជាមុនសិន ដើម្បីប្រើ AI Review។ (Please enter your Gemini API Key)');
            return;
        }

        // Show progress container
        ocrProgressContainer.classList.remove('hidden');
        ocrProgressBar.style.width = '20%';
        ocrProgressPercent.textContent = '20%';
        ocrStatusText.textContent = 'កំពុងផ្ញើទិន្នន័យទៅកាន់ Gemini AI...';
        btnAiReview.disabled = true;

        const formData = new FormData();
        formData.append('file', currentPdfBlob, activePdfFile ? activePdfFile.name : 'document.pdf');
        formData.append('pageNum', currentPage);
        formData.append('ocr_items', JSON.stringify(currentPageItems));

        // Set progress to 60% mid-way
        ocrProgressBar.style.width = '60%';
        ocrProgressPercent.textContent = '60%';
        ocrStatusText.textContent = 'Gemini AI កំពុងវិភាគរូបភាព និងកែតម្រូវអត្ថបទ...';

        const headers = {};
        if (localKey) headers['x-gemini-api-key'] = localKey;

        fetch('/api/ai-review', {
            method: 'POST',
            headers: headers,
            body: formData
        })
        .then(res => {
            if (!res.ok) {
                return res.json().then(err => {
                    throw new Error(err.message || 'Server error calling AI Review');
                });
            }
            return res.json();
        })
        .then(data => {
            if (data.status === 'success' && data.results) {
                let pageItems = ocrResults.filter(r => r.pageNum === currentPage);
                
                let updateCount = 0;
                let deleteCount = 0;
                let mergeCount = 0;
                let addCount = 0;
                
                const lang = ocrLangSelect ? ocrLangSelect.value : 'auto';
                
                data.results.forEach(op => {
                    const target = pageItems.find(r => r.id === op.id);
                    if (target) {
                        let isChanged = false;
                        if (op.text && op.text.trim() && target.lineText !== op.text.trim()) {
                            target.lineText = op.text.trim();
                            isChanged = true;
                        }
                        if (op.khmer_translation && op.khmer_translation.trim() && target.transText !== op.khmer_translation.trim()) {
                            target.transText = op.khmer_translation.trim();
                            isChanged = true;
                        }
                        if (isChanged) updateCount++;
                    }
                });

                // Clear any running delete timers
                ocrResults.forEach(r => { if (r.deleteTimer) clearInterval(r.deleteTimer); });

                renumberPhraseIds();
                saveOcrResults();
                renderOcrTable();
                updateOcrPageSelectOptions();

                ocrProgressBar.style.width = '100%';
                ocrProgressPercent.textContent = '100%';
                ocrStatusText.textContent = 'ផ្ទៀងផ្ទាត់ជោគជ័យ!';

                setTimeout(() => {
                    ocrProgressContainer.classList.add('hidden');
                    btnAiReview.disabled = false;

                    let summaryParts = [];
                    if (updateCount > 0) summaryParts.push(`កែកំហុស ${updateCount}`);
                    if (deleteCount > 0) summaryParts.push(`លុបជួររំខាន ${deleteCount}`);
                    if (mergeCount > 0) summaryParts.push(`បញ្ចូលគ្នា ${mergeCount}`);
                    if (addCount > 0) summaryParts.push(`បន្ថែមជួរថ្មី ${addCount}`);

                    const summaryStr = summaryParts.length > 0 
                        ? summaryParts.join('、 ') 
                        : "ពុំមានការផ្លាស់ប្តូរឡើយ";

                    alert(`✨ Gemini AI បានផ្ទៀងផ្ទាត់រួចរាល់៖\n(${summaryStr})`);
                }, 600);
            } else {
                throw new Error(data.message || 'No results returned from Gemini');
            }
        })
        .catch(err => {
            ocrProgressContainer.classList.add('hidden');
            btnAiReview.disabled = false;
            console.error(err);
            alert('មានបញ្ហាក្នុងការផ្ទៀងផ្ទាត់ជាមួយ AI៖\n' + err.message);
        });
    });

    // Handle Apply Khmer to Word (.docx) Button click
    if (btnApplyKhmerPdf) {
        btnApplyKhmerPdf.addEventListener('click', async () => {
            if (!currentPdfBlob && !activePdfFile && (!images || images.length === 0)) {
                alert('⚠️ សូមជ្រើសរើសឯកសារ Manga មួយជាមុនសិន!');
                return;
            }
            if (!ocrResults || ocrResults.length === 0) {
                alert('⚠️ មិនទាន់មានអត្ថបទបកប្រែនៅក្នុងតារាងនៅឡើយទេ។ សូមចុច "Start Scan Text & Translate" ជាមុនសិន!');
                return;
            }

            // Show progress
            ocrProgressContainer.classList.remove('hidden');
            ocrProgressBar.style.width = '20%';
            ocrProgressPercent.textContent = '20%';
            ocrStatusText.textContent = 'កំពុងចងក្រងរូបភាព និងអត្ថបទខ្មែរចូលក្នុងឯកសារ Word (.docx)...';
            btnApplyKhmerPdf.disabled = true;
            if (btnScan) btnScan.disabled = true;

            const formData = new FormData();
            if (images && images.length > 0) {
                images.forEach((img, idx) => {
                    formData.append('images', img.file, img.file.name || `page_${idx + 1}.png`);
                });
            } else if (currentPdfBlob) {
                formData.append('images', currentPdfBlob, activePdfFile ? activePdfFile.name : 'document.pdf');
            }
            formData.append('ocr_items', JSON.stringify(ocrResults));
            const baseName = (activePdfFile && activePdfFile.name) ? activePdfFile.name.replace(/\.[^/.]+$/, '') : 'manga_khmer';
            formData.append('title', `${baseName} - Khmer Translated`);

            // Smooth progress animation
            let currentP = 20;
            const timer = setInterval(() => {
                if (currentP < 90) {
                    currentP += 8;
                    ocrProgressBar.style.width = `${currentP}%`;
                    ocrProgressPercent.textContent = `${currentP}%`;
                    if (currentP > 40 && currentP < 70) {
                        ocrStatusText.textContent = 'កំពុងកំណត់រចនាប័ទ្មពុម្ពអក្សរខ្មែរ (Khmer Font & Tables)...';
                    } else if (currentP >= 70) {
                        ocrStatusText.textContent = 'កំពុងបញ្ចប់ឯកសារ Microsoft Word (.docx)...';
                    }
                }
            }, 100);

            try {
                const res = await fetch('/api/generate-docx', {
                    method: 'POST',
                    body: formData
                });

                clearInterval(timer);

                if (!res.ok) {
                    let errMsg = `Server error (${res.status})`;
                    try {
                        const errData = await res.json();
                        if (errData && errData.message) errMsg = errData.message;
                    } catch (e) {}
                    throw new Error(errMsg);
                }

                const docxBlob = await res.blob();
                const docxFileName = `${baseName}_Khmer_Translated.docx`;
                const url = URL.createObjectURL(docxBlob);
                const a = document.createElement('a');
                a.href = url;
                a.download = docxFileName;
                document.body.appendChild(a);
                a.click();
                URL.revokeObjectURL(url);
                document.body.removeChild(a);

                ocrProgressBar.style.width = '100%';
                ocrProgressPercent.textContent = '100%';
                ocrStatusText.textContent = '✨ បានបង្កើត និងទាញយកឯកសារ Word (.docx) ភាសាខ្មែរជោគជ័យ!';

                logActivityEntry({
                    type: 'doc',
                    title: `បញ្ចូលអក្សរខ្មែរ៖ ${docxFileName}`,
                    subtitle: `បានបង្កប់ ${ocrResults.length} ឃ្លាជាភាសាខ្មែរ (Word Document)`,
                    details: `Microsoft Word (.docx)`
                });

                setTimeout(() => {
                    ocrProgressContainer.classList.add('hidden');
                    btnApplyKhmerPdf.disabled = false;
                    if (btnScan) btnScan.disabled = false;
                    alert(`🎉 បានបង្កើតឯកសារ Word (.docx) ភាសាខ្មែរដោយជោគជ័យ!\n\n📄 ឈ្មោះ File៖ ${docxFileName}\n\nអ្នកអាចបើកកែសម្រួលអត្ថបទ និងរូបភាពលើ Microsoft Word ឬ WPS Office បានភ្លាមៗ។`);
                }, 600);

            } catch (err) {
                clearInterval(timer);
                ocrProgressContainer.classList.add('hidden');
                btnApplyKhmerPdf.disabled = false;
                if (btnScan) btnScan.disabled = false;
                console.error(err);
                alert('កំហុសក្នុងការបង្កើតឯកសារ Word ភាសាខ្មែរ៖\n' + err.message);
            }
        });
    }

    // Download button handler (Handles downloading active PDF)
    if (btnDownload) {
        btnDownload.addEventListener('click', () => {
            if (!currentPdfBlob && !activePdfFile) {
                alert('គ្មានឯកសារ PDF សម្រាប់ទាញយកឡើយ');
                return;
            }
            const blobToDownload = (activePdfFile && activePdfFile.blob) ? activePdfFile.blob : currentPdfBlob;
            const name = (activePdfFile && activePdfFile.name) ? activePdfFile.name : 'document.pdf';
            downloadPdfFile(blobToDownload, name);
        });
    }

    // Download Word (.docx) button handler
    if (btnDownloadDocx) {
        btnDownloadDocx.addEventListener('click', async () => {
            if (!currentPdfBlob && !activePdfFile && (!images || images.length === 0)) {
                alert('គ្មានឯកសារសម្រាប់ទាញយកជា Word ឡើយ');
                return;
            }

            const origHtml = btnDownloadDocx.innerHTML;
            btnDownloadDocx.innerHTML = `<i data-lucide="loader" class="w-3.5 h-3.5 animate-spin"></i> កំពុងបង្កើត Word...`;
            btnDownloadDocx.disabled = true;

            try {
                const formData = new FormData();
                if (images && images.length > 0) {
                    images.forEach((img, idx) => {
                        formData.append('images', img.file, img.file.name || `page_${idx + 1}.png`);
                    });
                } else if (currentPdfBlob) {
                    formData.append('images', currentPdfBlob, activePdfFile ? activePdfFile.name : 'document.pdf');
                }
                formData.append('ocr_items', JSON.stringify(ocrResults || []));
                const baseName = (activePdfFile && activePdfFile.name) ? activePdfFile.name.replace(/\.[^/.]+$/, '') : 'document';
                formData.append('title', baseName);

                const res = await fetch('/api/generate-docx', {
                    method: 'POST',
                    body: formData
                });

                if (!res.ok) {
                    throw new Error(`Server returned status ${res.status}`);
                }

                const docxBlob = await res.blob();
                const url = URL.createObjectURL(docxBlob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${baseName}.docx`;
                document.body.appendChild(a);
                a.click();
                URL.revokeObjectURL(url);
                document.body.removeChild(a);

                logActivityEntry({
                    type: 'doc',
                    title: `ទាញយកជា Word៖ ${baseName}.docx`,
                    subtitle: `ឯកសារ Microsoft Word (.docx)`,
                    details: `ទំហំសមាមាត្ររូបភាព 1:1`
                });
            } catch (err) {
                console.error('Error downloading Word document:', err);
                alert('មានបញ្ហាក្នុងការទាញយកជា Word៖\n' + err.message);
            } finally {
                btnDownloadDocx.innerHTML = origHtml;
                btnDownloadDocx.disabled = false;
                lucide.createIcons();
            }
        });
    }

    // Trigger hidden file input click on Import TXT click
    btnImportTxt.addEventListener('click', () => {
        importTxtInput.click();
    });

    // Handle Import TXT file selection
    importTxtInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const fileContent = event.target.result || "";
                const lines = fileContent.split(/\r?\n/);
                const importedResults = [];
                
                lines.forEach((line, index) => {
                    const trimmedLine = line.trim();
                    if (!trimmedLine) return;

                    // Parse header part: [ID: L1-1 | Page: 1 | Line: 1] TEXT: ...
                    const headerMatch = trimmedLine.match(/^\[ID:\s*([^\s\|]+)\s*\|\s*Page:\s*(\d+)\s*\|\s*Line:\s*(\d+)\]\s*TEXT:\s*(.*)$/);
                    if (!headerMatch) {
                        console.warn(`Skipping unparsable line ${index + 1}: ${trimmedLine}`);
                        return;
                    }

                    const id = headerMatch[1];
                    const pageNum = parseInt(headerMatch[2]);
                    const lineNum = parseInt(headerMatch[3]);
                    const remaining = headerMatch[4];

                    let lineText = remaining;
                    let transText = "";

                    // Check if it contains translation block: " -> [TRANS: ...]" at the end
                    const transIndex = remaining.lastIndexOf(' -> [TRANS: ');
                    if (transIndex !== -1 && remaining.endsWith(']')) {
                        lineText = remaining.substring(0, transIndex);
                        transText = remaining.substring(transIndex + ' -> [TRANS: '.length, remaining.length - 1);
                    }

                    importedResults.push({
                        id: id,
                        pageNum: pageNum,
                        lineNum: lineNum,
                        lineText: lineText.trim(),
                        transText: transText.trim(),
                        isPendingDelete: false,
                        countdown: 0
                    });
                });

                if (importedResults.length === 0) {
                    throw new Error('ពុំមានជួរទិន្នន័យត្រឹមត្រូវត្រូវបានរកឃើញឡើយ (No valid transcript lines found)');
                }

                // Clear all running delete timers to prevent memory leaks
                ocrResults.forEach(r => { if (r.deleteTimer) clearInterval(r.deleteTimer); });

                ocrResults = importedResults;

                // Sort ocrResults globally by pageNum and lineNum just in case
                ocrResults.sort((a, b) => {
                    if (a.pageNum !== b.pageNum) return a.pageNum - b.pageNum;
                    return a.lineNum - b.lineNum;
                });

                // Render updated table
                renderOcrTable();

                alert(`✨ ផ្ទុកទិន្នន័យពីឯកសារ TXT បានជោគជ័យ! (Loaded ${ocrResults.length} phrases successfully!)`);
            } catch (err) {
                alert('កំហុសក្នុងការអានឯកសារ TXT៖ ' + err.message);
            }
            // Reset input so user can import the same file again
            importTxtInput.value = '';
        };
        reader.readAsText(file);
    });

    // Helper to find the checked row item in ocrResults
    function getCheckedRow() {
        const checkedBox = ocrTableBody.querySelector('.ocr-row-checkbox:checked');
        if (!checkedBox) return null;
        const id = checkedBox.getAttribute('data-id');
        return ocrResults.find(r => r.id === id);
    }

    // Add Row Above Selected
    btnAddAbove.addEventListener('click', () => {
        const selected = getCheckedRow();
        if (!selected) return;

        const idx = ocrResults.findIndex(r => r.id === selected.id);
        if (idx === -1) return;

        const newRow = {
            id: `temp-${Date.now()}`,
            lineNum: 0,
            pageNum: selected.pageNum,
            lineText: "",
            transText: "",
            isPendingDelete: false,
            countdown: 0
        };

        ocrResults.splice(idx, 0, newRow);
        renumberPhraseIds();
        renderOcrTable();
        updateMergeButtonState();
    });

    // Add Row Below Selected
    btnAddBelow.addEventListener('click', () => {
        const selected = getCheckedRow();
        if (!selected) return;

        const idx = ocrResults.findIndex(r => r.id === selected.id);
        if (idx === -1) return;

        const newRow = {
            id: `temp-${Date.now()}`,
            lineNum: 0,
            pageNum: selected.pageNum,
            lineText: "",
            transText: "",
            isPendingDelete: false,
            countdown: 0
        };

        ocrResults.splice(idx + 1, 0, newRow);
        renumberPhraseIds();
        renderOcrTable();
        updateMergeButtonState();
    });

    // Initialize application state from IndexedDB/LocalStorage on page load
    initApp();

    // =========================================================================
    // DRAWER NAVIGATION & MULTI-VIEW STATE LOGIC
    // =========================================================================
    const drawerToggle = document.getElementById('drawer-toggle');
    const drawerClose = document.getElementById('drawer-close');
    const drawerOverlay = document.getElementById('drawer-overlay');
    const sidebarDrawer = document.getElementById('sidebar-drawer');
    const navPdfCreator = document.getElementById('nav-pdf-creator');
    const navMangaDownloader = document.getElementById('nav-manga-downloader');
    const navHistory = document.getElementById('nav-history');
    
    const viewPdfCreator = document.getElementById('view-pdf-creator');
    const viewMangaDownloader = document.getElementById('view-manga-downloader');
    const viewHistory = document.getElementById('view-history');

    // Open Drawer
    drawerToggle.addEventListener('click', () => {
        sidebarDrawer.classList.remove('-translate-x-full');
        drawerOverlay.classList.remove('hidden');
        setTimeout(() => {
            drawerOverlay.classList.add('active');
        }, 10);
    });

    // Close Drawer
    function closeDrawer() {
        sidebarDrawer.classList.add('-translate-x-full');
        drawerOverlay.classList.remove('active');
        setTimeout(() => {
            drawerOverlay.classList.add('hidden');
        }, 300);
    }

    drawerClose.addEventListener('click', closeDrawer);
    drawerOverlay.addEventListener('click', closeDrawer);

    // Switch view
    function switchView(viewName) {
        if (viewPdfCreator) viewPdfCreator.classList.add('hidden');
        if (viewMangaDownloader) viewMangaDownloader.classList.add('hidden');
        if (viewHistory) viewHistory.classList.add('hidden');

        [navPdfCreator, navMangaDownloader, navHistory].forEach(n => {
            if (n) {
                n.classList.remove('bg-brand-50', 'dark:bg-brand-950/40', 'text-brand-600', 'dark:text-brand-400');
                n.classList.add('hover:bg-slate-50', 'dark:hover:bg-slate-800', 'text-slate-600', 'dark:text-slate-400');
            }
        });

        if (viewName === 'pdf-creator') {
            if (viewPdfCreator) viewPdfCreator.classList.remove('hidden');
            if (navPdfCreator) {
                navPdfCreator.classList.add('bg-brand-50', 'dark:bg-brand-950/40', 'text-brand-600', 'dark:text-brand-400');
                navPdfCreator.classList.remove('hover:bg-slate-50', 'dark:hover:bg-slate-800', 'text-slate-600', 'dark:text-slate-400');
            }
        } else if (viewName === 'manga-downloader') {
            if (viewMangaDownloader) viewMangaDownloader.classList.remove('hidden');
            if (navMangaDownloader) {
                navMangaDownloader.classList.add('bg-brand-50', 'dark:bg-brand-950/40', 'text-brand-600', 'dark:text-brand-400');
                navMangaDownloader.classList.remove('hover:bg-slate-50', 'dark:hover:bg-slate-800', 'text-slate-600', 'dark:text-slate-400');
            }
        } else if (viewName === 'history') {
            if (viewHistory) viewHistory.classList.remove('hidden');
            if (navHistory) {
                navHistory.classList.add('bg-brand-50', 'dark:bg-brand-950/40', 'text-brand-600', 'dark:text-brand-400');
                navHistory.classList.remove('hover:bg-slate-50', 'dark:hover:bg-slate-800', 'text-slate-600', 'dark:text-slate-400');
            }
            if (typeof renderHistoryPage === 'function') {
                renderHistoryPage();
            }
        }
        closeDrawer();
        lucide.createIcons();
    }

    navPdfCreator.addEventListener('click', () => switchView('pdf-creator'));
    navMangaDownloader.addEventListener('click', () => switchView('manga-downloader'));
    if (navHistory) navHistory.addEventListener('click', () => switchView('history'));

    // =========================================================================
    // MANGA DOWNLOADER CORE LOGIC
    // =========================================================================
    const mangaUrlInput = document.getElementById('manga-url-input');
    const btnMangaFetch = document.getElementById('btn-manga-fetch');
    const mangaEmptyState = document.getElementById('manga-empty-state');
    const mangaContentArea = document.getElementById('manga-content-area');
    
    const mangaCover = document.getElementById('manga-cover');
    const mangaTitle = document.getElementById('manga-title');
    const mangaAuthor = document.getElementById('manga-author');
    const mangaStatus = document.getElementById('manga-status');
    const mangaDesc = document.getElementById('manga-desc');
    const mangaSelectedCount = document.getElementById('manga-selected-count');
    
    const btnMangaSelectAll = document.getElementById('btn-manga-select-all');
    const btnMangaDeselectAll = document.getElementById('btn-manga-deselect-all');
    const mangaRangeStart = document.getElementById('manga-range-start');
    const mangaRangeEnd = document.getElementById('manga-range-end');
    const btnMangaApplyRange = document.getElementById('btn-manga-apply-range');
    const mangaChapterList = document.getElementById('manga-chapter-list');
    
    const mangaChapterSearch = document.getElementById('manga-chapter-search');
    const btnMangaClearSearch = document.getElementById('btn-manga-clear-search');
    const btnMangaSort = document.getElementById('btn-manga-sort');
    const mangaSortLabel = document.getElementById('manga-sort-label');
    
    const mangaDownloadProgressContainer = document.getElementById('manga-download-progress-container');
    const mangaDownloadStatus = document.getElementById('manga-download-status');
    const mangaDownloadPercent = document.getElementById('manga-download-percent');
    const mangaDownloadBar = document.getElementById('manga-download-bar');
    const mangaDownloadDetails = document.getElementById('manga-download-details');
    
    const btnMangaDownloadDocx = document.getElementById('btn-manga-download-docx');
    const btnMangaDownloadZip = document.getElementById('btn-manga-download-zip');
    const btnMangaImportPdf = document.getElementById('btn-manga-import-pdf');

    let currentMangaData = null; 
    let selectedChaptersList = new Set(); 
    let downloadedPagesMap = new Map(); 
    let isMangaSortAscending = true;
    let mangaSearchQuery = '';

    // Filter & Sort Engine for Chapters
    function getFilteredAndSortedChapters() {
        if (!currentMangaData || !currentMangaData.chapters) return [];
        let list = [...currentMangaData.chapters];

        // Filter by search query
        if (mangaSearchQuery.trim()) {
            const q = mangaSearchQuery.toLowerCase().trim();
            list = list.filter(ch => {
                const chNum = (ch.chapter != null ? String(ch.chapter) : '').toLowerCase();
                const volNum = (ch.volume != null ? String(ch.volume) : '').toLowerCase();
                const title = (ch.title || '').toLowerCase();
                return chNum.includes(q) || volNum.includes(q) || title.includes(q) || `ch. ${chNum}`.includes(q) || `chapter ${chNum}`.includes(q);
            });
        }

        // Sort chapters
        list.sort((a, b) => {
            const numA = parseFloat(a.chapter);
            const numB = parseFloat(b.chapter);
            const validA = !isNaN(numA);
            const validB = !isNaN(numB);

            if (validA && validB) {
                return isMangaSortAscending ? (numA - numB) : (numB - numA);
            }
            if (validA) return isMangaSortAscending ? -1 : 1;
            if (validB) return isMangaSortAscending ? 1 : -1;
            return isMangaSortAscending ? (a.id || '').localeCompare(b.id || '') : (b.id || '').localeCompare(a.id || '');
        });

        return list;
    }

    function refreshChaptersDisplay() {
        const chapters = getFilteredAndSortedChapters();
        renderChapterList(chapters);
    }

    // Live Search Event Listeners
    if (mangaChapterSearch) {
        mangaChapterSearch.addEventListener('input', (e) => {
            mangaSearchQuery = e.target.value;
            if (btnMangaClearSearch) {
                btnMangaClearSearch.classList.toggle('hidden', !mangaSearchQuery);
            }
            refreshChaptersDisplay();
        });
    }

    if (btnMangaClearSearch) {
        btnMangaClearSearch.addEventListener('click', () => {
            if (mangaChapterSearch) mangaChapterSearch.value = '';
            mangaSearchQuery = '';
            btnMangaClearSearch.classList.add('hidden');
            refreshChaptersDisplay();
        });
    }

    // Sort Button Event Listener
    if (btnMangaSort) {
        btnMangaSort.addEventListener('click', () => {
            isMangaSortAscending = !isMangaSortAscending;
            if (mangaSortLabel) {
                mangaSortLabel.textContent = isMangaSortAscending ? 'ចាស់ ➔ ថ្មី (1 ➔ 99)' : 'ថ្មី ➔ ចាស់ (99 ➔ 1)';
            }
            refreshChaptersDisplay();
        });
    }

    // Fetch Manga info
    btnMangaFetch.addEventListener('click', () => {
        const urlOrId = mangaUrlInput.value.trim();
        if (!urlOrId) {
            alert('សូមបញ្ចូល Link ឬ ID របស់ Manga!');
            return;
        }

        const originalBtnHTML = btnMangaFetch.innerHTML;
        btnMangaFetch.innerHTML = `<i data-lucide="loader" class="w-4 h-4 animate-spin"></i> Loading...`;
        btnMangaFetch.disabled = true;
        lucide.createIcons();

        const formData = new FormData();
        formData.append('url', urlOrId);

        fetch('/api/manga/fetch', {
            method: 'POST',
            body: formData
        })
        .then(res => {
            if (!res.ok) {
                return res.json().then(err => {
                    throw new Error(err.message || 'Failed to fetch manga metadata');
                });
            }
            return res.json();
        })
        .then(data => {
            if (data.status === 'success' && data.manga) {
                currentMangaData = data.manga;
                selectedChaptersList.clear();
                downloadedPagesMap.clear();
                
                // Reset search & sort state
                mangaSearchQuery = '';
                if (mangaChapterSearch) mangaChapterSearch.value = '';
                if (btnMangaClearSearch) btnMangaClearSearch.classList.add('hidden');
                isMangaSortAscending = true;
                if (mangaSortLabel) mangaSortLabel.textContent = 'ចាស់ ➔ ថ្មី (1 ➔ 99)';
                
                // Update Cover & Details
                mangaCover.src = data.manga.coverUrl || 'https://via.placeholder.com/256x360?text=No+Cover';
                mangaTitle.textContent = data.manga.title;
                mangaAuthor.textContent = data.manga.author || 'Unknown Author';
                mangaStatus.textContent = data.manga.status || 'OnGoing';
                if ((data.manga.status || '').toLowerCase() === 'completed') {
                    mangaStatus.className = "inline-block mt-2 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded-full bg-emerald-100 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900/50";
                } else {
                    mangaStatus.className = "inline-block mt-2 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700";
                }
                mangaDesc.textContent = data.manga.description || 'គ្មានសេចក្តីសង្ខេបឡើយ។';
                
                // Render Chapters with Filter & Sort
                refreshChaptersDisplay();
                
                // Show area, hide empty
                if (mangaEmptyState) mangaEmptyState.classList.add('hidden');
                if (mangaContentArea) mangaContentArea.classList.remove('hidden');
                
                updateSelectedChaptersUI();
                
                // Auto-select requested chapter if user pasted direct chapter URL
                if (data.manga.requestedChapterUrl) {
                    const reqUrl = data.manga.requestedChapterUrl;
                    const chCard = document.querySelector(`.chapter-card[data-id="${reqUrl}"]`);
                    if (chCard) {
                        chCard.click();
                    }
                }
                
                // Reset Progress bar and buttons
                if (mangaDownloadProgressContainer) mangaDownloadProgressContainer.classList.add('hidden');
                if (btnMangaDownloadDocx) btnMangaDownloadDocx.disabled = !selectedChaptersList.size;
                if (btnMangaDownloadZip) btnMangaDownloadZip.disabled = !selectedChaptersList.size;
                if (btnMangaImportPdf) btnMangaImportPdf.disabled = !selectedChaptersList.size;

                logActivityEntry({
                    type: 'manga',
                    title: `ស្វែងរក Manga៖ ${data.manga.title}`,
                    subtitle: `មាន ${data.manga.chapters.length} ភាគ`,
                    details: `អ្នកនិពន្ធ៖ ${data.manga.author || 'Unknown'}`
                });
            } else {
                throw new Error(data.message || 'Manga details not found');
            }
        })
        .catch(err => {
            console.error(err);
            alert('មានបញ្ហាក្នុងការស្វែងរក Manga៖ ' + err.message);
        })
        .finally(() => {
            btnMangaFetch.innerHTML = originalBtnHTML;
            btnMangaFetch.disabled = false;
            lucide.createIcons();
        });
    });

    // Render Chapters Grid
    function renderChapterList(chapters) {
        mangaChapterList.innerHTML = '';
        if (!chapters || chapters.length === 0) {
            if (currentMangaData && currentMangaData.chapters && currentMangaData.chapters.length > 0) {
                mangaChapterList.innerHTML = `<div class="col-span-2 text-center text-xs text-slate-400 py-8 flex flex-col items-center justify-center gap-2">
                    <i data-lucide="search-x" class="w-8 h-8 stroke-1 opacity-50"></i>
                    <span>រកមិនឃើញភាគដែលត្រូវគ្នានឹង "${mangaSearchQuery}" ឡើយ។</span>
                </div>`;
            } else {
                mangaChapterList.innerHTML = `<div class="col-span-2 text-center text-xs text-slate-400 py-6">គ្មានភាគឡើយ។</div>`;
            }
            lucide.createIcons();
            return;
        }

        chapters.forEach(ch => {
            const chCard = document.createElement('div');
            const isSelected = selectedChaptersList.has(ch.id);
            chCard.className = `chapter-card flex items-center justify-between p-3.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl cursor-pointer select-none ${isSelected ? 'selected' : ''}`;
            chCard.dataset.id = ch.id;
            chCard.dataset.chapter = ch.chapter;
            
            const volumeLabel = ch.volume ? `Vol. ${ch.volume} ` : '';
            const chapterLabel = ch.chapter ? `Ch. ${ch.chapter}` : 'Special';
            const titleLabel = ch.title ? ` - ${ch.title}` : '';

            let pagesLabel = '';
            if (downloadedPagesMap.has(ch.id)) {
                const count = downloadedPagesMap.get(ch.id).length;
                pagesLabel = `<span class="text-emerald-500 dark:text-emerald-400 font-bold">✓ ${count} ទំព័រ (រួចរាល់)</span>`;
            } else {
                pagesLabel = ch.pages ? `${ch.pages} ទំព័រ` : 'មិនទាន់ទាញយក';
            }

            chCard.innerHTML = `
                <div class="flex flex-col gap-0.5">
                    <span class="font-bold text-xs text-slate-800 dark:text-slate-200">${volumeLabel}${chapterLabel}${titleLabel}</span>
                    <span class="text-[10px] text-slate-400 font-semibold">${pagesLabel}</span>
                </div>
                <div class="ch-checkbox w-4 h-4 border border-slate-300 dark:border-slate-700 rounded flex items-center justify-center text-white bg-transparent">
                    <i data-lucide="check" class="w-3 h-3 stroke-[3] hidden"></i>
                </div>
            `;

            // Toggle selection
            chCard.addEventListener('click', () => {
                const uuid = ch.id;
                if (selectedChaptersList.has(uuid)) {
                    selectedChaptersList.delete(uuid);
                    chCard.classList.remove('selected');
                } else {
                    selectedChaptersList.add(uuid);
                    chCard.classList.add('selected');
                }
                updateSelectedChaptersUI();
            });

            mangaChapterList.appendChild(chCard);
        });
        lucide.createIcons();
    }

    const mangaVolOptionsBox = document.getElementById('manga-volume-options-box');
    const mangaVolChunkSize = document.getElementById('manga-vol-chunk-size');
    const mangaVolCalcText = document.getElementById('manga-vol-calc-text');
    const mangaPdfModeRadios = document.querySelectorAll('input[name="manga-pdf-mode"]');

    function updateVolumeCalculationBadge() {
        if (!mangaVolCalcText) return;
        const count = selectedChaptersList.size;
        const chunkSize = Math.max(1, parseInt(mangaVolChunkSize?.value) || 10);
        const mode = document.querySelector('input[name="manga-pdf-mode"]:checked')?.value || 'combine';
        
        if (mangaVolOptionsBox) {
            mangaVolOptionsBox.classList.toggle('hidden', mode !== 'combine');
        }
        
        if (mode === 'separate') {
            mangaVolCalcText.textContent = `ជ្រើស ${count} ភាគ ➔ បង្កើតបាន ${count} ឯកសារ PDF (១ ភាគ = ១ PDF)`;
            return;
        }

        if (count === 0) {
            mangaVolCalcText.textContent = `ជ្រើស 0 ភាគ ➔ បង្កើត 0 សៀវភៅ PDF`;
            return;
        }

        const volumes = Math.ceil(count / chunkSize);
        if (volumes === 1) {
            mangaVolCalcText.textContent = `ជ្រើស ${count} ភាគ ➔ បង្កើតបាន ១ សៀវភៅ PDF តែមួយ (Volume)`;
        } else {
            mangaVolCalcText.textContent = `ជ្រើស ${count} ភាគ ➔ បង្កើតបាន ${volumes} សៀវភៅ PDF (១ PDF = ~${chunkSize} ភាគ)`;
        }
    }

    const mangaMasterCheckbox = document.getElementById('manga-master-checkbox');
    const mangaMasterLabel = document.getElementById('manga-master-label');

    mangaPdfModeRadios.forEach(r => r.addEventListener('change', updateVolumeCalculationBadge));
    if (mangaVolChunkSize) {
        mangaVolChunkSize.addEventListener('input', () => {
            if (parseInt(mangaVolChunkSize.value) < 1) mangaVolChunkSize.value = 1;
            updateVolumeCalculationBadge();
        });
    }

    // Update selection count & master checkbox state
    function updateSelectedChaptersUI() {
        const count = selectedChaptersList.size;
        const total = currentMangaData?.chapters?.length || 0;
        mangaSelectedCount.textContent = `${count} Chapters`;
        
        if (count > 0) {
            if (btnMangaDownloadDocx) btnMangaDownloadDocx.disabled = false;
            btnMangaDownloadZip.disabled = false;
            btnMangaImportPdf.disabled = false;
        } else {
            if (btnMangaDownloadDocx) btnMangaDownloadDocx.disabled = true;
            btnMangaDownloadZip.disabled = true;
            btnMangaImportPdf.disabled = true;
        }

        // Sync master checkbox state
        if (mangaMasterCheckbox) {
            if (total > 0 && count === total) {
                mangaMasterCheckbox.checked = true;
                mangaMasterCheckbox.indeterminate = false;
                if (mangaMasterLabel) mangaMasterLabel.textContent = 'លុបការជ្រើស';
            } else if (count > 0) {
                mangaMasterCheckbox.checked = false;
                mangaMasterCheckbox.indeterminate = true;
                if (mangaMasterLabel) mangaMasterLabel.textContent = `បានជ្រើស (${count})`;
            } else {
                mangaMasterCheckbox.checked = false;
                mangaMasterCheckbox.indeterminate = false;
                if (mangaMasterLabel) mangaMasterLabel.textContent = 'ជ្រើសទាំងអស់';
            }
        }

        updateVolumeCalculationBadge();
    }

    // Master Checkbox Toggle
    if (mangaMasterCheckbox) {
        mangaMasterCheckbox.addEventListener('change', () => {
            if (!currentMangaData || !currentMangaData.chapters) return;
            if (mangaMasterCheckbox.checked) {
                // Select all
                currentMangaData.chapters.forEach(ch => selectedChaptersList.add(ch.id));
                document.querySelectorAll('.chapter-card').forEach(card => card.classList.add('selected'));
            } else {
                // Deselect all
                selectedChaptersList.clear();
                document.querySelectorAll('.chapter-card').forEach(card => card.classList.remove('selected'));
            }
            updateSelectedChaptersUI();
        });
    }

    // Select All Button
    btnMangaSelectAll.addEventListener('click', () => {
        if (!currentMangaData || !currentMangaData.chapters) return;
        currentMangaData.chapters.forEach(ch => selectedChaptersList.add(ch.id));
        document.querySelectorAll('.chapter-card').forEach(card => {
            card.classList.add('selected');
        });
        updateSelectedChaptersUI();
    });

    // Deselect All Button
    btnMangaDeselectAll.addEventListener('click', () => {
        selectedChaptersList.clear();
        document.querySelectorAll('.chapter-card').forEach(card => {
            card.classList.remove('selected');
        });
        updateSelectedChaptersUI();
    });

    // Apply Range
    btnMangaApplyRange.addEventListener('click', () => {
        if (!currentMangaData) return;
        const startVal = parseFloat(mangaRangeStart.value);
        const endVal = parseFloat(mangaRangeEnd.value);

        if (isNaN(startVal) || isNaN(endVal)) {
            alert('សូមបញ្ចូលលេខភាគឱ្យបានត្រឹមត្រូវ!');
            return;
        }

        document.querySelectorAll('.chapter-card').forEach(card => {
            const chNum = parseFloat(card.dataset.chapter);
            const uuid = card.dataset.id;
            
            if (!isNaN(chNum) && chNum >= startVal && chNum <= endVal) {
                if (!selectedChaptersList.has(uuid)) {
                    selectedChaptersList.add(uuid);
                    card.classList.add('selected');
                }
            }
        });
        updateSelectedChaptersUI();
    });

    // High-Speed Concurrent chapter downloads (Multi-Worker Pool)
    async function startChaptersDownloadSequence() {
        mangaDownloadProgressContainer.classList.remove('hidden');
        btnMangaFetch.disabled = true;
        btnMangaDownloadZip.disabled = true;
        btnMangaImportPdf.disabled = true;

        const queue = Array.from(selectedChaptersList);
        const total = queue.length;
        let completed = 0;
        let queueIndex = 0;
        
        downloadedPagesMap.clear();

        const CONCURRENCY = Math.min(3, total); // Download 3 chapters concurrently

        async function worker() {
            while (queueIndex < total) {
                const currentIndex = queueIndex++;
                const uuid = queue[currentIndex];
                const chCard = document.querySelector(`.chapter-card[data-id="${uuid}"]`);
                const chLabel = chCard ? (chCard.querySelector('.font-bold')?.textContent || `Chapter ${currentIndex+1}`) : `Chapter ${currentIndex+1}`;

                mangaDownloadStatus.innerHTML = `<i data-lucide="loader" class="w-3.5 h-3.5 animate-spin"></i> កំពុងទាញយក (${completed + 1}/${total}): ${chLabel}...`;
                lucide.createIcons();

                try {
                    const formData = new FormData();
                    formData.append('chapter_id', uuid);

                    const response = await fetch('/api/manga/download-chapter', {
                        method: 'POST',
                        body: formData
                    });

                    if (!response.ok) {
                        throw new Error(`Server returned code ${response.status}`);
                    }

                    const data = await response.json();
                    if (data.status === 'success' && data.pages.length > 0) {
                        downloadedPagesMap.set(uuid, data.pages);
                        if (chCard) {
                            const pageLabelEl = chCard.querySelector('.text-\\[10px\\]');
                            if (pageLabelEl) {
                                pageLabelEl.innerHTML = `<span class="text-emerald-500 dark:text-emerald-400 font-bold">✓ ${data.pages.length} ទំព័រ (រួចរាល់)</span>`;
                            }
                        }
                    }
                } catch (err) {
                    console.error(`Error downloading chapter ${uuid}:`, err);
                } finally {
                    completed++;
                    const pct = Math.round((completed / total) * 100);
                    mangaDownloadBar.style.width = `${pct}%`;
                    mangaDownloadPercent.textContent = `${pct}%`;
                    mangaDownloadDetails.textContent = `បានទាញយក ${completed}/${total} ជំពូក (${downloadedPagesMap.size} ជោគជ័យ)`;
                }
            }
        }

        const workers = [];
        for (let w = 0; w < CONCURRENCY; w++) {
            workers.push(worker());
        }
        await Promise.all(workers);

        // Complete Progress
        mangaDownloadBar.style.width = '100%';
        mangaDownloadPercent.textContent = '100%';
        mangaDownloadStatus.innerHTML = `<i data-lucide="check-circle" class="w-3.5 h-3.5 text-green-500"></i> ទាញយកបានជោគជ័យទាំងអស់!`;
        mangaDownloadDetails.textContent = `បានទាញយក ${downloadedPagesMap.size} ជំពូក រួចរាល់។`;
        lucide.createIcons();

        btnMangaFetch.disabled = false;
        if (btnMangaDownloadDocx) btnMangaDownloadDocx.disabled = false;
        btnMangaDownloadZip.disabled = false;
        btnMangaImportPdf.disabled = false;
    }

    // DOCX Compiler trigger
    if (btnMangaDownloadDocx) {
        btnMangaDownloadDocx.addEventListener('click', async () => {
            if (downloadedPagesMap.size === 0) {
                await startChaptersDownloadSequence();
            }
            await downloadDocxFile();
        });
    }

    // ZIP Compiler trigger
    btnMangaDownloadZip.addEventListener('click', async () => {
        if (downloadedPagesMap.size === 0) {
            await startChaptersDownloadSequence();
        }
        await downloadZipFile();
    });

    async function downloadZipFile() {
        mangaDownloadStatus.innerHTML = `<i data-lucide="loader" class="w-3.5 h-3.5 animate-spin"></i> កំពុងរៀបចំឯកសារ ZIP...`;
        lucide.createIcons();

        // Sort downloaded chapters strictly in ascending numerical order
        const chapterEntries = Array.from(downloadedPagesMap.entries()).map(([chUuid, pages]) => {
            const chCard = document.querySelector(`.chapter-card[data-id="${chUuid}"]`);
            const chNum = chCard ? parseFloat(chCard.dataset.chapter) : NaN;
            const chStr = chCard ? (chCard.dataset.chapter || 'ch') : 'ch';
            return { chUuid, pages, chNum, chStr };
        });

        chapterEntries.sort((a, b) => {
            if (!isNaN(a.chNum) && !isNaN(b.chNum)) return a.chNum - b.chNum;
            if (!isNaN(a.chNum)) return -1;
            if (!isNaN(b.chNum)) return 1;
            return a.chStr.localeCompare(b.chStr, undefined, { numeric: true });
        });

        const allImagesData = [];
        chapterEntries.forEach(({ pages, chStr }) => {
            pages.forEach((p, idx) => {
                allImagesData.push({
                    name: `${currentMangaData.title}_Ch_${chStr}_Page_${idx + 1}.${p.name.split('.').pop()}`,
                    dataUrl: p.dataUrl
                });
            });
        });

        if (allImagesData.length === 0) {
            alert('គ្មានរូបភាពសម្រាប់ទាញយកឡើយ!');
            return;
        }

        const originalBtnHTML = btnMangaDownloadZip.innerHTML;
        btnMangaDownloadZip.innerHTML = `<i data-lucide="loader" class="w-4 h-4 animate-spin"></i> Zipping...`;
        btnMangaDownloadZip.disabled = true;

        try {
            const formData = new FormData();
            formData.append('files', JSON.stringify(allImagesData));
            formData.append('manga_title', currentMangaData.title);

            const response = await fetch('/api/manga/generate-zip', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                throw new Error(`Server returned code ${response.status}`);
            }

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = `${currentMangaData.title.replace(/\s+/g, '_')}_chapters.zip`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

            mangaDownloadStatus.innerHTML = `<i data-lucide="check-circle" class="w-3.5 h-3.5 text-green-500"></i> ទាញយក ZIP រួចរាល់!`;
            logActivityEntry({
                type: 'manga',
                title: `ទាញយកជា ZIP៖ ${currentMangaData.title}`,
                subtitle: `ផ្ទុក ${downloadedPagesMap.size} ភាគ`,
                details: `ឯកសារ ZIP សម្រាប់កុំព្យូទ័រ`
            });
        } catch (err) {
            console.error(err);
            alert('មានបញ្ហាក្នុងការទាញយក ZIP៖ ' + err.message);
            mangaDownloadStatus.innerHTML = `<i data-lucide="alert-triangle" class="w-3.5 h-3.5 text-rose-500"></i> បរាជ័យក្នុងការពន្លា ZIP`;
        } finally {
            btnMangaDownloadZip.innerHTML = originalBtnHTML;
            btnMangaDownloadZip.disabled = false;
            lucide.createIcons();
        }
    }

    async function downloadDocxFile() {
        if (!btnMangaDownloadDocx) return;
        mangaDownloadStatus.innerHTML = `<i data-lucide="loader" class="w-3.5 h-3.5 animate-spin"></i> កំពុងរៀបចំឯកសារ Word (.docx)...`;
        lucide.createIcons();

        // Sort downloaded chapters strictly in ascending numerical order
        const chapterEntries = Array.from(downloadedPagesMap.entries()).map(([chUuid, pages]) => {
            const chCard = document.querySelector(`.chapter-card[data-id="${chUuid}"]`);
            const chNum = chCard ? parseFloat(chCard.dataset.chapter) : NaN;
            const chStr = chCard ? (chCard.dataset.chapter || 'ch') : 'ch';
            return { chUuid, pages, chNum, chStr };
        });

        chapterEntries.sort((a, b) => {
            if (!isNaN(a.chNum) && !isNaN(b.chNum)) return a.chNum - b.chNum;
            if (!isNaN(a.chNum)) return -1;
            if (!isNaN(b.chNum)) return 1;
            return a.chStr.localeCompare(b.chStr, undefined, { numeric: true });
        });

        const allImagesData = [];
        chapterEntries.forEach(({ pages, chStr }) => {
            pages.forEach((p, idx) => {
                allImagesData.push({
                    name: `${currentMangaData.title}_Ch_${chStr}_Page_${idx + 1}.${p.name.split('.').pop()}`,
                    dataUrl: p.dataUrl
                });
            });
        });

        if (allImagesData.length === 0) {
            alert('គ្មានរូបភាពសម្រាប់ទាញយកឡើយ!');
            return;
        }

        const originalBtnHTML = btnMangaDownloadDocx.innerHTML;
        btnMangaDownloadDocx.innerHTML = `<i data-lucide="loader" class="w-4 h-4 animate-spin"></i> Creating DOCX...`;
        btnMangaDownloadDocx.disabled = true;

        try {
            const formData = new FormData();
            formData.append('files', JSON.stringify(allImagesData));
            formData.append('manga_title', currentMangaData.title);

            const response = await fetch('/api/manga/generate-docx', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                throw new Error(`Server returned code ${response.status}`);
            }

            const blob = await response.blob();
            const docxName = `${currentMangaData.title.replace(/\s+/g, '_')}_chapters.docx`;
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = docxName;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

            // Save DOCX blob directly into IndexedDB library (Zero PDF generation overhead)
            const docTitle = chapterEntries.length === 1 
                ? `${currentMangaData.title} - Ch ${chapterEntries[0].chStr}.docx`
                : `${currentMangaData.title} - ${chapterEntries.length} Chapters.docx`;

            const createdDocId = await savePdfToDB(docTitle, blob);

            // Switch to Manga Creator view & OCR tab for preview
            switchView('pdf-creator');
            switchTab('ocr');
            await loadAndRenderPdfGrid();

            if (createdDocId !== null) {
                const pdfList = await loadPdfsFromDB();
                const targetDoc = pdfList.find(p => p.id === createdDocId);
                if (targetDoc) {
                    selectPdfFile(targetDoc);
                }
            }

            mangaDownloadStatus.innerHTML = `<i data-lucide="check-circle" class="w-3.5 h-3.5 text-green-500"></i> បានបញ្ជូនទៅកាន់ Manga Creator និងទាញយក Word រួចរាល់!`;
            logActivityEntry({
                type: 'doc',
                title: `បញ្ជូន DOCX ទៅ Manga Creator៖ ${currentMangaData.title}`,
                subtitle: `ផ្ទុក ${downloadedPagesMap.size} ភាគ (Word Document)`,
                details: `ទំហំសមាមាត្ររូបភាព 1:1`
            });
            alert(`🎉 បានបង្កើតឯកសារ Word (.docx) និងបញ្ជូន ${downloadedPagesMap.size} ភាគទៅកាន់ Manga Creator ដោយជោគជ័យ!`);
        } catch (err) {
            console.error(err);
            alert('មានបញ្ហាក្នុងការបញ្ជូន DOCX៖ ' + err.message);
            mangaDownloadStatus.innerHTML = `<i data-lucide="alert-triangle" class="w-3.5 h-3.5 text-rose-500"></i> បរាជ័យក្នុងការបញ្ជូន DOCX`;
        } finally {
            btnMangaDownloadDocx.innerHTML = originalBtnHTML;
            btnMangaDownloadDocx.disabled = false;
            lucide.createIcons();
        }
    }

    // Import downloaded images directly to PDF Creator
    // Import downloaded images directly to PDF Creator Library
    btnMangaImportPdf.addEventListener('click', async () => {
        if (downloadedPagesMap.size === 0) {
            await startChaptersDownloadSequence();
        }
        
        if (downloadedPagesMap.size === 0) {
            alert('គ្មានទំព័ររូបភាពត្រូវបានទាញយកដើម្បីបញ្ជូនឡើយ!');
            return;
        }

        mangaDownloadStatus.innerHTML = `<i data-lucide="loader" class="w-3.5 h-3.5 animate-spin"></i> កំពុងចងក្រងជា PDF (Compiling PDF)...`;
        lucide.createIcons();
        
        const originalBtnHTML = btnMangaImportPdf.innerHTML;
        btnMangaImportPdf.innerHTML = `<i data-lucide="loader" class="w-4 h-4 animate-spin"></i> Compiling...`;
        btnMangaImportPdf.disabled = true;

        const selectedMode = document.querySelector('input[name="manga-pdf-mode"]:checked')?.value || 'combine';
        let lastCreatedPdfId = null;

        try {
            if (selectedMode === 'combine') {
                // Read user-defined chunk size (e.g. 10 chapters per volume PDF)
                const chunkSize = Math.max(1, parseInt(mangaVolChunkSize?.value) || 10);

                // Sort downloaded chapters in ascending order of chapter numbers
                const chapterEntries = Array.from(downloadedPagesMap.entries()).map(([chUuid, pages]) => {
                    const chCard = document.querySelector(`.chapter-card[data-id="${chUuid}"]`);
                    const chNum = chCard ? parseFloat(chCard.dataset.chapter) : NaN;
                    const chStr = chCard ? (chCard.dataset.chapter || 'ch') : 'ch';
                    return { chUuid, pages, chNum, chStr };
                });

                chapterEntries.sort((a, b) => {
                    if (!isNaN(a.chNum) && !isNaN(b.chNum)) return a.chNum - b.chNum;
                    if (!isNaN(a.chNum)) return -1;
                    if (!isNaN(b.chNum)) return 1;
                    return a.chStr.localeCompare(b.chStr);
                });

                // Split into batches of chunkSize
                const batches = [];
                for (let i = 0; i < chapterEntries.length; i += chunkSize) {
                    batches.push(chapterEntries.slice(i, i + chunkSize));
                }

                const totalBatches = batches.length;

                for (let bIdx = 0; bIdx < totalBatches; bIdx++) {
                    const currentBatch = batches[bIdx];
                    const volNum = bIdx + 1;
                    const firstCh = currentBatch[0].chStr;
                    const lastCh = currentBatch[currentBatch.length - 1].chStr;

                    mangaDownloadStatus.innerHTML = `<i data-lucide="loader" class="w-3.5 h-3.5 animate-spin"></i> កំពុងចងក្រង Volume ${volNum}/${totalBatches} (Ch ${firstCh} - Ch ${lastCh})...`;
                    lucide.createIcons();

                    const formData = new FormData();
                    const metadata = [];
                    let globalPageIndex = 1;

                    currentBatch.forEach(({ pages, chStr }) => {
                        if (!pages || pages.length === 0) return;
                        pages.forEach((page, idx) => {
                            const mimeMatch = page.dataUrl.match(/data:(.*?);base64/);
                            const mime = mimeMatch ? mimeMatch[1] : 'image/png';
                            const base64Data = page.dataUrl.split(',')[1];
                            const binaryData = atob(base64Data);
                            const array = [];
                            for (let i = 0; i < binaryData.length; i++) {
                                array.push(binaryData.charCodeAt(i));
                            }
                            const blob = new Blob([new Uint8Array(array)], { type: mime });
                            const filename = `${currentMangaData.title}_Vol_${volNum}_Ch_${chStr}_p_${idx + 1}_g${globalPageIndex}.${mime.split('/')[1] || 'png'}`;
                            
                            formData.append('images', blob, filename);
                            metadata.push({
                                filename: filename,
                                rotation: 0
                            });
                            globalPageIndex++;
                        });
                    });

                    if (metadata.length === 0) continue;

                    formData.append('metadata', JSON.stringify(metadata));
                    formData.append('page_size', 'original');
                    formData.append('quality', '1.0');

                    const response = await fetch('/api/generate-pdf', {
                        method: 'POST',
                        body: formData
                    });

                    if (!response.ok) {
                        let errorMsg = `Server returned code ${response.status}`;
                        try {
                            const errJson = await response.json();
                            if (errJson && errJson.message) errorMsg = errJson.message;
                        } catch (jsonErr) {}
                        throw new Error(`បរាជ័យចំពោះ Volume ${volNum} (Ch ${firstCh}-${lastCh})៖ ${errorMsg}`);
                    }

                    const pdfBlob = await response.blob();
                    let pdfName = '';
                    if (totalBatches > 1) {
                        pdfName = `${currentMangaData.title} - Vol ${volNum} (Ch ${firstCh}-${lastCh}).pdf`;
                    } else if (currentBatch.length > 1) {
                        pdfName = `${currentMangaData.title} - Ch ${firstCh}-${lastCh} (Combined).pdf`;
                    } else {
                        pdfName = `${currentMangaData.title} - Ch ${firstCh}.pdf`;
                    }

                    // Save volume PDF to IndexedDB
                    lastCreatedPdfId = await savePdfToDB(pdfName, pdfBlob);
                }

            } else {
                // Separate PDF per chapter - Sort in ascending chapter order
                const chapterEntries = Array.from(downloadedPagesMap.entries()).map(([chUuid, pages]) => {
                    const chCard = document.querySelector(`.chapter-card[data-id="${chUuid}"]`);
                    const chNum = chCard ? parseFloat(chCard.dataset.chapter) : NaN;
                    const chStr = chCard ? (chCard.dataset.chapter || 'ch') : 'ch';
                    return { chUuid, pages, chNum, chStr };
                });

                chapterEntries.sort((a, b) => {
                    if (!isNaN(a.chNum) && !isNaN(b.chNum)) return a.chNum - b.chNum;
                    if (!isNaN(a.chNum)) return -1;
                    if (!isNaN(b.chNum)) return 1;
                    return a.chStr.localeCompare(b.chStr, undefined, { numeric: true });
                });

                for (const { pages, chStr } of chapterEntries) {
                    const chNum = chStr;
                    if (!pages || pages.length === 0) continue;
                    
                    const formData = new FormData();
                    const metadata = [];
                    
                    pages.forEach((page, idx) => {
                        const mimeMatch = page.dataUrl.match(/data:(.*?);base64/);
                        const mime = mimeMatch ? mimeMatch[1] : 'image/png';
                        const base64Data = page.dataUrl.split(',')[1];
                        const binaryData = atob(base64Data);
                        const array = [];
                        for (let i = 0; i < binaryData.length; i++) {
                            array.push(binaryData.charCodeAt(i));
                        }
                        const blob = new Blob([new Uint8Array(array)], { type: mime });
                        const filename = `${currentMangaData.title}_Ch_${chNum}_Page_${idx + 1}.${mime.split('/')[1] || 'png'}`;
                        
                        formData.append('images', blob, filename);
                        metadata.push({
                            filename: filename,
                            rotation: 0
                        });
                    });

                    formData.append('metadata', JSON.stringify(metadata));
                    formData.append('page_size', 'original');
                    formData.append('quality', '1.0');

                    mangaDownloadStatus.innerHTML = `<i data-lucide="loader" class="w-3.5 h-3.5 animate-spin"></i> កំពុងចងក្រងភាគទី ${chNum}...`;
                    lucide.createIcons();

                    const response = await fetch('/api/generate-pdf', {
                        method: 'POST',
                        body: formData
                    });

                    if (!response.ok) {
                        let errorMsg = `Server returned code ${response.status}`;
                        try {
                            const errJson = await response.json();
                            if (errJson && errJson.message) {
                                errorMsg = errJson.message;
                            }
                        } catch (jsonErr) {}
                        throw new Error(`បរាជ័យចំពោះភាគទី ${chNum}៖ ${errorMsg}`);
                    }

                    const pdfBlob = await response.blob();
                    const pdfName = `${currentMangaData.title} - Ch ${chNum}.pdf`;
                    
                    // Save to IndexedDB
                    lastCreatedPdfId = await savePdfToDB(pdfName, pdfBlob);
                }
            }

            // Switch view & tab to show the created PDF in library
            switchView('pdf-creator');
            switchTab('organize');
            
            await loadAndRenderPdfGrid();
            
            // Auto-select the last created PDF
            if (lastCreatedPdfId !== null) {
                const pdfList = await loadPdfsFromDB();
                const targetPdf = pdfList.find(p => p.id === lastCreatedPdfId);
                if (targetPdf) {
                    selectPdfFile(targetPdf);
                }
            }

            mangaDownloadStatus.innerHTML = `<i data-lucide="check-circle" class="w-3.5 h-3.5 text-green-500"></i> បញ្ជូនទៅ Manga Creator រួចរាល់!`;
            lucide.createIcons();
            
            if (selectedMode === 'combine') {
                const chunkSize = Math.max(1, parseInt(mangaVolChunkSize?.value) || 10);
                const totalVols = Math.ceil(downloadedPagesMap.size / chunkSize);
                alert(`🎉 បានច្របាច់បញ្ចូល ${downloadedPagesMap.size} ភាគជា ${totalVols} សៀវភៅ PDF (Volumes) ដោយជោគជ័យ!`);
                logActivityEntry({
                    type: 'pdf',
                    title: `ចងក្រងសៀវភៅ Volume: ${currentMangaData.title}`,
                    subtitle: `ច្របាច់ ${downloadedPagesMap.size} ភាគជា ${totalVols} សៀវភៅ PDF`,
                    details: `កម្រិត ${chunkSize} ភាគក្នុង ១ PDF`
                });
            } else {
                alert(`🎉 បានចងក្រង និងបញ្ជូន ${downloadedPagesMap.size} ភាគដាច់ដោយឡែកទៅកាន់បណ្ណាល័យ PDF ដោយជោគជ័យ!`);
                logActivityEntry({
                    type: 'pdf',
                    title: `ចងក្រង PDF តាមភាគ: ${currentMangaData.title}`,
                    subtitle: `បង្កើតបាន ${downloadedPagesMap.size} ឯកសារ PDF ដាច់ដោយឡែក`,
                    details: `បញ្ជូនទៅកាន់បណ្ណាល័យ PDF`
                });
            }
        } catch (err) {
            console.error(err);
            alert('មានបញ្ហាក្នុងការចងក្រង PDF៖ ' + err.message);
            mangaDownloadStatus.innerHTML = `<i data-lucide="alert-triangle" class="w-3.5 h-3.5 text-rose-500"></i> បរាជ័យក្នុងការចងក្រង PDF`;
        } finally {
            btnMangaImportPdf.innerHTML = originalBtnHTML;
            btnMangaImportPdf.disabled = false;
            lucide.createIcons();
        }
    });

    // =========================================================================
    // HISTORY & DATA MANAGEMENT MODULE
    // =========================================================================
    const HISTORY_KEY = 'pdf_creator_activity_history';
    let currentHistoryFilter = 'all';
    let historySearchQuery = '';

    const historyListContainer = document.getElementById('history-list-container');
    const historyEmptyState = document.getElementById('history-empty-state');
    const historySearchInput = document.getElementById('history-search-input');
    const historyFilterBtns = document.querySelectorAll('.history-filter-btn');

    const statPdfCount = document.getElementById('stat-pdf-count');
    const statMangaCount = document.getElementById('stat-manga-count');
    const statOcrCount = document.getElementById('stat-ocr-count');
    const statStorageSize = document.getElementById('stat-storage-size');

    const filterCountAll = document.getElementById('filter-count-all');
    const filterCountManga = document.getElementById('filter-count-manga');
    const filterCountOcr = document.getElementById('filter-count-ocr');
    const filterCountPdf = document.getElementById('filter-count-pdf');

    const btnClearHistoryLogs = document.getElementById('btn-clear-history-logs');
    const btnClearAllData = document.getElementById('btn-clear-all-data');

    const modalClearConfirm = document.getElementById('modal-clear-confirm');
    const modalClearTitle = document.getElementById('modal-clear-title');
    const modalClearDesc = document.getElementById('modal-clear-desc');
    const modalClearWarning = document.getElementById('modal-clear-warning');
    const btnModalCancel = document.getElementById('btn-modal-cancel');
    const btnModalConfirm = document.getElementById('btn-modal-confirm');

    let pendingClearAction = null;

    // Get list of history from localStorage
    function getHistoryList() {
        try {
            const raw = localStorage.getItem(HISTORY_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch (e) {
            console.error('Error reading history from storage:', e);
            return [];
        }
    }

    // Save history list to localStorage
    function saveHistoryList(list) {
        try {
            localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
        } catch (e) {
            console.error('Error saving history list:', e);
        }
    }

    // Add a new activity entry
    function logActivityEntry(entry) {
        const list = getHistoryList();
        const newEntry = {
            id: 'hist_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
            type: entry.type || 'general', // 'manga', 'ocr', 'pdf'
            title: entry.title || 'កិច្ចការថ្មី',
            subtitle: entry.subtitle || '',
            details: entry.details || '',
            timestamp: entry.timestamp || new Date().toISOString(),
            meta: entry.meta || {}
        };
        list.unshift(newEntry);
        // Keep up to 200 history logs
        if (list.length > 200) list.pop();
        saveHistoryList(list);
    }

    // Format Date / Relative time
    function formatHistoryTime(isoString) {
        try {
            const date = new Date(isoString);
            const now = new Date();
            const diffSec = Math.floor((now - date) / 1000);
            
            if (diffSec < 60) return 'ទើបតែមុននេះ';
            if (diffSec < 3600) return `${Math.floor(diffSec / 60)} នាទីមុន`;
            if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} ម៉ោងមុន`;
            return date.toLocaleDateString('km-KH', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        } catch {
            return isoString;
        }
    }

    // Render History Page
    async function renderHistoryPage() {
        const history = getHistoryList();
        const pdfs = await loadPdfsFromDB();

        // 1. Calculate & Render Stats
        if (statPdfCount) statPdfCount.textContent = pdfs.length;
        
        const mangaEntries = history.filter(h => h.type === 'manga');
        if (statMangaCount) statMangaCount.textContent = mangaEntries.length;

        const ocrEntries = history.filter(h => h.type === 'ocr');
        if (statOcrCount) statOcrCount.textContent = ocrEntries.length;

        const pdfEntries = history.filter(h => h.type === 'pdf');

        // Calculate storage
        let totalBytes = 0;
        pdfs.forEach(p => {
            if (p.blob && p.blob.size) totalBytes += p.blob.size;
        });
        const mbSize = (totalBytes / (1024 * 1024)).toFixed(1);
        if (statStorageSize) statStorageSize.textContent = `${mbSize} MB`;

        // Update filter badge counts
        if (filterCountAll) filterCountAll.textContent = history.length;
        if (filterCountManga) filterCountManga.textContent = mangaEntries.length;
        if (filterCountOcr) filterCountOcr.textContent = ocrEntries.length;
        if (filterCountPdf) filterCountPdf.textContent = pdfEntries.length;

        // 2. Filter & Search
        let filtered = [...history];

        if (currentHistoryFilter !== 'all') {
            filtered = filtered.filter(h => h.type === currentHistoryFilter);
        }

        if (historySearchQuery.trim()) {
            const q = historySearchQuery.toLowerCase().trim();
            filtered = filtered.filter(h => 
                (h.title || '').toLowerCase().includes(q) || 
                (h.subtitle || '').toLowerCase().includes(q) || 
                (h.details || '').toLowerCase().includes(q)
            );
        }

        // 3. Render Cards
        if (!historyListContainer) return;
        historyListContainer.innerHTML = '';

        if (filtered.length === 0) {
            historyListContainer.classList.add('hidden');
            if (historyEmptyState) historyEmptyState.classList.remove('hidden');
            return;
        }

        historyListContainer.classList.remove('hidden');
        if (historyEmptyState) historyEmptyState.classList.add('hidden');

        filtered.forEach(item => {
            const card = document.createElement('div');
            card.className = 'p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm flex items-center justify-between gap-4 transition hover:border-brand-300 dark:hover:border-brand-700/60';

            let typeIcon = 'file-text';
            let typeColor = 'bg-brand-50 text-brand-600 dark:bg-brand-950/60 dark:text-brand-400';
            let typeBadge = 'PDF FILE';

            if (item.type === 'manga') {
                typeIcon = 'download';
                typeColor = 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400';
                typeBadge = 'MANGA DOWNLOAD';
            } else if (item.type === 'ocr') {
                typeIcon = 'sparkles';
                typeColor = 'bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400';
                typeBadge = 'OCR & TRANSLATE';
            }

            card.innerHTML = `
                <div class="flex items-center gap-3.5 min-w-0">
                    <div class="w-10 h-10 rounded-xl flex items-center justify-center ${typeColor} flex-shrink-0">
                        <i data-lucide="${typeIcon}" class="w-5 h-5"></i>
                    </div>
                    <div class="min-w-0">
                        <div class="flex items-center gap-2">
                            <span class="text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${typeColor}">${typeBadge}</span>
                            <span class="text-[10px] text-slate-400 font-medium">${formatHistoryTime(item.timestamp)}</span>
                        </div>
                        <h4 class="font-bold text-xs text-slate-800 dark:text-slate-200 truncate mt-0.5">${item.title}</h4>
                        <p class="text-[11px] text-slate-400 dark:text-slate-500 truncate">${item.subtitle ? item.subtitle + ' • ' : ''}${item.details}</p>
                    </div>
                </div>

                <div class="flex items-center gap-2 flex-shrink-0">
                    <button class="btn-delete-history p-2 rounded-xl text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition" data-id="${item.id}" title="លុបកំណត់ត្រានេះ">
                        <i data-lucide="trash" class="w-4 h-4"></i>
                    </button>
                </div>
            `;

            // Delete single history log
            card.querySelector('.btn-delete-history')?.addEventListener('click', (e) => {
                e.stopPropagation();
                const list = getHistoryList().filter(h => h.id !== item.id);
                saveHistoryList(list);
                renderHistoryPage();
            });

            historyListContainer.appendChild(card);
        });

        lucide.createIcons();
    }

    // Filter Buttons Listener
    historyFilterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            historyFilterBtns.forEach(b => {
                b.classList.remove('bg-white', 'dark:bg-slate-800', 'text-brand-600', 'dark:text-brand-400', 'shadow-sm');
                b.classList.add('text-slate-500', 'hover:text-slate-800', 'dark:hover:text-slate-200');
            });
            btn.classList.add('bg-white', 'dark:bg-slate-800', 'text-brand-600', 'dark:text-brand-400', 'shadow-sm');
            btn.classList.remove('text-slate-500', 'hover:text-slate-800', 'dark:hover:text-slate-200');

            currentHistoryFilter = btn.dataset.filter || 'all';
            renderHistoryPage();
        });
    });

    // Search input listener
    if (historySearchInput) {
        historySearchInput.addEventListener('input', (e) => {
            historySearchQuery = e.target.value;
            renderHistoryPage();
        });
    }

    // Modal Clear Confirm Handlers
    function showClearModal(actionType) {
        pendingClearAction = actionType;
        if (!modalClearConfirm) return;

        if (actionType === 'history_only') {
            modalClearTitle.textContent = 'លុបតែបញ្ជីប្រវត្តិកិច្ចការ?';
            modalClearDesc.textContent = 'កំណត់ត្រាប្រវត្តិទាំងអស់នឹងត្រូវសម្អាត ប៉ុន្តែឯកសារ PDF ក្នុងបណ្ណាល័យនៅរក្សាទុកដដែល។';
            modalClearWarning.textContent = 'កំណត់ត្រាប្រវត្តិកិច្ចការទាំងអស់នឹងត្រូវបានលុបចោល។';
        } else if (actionType === 'clear_all') {
            modalClearTitle.textContent = 'សម្អាតទិន្នន័យ និងឯកសារទាំងអស់? (Factory Reset)';
            modalClearDesc.textContent = 'រាល់ឯកសារ PDF ក្នុងបណ្ណាល័យ រួមទាំងប្រវត្តិទាញយក និងកំណត់ត្រាទាំងអស់នឹងត្រូវបានលុបស្អាត ១០០%។';
            modalClearWarning.textContent = 'ឯកសារ PDF ទាំងអស់ក្នុង IndexedDB នឹងត្រូវលុបចោលទាំងស្រុងដោយមិនអាចត្រឡប់វិញបានឡើយ!';
        }

        modalClearConfirm.classList.remove('hidden');
        lucide.createIcons();
    }

    function hideClearModal() {
        if (modalClearConfirm) modalClearConfirm.classList.add('hidden');
        pendingClearAction = null;
    }

    if (btnClearHistoryLogs) {
        btnClearHistoryLogs.addEventListener('click', () => showClearModal('history_only'));
    }

    if (btnClearAllData) {
        btnClearAllData.addEventListener('click', () => showClearModal('clear_all'));
    }

    if (btnModalCancel) {
        btnModalCancel.addEventListener('click', hideClearModal);
    }

    if (btnModalConfirm) {
        btnModalConfirm.addEventListener('click', async () => {
            if (pendingClearAction === 'history_only') {
                localStorage.removeItem(HISTORY_KEY);
                hideClearModal();
                renderHistoryPage();
                alert('🧹 បានលុបកំណត់ត្រាប្រវត្តិកិច្ចការទាំងអស់ដោយជោគជ័យ!');
            } else if (pendingClearAction === 'clear_all') {
                // 1. Clear IndexedDB PDFs
                await clearAllPdfsFromDB();
                // 2. Clear history
                localStorage.removeItem(HISTORY_KEY);
                // 3. Clear active PDF states
                activePdfFile = null;
                selectedChaptersList.clear();
                downloadedPagesMap.clear();
                
                hideClearModal();
                await loadAndRenderPdfGrid();
                renderHistoryPage();
                alert('🗑️ បានសម្អាតទិន្នន័យ ឯកសារ PDF និងប្រវត្តិទាំងអស់ដោយជោគជ័យ!');
            }
        });
    }

    // Expose renderHistoryPage globally so switchView can call it
    window.renderHistoryPage = renderHistoryPage;
    window.logActivityEntry = logActivityEntry;
});
