
// ... imports
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Message, Suggestion, BuildState } from '../types';
import { Send, Sparkles, Square, RefreshCw, Wrench, Lightbulb, Paperclip, X, Image as ImageIcon, Wind, Loader2, AlertTriangle, Cloud, Wand2, Copy, MoreHorizontal, Clock, Check, Coins, CheckCircle2, XCircle, ChevronDown, ChevronUp } from 'lucide-react';
import ThinkingTerminal from './ThinkingTerminal';
import CloudConnectionTerminal from './CloudConnectionTerminal';
import { useTranslation } from '../utils/translations';
import { fileToBase64 } from '../services/cloudService';

interface ImageUpload {
  id: string;
  file: File;
  previewUrl: string;
  serverUrl?: string;
  base64?: string;
  uploading: boolean;
  error?: boolean;
}

interface ChatInterfaceProps {
  messages: Message[];
  onSendMessage: (content: string, images: { url: string; base64: string }[]) => void;
  onUploadImage?: (file: File) => Promise<string>;
  onStop: () => void;
  onRetry: (prompt: string) => void;
  onAutoFix: () => void;
  onClearBuildState?: () => void;
  onConnectDatabase?: () => void;
  isThinking: boolean;
  isAutoRepairing?: boolean;
  buildState: BuildState | null;
  suggestions: Suggestion[];
  isSuggestionsLoading: boolean;
  runtimeError?: string | null;
  cloudConnectionStatus?: 'idle' | 'provisioning' | 'waking' | 'success' | 'error';
  cloudConnectionError?: string | null;
  onCloudConnectRetry?: () => void;
  onClearCloudConnectionState?: () => void;
}

const SUCCESS_SOUND_URL = 'https://cdn.pixabay.com/audio/2022/03/15/audio_2b28b1e36c.mp3';

const MarkdownRenderer: React.FC<{ content: string }> = ({ content }) => {
  const parts = content.split(/(```[\s\S]*?```|`[^`]+`|\*\*[^*]+\*\*)/g);
  return (
    <div className="whitespace-pre-wrap leading-relaxed text-sm font-normal text-slate-700 dark:text-slate-200">
      {parts.map((part, index) => {
        if (part.startsWith('```') && part.endsWith('```')) {
          const code = part.slice(3, -3);
          return <pre key={index} className="bg-slate-50 dark:bg-slate-900/50 text-slate-800 dark:text-gray-300 p-3 rounded-lg my-2 overflow-x-auto text-xs font-mono border border-slate-100 dark:border-slate-800"><code>{code}</code></pre>;
        }
        if (part.startsWith('`') && part.endsWith('`')) return <code key={index} className="bg-slate-100 dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 px-1.5 py-0.5 rounded text-xs font-mono border border-slate-200 dark:border-transparent">{part.slice(1, -1)}</code>;
        if (part.startsWith('**') && part.endsWith('**')) return <strong key={index} className="text-slate-900 dark:text-white font-semibold">{part.slice(2, -2)}</strong>;
        return <span key={index}>{part}</span>;
      })}
    </div>
  );
};

// Helper for formatting execution time
const formatTime = (ms: number) => {
  if (!ms) return '—';
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${(ms / 1000).toFixed(1)}s`;
};

// Helper for formatting credits
const formatCredits = (credits: number) => {
  if (credits === undefined) return '—';
  if (credits === 0) return '0';
  return credits < 0.01 ? '< 0.01' : credits.toFixed(2);
};

const MessageActions: React.FC<{ msg: Message }> = ({ msg }) => {
    const [copied, setCopied] = useState(false);
    const [showMenu, setShowMenu] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    const handleCopy = () => {
        navigator.clipboard.writeText(msg.content);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setShowMenu(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    return (
        <div className="flex items-center gap-1 justify-end relative">
            <button 
                onClick={handleCopy} 
                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-white rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors relative"
                title={copied ? "Copied" : "Copy Message"}
            >
                {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
                {copied && <span className="absolute -top-8 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-[10px] px-2 py-1 rounded shadow-md whitespace-nowrap animate-in fade-in zoom-in-95">Copied</span>}
            </button>
            <div className="relative" ref={menuRef}>
                <button 
                    onClick={() => setShowMenu(!showMenu)} 
                    className={`p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-white rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors ${showMenu ? 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-white' : ''}`}
                >
                    <MoreHorizontal size={14} />
                </button>
                {showMenu && (
                    <div className="absolute bottom-full right-0 mb-2 w-48 bg-white dark:bg-[#1e293b] border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl p-3 z-50 animate-in fade-in zoom-in-95 origin-bottom-right">
                        <div className="space-y-3">
                            <div className="flex justify-between items-center text-xs">
                                <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                                    <Clock size={12} /> <span>Worked for</span>
                                </div>
                                <span className="font-mono font-medium text-slate-700 dark:text-slate-200">
                                    {msg.role === 'user' ? '—' : formatTime(msg.executionTimeMs || 0)}
                                </span>
                            </div>
                            <div className="h-px bg-slate-100 dark:bg-slate-800"></div>
                            <div className="flex justify-between items-center text-xs">
                                <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                                    <Coins size={12} /> <span>Credits used</span>
                                </div>
                                <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                                    {msg.role === 'user' ? '0' : formatCredits(msg.creditsUsed || 0)}
                                </span>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

const JobSummaryCard: React.FC<{ msg: Message }> = ({ msg }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const { jobSummary } = msg;

    if (!jobSummary) return null;

    const isSuccess = jobSummary.status === 'completed';
    const Icon = isSuccess ? CheckCircle2 : XCircle;
    const color = isSuccess ? 'emerald' : 'red';

    return (
        <div className="w-full max-w-lg my-4 animate-in fade-in duration-300 font-sans">
            <div className={`relative rounded-2xl border transition-all duration-300 bg-${color}-50/50 border-${color}-100 dark:bg-${color}-950/10 dark:border-${color}-900/30`}>
                <div 
                    className="p-4 flex items-center justify-between cursor-pointer hover:bg-slate-50/50 dark:hover:bg-slate-800/20 transition-colors"
                    onClick={() => setIsExpanded(!isExpanded)}
                >
                    <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-8 h-8 rounded-full bg-${color}-100 dark:bg-${color}-900/30 flex items-center justify-center text-${color}-500 shrink-0`}>
                            <Icon size={16} />
                        </div>
                        <div className="flex flex-col min-w-0">
                            <span className={`text-sm font-medium truncate text-${color}-800 dark:text-${color}-300`}>
                                {jobSummary.title}
                            </span>
                            <p className={`text-xs text-${color}-600 dark:text-${color}-400/80`}>{isSuccess ? 'Completed successfully' : 'Failed'}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-1 pl-2" onClick={e => e.stopPropagation()}>
                        <MessageActions msg={msg} />
                        {isExpanded ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
                    </div>
                </div>

                {isExpanded && (
                    <div className="px-4 pb-4 pt-0 border-t border-slate-100 dark:border-slate-800/50 animate-in slide-in-from-top-1">
                        {msg.content && (
                            <div className={`mt-3 p-3 rounded-lg text-xs ${isSuccess ? 'bg-slate-100 dark:bg-slate-800/50 text-slate-600 dark:text-slate-300' : 'bg-red-100/50 dark:bg-red-900/20 text-red-700 dark:text-red-300'}`}>
                                <MarkdownRenderer content={msg.content} />
                            </div>
                        )}
                        <div className="mt-3 space-y-2 pl-2 relative">
                            <div className="absolute left-[7px] top-2 bottom-2 w-px bg-slate-200 dark:bg-slate-800"></div>
                            {jobSummary.plan.map((step, index) => (
                                <div key={index} className="relative flex items-start gap-3 text-sm py-1 opacity-80">
                                    <div className={`mt-1 w-3.5 h-3.5 rounded-full border-2 shrink-0 z-10 flex items-center justify-center bg-white dark:bg-slate-900 ${isSuccess ? 'border-emerald-500 bg-emerald-500' : 'border-red-500 bg-red-500'}`}>
                                        {isSuccess ? <Check size={10} className="text-white" /> : <X size={10} className="text-white" />}
                                    </div>
                                    <span className="text-slate-600 dark:text-slate-400">{step}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

const ChatInterface: React.FC<ChatInterfaceProps> = ({ 
    messages, onSendMessage, onUploadImage, onStop, onRetry, onAutoFix, onClearBuildState, onConnectDatabase, isThinking, isAutoRepairing,
    buildState, suggestions, isSuggestionsLoading, runtimeError,
    cloudConnectionStatus = 'idle',
    cloudConnectionError,
    onCloudConnectRetry,
    onClearCloudConnectionState,
}) => {
  const [input, setInput] = useState('');
  const [stagedImages, setStagedImages] = useState<ImageUpload[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const successSoundRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const wasThinkingRef = useRef(false);
  const { t, dir } = useTranslation();

  useEffect(() => {
    successSoundRef.current = new Audio(SUCCESS_SOUND_URL);
    successSoundRef.current.volume = 0.5;
    successSoundRef.current.onerror = () => {
        successSoundRef.current = null;
    };
  }, []);

  useEffect(() => {
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  }, [messages, buildState, runtimeError, cloudConnectionStatus]);

  useEffect(() => {
    if (!isThinking && wasThinkingRef.current) {
        if (successSoundRef.current) {
            successSoundRef.current.play().catch(() => {});
        }
    }
    wasThinkingRef.current = isThinking;
  }, [isThinking]);

  // ... (Upload Logic preserved)
  const handleFileValidation = (file: File): boolean => {
      const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
      const maxSize = 10 * 1024 * 1024; // 10 MB
      if (!allowedTypes.includes(file.type)) {
          alert('Invalid file type. Please upload PNG, JPG, or WebP.');
          return false;
      }
      if (file.size > maxSize) {
          alert('File is too large. Maximum size is 10MB.');
          return false;
      }
      return true;
  };

  const addFilesToStage = async (files: File[]) => {
      const validFiles = Array.from(files).filter(handleFileValidation);
      if (validFiles.length === 0) return;

      const newUploads: ImageUpload[] = validFiles.map(file => ({
          id: crypto.randomUUID(),
          file,
          previewUrl: URL.createObjectURL(file),
          uploading: true
      }));

      setStagedImages(prev => [...prev, ...newUploads]);

      for (const upload of newUploads) {
          try {
              const base64 = await fileToBase64(upload.file);
              let serverUrl = upload.previewUrl; 
              if (onUploadImage) {
                 serverUrl = await onUploadImage(upload.file);
              }
              setStagedImages(prev => prev.map(p => p.id === upload.id ? { ...p, base64, serverUrl, uploading: false } : p));
          } catch (error) {
              setStagedImages(prev => prev.map(p => p.id === upload.id ? { ...p, uploading: false, error: true } : p));
          }
      }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) addFilesToStage(Array.from(e.target.files));
      if (fileInputRef.current) fileInputRef.current.value = '';
  };
  
  const removeStagedImage = (id: string) => {
      setStagedImages(prev => prev.filter(img => img.id !== id));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (stagedImages.some(img => img.uploading)) return;
    if ((input.trim() || stagedImages.length > 0) && !isThinking) {
      const validImages = stagedImages
        .filter(img => !img.error && img.serverUrl && img.base64)
        .map(img => ({ url: img.serverUrl!, base64: img.base64! }));
      onSendMessage(input.trim(), validImages);
      setInput('');
      setStagedImages([]);
    }
  };

  const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
  const handleRetryClick = () => lastUserMessage && onRetry(lastUserMessage.content);
  const handleSuggestionClick = (prompt: string) => { setInput(prompt); document.getElementById('chat-input')?.focus(); };
  
  const dropHandler = useCallback((ev: React.DragEvent<HTMLDivElement>) => {
    ev.preventDefault();
    setIsDragging(false);
    if (ev.dataTransfer.files) addFilesToStage(Array.from(ev.dataTransfer.files));
  }, []);
  
  const dragOverHandler = (ev: React.DragEvent<HTMLDivElement>) => {
    ev.preventDefault();
    setIsDragging(true);
  };
  
  const dragLeaveHandler = () => setIsDragging(false);
  const pasteHandler = useCallback((ev: ClipboardEvent) => {
    if (ev.clipboardData) {
      const items = Array.from(ev.clipboardData.items).filter(item => item.type.indexOf('image') !== -1);
      if (items.length > 0) {
        const files = items.map(item => item.getAsFile()).filter(Boolean) as File[];
        addFilesToStage(files);
      }
    }
  }, []);
  
  useEffect(() => {
    window.addEventListener('paste', pasteHandler);
    return () => window.removeEventListener('paste', pasteHandler);
  }, [pasteHandler]);

  const lastMessageIsError = messages.length > 0 && 
    messages[messages.length - 1].role === 'assistant' && 
    (messages[messages.length - 1].content.trim().toLowerCase().startsWith('error:') || (buildState?.error != null && !isThinking));

  const shouldShowBuildTerminal = isThinking || (buildState && buildState.plan.length > 0);
  const isUploading = stagedImages.some(img => img.uploading);

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-[#0f172a] relative transition-colors duration-300 font-sans" onDrop={dropHandler} onDragOver={dragOverHandler} onDragLeave={dragLeaveHandler} dir={dir}>
      {isDragging && (
        <div className="absolute inset-0 bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm z-30 flex flex-col items-center justify-center pointer-events-none">
            <div className="border-2 border-dashed border-indigo-400 rounded-3xl p-12 flex flex-col items-center">
                <ImageIcon size={48} className="text-indigo-500 mb-4" />
                <p className="font-semibold text-lg text-slate-800 dark:text-white">{t('dropImages')}</p>
            </div>
        </div>
      )}
      <div className="flex-1 overflow-y-auto p-4 space-y-6 scroll-smooth">
        {messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 dark:text-gray-500 opacity-60">
                <div className="w-16 h-16 bg-indigo-50 dark:bg-indigo-900/20 rounded-2xl flex items-center justify-center mb-4">
                    <Sparkles size={32} className="text-indigo-400" />
                </div>
                <p className="font-medium">{t('startBuilding')}</p>
            </div>
        )}
        
        {messages.map((msg) => (
          <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} group animate-in slide-in-from-bottom-2 fade-in duration-300`}>
             {msg.type === 'job_summary' ? (
                <JobSummaryCard msg={msg} />
             ) : (
                <div className={`max-w-[90%] text-sm ${ 
                    msg.role === 'user' 
                    ? 'bg-white dark:bg-[#1e293b] text-slate-800 dark:text-gray-100 rounded-2xl rounded-tr-none px-4 py-2.5 shadow-sm border border-slate-100 dark:border-slate-800' 
                    : 'bg-transparent text-slate-700 dark:text-gray-300 px-0 py-2'
                }`}>
                    {msg.images && msg.images.length > 0 && (
                        <div className={`grid gap-2 mb-3 ${msg.images.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                            {msg.images.map((img, idx) => (
                                <img key={idx} src={img} alt="attachment" className="rounded-xl w-full h-auto object-cover border border-slate-200 dark:border-slate-700 shadow-sm" />
                            ))}
                        </div>
                    )}
                    {msg.content && <MarkdownRenderer content={msg.content} />}
                    
                    {/* Actions Bar */}
                    <div className="mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <MessageActions msg={msg} />
                    </div>
                    
                    {msg.requiresAction === 'CONNECT_DATABASE' && onConnectDatabase && (
                        <div className="pt-3">
                            <button 
                                onClick={onConnectDatabase}
                                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium px-4 py-2 rounded-lg transition-all shadow-md shadow-indigo-500/20"
                            >
                                <Cloud size={14} />
                                {t('connectCloud')}
                            </button>
                        </div>
                    )}
                </div>
             )}
          </div>
        ))}
        
        {cloudConnectionStatus !== 'idle' && onClearCloudConnectionState && (
            <CloudConnectionTerminal
                status={cloudConnectionStatus}
                error={cloudConnectionError}
                onRetry={onCloudConnectRetry}
                onClose={onClearCloudConnectionState}
            />
        )}
        
        {cloudConnectionStatus === 'idle' && shouldShowBuildTerminal && (
          <ThinkingTerminal 
             isComplete={!isThinking} 
             plan={buildState?.plan || []} 
             currentStepIndex={buildState?.currentStep || 0} 
             error={buildState?.error || null} 
             onRetry={handleRetryClick}
             onClose={onClearBuildState}
             phases={buildState?.phases}
             currentPhaseIndex={buildState?.currentPhaseIndex}
          />
        )}

        {!isThinking && lastMessageIsError && (
            <div className="flex justify-start gap-2">
                 <button onClick={handleRetryClick} className="flex items-center gap-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 px-3 py-1.5 rounded-lg hover:border-indigo-300 hover:text-indigo-600 transition-colors"><RefreshCw size={12}/>{t('retry')}</button>
                 <button onClick={() => onAutoFix()} className="flex items-center gap-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 px-3 py-1.5 rounded-lg hover:border-indigo-300 hover:text-indigo-600 transition-colors"><Wrench size={12}/>{t('attemptFix')}</button>
            </div>
        )}

        {/* Minimal Auto-Healing Status */}
        {isAutoRepairing && (
             <div className="flex items-center gap-3 p-3 bg-white dark:bg-slate-900 border border-amber-100 dark:border-amber-900/30 rounded-xl shadow-sm animate-pulse max-w-sm">
                <div className="w-8 h-8 rounded-full bg-amber-50 dark:bg-amber-900/20 flex items-center justify-center shrink-0">
                    <Wand2 size={16} className="text-amber-500" />
                </div>
                <div>
                    <h4 className="text-sm font-medium text-slate-800 dark:text-white">{t('selfHealing')}</h4>
                    <p className="text-xs text-slate-500">Fixing runtime error...</p>
                </div>
            </div>
        )}

        {/* Minimal Runtime Error Status */}
        {!isThinking && runtimeError && !isAutoRepairing && (
            <div className="flex flex-col gap-2 p-3 bg-white dark:bg-slate-900 border border-red-100 dark:border-red-900/30 rounded-xl shadow-sm max-w-sm">
                <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-red-50 dark:bg-red-900/20 flex items-center justify-center shrink-0">
                        <AlertTriangle size={16} className="text-red-500" />
                    </div>
                    <div>
                        <h4 className="text-sm font-medium text-slate-800 dark:text-white">{t('runtimeError')}</h4>
                        <p className="text-xs text-slate-500 mt-1 line-clamp-2">{runtimeError}</p>
                    </div>
                </div>
                <button 
                    onClick={() => onAutoFix()}
                    className="self-end text-xs font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300 flex items-center gap-1 px-2 py-1"
                >
                    <Wrench size={12} /> {t('autoFixError')}
                </button>
            </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-4 bg-gradient-to-t from-slate-50 via-slate-50 to-transparent dark:from-[#0f172a] dark:via-[#0f172a] dark:to-transparent sticky bottom-0 z-20">
        
        {isSuggestionsLoading && !isThinking && suggestions.length === 0 && (
            <div className="mb-2 flex items-center gap-2 px-2 text-xs text-slate-400">
                <Loader2 size={12} className="animate-spin" />
                <span>{t('generatingSuggestions')}</span>
            </div>
        )}

        {suggestions.length > 0 && !isThinking && (
          <div className="mb-3 flex items-center gap-2 overflow-x-auto no-scrollbar pb-1 px-1">
              <div className="flex items-center gap-1.5 text-xs font-medium text-indigo-500 shrink-0 px-1"><Lightbulb size={12} /><span>{t('next')}</span></div>
              {suggestions.map((s, i) => (
                  <button key={i} onClick={() => handleSuggestionClick(s.prompt)} className="whitespace-nowrap bg-white dark:bg-[#1e293b] hover:border-indigo-300 dark:hover:border-indigo-500 hover:text-indigo-600 dark:hover:text-indigo-400 text-slate-600 dark:text-gray-400 border border-slate-200 dark:border-slate-700 rounded-full px-3 py-1.5 text-xs transition-all shadow-sm">
                      {s.title}
                  </button>
              ))}
          </div>
        )}
        
        <form onSubmit={handleSubmit} className="relative group bg-white dark:bg-[#1e293b] rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm focus-within:ring-2 focus-within:ring-indigo-500/20 focus-within:border-indigo-500/50 transition-all">
          {stagedImages.length > 0 && (
            <div className="p-2 border-b border-slate-100 dark:border-slate-800">
                <div className="flex gap-2 overflow-x-auto">
                    {stagedImages.map((img) => (
                        <div key={img.id} className="relative shrink-0 w-12 h-12 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700">
                            <img src={img.previewUrl} className={`w-full h-full object-cover ${img.uploading ? 'opacity-50' : ''}`} alt="preview" />
                            {img.uploading && <div className="absolute inset-0 flex items-center justify-center"><Loader2 className="animate-spin text-white" size={16} /></div>}
                            {img.error && <div className="absolute inset-0 flex items-center justify-center bg-red-500/50"><AlertTriangle className="text-white" size={16} /></div>}
                            <button type="button" onClick={() => removeStagedImage(img.id)} className="absolute top-0.5 right-0.5 bg-black/50 hover:bg-red-500 text-white rounded-full p-0.5"><X size={10} /></button>
                        </div>
                    ))}
                </div>
            </div>
          )}
          <div className="flex items-center pl-2 pr-2 py-1">
            <button type="button" onClick={() => fileInputRef.current?.click()} className="p-2 text-slate-400 hover:text-indigo-500 transition-colors rounded-full hover:bg-slate-100 dark:hover:bg-slate-800"><Paperclip size={18} /></button>
            <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="image/png, image/jpeg, image/webp" multiple className="hidden" />
            <input id="chat-input" type="text" dir="auto" value={input} onChange={(e) => setInput(e.target.value)} placeholder={t('placeholder')} disabled={isThinking} className="flex-1 bg-transparent text-slate-900 dark:text-white placeholder-slate-400 text-sm focus:outline-none px-2 py-3" />
            <div className="">{isThinking ? (<button type="button" onClick={onStop} className="p-2 text-slate-400 hover:text-red-500 transition-colors"><Square size={16} fill="currentColor" /></button>) : (<button type="submit" disabled={(!input.trim() && stagedImages.length === 0) || isUploading} className="p-2 bg-indigo-600 rounded-xl text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm"><Send size={16} className="rtl:rotate-180" /></button>)}</div>
          </div>
        </form>
      </div>
    </div>
  );
};
export default ChatInterface;
