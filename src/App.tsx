import React, { useState, useEffect, useCallback } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { 
  Upload, Download, Moon, Files, Layout, Settings, 
  Search, User, Trash2, FileText, ChevronRight, 
  HelpCircle, ExternalLink, Sliders
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { db, type Artifact } from './lib/db';
import { PDFDocument } from 'pdf-lib';

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
  const [recentFiles, setRecentFiles] = useState<Artifact[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Load history from IndexedDB
  const refreshHistory = useCallback(async () => {
    const history = await db.artifacts.orderBy('id').reverse().limit(6).toArray();
    setRecentFiles(history);
  }, []);

  useEffect(() => {
    refreshHistory();
  }, [refreshHistory]);

  const onFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFile = event.target.files?.[0];
    if (uploadedFile && uploadedFile.type === 'application/pdf') {
      setFile(uploadedFile);
      await db.artifacts.add({
        filename: uploadedFile.name,
        date: new Date().toLocaleDateString(),
        size: (uploadedFile.size / 1024 / 1024).toFixed(1) + ' MB',
        type: 'pdf'
      });
      refreshHistory();
    }
  };

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
          ? `invert(1) hue-rotate(180deg) contrast(${contrast}%) brightness(${brightness}%)`
          : `contrast(${contrast}%) brightness(${brightness}%)`;
        
        filterCtx.filter = filterString;
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
    <div className="flex h-screen overflow-hidden text-gray-400 font-sans">
      
      {/* --- LEFT SIDEBAR --- */}
      <aside className="w-64 border-r border-white/5 bg-night-900 p-6 flex flex-col justify-between">
        <div>
          <div className="flex items-center gap-2 mb-10 text-white">
            <div className="w-9 h-9 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Moon size={20} fill="white" />
            </div>
            <span className="font-bold text-lg tracking-tight">NightPaper</span>
          </div>
          
          <nav className="space-y-1">
            <h3 className="text-[10px] font-bold text-gray-600 uppercase tracking-widest px-3 mb-3">The Archive</h3>
            <SidebarItem icon={<Files size={18}/>} label="Library" active />
            <SidebarItem icon={<Layout size={18}/>} label="Recent" />
            <SidebarItem icon={<Settings size={18}/>} label="Preferences" />
          </nav>

          <nav className="mt-10 space-y-1">
            <h3 className="text-[10px] font-bold text-gray-600 uppercase tracking-widest px-3 mb-3">Community</h3>
            <SidebarItem icon={<HelpCircle size={18}/>} label="Support" />
            <SidebarItem icon={<ExternalLink size={18}/>} label="Extension" />
          </nav>
        </div>

        <div className="bg-white/[0.03] p-4 rounded-2xl border border-white/5">
          <div className="flex justify-between text-[10px] mb-2 uppercase font-bold text-gray-500">
            <span>Local Cache</span>
            <span>{(recentFiles.reduce((acc, f) => acc + parseFloat(f.size), 0)).toFixed(1)}MB</span>
          </div>
          <div className="w-full bg-white/10 h-1 rounded-full overflow-hidden">
            <div className="bg-indigo-500 h-full w-[35%]"></div>
          </div>
        </div>
      </aside>

      {/* --- MAIN CANVAS --- */}
      <main className="flex-1 flex flex-col bg-night-950 relative overflow-hidden">
        {/* Header bar */}
        <header className="h-16 border-b border-white/5 flex items-center justify-between px-8 bg-night-950/80 backdrop-blur-md z-10">
          <div className="flex gap-8 text-sm font-medium">
            <button className={`${!file ? 'text-white border-b-2 border-indigo-500' : 'text-gray-500 hover:text-white'} transition py-5 px-1 underline-offset-[20px]`} onClick={() => setFile(null)}>
              Enhance
            </button>
            <button className="text-gray-500 hover:text-white transition py-5">History</button>
            <button className="text-gray-500 hover:text-white transition py-5">Settings</button>
          </div>
          <div className="flex items-center gap-4">
            <div className="bg-white/5 rounded-full px-4 py-1.5 flex items-center gap-2 border border-white/5 text-sm ring-1 ring-white/5">
              <Search size={14} className="text-gray-500" />
              <input 
                className="bg-transparent border-none outline-none text-white w-48 placeholder:text-gray-600" 
                placeholder="Search documents..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <button className="p-2 hover:bg-white/5 rounded-full transition text-gray-500">
              <User size={20} />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-12 custom-scrollbar scroll-smooth">
          <AnimatePresence mode="wait">
            {!file ? (
              <motion.section 
                key="dropzone"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.4 }}
              >
                <div className="mb-12">
                  <h1 className="text-4xl text-white font-bold tracking-tight mb-3">Prepare for Focus</h1>
                  <p className="text-gray-500 max-w-xl text-lg">Invert your technical documents for high-clarity nocturnal reading. Everything happens in your browser.</p>
                </div>

                {/* UPLOAD ZONE */}
                <label 
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  className="group relative block w-full aspect-[21/9] border-2 border-dashed border-white/10 rounded-[40px] hover:border-indigo-500/50 transition-all cursor-pointer bg-white/[0.01] hover:bg-white/[0.02]"
                >
                  <input type="file" className="hidden" onChange={onFileChange} accept="application/pdf" />
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <motion.div 
                      whileHover={{ scale: 1.1 }}
                      className="w-20 h-20 bg-white/5 rounded-3xl flex items-center justify-center mb-6 border border-white/5"
                    >
                      <Upload className="text-indigo-500" size={32} />
                    </motion.div>
                    <h3 className="text-white font-semibold text-2xl tracking-tight">Drop PDF to begin</h3>
                    <p className="text-gray-500 text-sm mt-2 font-medium">Maximum file size: 128MB per document</p>
                    <div className="mt-8 px-8 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl font-bold transition-all shadow-xl shadow-indigo-600/20 active:scale-95">
                      Select Document
                    </div>
                  </div>
                </label>

                {/* RECENT GRID */}
                <div className="mt-20">
                  <div className="flex justify-between items-center mb-8">
                    <div className="flex items-center gap-2">
                       <h2 className="text-xs font-bold uppercase tracking-widest text-gray-500">Recent Artifacts</h2>
                       <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
                    </div>
                    <button 
                      onClick={clearHistory}
                      className="text-xs text-gray-600 hover:text-red-400 flex items-center gap-1.5 transition-colors font-bold uppercase tracking-tighter"
                    >
                      Clear All <Trash2 size={12} />
                    </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {recentFiles.map((f, idx) => (
                      <motion.div 
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: idx * 0.1 }}
                        key={f.id} 
                        className="group bg-white/5 p-5 rounded-3xl border border-white/5 hover:bg-white/[0.08] transition-all cursor-pointer"
                      >
                        <div className="aspect-[4/3] bg-[#080808] rounded-2xl mb-5 flex items-center justify-center text-gray-800 border border-white/5 group-hover:border-indigo-500/20 transition-colors">
                           <FileText size={48} className="opacity-10 group-hover:opacity-20 transition-opacity" />
                        </div>
                        <div className="flex justify-between items-start">
                          <div className="max-w-[80%]">
                            <p className="text-white text-sm font-bold truncate mb-1">{f.filename}</p>
                            <p className="text-[11px] text-gray-500 font-medium">{f.date} • {f.size}</p>
                          </div>
                          <div className="p-2 bg-white/5 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity">
                            <ChevronRight size={14} className="text-indigo-400" />
                          </div>
                        </div>
                      </motion.div>
                    ))}
                    {recentFiles.length === 0 && (
                      <div className="col-span-full py-12 text-center border border-dashed border-white/5 rounded-3xl">
                        <p className="text-gray-600 text-sm italic">No recent documents found.</p>
                      </div>
                    )}
                  </div>
                </div>
              </motion.section>
            ) : (
              /* PDF PREVIEW MODE */
              <motion.div 
                key="preview"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                className="flex flex-col items-center pb-24"
              >
                <div className="w-full flex justify-between items-center mb-8 px-4">
                   <div className="flex flex-col">
                      <h2 className="text-white font-bold text-xl mb-1">{file.name}</h2>
                      <p className="text-gray-500 text-sm">Enhanced Preview • Rendered locally</p>
                   </div>
                   <button 
                      onClick={() => setFile(null)} 
                      className="px-4 py-2 bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white rounded-xl text-sm font-bold transition flex items-center gap-2"
                   >
                     Upload New <Upload size={14} />
                   </button>
                </div>

                <div className="relative group">
                  <div 
                    className="bg-white shadow-2xl rounded-sm overflow-hidden ring-1 ring-white/10" 
                    style={filterStyle}
                  >
                    <Document 
                      file={file} 
                      onLoadSuccess={({ numPages: pages }) => setNumPages(pages)}
                      loading={<LoadingState />}
                    >
                      <Page 
                        pageNumber={1} 
                        width={Math.min(window.innerWidth - 600, 800)} 
                        renderTextLayer={false} 
                        renderAnnotationLayer={false} 
                      />
                    </Document>
                  </div>
                  
                  <div className="absolute -bottom-10 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest whitespace-nowrap">
                        Displaying Page 1 of {numPages} • Smart Filter Active
                      </p>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* --- RIGHT ADJUSTMENT PANEL --- */}
      <aside className="w-80 border-l border-white/5 p-8 flex flex-col bg-night-900">
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-600 mb-8">Document Context</h3>
        
        <div className="space-y-6 mb-12">
          <ContextItem label="Title" value={file ? file.name : "NightPaper_Guide.pdf"} />
          <div className="grid grid-cols-2 gap-4">
            <ContextItem label="Total Pages" value={numPages || "—"} />
            <ContextItem label="File Size" value={file ? (file.size / 1024 / 1024).toFixed(1) + "MB" : "—"} />
          </div>
        </div>

        <div className="flex items-center gap-2 mb-6">
           <Sliders size={12} className="text-indigo-500" />
           <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-600">Visual Engine</h3>
        </div>
        
        <div className="bg-white/[0.03] p-5 rounded-3xl border border-white/10 mb-8">
          <div className="flex justify-between items-center mb-2">
            <div className="flex flex-col">
               <span className="text-white text-sm font-bold tracking-tight">Smart Dark</span>
               <span className="text-[10px] text-gray-500 font-medium">OLED Background Inversion</span>
            </div>
            <button 
              onClick={() => setIsSmartDark(!isSmartDark)}
              className={`w-11 h-6 rounded-full transition-all duration-300 relative ${isSmartDark ? 'bg-indigo-600' : 'bg-white/10'}`}
            >
              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow-md transition-all duration-300 transform ${isSmartDark ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>
        </div>

        <div className="space-y-8 mb-12">
          <SliderControl 
            label="Canvas Contrast" 
            value={contrast} 
            onChange={setContrast} 
            min={50} max={150} 
            leftLabel="Soft Gray" 
            rightLabel="High Contrast" 
          />
          <SliderControl 
            label="Global Brightness" 
            value={brightness} 
            onChange={setBrightness} 
            min={20} max={120} 
            leftLabel="Dim" 
            rightLabel="Vivid" 
          />
        </div>

        <button 
          onClick={exportPDF}
          disabled={!file || isProcessing}
          className="mt-auto w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-800 disabled:text-gray-600 disabled:cursor-not-allowed text-white font-bold py-5 rounded-2xl shadow-2xl shadow-indigo-600/20 flex items-center justify-center gap-3 transition-all active:scale-[0.98]"
        >
          {isProcessing ? (
            <span className="animate-pulse">Processing...</span>
          ) : (
            <>
              <Download size={18} />
              <span>Finalize Artifact</span>
            </>
          )}
        </button>
        <p className="text-[10px] text-gray-600 text-center mt-4 uppercase font-bold tracking-tighter italic">
          High fidelity local processing enabled
        </p>
      </aside>
    </div>
  );
}

// Helper Components
function SidebarItem({ icon, label, active = false }: { icon: React.ReactNode, label: string, active?: boolean }) {
  return (
    <div className={`flex items-center gap-3.5 px-3 py-2.5 rounded-xl cursor-pointer transition-all duration-200 group ${active ? 'bg-indigo-600/10 text-indigo-400' : 'text-gray-500 hover:text-white hover:bg-white/5'}`}>
      <span className={`${active ? 'text-indigo-400' : 'group-hover:text-white transition-colors'}`}>
        {icon}
      </span> 
      <span className="text-sm font-semibold tracking-tight">{label}</span>
      {active && <div className="ml-auto w-1 h-1 rounded-full bg-indigo-400" />}
    </div>
  );
}

function ContextItem({ label, value }: { label: string, value: string | number }) {
  return (
    <div>
      <div className="text-[10px] text-gray-600 font-bold uppercase tracking-widest mb-1.5">{label}</div>
      <div className="text-sm text-gray-300 font-bold truncate tracking-tight">{value}</div>
    </div>
  );
}

function SliderControl({ label, value, onChange, min, max, leftLabel, rightLabel }: any) {
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center text-white">
        <label className="text-[11px] font-bold text-gray-500 uppercase tracking-tight">{label}</label>
        <span className="text-[10px] text-indigo-400 font-mono bg-indigo-500/10 px-1.5 py-0.5 rounded-md">{value}%</span>
      </div>
      <input 
        type="range" 
        className="w-full h-1 bg-white/5 rounded-full appearance-none cursor-pointer accent-indigo-500 hover:accent-indigo-400 transition-all border-none outline-none ring-0"
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
      <div className="w-10 h-10 border-2 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin mb-4" />
      <p className="text-sm font-medium animate-pulse">Rendering Artifact...</p>
    </div>
  );
}
