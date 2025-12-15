
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Project, Message, ViewMode, User, Suggestion, BuildState } from '../types';
import { generateProjectTitle, generateSuggestions, handleUserIntent } from '../services/geminiService';
import { cloudService } from '../services/cloudService';
import { rafieiCloudService } from '../services/rafieiCloudService';
import { vercelService } from '../services/vercelService';
import { useTranslation } from '../utils/translations';
import { useTheme } from '../utils/theme';
import PreviewCanvas from './PreviewCanvas';
import ChatInterface from './ChatInterface';
import CodeEditor from './CodeEditor';
import PublishDropdown from './PublishDropdown';
import ManageDomainsModal from './ManageDomainsModal';
import { 
    Loader2, ArrowLeft, PanelLeft, Monitor, Tablet, Smartphone, 
    Check, Cloud, MessageSquare, Eye, Globe, X, LayoutDashboard, 
    ExternalLink, Power 
} from 'lucide-react';

interface ProjectBuilderProps {
    user: User;
}

type DeviceMode = 'desktop' | 'tablet' | 'mobile';

const MAX_AUTO_REPAIRS = 3;

const ProjectBuilder: React.FC<ProjectBuilderProps> = ({ user }) => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  
  const [buildState, setBuildState] = useState<BuildState | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [isSuggestionsLoading, setIsSuggestionsLoading] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [pendingPrompt, setPendingPrompt] = useState<{ content: string; images: { url: string; base64: string }[] } | null>(null);
  const [deploying, setDeploying] = useState(false);

  const projectRef = useRef<Project | null>(null);
  const lastSuggestionMessageIdRef = useRef<string | null>(null);
  const failedSuggestionAttemptsRef = useRef<Record<string, number>>({});
  
  const connectingRef = useRef(false);
  const autoRepairAttemptsRef = useRef(0);
  const isAutoFixingRef = useRef(false);
  const isUserStoppedRef = useRef(false);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoStartRef = useRef(false); // To prevent double triggers
  
  const [viewMode, setViewMode] = useState<ViewMode>('preview');
  const [mobileTab, setMobileTab] = useState<'chat' | 'preview'>('chat');
  const [deviceMode, setDeviceMode] = useState<DeviceMode>('desktop');
  
  const [showPublishDropdown, setShowPublishDropdown] = useState(false);
  const [showManageDomains, setShowManageDomains] = useState(false);
  
  const [showCloudDetails, setShowCloudDetails] = useState(false);
  const [localCloudError, setLocalCloudError] = useState<string | null>(null);

  const [sidebarWidth, setSidebarWidth] = useState(400);
  const [isResizing, setIsResizing] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const desktopPublishRef = useRef<HTMLDivElement>(null);
  const mobilePublishRef = useRef<HTMLDivElement>(null);

  const { t, dir } = useTranslation();
  const { theme, toggleTheme } = useTheme();
  
  const isMobile = typeof window !== 'undefined' ? window.innerWidth < 768 : false;
  
  const cloudStatus = project?.rafieiCloudProject?.status || 'idle';
  const isCloudActive = cloudStatus === 'ACTIVE';
  const isConnectingCloud = cloudStatus === 'CREATING';
  
  const uiCloudStatus: 'idle' | 'provisioning' | 'waking' | 'success' | 'error' = 
    localCloudError ? 'error' :
    cloudStatus === 'CREATING' ? 'provisioning' :
    cloudStatus === 'FAILED' ? 'error' : 
    'idle';

  const isBuilding = project?.status === 'generating';
  const isThinking = isBuilding || isConnectingCloud;
  const isAutoRepairing = isBuilding && isAutoFixingRef.current;
  
  const isFirstGeneration = isBuilding && project ? (!project.code.html && !project.code.javascript) : false;
  const isUpdating = isBuilding && !isFirstGeneration;

  // Use Vercel URL if available and not currently generating new code
  const previewUrl = (!isBuilding && project?.vercelConfig?.productionUrl) ? project.vercelConfig.productionUrl : undefined;

  const startResizing = useCallback(() => { setIsResizing(true); }, []);
  const stopResizing = useCallback(() => { setIsResizing(false); }, []);

  const resize = useCallback((mouseMoveEvent: MouseEvent) => {
      if (isResizing) {
          const newWidth = mouseMoveEvent.clientX;
          if (newWidth > 300 && newWidth < 800) {
              setSidebarWidth(newWidth);
          }
      }
  }, [isResizing]);

  useEffect(() => {
      if (isResizing) {
          window.addEventListener("mousemove", resize);
          window.addEventListener("mouseup", stopResizing);
          document.body.style.userSelect = 'none';
          document.body.style.cursor = 'col-resize';
      } else {
          window.removeEventListener("mousemove", resize);
          window.removeEventListener("mouseup", stopResizing);
          document.body.style.userSelect = '';
          document.body.style.cursor = '';
      }
      return () => {
          window.removeEventListener("mousemove", resize);
          window.removeEventListener("mouseup", stopResizing);
          document.body.style.userSelect = '';
          document.body.style.cursor = '';
      };
  }, [isResizing, resize, stopResizing]);

  // SAFETY WATCHDOG
  useEffect(() => {
      if (isBuilding && buildState && buildState.plan.length === 0) {
          if (watchdogRef.current) clearTimeout(watchdogRef.current);
          watchdogRef.current = setTimeout(() => {
              console.warn("Watchdog triggered: Stuck in analysis phase. Forcing restart...");
              if (project) {
                  const errorMsg: Message = {
                      id: crypto.randomUUID(),
                      role: 'assistant',
                      content: `Analysis timed out. Retrying with a simplified build plan...`,
                      timestamp: Date.now()
                  };
                  const updated = { ...project, messages: [...project.messages, errorMsg] };
                  setProject(updated);
                  
                  const lastUserMsg = [...project.messages].reverse().find(m => m.role === 'user');
                  if (lastUserMsg) {
                      handleSendMessage(lastUserMsg.content, [], updated, true);
                  }
              }
          }, 60000); 
      } else {
          if (watchdogRef.current) clearTimeout(watchdogRef.current);
      }
      return () => { if (watchdogRef.current) clearTimeout(watchdogRef.current); };
  }, [isBuilding, buildState?.plan.length]);

  useEffect(() => {
      projectRef.current = project;
      
      // Auto-start build for fresh skeleton projects
      if (project && project.status === 'idle' && project.messages.length === 1 && project.messages[0].role === 'user' && !project.code.javascript && !autoStartRef.current) {
          autoStartRef.current = true;
          const prompt = project.messages[0].content;
          const images = project.messages[0].images?.map(url => ({ url, base64: '' })) || [];
          console.log("Auto-triggering initial build for new project...");
          handleSendMessage(prompt, images, project, true); 
      }

      if (project?.rafieiCloudProject?.status === 'ACTIVE' && pendingPrompt) {
          const promptToExecute = { ...pendingPrompt };
          setPendingPrompt(null); 

          const successMsg: Message = {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: "✅ **Rafiei Cloud Connected**\n\nDatabase is ready. Resuming your build request...",
            timestamp: Date.now()
          };
          
          const updated = { ...project, messages: [...project.messages, successMsg] };
          setProject(updated);
          cloudService.saveProject(updated);

          setTimeout(() => {
              handleSendMessage(promptToExecute.content, promptToExecute.images, updated, true);
          }, 1000);
      }

  }, [project, pendingPrompt]); 

  const fetchProject = async () => {
      if (!projectId) return;
      try {
          const p = await cloudService.getProject(projectId);
          if (p) {
              setProject(p);
              setBuildState(p.buildState || null);
              if (p.rafieiCloudProject && p.rafieiCloudProject.status === 'CREATING') {
                  rafieiCloudService.monitorProvisioning(p.rafieiCloudProject, p.id);
              }
          } else {
              navigate('/dashboard');
          }
      } catch (err) {
          console.error("Failed to load project:", err);
          navigate('/dashboard');
      } finally {
          setLoading(false);
      }
  };
  
  useEffect(() => {
    fetchProject();
    setSuggestions([]);
    lastSuggestionMessageIdRef.current = null;
    failedSuggestionAttemptsRef.current = {};
    connectingRef.current = false;
    autoRepairAttemptsRef.current = 0;
    isAutoFixingRef.current = false;
    isUserStoppedRef.current = false;
    autoStartRef.current = false;
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    const { unsubscribe } = cloudService.subscribeToProjectChanges(projectId, (updatedProject) => {
      setProject(updatedProject);
      setBuildState(updatedProject.buildState || null);
    });
    return () => unsubscribe();
  }, [projectId]);

  const handleStop = async () => {
    isUserStoppedRef.current = true;
    if (isConnectingCloud && project?.rafieiCloudProject) {
        rafieiCloudService.cancelMonitoring(project.rafieiCloudProject.id);
        setPendingPrompt(null);
        connectingRef.current = false;
        const cancelMsg: Message = { id: crypto.randomUUID(), role: 'assistant', content: "🛑 Cloud connection cancelled.", timestamp: Date.now() };
        const updated = { ...project, rafieiCloudProject: undefined, messages: [...project.messages, cancelMsg], updatedAt: Date.now() };
        setProject(updated);
        setBuildState(null);
        await cloudService.saveProject(updated);
        return;
    }
    if (isBuilding && project) {
        cloudService.stopBuild(project.id);
        const stopped = { ...project, status: 'idle' as const, updatedAt: Date.now() };
        setProject(stopped);
        cloudService.saveProject(stopped);
    }
  };

  const handleRetry = (prompt: string) => {
      if(project) {
          const updated = { ...project, messages: project.messages.slice(0, -1), updatedAt: Date.now() };
          setProject(updated); 
          cloudService.saveProject(updated).then(() => { handleSendMessage(prompt, []); });
      }
  };
  
  const handleAutoFix = () => {
      if (project) {
          const prompt = runtimeError ? `I encountered a runtime error: "${runtimeError}". Please fix it.` : "The code has an error. Fix it.";
          isAutoFixingRef.current = true;
          handleSendMessage(prompt, [], project, false, true);
          setRuntimeError(null);
      }
  };
  
  const handleClearBuildState = async () => {
      if (project) {
          const updated = { ...project, buildState: null };
          setProject(updated); setBuildState(null);
          await cloudService.saveProject(updated);
      }
  };
  
  const handleUploadImage = async (file: File): Promise<string> => {
      if (!project) throw new Error("No project context");
      const tempId = crypto.randomUUID(); 
      return await cloudService.uploadChatImage(project.userId, tempId, file);
  };

  const handleClearCloudConnectionState = () => { setLocalCloudError(null); connectingRef.current = false; };
  const handleCloudConnectRetry = () => { connectingRef.current = false; handleConnectCloud(project, pendingPrompt || undefined); };
  
  const handleConnectCloud = async (startProject?: Project, resumePrompt?: any) => {
    const currentProject = startProject || project;
    if (!currentProject || connectingRef.current) return;
    connectingRef.current = true;
    setLocalCloudError(null);
    try {
        await rafieiCloudService.provisionProject(user, currentProject);
    } catch (error: any) {
        connectingRef.current = false;
        setLocalCloudError(error.message);
        const failMsg: Message = { id: crypto.randomUUID(), role: 'assistant', content: `❌ Failed: ${error.message}`, timestamp: Date.now() };
        const withError = { ...currentProject, messages: [...currentProject.messages, failMsg] };
        setProject(withError);
        await cloudService.saveProject(withError);
    }
  };

  // --- MAIN SEND MESSAGE ---
  const handleSendMessage = async (content: string, images: { url: string, base64: string }[], projectOverride?: Project, isInitialAutoStart = false, isAutoFix = false) => {
    const currentProject = projectOverride || projectRef.current;
    
    if (!currentProject || !user || (currentProject.status === 'generating' && !projectOverride && !isInitialAutoStart)) return;

    setSuggestions([]);
    handleClearCloudConnectionState();
    setRuntimeError(null);
    isUserStoppedRef.current = false;

    if (!isAutoFix && !isInitialAutoStart) {
        autoRepairAttemptsRef.current = 0;
        isAutoFixingRef.current = false;
    }

    let updatedProject = currentProject;

    if (!isInitialAutoStart) {
        const userMsg: Message = {
            id: crypto.randomUUID(),
            role: 'user',
            content,
            timestamp: Date.now(),
            images: images.map(i => i.url) 
        };
        updatedProject = { 
            ...currentProject, 
            messages: [...currentProject.messages, userMsg],
            updatedAt: Date.now() 
        };
        setProject(updatedProject);
    }

    const initialLogs = ["Initiating build process...", "Analyzing request...", "Preparing environment..."];
    setBuildState({
        plan: [],
        phases: [],
        currentPhaseIndex: 0,
        currentStep: 0,
        lastCompletedStep: -1,
        error: null,
        logs: initialLogs
    });

    try {
        let projectToBuild = { ...updatedProject };
        
        if (projectToBuild.messages.filter(m => m.role === 'user').length === 1) {
            const title = await generateProjectTitle(content);
            projectToBuild.name = title;
        }

        projectToBuild.status = 'generating';
        projectToBuild.updatedAt = Date.now(); 
        
        projectToBuild.buildState = {
            ...(buildState || { plan: [], phases: [], currentPhaseIndex: 0, currentStep: 0, lastCompletedStep: -1, error: null }),
            logs: [...initialLogs]
        };

        setProject(projectToBuild); 

        const handleLocalStateUpdate = (updatedState: Project) => {
            setProject(prev => {
                if (!prev || prev.id !== updatedState.id) return prev;
                return updatedState;
            });
            setBuildState(updatedState.buildState || null);
        };

        const handleNarratorMessage = (msg: Message) => {
             setProject(prev => {
                 if (!prev) return null;
                 if (prev.messages.some(m => m.id === msg.id)) return prev;
                 return { ...prev, messages: [...prev.messages, msg] };
             });
        };

        await cloudService.triggerBuild(projectToBuild, content, images, 
            (updatedState) => {
                handleLocalStateUpdate(updatedState);
                
                // --- AUTO DEPLOY TO VERCEL ON COMPLETION ---
                if (updatedState.status === 'idle' && updatedState.buildState?.error === null) {
                    setDeploying(true);
                    vercelService.publishProject(updatedState).then(deployment => {
                        const finalProject = { ...updatedState, vercelConfig: deployment };
                        setProject(finalProject);
                        cloudService.saveProject(finalProject);
                        setDeploying(false);
                    }).catch(e => {
                        console.warn("Auto-deploy failed", e);
                        setDeploying(false);
                    });
                }
            }, 
            handleNarratorMessage
        );

    } catch (e: any) {
        console.error("Handle Message Error", e);
        setBuildState(prev => prev ? ({...prev, error: `Error: ${e.message}`}) : null);
        const errorMsg: Message = { id: crypto.randomUUID(), role: 'assistant', content: `Error: ${e.message}`, timestamp: Date.now() };
        const finalProject = { ...updatedProject, messages: [...updatedProject.messages, errorMsg], status: 'idle' as const };
        setProject(finalProject);
        await cloudService.saveProject(finalProject);
    }
  };

  if (loading) return <div className="h-screen flex items-center justify-center bg-slate-50 dark:bg-[#0f172a] text-slate-800 dark:text-white"><Loader2 className="animate-spin" size={32} /></div>;
  if (!project) return null;

  const deviceSizeClass = deviceMode === 'desktop' ? 'w-full h-full' : deviceMode === 'tablet' ? 'w-[768px] h-full max-w-full mx-auto' : 'w-[375px] h-[667px] max-w-full mx-auto';
  const hasCloudProject = project.rafieiCloudProject != null && project.rafieiCloudProject.status === 'ACTIVE';
  
  return (
    <div className="flex flex-col h-screen bg-white dark:bg-[#0f172a] text-slate-900 dark:text-white overflow-hidden transition-colors duration-300" dir={dir}>
        {/* Header */}
        <div className="hidden md:flex h-14 bg-white dark:bg-[#0f172a] border-b border-slate-200 dark:border-slate-700 items-center justify-between px-4 z-20 shrink-0">
            <div className="flex items-center gap-2">
                <button onClick={() => navigate('/dashboard')} className="p-2 hover:bg-slate-100 dark:hover:bg-gray-800 rounded-lg text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white transition-colors flex items-center gap-2">
                    <ArrowLeft size={18} /><span className="text-sm font-medium hidden sm:inline">Dashboard</span>
                </button>
                <div className="h-6 w-px bg-slate-200 dark:bg-gray-700 hidden sm:block"></div>
                <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className={`p-2 rounded-lg transition-colors ${isSidebarOpen ? 'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/20' : 'text-slate-500 dark:text-gray-400 hover:bg-slate-100 dark:hover:bg-gray-800'}`}><PanelLeft size={18} /></button>
                <h1 className="font-semibold text-slate-800 dark:text-gray-200 truncate max-w-[150px] md:max-w-md hidden sm:block">{project.name}</h1>
                {deploying && <span className="text-xs text-indigo-500 flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Deploying Preview...</span>}
            </div>
            <div className="flex-1 flex justify-center items-center gap-4">
                <div className="hidden md:flex bg-slate-100 dark:bg-slate-800 rounded-lg p-1 border border-slate-200 dark:border-slate-700">
                    <button onClick={() => setViewMode('preview')} className={`px-3 py-1.5 rounded-md text-xs font-medium ${viewMode === 'preview' ? 'bg-white dark:bg-indigo-600 shadow-sm dark:shadow-none' : 'text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white'}`}>{t('preview')}</button>
                    <button onClick={() => setViewMode('code')} className={`px-3 py-1.5 rounded-md text-xs font-medium ${viewMode === 'code' ? 'bg-white dark:bg-indigo-600 shadow-sm dark:shadow-none' : 'text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white'}`}>{t('code')}</button>
                </div>
            </div>
            <div className="flex items-center gap-3">
                {hasCloudProject && <button onClick={() => navigate(`/cloud/${project.id}`)} className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-200 dark:border-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded-full text-xs font-medium hover:bg-emerald-100 dark:hover:bg-emerald-900/20 transition-colors"><Cloud size={12} fill="currentColor" /><span className="hidden lg:inline">Cloud Active</span></button>}
                <div className="relative" ref={desktopPublishRef}>
                    <button onClick={() => setShowPublishDropdown(!showPublishDropdown)} className="flex items-center gap-2 bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 transition-opacity shadow-sm">{t('publish')}</button>
                    {showPublishDropdown && <div className="absolute right-0 top-full mt-2 z-50"><PublishDropdown project={project} user={user} onManageDomains={() => { setShowPublishDropdown(false); setShowManageDomains(true); }} onClose={() => setShowPublishDropdown(false)} onUpdate={fetchProject} /></div>}
                </div>
            </div>
        </div>

        {/* Mobile Header */}
        <div className="md:hidden h-14 bg-white dark:bg-[#0f172a] border-b border-slate-200 dark:border-slate-700 flex items-center justify-between px-4 shrink-0 z-20">
            <button onClick={() => navigate('/dashboard')}><ArrowLeft size={20} className="text-slate-600 dark:text-slate-300" /></button>
            <div className="flex bg-slate-100 dark:bg-slate-800 rounded-lg p-1">
                <button onClick={() => setMobileTab('chat')} className={`px-4 py-1.5 rounded-md text-xs font-medium transition-all ${mobileTab === 'chat' ? 'bg-white dark:bg-slate-600 shadow-sm text-indigo-600 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}>Chat</button>
                <button onClick={() => setMobileTab('preview')} className={`px-4 py-1.5 rounded-md text-xs font-medium transition-all ${mobileTab === 'preview' ? 'bg-white dark:bg-slate-600 shadow-sm text-indigo-600 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}>Preview</button>
            </div>
            <div className="relative" ref={mobilePublishRef}>
                <button onClick={() => setShowPublishDropdown(!showPublishDropdown)}><ExternalLink size={20} className="text-slate-600 dark:text-slate-300" /></button>
                {showPublishDropdown && <div className="absolute right-0 top-full mt-2 z-50"><PublishDropdown project={project} user={user} onManageDomains={() => { setShowPublishDropdown(false); setShowManageDomains(true); }} onClose={() => setShowPublishDropdown(false)} onUpdate={fetchProject} /></div>}
            </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex overflow-hidden relative">
            <div className={`${isMobile ? (mobileTab === 'chat' ? 'w-full' : 'hidden') : (isSidebarOpen ? 'flex' : 'hidden')} flex-col border-r border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0f172a] transition-all duration-300 relative`} style={{ width: isMobile ? '100%' : `${sidebarWidth}px` }}>
                <ChatInterface 
                    messages={project.messages}
                    onSendMessage={(content, images) => handleSendMessage(content, images)}
                    onUploadImage={handleUploadImage}
                    onStop={handleStop}
                    onRetry={handleRetry}
                    onAutoFix={handleAutoFix}
                    onClearBuildState={handleClearBuildState}
                    onConnectDatabase={() => handleConnectCloud()}
                    isThinking={isThinking}
                    isAutoRepairing={isAutoRepairing}
                    buildState={buildState}
                    suggestions={suggestions}
                    isSuggestionsLoading={isSuggestionsLoading}
                    runtimeError={runtimeError}
                    cloudConnectionStatus={uiCloudStatus}
                    cloudConnectionError={localCloudError}
                    onCloudConnectRetry={handleCloudConnectRetry}
                    onClearCloudConnectionState={handleClearCloudConnectionState}
                />
                {!isMobile && <div className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-indigo-500/50 active:bg-indigo-500 transition-colors z-10" onMouseDown={startResizing} />}
            </div>

            <div className={`flex-1 bg-slate-100 dark:bg-black/50 relative overflow-hidden flex flex-col items-center justify-center ${isMobile && mobileTab !== 'preview' ? 'hidden' : 'flex'}`}>
                <div className={`transition-all duration-300 ${deviceSizeClass} ${deviceMode !== 'desktop' ? 'my-8 shadow-2xl border-8 border-slate-800 rounded-[2rem] overflow-hidden bg-white' : ''}`}>
                    {viewMode === 'preview' ? (
                        <PreviewCanvas 
                            code={project.code} 
                            files={project.files}
                            isGenerating={isThinking || deploying}
                            isUpdating={isUpdating}
                            onRuntimeError={setRuntimeError}
                            projectId={project.id}
                            active={!isMobile || mobileTab === 'preview'}
                            externalUrl={previewUrl}
                        />
                    ) : (
                        <CodeEditor 
                            code={project.code} 
                            files={project.files}
                            isThinking={isThinking}
                            active={!isMobile || mobileTab === 'preview'}
                        />
                    )}
                </div>
            </div>
        </div>

        {showManageDomains && <ManageDomainsModal project={project} user={user} onClose={() => setShowManageDomains(false)} onUpdate={fetchProject} />}
    </div>
  );
};

export default ProjectBuilder;
