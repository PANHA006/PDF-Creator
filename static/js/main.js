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
            lang: r.lang
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

    async function initApp() {
        const savedLang = localStorage.getItem('selectedLang');
        if (savedLang && ocrLangSelect) {
            ocrLangSelect.value = savedLang;
        }

        const savedResults = localStorage.getItem('ocrResults');
        if (savedResults) {
            ocrResults = JSON.parse(savedResults);
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
    const ocrProgressContainer = document.getElementById('ocr-progress-container');
    const ocrProgressBar = document.getElementById('ocr-progress-bar');
    const ocrProgressPercent = document.getElementById('ocr-progress-percent');
    const ocrStatusText = document.getElementById('ocr-status-text');
    const ocrEmptyTableState = document.getElementById('ocr-empty-table-state');
    const btnCopyText = document.getElementById('btn-copy-text');
    const btnSaveTxt = document.getElementById('btn-save-txt');
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
            
            card.innerHTML = `
                <div class="flex items-start gap-3">
                    <div class="w-10 h-10 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-100 dark:border-red-900/30 flex items-center justify-center text-red-500 shrink-0">
                        <i data-lucide="file-text" class="w-6 h-6"></i>
                    </div>
                    <div class="overflow-hidden flex-1">
                        <h4 class="font-bold text-xs text-slate-800 dark:text-slate-200 truncate" title="${item.name}">${item.name}</h4>
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
        
        renderPdfViewport(item.blob);
        
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
        const originalDropzoneHTML = dropzone.innerHTML;
        switchTab('organize');
        dropzone.innerHTML = `
            <div class="flex items-center gap-3 justify-center py-4">
                <i data-lucide="loader" class="w-6 h-6 animate-spin text-brand-500"></i>
                <span class="text-sm font-semibold text-slate-600 dark:text-slate-400">កំពុងវិភាគទំព័រ PDF សម្រាប់ OCR (Analyzing PDF)...</span>
            </div>
        `;
        lucide.createIcons();
        
        try {
            const formData = new FormData();
            formData.append('file', pdfBlob, pdfName);
            
            const response = await fetch('/api/upload-pdf', {
                method: 'POST',
                body: formData
            });
            
            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.message || 'Failed to parse PDF file');
            }
            
            const data = await response.json();
            if (data.status === 'success' && data.pages.length > 0) {
                const newImages = data.pages.map((page, idx) => ({
                    id: 'img_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9) + '_' + idx,
                    name: `${pdfName.replace(/\.pdf$/i, '')}_page_${idx + 1}.png`,
                    dataUrl: page.dataUrl,
                    rotation: 0
                }));
                
                images = newImages;
                updateOcrPageSelectOptions();
                
                switchTab('ocr');
                ocrPageSelect.value = 'all';
                btnScan.click();
            } else {
                throw new Error(data.message || 'No pages found in PDF');
            }
        } catch (err) {
            console.error(err);
            alert('មានបញ្ហាក្នុងការរៀបចំ OCR៖ ' + err.message);
        } finally {
            dropzone.innerHTML = originalDropzoneHTML;
            lucide.createIcons();
        }
    }

    function renderPdfViewport(pdfBlob) {
        if (activePdfObjectUrl) {
            URL.revokeObjectURL(activePdfObjectUrl);
        }
        
        pdfViewport.innerHTML = '';
        if (!pdfBlob) {
            pdfViewport.innerHTML = `
                <div id="pdf-empty-preview" class="flex-1 flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 p-6 text-center">
                    <i data-lucide="eye-off" class="w-12 h-12 mb-3 stroke-1 opacity-60"></i>
                    <h3 class="text-xs font-semibold text-slate-700 dark:text-slate-300">មិនទាន់មានការជ្រើសរើស</h3>
                    <p class="text-[10px] text-slate-400 dark:text-slate-500 mt-1 max-w-xs">សូមជ្រើសរើសឯកសារ PDF ពីបញ្ជីខាងស្តាំ ឬ Upload ឯកសារ PDF ដើម្បីមើល Preview ទីនេះ</p>
                </div>
            `;
            lucide.createIcons();
            return;
        }

        activePdfObjectUrl = URL.createObjectURL(pdfBlob);
        
        const iframe = document.createElement('iframe');
        iframe.src = activePdfObjectUrl;
        iframe.className = "w-full h-full border-0";
        pdfViewport.appendChild(iframe);
    }

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
        if (images.length === 0) {
            const opt = document.createElement('option');
            opt.value = 'none';
            opt.textContent = 'គ្មានទំព័ររូបភាព';
            ocrPageSelect.appendChild(opt);
            return;
        }

        // Add 'current page' option
        const optCurrent = document.createElement('option');
        optCurrent.value = 'current';
        optCurrent.textContent = `ទំព័របច្ចុប្បន្ន (${currentPage})`;
        ocrPageSelect.appendChild(optCurrent);

        // Add 'all pages' option
        const optAll = document.createElement('option');
        optAll.value = 'all';
        optAll.textContent = 'គ្រប់ទំព័រទាំងអស់';
        ocrPageSelect.appendChild(optAll);

        // Add options for individual pages
        images.forEach((img, idx) => {
            const opt = document.createElement('option');
            opt.value = idx + 1;
            opt.textContent = `ទំព័រទី ${idx + 1}`;
            ocrPageSelect.appendChild(opt);
        });
    }

    // Handle Start Scan Button click
    btnScan.addEventListener('click', () => {
        if (images.length === 0) return;

        // Confirm overwrite if we already have OCR results
        if (ocrResults.length > 0) {
            const proceed = confirm('ការស្កែនឡើងវិញនឹងលុប និងជំនួសរាល់អត្ថបទចាស់ៗទាំងអស់។ តើអ្នកពិតជាចង់បន្តការស្កែនមែនទេ?\n(Rescanning will clear and overwrite all existing transcripts. Do you want to proceed?)');
            if (!proceed) {
                return;
            }
        }

        const lang = ocrLangSelect.value;
        const targetPageVal = ocrPageSelect.value;
        
        // Show progress bar container
        ocrProgressContainer.classList.remove('hidden');
        ocrProgressBar.style.width = '0%';
        ocrProgressPercent.textContent = '0%';
        ocrStatusText.textContent = 'កំពុងចាប់ផ្តើមការស្កែនអត្ថបទ (Starting OCR scan)...';
        btnScan.disabled = true;

        // Determine pages to scan
        let pagesToScan = [];
        if (targetPageVal === 'all') {
            pagesToScan = images.map((_, idx) => idx + 1);
            // Clear all running delete timers to prevent memory leaks
            ocrResults.forEach(r => { if (r.deleteTimer) clearInterval(r.deleteTimer); });
            ocrResults = []; // Reset if scanning all
        } else if (targetPageVal === 'current') {
            pagesToScan = [currentPage];
            // Clear timers for the page being rescanned
            ocrResults.filter(r => r.pageNum === currentPage).forEach(r => { if (r.deleteTimer) clearInterval(r.deleteTimer); });
            ocrResults = ocrResults.filter(r => r.pageNum !== currentPage); // Clear current page
        } else {
            const pNum = parseInt(targetPageVal);
            pagesToScan = [pNum];
            // Clear timers for the page being rescanned
            ocrResults.filter(r => r.pageNum === pNum).forEach(r => { if (r.deleteTimer) clearInterval(r.deleteTimer); });
            ocrResults = ocrResults.filter(r => r.pageNum !== pNum); // Clear specific page
        }

        // Perform requests sequentially to allow real-time progress updates and avoid overloading the server
        const totalPages = pagesToScan.length;

        function scanPage(index) {
            if (index >= totalPages) {
                // All pages completed successfully!
                ocrProgressBar.style.width = '100%';
                ocrProgressPercent.textContent = '100%';
                ocrStatusText.textContent = 'ស្កែនអត្ថបទបានជោគជ័យ!';

                // Sort ocrResults by pageNum then by phrase line number
                ocrResults.sort((a, b) => {
                    if (a.pageNum !== b.pageNum) return a.pageNum - b.pageNum;
                    return a.lineNum - b.lineNum;
                });

                setTimeout(() => {
                    ocrProgressContainer.classList.add('hidden');
                    btnScan.disabled = false;
                    
                    // Render Grid
                    renderOcrTable();

                    btnCopyText.disabled = false;
                    btnSaveTxt.disabled = false;
                    
                    alert(`✨ ការស្កែនអត្ថបទចំនួន ${totalPages} ទំព័រ បានបញ្ចប់ដោយជោគជ័យ!`);
                }, 600);
                return;
            }

            const pageNum = pagesToScan[index];
            const currentPercentage = Math.round((index / totalPages) * 100);
            
            ocrProgressBar.style.width = `${currentPercentage}%`;
            ocrProgressPercent.textContent = `${currentPercentage}%`;
            ocrStatusText.textContent = `កំពុងស្កែនទំព័រទី ${pageNum} (ទំព័រទី ${index + 1} នៃ ${totalPages})...`;

            const img = images[pageNum - 1];
            const formData = new FormData();
            
            let fileToUpload = img.file;
            if (!fileToUpload && img.dataUrl) {
                fileToUpload = dataURLtoBlob(img.dataUrl);
            }
            
            formData.append('image', fileToUpload, img.name || `page_${pageNum}.png`);
            formData.append('rotation', img.rotation);
            formData.append('lang', lang);

            // If it's a single page scan, set to 50% progress mid-way to look interactive
            if (totalPages === 1) {
                ocrProgressBar.style.width = '50%';
                ocrProgressPercent.textContent = '50%';
            }

            fetch('/api/scan-ocr', {
                method: 'POST',
                body: formData
            })
            .then(res => {
                if (!res.ok) {
                    return res.json().then(err => {
                        throw new Error(err.message || `Server error scanning page ${pageNum}`);
                    });
                }
                return res.json();
            })
            .then(data => {
                const text = data.text || '';
                
                // Split scanned text into paragraph blocks/speech bubbles (by double or multiple newlines)
                const paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 0);
                
                paragraphs.forEach((paragraphText, paraIdx) => {
                    // Split each paragraph block into individual lines to merge them
                    const lines = paragraphText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
                    
                    let mergedText = '';
                    lines.forEach((line, lineIdx) => {
                        if (lineIdx === 0) {
                            mergedText = line;
                        } else {
                            const prevLine = lines[lineIdx - 1];
                            // If previous line ends with a hyphen, merge directly without space and drop the hyphen
                            if (prevLine.endsWith('-')) {
                                mergedText = mergedText.slice(0, -1) + line;
                            } else {
                                mergedText += ' ' + line;
                            }
                        }
                    });

                    // Filter out garbage/noise text (short English fragments, sound effects, metadata)
                    if (isGarbageText(mergedText, lang)) {
                        return; // Skip this phrase
                    }

                    const phraseId = `L${pageNum}-${paraIdx + 1}`;
                    ocrResults.push({
                        id: phraseId,
                        lineNum: paraIdx + 1, // Represents Phrase number in the page
                        pageNum: pageNum,
                        lineText: mergedText,
                        transText: "" // default empty
                    });
                });

                // Scan next page in queue
                scanPage(index + 1);
            })
            .catch(err => {
                ocrProgressContainer.classList.add('hidden');
                btnScan.disabled = false;
                console.error(err);
                alert('មានបញ្ហាក្នុងការស្កែនអត្ថបទ៖\n' + err.message);
            });
        }

        // Start scanning the first page
        scanPage(0);
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
        if (ocrResults.length === 0) return;
        let maxTextLen = 30;
        let maxTransLen = 30;
        ocrResults.forEach(res => {
            if (res.lineText && res.lineText.length > maxTextLen) {
                maxTextLen = res.lineText.length;
            }
            if (res.transText && res.transText.length > maxTransLen) {
                maxTransLen = res.transText.length;
            }
        });
        
        const colTextWidth = `${Math.max(40, maxTextLen + 4)}ch`;
        const colTransWidth = `${Math.max(40, maxTransLen + 4)}ch`;
        currentGridCols = `40px 40px 70px 70px 90px ${colTextWidth} ${colTransWidth}`;

        // Apply grid column width values directly to the header element to prevent browser sticky inheritance bugs
        const headerGrid = document.querySelector('#ocr-table-container .grid.sticky');
        if (headerGrid) {
            headerGrid.style.gridTemplateColumns = currentGridCols;
        }
        
        // Also keep the fallback CSS property just in case
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

        ocrTableContainer.classList.remove('hidden');
        ocrEmptyTableState.classList.add('hidden');
        if (btnToggleFullscreen) btnToggleFullscreen.classList.remove('hidden');
        ocrTableBody.innerHTML = '';

        ocrResults.forEach((res) => {
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
            rowEl.className = 'grid justify-start gap-4 px-4 py-2 bg-white dark:bg-slate-950/40 hover:bg-slate-50 dark:hover:bg-slate-900/20 transition duration-150 border-b border-slate-200 dark:border-slate-800/80 w-full';
            rowEl.style.gridTemplateColumns = currentGridCols;

            rowEl.innerHTML = `
                <div class="flex justify-center border-r border-slate-100 dark:border-slate-800/80 pr-2 items-center">
                    <button class="ocr-btn-delete p-1.5 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/20 text-slate-400 hover:text-rose-500 transition" title="លុបឃ្លានេះ">
                        <i data-lucide="trash" class="w-3.5 h-3.5"></i>
                    </button>
                </div>
                <div class="flex items-center justify-center border-r border-slate-100 dark:border-slate-800/80 pr-2">
                    <input type="checkbox" class="ocr-row-checkbox w-3.5 h-3.5 text-brand-600 border-slate-300 rounded focus:ring-brand-500 cursor-pointer" data-id="${res.id}">
                </div>
                <div class="font-mono text-[10px] text-slate-500 font-bold border-r border-slate-100 dark:border-slate-800/80 pr-2 flex items-center">${res.id}</div>
                <div class="font-mono text-[11px] text-slate-400 dark:text-slate-500 border-r border-slate-100 dark:border-slate-800/80 pr-2 flex items-center">${res.lineNum}</div>
                <div class="text-[11px] font-semibold text-slate-700 dark:text-slate-400 border-r border-slate-100 dark:border-slate-800/80 pr-2 flex items-center">ទំព័រទី ${res.pageNum}</div>
                <div class="border-r border-slate-100 dark:border-slate-800/80 pr-4 flex items-center">
                    <input type="text" class="ocr-text-input inline-block w-auto bg-transparent border border-transparent rounded-lg px-2 py-1 text-xs text-slate-800 dark:text-slate-200 font-medium transition focus:outline-none focus:ring-0" style="min-width: 250px; width: ${(res.lineText || '').length + 2}ch;" value="${res.lineText}">
                </div>
                <div class="flex items-center">
                    <input type="text" class="ocr-trans-input inline-block w-auto bg-transparent border border-transparent rounded-lg px-2 py-1 text-xs text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-600 transition focus:outline-none focus:ring-0" placeholder="បញ្ចូលការបកប្រែ/កែសម្រួល..." style="min-width: 250px; width: ${(res.transText || '').length + 2}ch;" value="${res.transText}">
                </div>
            `;

            // Track input text changes in state dynamically and auto-resize in real-time
            rowEl.querySelector('.ocr-text-input').addEventListener('input', (e) => {
                res.lineText = e.target.value;
                e.target.style.width = (e.target.value.length + 2) + 'ch';
                adjustGridColumns();
                saveOcrResults();
            });
            rowEl.querySelector('.ocr-trans-input').addEventListener('input', (e) => {
                res.transText = e.target.value;
                e.target.style.width = (e.target.value.length + 2) + 'ch';
                adjustGridColumns();
                saveOcrResults();
            });

            // Delete specific row trigger (Soft delete with 5s countdown)
            rowEl.querySelector('.ocr-btn-delete').addEventListener('click', (e) => {
                e.stopPropagation();
                
                res.isPendingDelete = true;
                res.countdown = 5;

                if (res.deleteTimer) {
                    clearInterval(res.deleteTimer);
                }

                res.deleteTimer = setInterval(() => {
                    res.countdown--;
                    if (res.countdown <= 0) {
                        clearInterval(res.deleteTimer);
                        res.deleteTimer = null;

                        // Permanent deletion
                        ocrResults = ocrResults.filter(r => r.id !== res.id);
                        renumberPhraseIds();
                        renderOcrTable();
                        updateMergeButtonState();
                    } else {
                        // Re-draw table to show updated countdown
                        renderOcrTable();
                    }
                }, 1000);

                renderOcrTable();
                updateMergeButtonState();
            });

            // Checkbox change listener
            rowEl.querySelector('.ocr-row-checkbox').addEventListener('change', () => {
                updateMergeButtonState();
            });

            ocrTableBody.appendChild(rowEl);
        });

        saveOcrResults();
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
    
    const viewPdfCreator = document.getElementById('view-pdf-creator');
    const viewMangaDownloader = document.getElementById('view-manga-downloader');

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
        if (viewName === 'pdf-creator') {
            viewPdfCreator.classList.remove('hidden');
            viewMangaDownloader.classList.add('hidden');
            
            navPdfCreator.classList.add('bg-brand-50', 'dark:bg-brand-950/40', 'text-brand-600', 'dark:text-brand-400');
            navPdfCreator.classList.remove('hover:bg-slate-50', 'dark:hover:bg-slate-800', 'text-slate-600', 'dark:text-slate-400');
            
            navMangaDownloader.classList.remove('bg-brand-50', 'dark:bg-brand-950/40', 'text-brand-600', 'dark:text-brand-400');
            navMangaDownloader.classList.add('hover:bg-slate-50', 'dark:hover:bg-slate-800', 'text-slate-600', 'dark:text-slate-400');
        } else if (viewName === 'manga-downloader') {
            viewPdfCreator.classList.add('hidden');
            viewMangaDownloader.classList.remove('hidden');
            
            navMangaDownloader.classList.add('bg-brand-50', 'dark:bg-brand-950/40', 'text-brand-600', 'dark:text-brand-400');
            navMangaDownloader.classList.remove('hover:bg-slate-50', 'dark:hover:bg-slate-800', 'text-slate-600', 'dark:text-slate-400');
            
            navPdfCreator.classList.remove('bg-brand-50', 'dark:bg-brand-950/40', 'text-brand-600', 'dark:text-brand-400');
            navPdfCreator.classList.add('hover:bg-slate-50', 'dark:hover:bg-slate-800', 'text-slate-600', 'dark:text-slate-400');
        }
        closeDrawer();
        lucide.createIcons();
    }

    navPdfCreator.addEventListener('click', () => switchView('pdf-creator'));
    navMangaDownloader.addEventListener('click', () => switchView('manga-downloader'));

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
    
    const mangaDownloadProgressContainer = document.getElementById('manga-download-progress-container');
    const mangaDownloadStatus = document.getElementById('manga-download-status');
    const mangaDownloadPercent = document.getElementById('manga-download-percent');
    const mangaDownloadBar = document.getElementById('manga-download-bar');
    const mangaDownloadDetails = document.getElementById('manga-download-details');
    
    const btnMangaDownloadZip = document.getElementById('btn-manga-download-zip');
    const btnMangaImportPdf = document.getElementById('btn-manga-import-pdf');

    let currentMangaData = null; 
    let selectedChaptersList = new Set(); 
    let downloadedPagesMap = new Map(); 

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
                
                // Render Chapters
                renderChapterList(data.manga.chapters);
                
                // Show area, hide empty
                mangaEmptyState.classList.add('hidden');
                mangaContentArea.classList.remove('hidden');
                
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
                mangaDownloadProgressContainer.classList.add('hidden');
                btnMangaDownloadZip.disabled = !selectedChaptersList.size;
                btnMangaImportPdf.disabled = !selectedChaptersList.size;
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
        if (chapters.length === 0) {
            mangaChapterList.innerHTML = `<div class="col-span-2 text-center text-xs text-slate-400 py-6">គ្មានភាគជាភាសាអង់គ្លេសឡើយ។</div>`;
            return;
        }

        chapters.forEach(ch => {
            const chCard = document.createElement('div');
            chCard.className = 'chapter-card flex items-center justify-between p-3.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl cursor-pointer select-none';
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
                    chCard.querySelector('.ch-checkbox').classList.remove('bg-brand-600', 'border-brand-600');
                    chCard.querySelector('.ch-checkbox').classList.add('bg-transparent', 'border-slate-300');
                    chCard.querySelector('.ch-checkbox i').classList.add('hidden');
                } else {
                    selectedChaptersList.add(uuid);
                    chCard.classList.add('selected');
                    chCard.querySelector('.ch-checkbox').classList.add('bg-brand-600', 'border-brand-600');
                    chCard.querySelector('.ch-checkbox').classList.remove('bg-transparent', 'border-slate-300');
                    chCard.querySelector('.ch-checkbox i').classList.remove('hidden');
                }
                updateSelectedChaptersUI();
            });

            mangaChapterList.appendChild(chCard);
        });
        lucide.createIcons();
    }

    // Update selection count
    function updateSelectedChaptersUI() {
        const count = selectedChaptersList.size;
        mangaSelectedCount.textContent = `${count} Chapters`;
        
        if (count > 0) {
            btnMangaDownloadZip.disabled = false;
            btnMangaImportPdf.disabled = false;
        } else {
            btnMangaDownloadZip.disabled = true;
            btnMangaImportPdf.disabled = true;
        }
    }

    // Select All
    btnMangaSelectAll.addEventListener('click', () => {
        if (!currentMangaData) return;
        document.querySelectorAll('.chapter-card').forEach(card => {
            const uuid = card.dataset.id;
            if (!selectedChaptersList.has(uuid)) {
                selectedChaptersList.add(uuid);
                card.classList.add('selected');
                card.querySelector('.ch-checkbox').classList.add('bg-brand-600', 'border-brand-600');
                card.querySelector('.ch-checkbox').classList.remove('bg-transparent', 'border-slate-300');
                card.querySelector('.ch-checkbox i').classList.remove('hidden');
            }
        });
        updateSelectedChaptersUI();
    });

    // Deselect All
    btnMangaDeselectAll.addEventListener('click', () => {
        selectedChaptersList.clear();
        document.querySelectorAll('.chapter-card').forEach(card => {
            card.classList.remove('selected');
            card.querySelector('.ch-checkbox').classList.remove('bg-brand-600', 'border-brand-600');
            card.querySelector('.ch-checkbox').classList.add('bg-transparent', 'border-slate-300');
            card.querySelector('.ch-checkbox i').classList.add('hidden');
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
                    card.querySelector('.ch-checkbox').classList.add('bg-brand-600', 'border-brand-600');
                    card.querySelector('.ch-checkbox').classList.remove('bg-transparent', 'border-slate-300');
                    card.querySelector('.ch-checkbox i').classList.remove('hidden');
                }
            }
        });
        updateSelectedChaptersUI();
    });

    // Sequential chapter downloads
    async function startChaptersDownloadSequence() {
        mangaDownloadProgressContainer.classList.remove('hidden');
        btnMangaFetch.disabled = true;
        btnMangaDownloadZip.disabled = true;
        btnMangaImportPdf.disabled = true;

        const queue = Array.from(selectedChaptersList);
        const total = queue.length;
        
        downloadedPagesMap.clear();

        for (let i = 0; i < total; i++) {
            const uuid = queue[i];
            const chCard = document.querySelector(`.chapter-card[data-id="${uuid}"]`);
            const chLabel = chCard ? chCard.querySelector('.font-bold').textContent : `Chapter ${i+1}`;
            
            mangaDownloadStatus.innerHTML = `<i data-lucide="loader" class="w-3.5 h-3.5 animate-spin"></i> កំពុងទាញយក (${i+1}/${total}): ${chLabel}...`;
            mangaDownloadDetails.textContent = `Fetching chapter pages data from server...`;
            
            const pct = Math.round((i / total) * 100);
            mangaDownloadBar.style.width = `${pct}%`;
            mangaDownloadPercent.textContent = `${pct}%`;
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
                    mangaDownloadDetails.textContent = `ជោគជ័យ៖ ទទួលបាន ${data.pages.length} ទំព័រ!`;
                    
                    if (chCard) {
                        const pageLabelEl = chCard.querySelector('.text-\\[10px\\]');
                        if (pageLabelEl) {
                            pageLabelEl.innerHTML = `<span class="text-emerald-500 dark:text-emerald-400 font-bold">✓ ${data.pages.length} ទំព័រ (រួចរាល់)</span>`;
                        }
                    }
                } else {
                    console.warn(`Chapter ${uuid} has no pages or failed:`, data.message);
                }
            } catch (err) {
                console.error(`Error downloading chapter ${uuid}:`, err);
                mangaDownloadDetails.textContent = `បរាជ័យ៖ មិនអាចទាញយកភាគនេះបានឡើយ (${err.message})`;
                alert(`បរាជ័យក្នុងការទាញយកភាគ៖ ${chLabel}`);
            }
        }

        // Complete Progress
        mangaDownloadBar.style.width = '100%';
        mangaDownloadPercent.textContent = '100%';
        mangaDownloadStatus.innerHTML = `<i data-lucide="check-circle" class="w-3.5 h-3.5 text-green-500"></i> ទាញយកបានជោគជ័យទាំងអស់!`;
        mangaDownloadDetails.textContent = `បានទាញយក ${downloadedPagesMap.size} ជំពូក រួចរាល់។`;
        lucide.createIcons();

        btnMangaFetch.disabled = false;
        btnMangaDownloadZip.disabled = false;
        btnMangaImportPdf.disabled = false;
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

        const allImagesData = [];
        for (const [chUuid, pages] of downloadedPagesMap.entries()) {
            const chCard = document.querySelector(`.chapter-card[data-id="${chUuid}"]`);
            const chNum = chCard ? chCard.dataset.chapter : 'ch';
            pages.forEach((p, idx) => {
                allImagesData.push({
                    name: `${currentMangaData.title}_Ch_${chNum}_Page_${idx + 1}.${p.name.split('.').pop()}`,
                    dataUrl: p.dataUrl
                });
            });
        }

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

    // Import downloaded images directly to PDF Creator
    // Import downloaded images directly to PDF Creator Library
    btnMangaImportPdf.addEventListener('click', async () => {
        if (downloadedPagesMap.size === 0) {
            await startChaptersDownloadSequence();
        }
        
        const allPagesForPdf = [];
        for (const [chUuid, pages] of downloadedPagesMap.entries()) {
            const chCard = document.querySelector(`.chapter-card[data-id="${chUuid}"]`);
            const chNum = chCard ? chCard.dataset.chapter : 'ch';
            
            pages.forEach((page, idx) => {
                const mimeMatch = page.dataUrl.match(/data:(.*?);base64/);
                const mime = mimeMatch ? mimeMatch[1] : 'image/png';
                const ext = mime.split('/')[1] || 'png';
                
                allPagesForPdf.push({
                    name: `${currentMangaData.title}_Ch_${chNum}_Page_${idx + 1}.${ext}`,
                    dataUrl: page.dataUrl
                });
            });
        }

        if (allPagesForPdf.length === 0) {
            alert('គ្មានទំព័ររូបភាពត្រូវបានទាញយកដើម្បីបញ្ជូនឡើយ!');
            return;
        }

        mangaDownloadStatus.innerHTML = `<i data-lucide="loader" class="w-3.5 h-3.5 animate-spin"></i> កំពុងចងក្រងជា PDF (Compiling PDF)...`;
        lucide.createIcons();
        
        const originalBtnHTML = btnMangaImportPdf.innerHTML;
        btnMangaImportPdf.innerHTML = `<i data-lucide="loader" class="w-4 h-4 animate-spin"></i> Compiling...`;
        btnMangaImportPdf.disabled = true;

        try {
            const formData = new FormData();
            const metadata = [];
            
            allPagesForPdf.forEach((page) => {
                const mimeMatch = page.dataUrl.match(/data:(.*?);base64/);
                const mime = mimeMatch ? mimeMatch[1] : 'image/png';
                const base64Data = page.dataUrl.split(',')[1];
                const binaryData = atob(base64Data);
                const array = [];
                for (let i = 0; i < binaryData.length; i++) {
                    array.push(binaryData.charCodeAt(i));
                }
                const blob = new Blob([new Uint8Array(array)], { type: mime });
                
                formData.append('images', blob, page.name);
                metadata.push({
                    filename: page.name,
                    rotation: 0
                });
            });

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
                    if (errJson && errJson.message) {
                        errorMsg = errJson.message;
                    }
                } catch (jsonErr) {}
                throw new Error(errorMsg);
            }

            const pdfBlob = await response.blob();
            
            // Deduce chapters label
            const chaptersArray = Array.from(selectedChaptersList).map(uuid => {
                const card = document.querySelector(`.chapter-card[data-id="${uuid}"]`);
                return card ? card.dataset.chapter : '';
            }).filter(Boolean);
            
            let chaptersLabel = '';
            if (chaptersArray.length > 0) {
                chaptersLabel = ` - Ch ${chaptersArray.join('_')}`;
            }
            
            const pdfName = `${currentMangaData.title}${chaptersLabel}.pdf`;
            
            // Save to IndexedDB
            const newId = await savePdfToDB(pdfName, pdfBlob);
            
            // Switch view & tab
            switchView('pdf-creator');
            switchTab('organize');
            
            await loadAndRenderPdfGrid();
            
            // Auto-select newly created PDF
            const pdfList = await loadPdfsFromDB();
            const targetPdf = pdfList.find(p => p.id === newId);
            if (targetPdf) {
                selectPdfFile(targetPdf);
            }

            mangaDownloadStatus.innerHTML = `<i data-lucide="check-circle" class="w-3.5 h-3.5 text-green-500"></i> បញ្ជូនទៅ PDF Creator រួចរាល់!`;
            lucide.createIcons();
            alert(`🎉 បានចងក្រង និងបញ្ជូនរឿង "${pdfName}" ទៅកាន់បណ្ណាល័យ PDF ដោយជោគជ័យ!`);
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
});
