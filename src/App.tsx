import React, { useState, useEffect, useCallback } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { 
  Upload, Download, Moon, Files, Layout, Settings, 
  Search, User, Trash2, FileText, ChevronRight, 
  HelpCircle, ExternalLink, Sliders, Menu, X,
  BookOpen, Brain, PencilLine, Sparkles, CheckCircle2,
  ChevronLeft, RefreshCcw, Lightbulb, Zap,
  ZoomIn, ZoomOut, Maximize, Minimize
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { db, type Artifact } from './lib/db';
import { PDFDocument } from 'pdf-lib';
import { generateStudyMaterial, type StudyMaterial } from './lib/gemini';

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

/**
 * NightPaper: A smart PDF dark mode reader for deep focus.
 */
export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [numPages, setNumPages] = useState<number | null>(null);
  const [contrast, setContrast] = useState(100);
  const [brightness, setBrightness] = useState(100);
  const [isSmartDark, setIsSmartDark] = useState(true);
  const [theme, setTheme] = useState<'soft' | 'pure' | 'sepia'>('soft');
  const [recentFiles, setRecentFiles] = useState<Artifact[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(false);
  const [windowWidth, setWindowWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1200);
  const [sessionId, setSessionId] = useState<string | null>(null);

  // New Obsidian AI States
  const [activeMode, setActiveMode] = useState<'read' | 'study' | 'practice'>('read');
  const [activeTab, setActiveTab] = useState<'summary' | 'keyPoints' | 'flashcards' | 'questions'>('summary');
  const [studyMaterial, setStudyMaterial] = useState<StudyMaterial | null>(null);
  const [isAIPreparing, setIsAIPreparing] = useState(false);
  
  // PDF View States
  const [scale, setScale] = useState(1.0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [loadedPages, setLoadedPages] = useState<number>(2); // Start by rendering 2 pages for speed
  
  // Flashcard State
  const [currentFlashcard, setCurrentFlashcard] = useState(0);
  const [isCardFlipped, setIsCardFlipped] = useState(false);
  
  // Practice State
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [showSolution, setShowSolution] = useState(false);
  const [score, setScore] = useState(0);

  // Theme presets
  useEffect(() => {
    if (theme === 'soft') {
      setContrast(100);
      setBrightness(100);
    } else if (theme === 'pure') {
      setContrast(110);
      setBrightness(90);
    } else if (theme === 'sepia') {
      setContrast(90);
      setBrightness(105);
      setIsSmartDark(false);
    }
  }, [theme]);

  // Initialize Sync Session
  useEffect(() => {
    let sid = localStorage.getItem('nightpaper_session_id');
    if (!sid) {
      sid = Math.random().toString(36).substring(7);
      localStorage.setItem('nightpaper_session_id', sid);
    }
    setSessionId(sid);
    
    // Attempt to load synced state
    const loadSync = async () => {
      try {
        const resp = await fetch(`/api/sync/load/${sid}`);
        if (!resp.ok) return; // Silent fail for load to not disrupt UX
        const data = await resp.json();
        if (data && typeof data === 'object') {
          if (data.contrast !== undefined) setContrast(data.contrast);
          if (data.brightness !== undefined) setBrightness(data.brightness);
          if (data.isSmartDark !== undefined) setIsSmartDark(data.isSmartDark);
        }
      } catch (e) { console.error("Sync load failed", e); }
    };
    loadSync();
  }, []);

  // Sync state to server on changes
  useEffect(() => {
    if (!sessionId) return;
    const saveSync = async () => {
      try {
        await fetch('/api/sync/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            data: { contrast, brightness, isSmartDark }
          })
        });
      } catch (e) { /* silent fail */ }
    };
    const timer = setTimeout(saveSync, 2000);
    return () => clearTimeout(timer);
  }, [contrast, brightness, isSmartDark, sessionId]);

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Load history from IndexedDB
  const refreshHistory = useCallback(async () => {
    const history = await db.artifacts.orderBy('id').reverse().limit(6).toArray();
    setRecentFiles(history);
  }, []);

  useEffect(() => {
    refreshHistory();
  }, [refreshHistory]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'AUTH_SUCCESS') {
        alert(`${event.data.provider} connected successfully! (Demo: file fetching logic would trigger here)`);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const initiateOAuth = async (provider: 'google') => {
    try {
      const resp = await fetch(`/api/auth/${provider}/url`);
      if (!resp.ok) {
        const errorData = await resp.json().catch(() => ({ error: 'Unknown server error' }));
        throw new Error(errorData.error || `Server returned ${resp.status}`);
      }
      const { url } = await resp.json();
      window.open(url, 'auth_popup', 'width=600,height=700');
    } catch (e: any) {
      console.error("OAuth initiation failed", e);
      alert(`Connection failed: ${e.message}`);
    }
  };

  const onFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFile = event.target.files?.[0];
    if (uploadedFile && uploadedFile.type === 'application/pdf') {
      setFile(uploadedFile);
      setStudyMaterial(null);
      setActiveMode('read');
      await db.artifacts.add({
        filename: uploadedFile.name,
        date: new Date().toLocaleDateString(),
        size: (uploadedFile.size / 1024 / 1024).toFixed(1) + ' MB',
        type: 'pdf'
      });
      refreshHistory();
    }
  };

  const handleStudyActivation = async () => {
    if (!file || studyMaterial) return;
    setIsAIPreparing(true);
    try {
      // In a real app we'd extract text from PDF, for now we simulate with the filename and context
      // You'd typically use a library like pdfjs-dist or a backend service for text extraction
      const materials = await generateStudyMaterial(`Subject: ${file.name}. 
        The student is reading a technical/educational document about this topic. 
        Please provide insightful study materials based on the likely content of such a file.`);
      setStudyMaterial(materials);
    } catch (e) {
      console.error("AI Generation failed", e);
    } finally {
      setIsAIPreparing(false);
    }
  };

  useEffect(() => {
    if (activeMode === 'study' && !studyMaterial && file && !isAIPreparing) {
      handleStudyActivation();
    }
  }, [activeMode, file]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && droppedFile.type === 'application/pdf') {
      setFile(droppedFile);
      await db.artifacts.add({
        filename: droppedFile.name,
        date: new Date().toLocaleDateString(),
        size: (droppedFile.size / 1024 / 1024).toFixed(1) + ' MB',
        type: 'pdf'
      });
      refreshHistory();
    }
  };

  const clearHistory = async () => {
    await db.artifacts.clear();
    refreshHistory();
  };

  const exportPDF = async () => {
    if (!file) return;
    setIsProcessing(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
      const outPdfDoc = await PDFDocument.create();

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 2 });

        // 1. Raw Render Canvas (Captures original PDF content on white)
        const rawCanvas = document.createElement('canvas');
        const rawCtx = rawCanvas.getContext('2d');
        if (!rawCtx) continue;

        rawCanvas.width = viewport.width;
        rawCanvas.height = viewport.height;

        // Ensure white background so inversion works correctly for both background and text
        rawCtx.fillStyle = 'white';
        rawCtx.fillRect(0, 0, rawCanvas.width, rawCanvas.height);

        await (page as any).render({
          canvasContext: rawCtx,
          viewport: viewport
        }).promise;

        // 2. Filter Canvas (Applies visual transforms to the raw render)
        const filterCanvas = document.createElement('canvas');
        const filterCtx = filterCanvas.getContext('2d');
        if (!filterCtx) continue;

        filterCanvas.width = viewport.width;
        filterCanvas.height = viewport.height;

        const filterString = isSmartDark 
          ? `invert(1) hue-rotate(180deg) contrast(${contrast}%) brightness(${brightness}%) saturate(1.2) contrast(1.1)`
          : `contrast(${contrast}%) brightness(${brightness}%)`;
        
        filterCtx.filter = filterString;
        filterCtx.imageSmoothingEnabled = true;
        filterCtx.imageSmoothingQuality = 'high';
        filterCtx.drawImage(rawCanvas, 0, 0);

        // 3. Embed into PDF
        const imageUri = filterCanvas.toDataURL('image/jpeg', 0.85);
        const imageBytes = await fetch(imageUri).then(res => res.arrayBuffer());
        const embeddedImage = await outPdfDoc.embedJpg(imageBytes);

        const newPage = outPdfDoc.addPage([viewport.width, viewport.height]);
        newPage.drawImage(embeddedImage, {
          x: 0,
          y: 0,
          width: viewport.width,
          height: viewport.height,
        });
      }

      const pdfBytes = await outPdfDoc.save();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `night_${file.name.replace('.pdf', '')}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to export PDF:', err);
      alert('Failed to generate dark mode PDF. Please try a smaller file.');
    } finally {
      setIsProcessing(false);
    }
  };

  useEffect(() => {
    if (file) {
      setLoadedPages(2);
      // Gradually load more pages to prevent frame drops
      const interval = setInterval(() => {
        setLoadedPages(prev => {
          if (numPages && prev < numPages) return Math.min(prev + 10, numPages);
          clearInterval(interval);
          return prev;
        });
      }, 300);
      return () => clearInterval(interval);
    }
  }, [file, numPages]);

  // Preview Filter Logic
  const filterStyle = isSmartDark 
    ? { 
        filter: `invert(1) hue-rotate(180deg) contrast(${contrast}%) brightness(${brightness}%)`,
        transition: 'filter 0.3s ease-out'
      } 
    : {
        filter: `contrast(${contrast}%) brightness(${brightness}%)`,
        transition: 'filter 0.3s ease-out'
    };

  return (
    <div className="flex h-screen overflow-hidden text-gray-400 font-sans relative bg-night-950">
      
      {/* Mobile Overlay */}
      <AnimatePresence>
        {(isSidebarOpen || isRightPanelOpen) && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => { setIsSidebarOpen(false); setIsRightPanelOpen(false); }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
          />
        )}
      </AnimatePresence>

      {/* --- LEFT SIDEBAR (READ MODE FOCUS) --- */}
      <AnimatePresence mode="popLayout">
        {activeMode === 'read' && (
          <motion.aside 
            initial={{ x: -20, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -300, opacity: 0 }}
            className={`fixed inset-y-0 left-0 w-72 border-r border-white/5 bg-night-900 p-6 flex flex-col justify-between transition-transform duration-300 z-50 lg:relative lg:translate-x-0 ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}
          >
            <div>
              <div className="flex items-center justify-between mb-10 text-white">
                <div className="flex items-center gap-2">
                  <div className="relative w-10 h-10 group">
                    <div className="relative w-full h-full bg-night-primary rounded-xl flex items-center justify-center border border-white/10">
                      <Moon size={22} className="text-white absolute -top-1 -right-1 rotate-12" />
                      <FileText size={18} className="text-white/90" />
                    </div>
                  </div>
                  <span className="font-bold text-xl tracking-tighter">Nightpaper</span>
                </div>
                <button onClick={() => setIsSidebarOpen(false)} className="lg:hidden p-2 -mr-2 text-gray-500 hover:text-white">
                  <X size={20} />
                </button>
              </div>
              
              <div className="space-y-8">
                {/* SECTION: APPEARANCE */}
                <section>
                  <h3 className="text-[10px] font-bold text-gray-600 uppercase tracking-widest px-1 mb-4 flex items-center gap-2">
                    <Layout size={12} /> Appearance
                  </h3>
                  <div className="space-y-5 px-1">
                    <SliderControl 
                      label="Text Brightness" 
                      value={brightness} 
                      onChange={setBrightness} 
                      min={70} max={100} 
                      leftLabel="Dim" rightLabel="Vivid"
                    />
                    <SliderControl 
                      label="Background Depth" 
                      value={100 - contrast} 
                      onChange={(v: number) => setContrast(100 - v)} 
                      min={0} max={30} 
                      leftLabel="Flat" rightLabel="Deep"
                    />
                  </div>
                </section>

                {/* SECTION: THEMES */}
                <section>
                  <h3 className="text-[10px] font-bold text-gray-600 uppercase tracking-widest px-1 mb-3 flex items-center gap-2">
                    <Moon size={12} /> Themes
                  </h3>
                  <div className="grid grid-cols-1 gap-2">
                    <ThemeButton active={theme === 'soft'} onClick={() => setTheme('soft')} label="Soft Dark" color="#1a1a1a" />
                    <ThemeButton active={theme === 'pure'} onClick={() => setTheme('pure')} label="Pure Black" color="#000000" />
                    <ThemeButton active={theme === 'sepia'} onClick={() => setTheme('sepia')} label="Sepia Focus" color="#3d2b1f" />
                  </div>
                </section>

                {/* SECTION: CONTROLS */}
                <section>
                   <h3 className="text-[10px] font-bold text-gray-600 uppercase tracking-widest px-1 mb-3 flex items-center gap-2">
                    <Settings size={12} /> Controls
                  </h3>
                  <div className="glass p-4 rounded-2xl">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-semibold text-gray-300">Smart Inversion</span>
                      <button 
                        onClick={() => setIsSmartDark(!isSmartDark)}
                        className={`w-10 h-5 rounded-full transition-all relative ${isSmartDark ? 'bg-night-primary' : 'bg-white/10'}`}
                      >
                        <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all transform ${isSmartDark ? 'translate-x-5.5' : 'translate-x-0.5'}`} />
                      </button>
                    </div>
                  </div>
                </section>

                {/* SECTION: EXPORT */}
                <section className="pt-4">
                  <button 
                    onClick={exportPDF}
                    disabled={!file || isProcessing}
                    className="w-full primary-gradient hover:opacity-90 disabled:bg-gray-800 disabled:text-gray-600 disabled:cursor-not-allowed text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-3 transition-all active:scale-[0.98]"
                  >
                    {isProcessing ? <RefreshCcw size={18} className="animate-spin" /> : <Download size={18} />}
                    <span>Download Dark PDF</span>
                  </button>
                </section>
              </div>
            </div>

            <div className="mt-8">
              <CloudConnectItem 
                provider="google" 
                label="Connected to Drive" 
                onConnect={() => initiateOAuth('google')} 
              />
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* --- MAIN WORKSPACE --- */}
      <main className="flex-1 flex flex-col relative overflow-hidden w-full">
        {/* GLOBAL NAVIGATION (TOP CENTERED) */}
        <header className="h-20 border-b border-white/5 flex items-center justify-between px-8 bg-night-950/80 backdrop-blur-md z-40">
          <div className="lg:hidden">
            {activeMode === 'read' && (
              <button 
                onClick={() => setIsSidebarOpen(true)}
                className="p-2.5 glass rounded-xl text-gray-400 hover:text-white transition"
              >
                <Menu size={20} />
              </button>
            )}
          </div>

          {/* MODE SWITCHER */}
          <div className="absolute left-1/2 -translate-x-1/2 flex bg-black/40 p-1 rounded-2xl border border-white/5 shadow-2xl scale-90 sm:scale-100">
            <ModeButton 
              active={activeMode === 'read'} 
              onClick={() => setActiveMode('read')} 
              icon={<BookOpen size={16} />} 
              label="Read Mode" 
            />
            <ModeButton 
              active={activeMode === 'study'} 
              onClick={() => setActiveMode('study')} 
              icon={<Brain size={16} />} 
              label="Study Mode" 
            />
            <ModeButton 
              active={activeMode === 'practice'} 
              onClick={() => setActiveMode('practice')} 
              icon={<PencilLine size={16} />} 
              label="Practice Mode" 
            />
          </div>

          <div className="flex items-center gap-3">
             <button className="p-2.5 glass rounded-full text-gray-400 hover:text-white transition hidden md:flex">
               <Search size={18} />
             </button>
             <button className="p-2.5 glass rounded-full text-gray-400 hover:text-white transition">
               <User size={18} />
             </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto custom-scrollbar relative">
          <AnimatePresence mode="wait">
            {!file ? (
              <motion.section 
                key="welcome"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="p-12 max-w-5xl mx-auto"
              >
                <div className="mb-12">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-night-primary-dim border border-night-primary/20 text-night-primary text-[10px] font-bold uppercase tracking-widest mb-6">
                    <Zap size={12} fill="currentColor" /> Welcome to Nightpaper
                  </div>
                  <h1 className="text-5xl md:text-7xl text-white font-bold tracking-tighter mb-6 leading-[0.9]">Elevate your <br/><span className="text-night-primary">learning.</span></h1>
                  <p className="text-gray-500 max-w-2xl text-lg md:text-xl leading-relaxed">
                    Transform static PDFs into interactive AI study systems. Read with comfort, study with focus, and practice with purpose.
                  </p>
                </div>

                {/* UPLOAD ZONE */}
                <label 
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  className="group relative block w-full aspect-[21/9] border-2 border-dashed border-white/10 rounded-[40px] hover:border-night-primary/50 transition-all cursor-pointer bg-white/[0.01] hover:bg-white/[0.02]"
                >
                  <input type="file" className="hidden" onChange={onFileChange} accept="application/pdf" />
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <motion.div 
                      whileHover={{ scale: 1.1 }}
                      className="w-20 h-20 glass rounded-3xl flex items-center justify-center mb-6"
                    >
                      <Upload className="text-night-primary" size={32} />
                    </motion.div>
                    <h3 className="text-white font-semibold text-2xl tracking-tight">Drop PDF to begin</h3>
                    <p className="text-gray-500 text-sm mt-2 font-medium">Auto-enhancement & Sync enabled</p>
                    <div className="mt-8 px-10 py-4 primary-gradient text-white rounded-2xl font-bold transition-all active:scale-95">
                      Select Documents
                    </div>
                  </div>
                </label>

                {/* RECENT GRID */}
                {recentFiles.length > 0 && (
                  <div className="mt-20">
                    <div className="flex justify-between items-center mb-8">
                       <h2 className="text-xs font-bold uppercase tracking-widest text-gray-500">Recent Artifacts</h2>
                       <button onClick={clearHistory} className="text-xs text-gray-600 hover:text-red-400 transition-colors font-bold uppercase tracking-tighter">
                         Clear Archive
                       </button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      {recentFiles.map((f, idx) => (
                        <motion.div 
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: idx * 0.05 }}
                          key={f.id} 
                          className="group glass p-5 rounded-3xl hover:bg-white/[0.06] transition-all cursor-pointer"
                        >
                          <div className="aspect-video bg-black/40 rounded-2xl mb-4 flex items-center justify-center border border-white/5 opacity-50 group-hover:opacity-100 transition-opacity">
                             <FileText size={32} className="text-night-primary" />
                          </div>
                          <p className="text-white text-sm font-bold truncate mb-1">{f.filename}</p>
                          <p className="text-[10px] text-gray-600 font-bold uppercase">{f.date} • {f.size}</p>
                        </motion.div>
                      ))}
                    </div>
                  </div>
                )}
              </motion.section>
            ) : (
              <div className="h-full">
                {/* MODE: READ */}
                <AnimatePresence>
                  {activeMode === 'read' && (
                    <motion.div 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="h-full flex flex-col items-center p-8 md:p-12"
                    >
                      <div className="w-full max-w-5xl flex flex-col md:flex-row justify-between items-start md:items-center mb-10 px-4 gap-4">
                        <div className="flex flex-col">
                           <h2 className="text-white font-bold text-2xl tracking-tight mb-1 truncate max-w-[300px] md:max-w-md">{file.name}</h2>
                           <div className="flex items-center gap-3">
                              <span className="text-[10px] font-bold text-gray-600 uppercase tracking-widest">Enhanced Mode Active</span>
                              <div className="w-1 h-1 rounded-full bg-night-primary" />
                              <span className="text-[10px] font-bold text-gray-600 uppercase tracking-widest">{numPages} Pages Detected</span>
                           </div>
                        </div>
                        <button 
                          onClick={() => setFile(null)} 
                          className="px-5 py-2.5 glass rounded-xl text-gray-400 hover:text-white text-xs font-bold transition flex items-center gap-2"
                        >
                          <ChevronLeft size={14} /> Back to Library
                        </button>
                      </div>

                      <div className={`relative group no-select w-full flex flex-col items-center ${isFullscreen ? 'fixed inset-0 z-[60] bg-night-950 overflow-y-auto p-4 md:p-12 pb-32' : 'mb-24'}`}>
                        {/* FLOATING TOOLBAR */}
                        <div className={`sticky top-6 mb-8 glass px-4 py-2 rounded-2xl flex items-center gap-4 shadow-2xl z-50 border-white/10`}>
                           <button onClick={() => setScale(Math.max(0.5, scale - 0.1))} className="p-2 text-gray-500 hover:text-night-primary transition"><ZoomOut size={18} /></button>
                           <div className="w-[1px] h-4 bg-white/10" />
                           <span className="text-xs font-mono font-bold text-gray-400 min-w-[3rem] text-center">{Math.round(scale * 100)}%</span>
                           <div className="w-[1px] h-4 bg-white/10" />
                           <button onClick={() => setScale(Math.min(2.5, scale + 0.1))} className="p-2 text-gray-500 hover:text-night-primary transition"><ZoomIn size={18} /></button>
                           <div className="w-[1px] h-6 bg-white/10 mx-2" />
                           <button onClick={() => setIsFullscreen(!isFullscreen)} className="p-2 text-gray-500 hover:text-night-primary transition">
                             {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
                           </button>
                        </div>

                        <div 
                          className="shadow-2xl rounded-sm overflow-hidden flex flex-col gap-4" 
                          style={{ 
                            ...filterStyle, 
                            colorScheme: 'light',
                            forcedColorAdjust: 'none'
                          } as any}
                        >
                          <Document 
                            file={file} 
                            onLoadSuccess={({ numPages: pages }) => setNumPages(pages)}
                            loading={<LoadingState />}
                          >
                            {Array.from(new Array(loadedPages), (el, index) => (
                              <Page 
                                key={`page_${index + 1}`}
                                pageNumber={index + 1} 
                                scale={scale}
                                width={Math.min(windowWidth - (windowWidth < 1024 ? 40 : 400), 900)} 
                                renderTextLayer={false} 
                                renderAnnotationLayer={false}
                                className="pointer-events-none mb-4 shadow-xl last:mb-0" 
                              />
                            ))}
                          </Document>
                        </div>
                        
                        {!isFullscreen && (
                          <div className="mt-12 text-[10px] font-bold text-gray-600 uppercase tracking-widest flex items-center gap-2">
                             Full Document Loaded <div className="w-1 h-1 rounded-full bg-white/10" /> Scroll to Read
                          </div>
                        )}
                      </div>

                      {/* AI SUGGESTION TOAST */}
                      <motion.div 
                        initial={{ y: 50, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        className="fixed bottom-10 left-1/2 -translate-x-1/2 glass px-6 py-4 rounded-3xl flex items-center gap-4 shadow-2xl z-30 border-night-primary/20"
                      >
                         <div className="p-2 bg-night-primary-dim rounded-xl text-night-primary">
                           <Lightbulb size={20} />
                         </div>
                         <div>
                            <p className="text-sm text-white font-bold">Ready to understand faster?</p>
                            <p className="text-xs text-gray-500">Gemini AI is ready to summarize this for you.</p>
                         </div>
                         <button 
                            onClick={() => setActiveMode('study')}
                            className="px-4 py-2 bg-night-primary text-white text-xs font-bold rounded-xl hover:opacity-90 transition shadow-lg shadow-night-primary/20"
                          >
                            Activate Study Mode
                         </button>
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* MODE: STUDY */}
                <AnimatePresence>
                  {activeMode === 'study' && (
                    <motion.div 
                      initial={{ opacity: 0, scale: 1.02 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.98 }}
                      className="h-full flex flex-col p-8 lg:p-16 max-w-5xl mx-auto"
                    >
                      {isAIPreparing ? (
                        <div className="flex-1 flex flex-col items-center justify-center space-y-6">
                           <motion.div 
                              animate={{ rotate: 360 }}
                              transition={{ duration: 4, repeat: Infinity, ease: 'linear' }}
                              className="w-16 h-16 border-2 border-night-primary/20 border-t-night-primary rounded-full"
                           />
                           <div className="text-center">
                             <h2 className="text-white text-2xl font-bold mb-2">Analyzing Document...</h2>
                             <p className="text-gray-500 italic">Gemini is extracting key concepts and generating insights.</p>
                           </div>
                        </div>
                      ) : studyMaterial ? (
                        <div className="space-y-12">
                          {/* TAB CONTROLS */}
                          <div className="flex justify-center gap-2 bg-black/40 p-1.5 rounded-2xl border border-white/5 w-fit mx-auto shadow-xl">
                            <TabButton active={activeTab === 'summary'} onClick={() => setActiveTab('summary')} label="Summary" />
                            <TabButton active={activeTab === 'keyPoints'} onClick={() => setActiveTab('keyPoints')} label="Key Points" />
                            <TabButton active={activeTab === 'flashcards'} onClick={() => setActiveTab('flashcards')} label="Flashcards" />
                            <TabButton active={activeTab === 'questions'} onClick={() => setActiveTab('questions')} label="Practice Questions" />
                          </div>

                          <div className="min-h-[500px]">
                            <AnimatePresence mode="wait">
                              {activeTab === 'summary' && (
                                <motion.div 
                                  key="summary"
                                  initial={{ opacity: 0, y: 10 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  exit={{ opacity: 0, y: -10 }}
                                  className="glass-dark p-8 md:p-12 rounded-[40px] shadow-2xl border-white/5"
                                >
                                  <h2 className="text-3xl font-serif text-white mb-8 italic tracking-tight underline decoration-night-primary/30 underline-offset-8">Executive Summary</h2>
                                  <div className="text-gray-300 text-lg leading-relaxed space-y-6">
                                    {studyMaterial.summary.split('\n\n').map((p, i) => <p key={i}>{p}</p>)}
                                  </div>
                                </motion.div>
                              )}

                              {activeTab === 'keyPoints' && (
                                <motion.div 
                                  key="keypoints"
                                  initial={{ opacity: 0, y: 10 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  exit={{ opacity: 0, y: -10 }}
                                  className="grid grid-cols-1 md:grid-cols-2 gap-6"
                                >
                                  {studyMaterial.keyPoints.map((point, idx) => (
                                    <div key={idx} className="glass p-6 rounded-3xl border-l-4 border-l-night-primary hover:bg-white/[0.05] transition-colors">
                                      <div className="text-night-primary mb-3">
                                        <CheckCircle2 size={24} />
                                      </div>
                                      <p className="text-white font-medium text-lg tracking-tight">{point}</p>
                                    </div>
                                  ))}
                                </motion.div>
                              )}

                              {activeTab === 'flashcards' && (
                                <motion.div 
                                  key="flashcards"
                                  initial={{ opacity: 0, y: 10 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  exit={{ opacity: 0, y: -10 }}
                                  className="flex flex-col items-center space-y-12"
                                >
                                  <div className="w-full flex justify-between items-center px-4">
                                     <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">Mastery Level</span>
                                     <span className="text-xs font-bold text-night-primary uppercase tracking-widest">{currentFlashcard + 1} / {studyMaterial.flashcards.length} Mastered</span>
                                  </div>
                                  <div className="w-full bg-white/5 h-1.5 rounded-full overflow-hidden">
                                    <motion.div 
                                      animate={{ width: `${((currentFlashcard + 1) / studyMaterial.flashcards.length) * 100}%` }}
                                      className="bg-night-primary h-full"
                                    />
                                  </div>

                                  {/* FLASHCARD */}
                                  <div className="relative w-full aspect-[16/10] max-w-2xl group cursor-pointer" onClick={() => setIsCardFlipped(!isCardFlipped)}>
                                    <div className={`w-full h-full transition-all duration-700 [transform-style:preserve-3d] ${isCardFlipped ? '[transform:rotateY(180deg)]' : ''}`}>
                                      {/* FRONT */}
                                      <div className="absolute inset-0 backface-hidden glass-dark rounded-[40px] flex flex-col items-center justify-center p-12 text-center border-white/10 shadow-2xl">
                                         <span className="text-[10px] font-bold text-night-primary uppercase tracking-[0.3em] mb-6">{studyMaterial.flashcards[currentFlashcard].concept}</span>
                                         <h3 className="text-4xl font-serif text-white italic">{studyMaterial.flashcards[currentFlashcard].question}</h3>
                                         <div className="mt-12 p-3 bg-white/5 rounded-full text-gray-500 group-hover:text-night-primary transition-colors">
                                           <RefreshCcw size={20} />
                                         </div>
                                      </div>
                                      {/* BACK */}
                                      <div className="absolute inset-0 backface-hidden [transform:rotateY(180deg)] glass p-12 rounded-[40px] flex flex-col items-center justify-center text-center border-night-primary/20 shadow-2xl">
                                        <p className="text-2xl text-gray-100 leading-relaxed font-medium">
                                          {studyMaterial.flashcards[currentFlashcard].answer}
                                        </p>
                                      </div>
                                    </div>
                                  </div>

                                  <div className="flex gap-4">
                                     <FlashcardAction icon={<RefreshCcw size={18} />} label="Repeat" onClick={() => { setIsCardFlipped(false); setCurrentFlashcard((prev) => (prev + 1) % studyMaterial.flashcards.length); }} />
                                     <FlashcardAction icon={<Zap size={18} />} label="Hard" onClick={() => { setIsCardFlipped(false); setCurrentFlashcard((prev) => (prev + 1) % studyMaterial.flashcards.length); }} />
                                     <FlashcardAction active icon={<CheckCircle2 size={18} />} label="Easy" onClick={() => { setIsCardFlipped(false); setCurrentFlashcard((prev) => (prev + 1) % studyMaterial.flashcards.length); }} />
                                  </div>
                                </motion.div>
                              )}

                              {activeTab === 'questions' && (
                                <motion.div 
                                  key="questions"
                                  initial={{ opacity: 0, y: 10 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  exit={{ opacity: 0, y: -10 }}
                                  className="space-y-6 pb-20"
                                >
                                  {studyMaterial.questions.map((q, i) => (
                                    <details key={i} className="group glass rounded-3xl open:bg-white/[0.06] transition-all">
                                      <summary className="flex justify-between items-center p-6 list-none cursor-pointer">
                                        <div className="flex items-center gap-4">
                                           <div className="w-8 h-8 rounded-full bg-night-primary/10 text-night-primary flex items-center justify-center font-bold text-xs">
                                             Q{i + 1}
                                           </div>
                                           <p className="text-white font-medium text-lg pr-4">{q.question}</p>
                                        </div>
                                        <div className="text-gray-600 group-open:rotate-180 transition-transform">
                                          <ChevronRight size={20} />
                                        </div>
                                      </summary>
                                      <div className="px-6 pb-6 pt-2 border-t border-white/5 space-y-4">
                                         <div className="p-4 bg-night-primary-dim rounded-2xl border border-night-primary/10">
                                            <p className="text-night-primary font-bold text-xs uppercase mb-1">Answer</p>
                                            <p className="text-white font-medium">{q.answer}</p>
                                         </div>
                                         <p className="text-gray-500 text-sm leading-relaxed">{q.explanation}</p>
                                      </div>
                                    </details>
                                  ))}
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>

                          {/* START PRACTICE BOX */}
                          <motion.div 
                            initial={{ opacity: 0, scale: 0.95 }}
                            whileInView={{ opacity: 1, scale: 1 }}
                            className="glass-dark p-8 rounded-[40px] flex flex-col md:flex-row items-center justify-between gap-8 border-night-primary/20 shadow-2xl"
                          >
                             <div className="flex items-center gap-6 text-center md:text-left">
                               <div className="w-16 h-16 bg-night-primary rounded-full flex items-center justify-center shadow-2xl shadow-night-primary/40 animate-pulse">
                                 <Zap size={32} fill="white" className="text-white" />
                               </div>
                               <div>
                                 <h3 className="text-2xl text-white font-bold mb-1">Ready to test yourself?</h3>
                                 <p className="text-gray-500">Practice under simulated exam conditions to lock in your knowledge.</p>
                               </div>
                             </div>
                             <button 
                                onClick={() => setActiveMode('practice')}
                                className="px-8 py-4 primary-gradient text-white rounded-[24px] font-bold shadow-xl shadow-night-primary/20 hover:scale-105 active:scale-95 transition-all"
                              >
                                Try Practice Mode
                             </button>
                          </motion.div>
                        </div>
                      ) : (
                        <div className="flex-1 flex flex-col items-center justify-center">
                           <button onClick={handleStudyActivation} className="px-8 py-4 primary-gradient text-white rounded-3xl font-bold">
                             Generate Study Pack
                           </button>
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* MODE: PRACTICE */}
                <AnimatePresence>
                   {activeMode === 'practice' && (
                     <motion.div 
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 1.1 }}
                      className="h-full flex flex-col p-8 lg:p-24 items-center"
                     >
                        {!studyMaterial ? (
                           <div className="flex flex-col items-center gap-6">
                              <Brain size={64} className="text-gray-800" />
                              <p className="text-gray-500 font-bold uppercase tracking-widest text-center">Generate study materials first <br/> to access practice mode</p>
                              <button onClick={() => setActiveMode('study')} className="px-6 py-3 glass rounded-2xl text-white font-bold">Go to Study Mode</button>
                           </div>
                        ) : (
                          <div className="w-full max-w-2xl space-y-12">
                             <div className="flex justify-between items-end">
                                <div className="space-y-1">
                                  <p className="text-[10px] font-bold text-gray-600 uppercase tracking-widest">Progress</p>
                                  <h2 className="text-white text-3xl font-bold tracking-tighter">Question {currentQuestion + 1} <span className="text-gray-700">/ {studyMaterial.questions.length}</span></h2>
                                </div>
                                <div className="text-right">
                                   <p className="text-[10px] font-bold text-gray-600 uppercase tracking-widest">Accuracy</p>
                                   <p className="text-night-primary font-mono text-2xl font-bold">{Math.round((score / (currentQuestion || 1)) * 100)}%</p>
                                </div>
                             </div>

                             <div className="w-full bg-white/5 h-2 rounded-full overflow-hidden">
                                <motion.div 
                                  animate={{ width: `${((currentQuestion + 1) / studyMaterial.questions.length) * 100}%` }}
                                  className="primary-gradient h-full"
                                />
                             </div>

                             <motion.div 
                                key={currentQuestion}
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                className="glass-dark p-12 rounded-[50px] shadow-3xl border-white/5 relative overflow-hidden"
                             >
                                <div className="absolute top-0 left-0 w-full h-1 bg-night-primary opacity-20" />
                                <h3 className="text-3xl text-white font-serif italic mb-12 leading-tight pr-6">
                                  {studyMaterial.questions[currentQuestion].question}
                                </h3>

                                <div className="space-y-4">
                                   {studyMaterial.questions[currentQuestion].options.map((option, oIdx) => (
                                     <button 
                                        key={oIdx}
                                        onClick={() => !showSolution && setSelectedOption(option)}
                                        className={`w-full p-6 rounded-[24px] text-left transition-all flex items-center justify-between group
                                          ${selectedOption === option ? 'bg-night-primary text-white shadow-xl shadow-night-primary/20' : 'bg-white/[0.03] text-gray-400 hover:bg-white/[0.06]'}
                                          ${showSolution && option === studyMaterial.questions[currentQuestion].answer ? 'ring-2 ring-emerald-500 bg-emerald-500/10' : ''}
                                          ${showSolution && selectedOption === option && option !== studyMaterial.questions[currentQuestion].answer ? 'ring-2 ring-red-500 bg-red-500/10' : ''}
                                          ${showSolution ? 'cursor-default' : ''}
                                        `}
                                     >
                                        <span className="flex items-center gap-4">
                                          <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs ring-1 transition-all ${selectedOption === option ? 'bg-white/20 ring-white/50' : 'bg-white/5 ring-white/10 group-hover:bg-white/10'}`}>
                                            {String.fromCharCode(65 + oIdx)}
                                          </div>
                                          <span className="font-semibold">{option}</span>
                                        </span>
                                        {showSolution && option === studyMaterial.questions[currentQuestion].answer && <CheckCircle2 className="text-emerald-500" />}
                                     </button>
                                   ))}
                                </div>
                             </motion.div>

                             <div className="flex justify-between items-center pt-4">
                                <button 
                                  onClick={() => setShowSolution(!showSolution)}
                                  className="text-xs font-bold uppercase tracking-widest text-gray-500 hover:text-white flex items-center gap-2 transition-colors"
                                >
                                  <Lightbulb size={16} /> {showSolution ? 'Hide Solution' : 'Show Solution'}
                                </button>
                                <button 
                                  disabled={!selectedOption}
                                  onClick={() => {
                                    if (selectedOption === studyMaterial.questions[currentQuestion].answer) setScore(score + 1);
                                    if (currentQuestion < studyMaterial.questions.length - 1) {
                                      setCurrentQuestion(currentQuestion + 1);
                                      setSelectedOption(null);
                                      setShowSolution(false);
                                    } else {
                                      alert(`Session Complete! Your score: ${score + (selectedOption === studyMaterial.questions[currentQuestion].answer ? 1 : 0)} / ${studyMaterial.questions.length}`);
                                      setActiveMode('study');
                                    }
                                  }}
                                  className="px-10 py-5 primary-gradient text-white rounded-3xl font-bold flex items-center gap-2 group transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                >
                                  Next Question <ChevronRight className="group-hover:translate-x-1 transition-transform" />
                                </button>
                             </div>
                             {showSolution && (
                               <motion.div 
                                 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                                 className="glass p-6 rounded-3xl border-l-4 border-emerald-500/50"
                               >
                                 <p className="text-xs font-bold text-emerald-500 uppercase mb-2">Internal Logic</p>
                                 <p className="text-sm text-gray-400 italic font-medium">{studyMaterial.questions[currentQuestion].explanation}</p>
                               </motion.div>
                             )}
                          </div>
                        )}
                     </motion.div>
                   )}
                </AnimatePresence>
              </div>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* FOOTER MINI STATS */}
      <footer className="fixed bottom-6 right-8 z-30 pointer-events-none">
        <div className="glass px-5 py-3 rounded-2xl flex items-center gap-6 shadow-2xl border-white/5 opacity-40 hover:opacity-100 transition-opacity pointer-events-auto group">
           <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest whitespace-nowrap">Local Node Active</span>
           </div>
           <div className="h-3 w-[1px] bg-white/10" />
           <div className="text-[10px] font-mono text-gray-600">ID: {sessionId?.substring(0, 8)}</div>
        </div>
      </footer>
    </div>
  );
}

// Added Helper Components
function ModeButton({ active, onClick, icon, label }: any) {
  return (
    <button 
      onClick={onClick}
      className={`flex items-center gap-2 px-4 md:px-6 py-2.5 md:py-3 rounded-xl font-bold text-xs transition-colors ${active ? 'bg-night-primary text-white' : 'text-gray-500 hover:text-gray-200'}`}
    >
      {icon} <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function TabButton({ active, onClick, label }: any) {
  return (
    <button 
      onClick={onClick}
      className={`px-6 py-2 rounded-xl text-xs font-bold transition-colors ${active ? 'bg-night-primary text-white' : 'text-gray-500 hover:text-white'}`}
    >
      {label}
    </button>
  );
}

function ThemeButton({ active, onClick, label, color }: any) {
  return (
    <button 
      onClick={onClick}
      className={`w-full flex items-center justify-between p-3 rounded-2xl border transition-colors ${active ? 'border-night-primary bg-night-primary-dim' : 'border-white/5 hover:bg-white/[0.03]'}`}
    >
      <div className="flex items-center gap-3">
        <div className="w-5 h-5 rounded-lg border border-white/10" style={{ backgroundColor: color }} />
        <span className={`text-xs font-semibold ${active ? 'text-night-primary' : 'text-gray-400'}`}>{label}</span>
      </div>
      {active && <div className="w-1.5 h-1.5 rounded-full bg-night-primary" />}
    </button>
  );
}

function FlashcardAction({ icon, label, onClick, active = false }: any) {
  return (
    <button 
      onClick={onClick}
      className={`flex flex-col items-center gap-3 px-8 py-6 rounded-3xl transition-colors border ${active ? 'glass border-night-primary/30 text-night-primary shadow-xl shadow-night-primary/10' : 'glass border-white/5 text-gray-400 hover:text-white'}`}
    >
      {icon}
      <span className="text-[10px] font-bold uppercase tracking-widest leading-none">{label}</span>
    </button>
  );
}

function CloudConnectItem({ provider, label, onConnect }: { provider: string, label: string, onConnect: () => void }) {
  return (
    <div 
      onClick={onConnect}
      className="flex items-center justify-between px-3 py-2.5 rounded-xl cursor-pointer hover:bg-white/5 group transition-colors"
    >
      <div className="flex items-center gap-3">
        <div className={`w-2 h-2 rounded-full ${provider === 'google' ? 'bg-yellow-400' : 'bg-emerald-400'}`} />
        <span className="text-sm font-semibold text-gray-500 group-hover:text-white">{label}</span>
      </div>
      <ExternalLink size={12} className="text-gray-700 group-hover:text-night-primary" />
    </div>
  );
}

function SliderControl({ label, value, onChange, min, max, leftLabel, rightLabel }: any) {
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center text-white">
        <label className="text-[11px] font-bold text-gray-500 uppercase tracking-tight">{label}</label>
        <span className="text-[10px] text-night-primary font-mono bg-night-primary/10 px-1.5 py-0.5 rounded-md">{value}%</span>
      </div>
      <input 
        type="range" 
        className="w-full h-1 bg-white/5 rounded-full appearance-none cursor-pointer accent-night-primary transition-all border-none outline-none ring-0"
        min={min} max={max} value={value}
        onChange={(e) => onChange(parseInt(e.target.value))}
      />
      <div className="flex justify-between text-[9px] text-gray-600 font-bold uppercase tracking-tighter">
        <span>{leftLabel}</span>
        <span>{rightLabel}</span>
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center p-20 text-gray-500">
      <div className="w-10 h-10 border-2 border-night-primary/20 border-t-night-primary rounded-full animate-spin mb-4" />
      <p className="text-sm font-medium animate-pulse">Analyzing Document...</p>
    </div>
  );
}
