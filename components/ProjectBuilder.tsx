
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Project, Message, ViewMode, User, Suggestion, BuildState } from '../types';
import { generateProjectTitle, generateSuggestions, handleUserIntent } from '../services/geminiService';
import { cloudService } from '../services/cloudService';
import { rafieiCloudService } from '../services/rafieiCloudService';
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

  const projectRef = useRef<Project | null>(null);
  const lastSuggestionMessageIdRef = useRef<string | null>(null);
  const failedSuggestionAttemptsRef = useRef<Record<string, number>>({});
  
  const connectingRef = useRef(false);
  const autoRepairAttemptsRef = useRef(0);
  const isAutoFixingRef = useRef(false);
  const isUserStoppedRef = useRef(false);
  
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

  // --- FIXED: CRITICAL CRASH LOOP PREVENTION ---
  // The pendingPrompt must be cleared SYNCHRONOUSLY before any state update that triggers re-render.
  useEffect(() => {
      projectRef.current = project;
      
      if (project?.rafieiCloudProject?.status === 'ACTIVE' && pendingPrompt) {
          // Capture the prompt data
          const promptToExecute = { ...pendingPrompt };
          
          // Clear the pending state IMMEDIATELY to prevent infinite loop on next render
          setPendingPrompt(null); 

          const successMsg: Message = {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: "✅ **Rafiei Cloud Connected**\n\nDatabase is ready. Resuming your build request...",
            timestamp: Date.now()
          };
          
          // Optimistic update
          const updated = { ...project, messages: [...project.messages, successMsg] };
          setProject(updated);
          cloudService.saveProject(updated);

          // Resume build after a brief delay to allow UI to settle
          setTimeout(() => {
              handleSendMessage(promptToExecute.content, promptToExecute.images, updated, true);
          }, 1000);
      }

  }, [project, pendingPrompt]); // Added pendingPrompt to dependencies for correctness

  useEffect(() => {
      if (runtimeError && !isThinking && !isUserStoppedRef.current) {
          if (autoRepairAttemptsRef.current < MAX_AUTO_REPAIRS) {
              const attempt = autoRepairAttemptsRef.current + 1;
              console.log(`[Auto-Heal] Runtime Error Detected: "${runtimeError}". Initiating repair attempt ${attempt}/${MAX_AUTO_REPAIRS}...`);
              
              autoRepairAttemptsRef.current = attempt;
              
              const timer = setTimeout(() => {
                  handleAutoFix();
              }, 1000);
              return () => clearTimeout(timer);
          } else {
              console.warn("[Auto-Heal] Maximum repair attempts reached. Stopping autonomous loop.");
          }
      }
  }, [runtimeError, isThinking]);

  const DB_CONNECT_MESSAGE = "This project requires a backend database. Starting Rafiei Cloud connection process...";

  useEffect(() => {
      if (project && project.messages.length > 0) {
          const lastMsg = project.messages[project.messages.length - 1];
          if (lastMsg.role === 'assistant' && lastMsg.content === DB_CONNECT_MESSAGE) {
              const hasCloud = project.rafieiCloudProject && project.rafieiCloudProject.status === 'ACTIVE';
              if (!hasCloud && !isConnectingCloud && !connectingRef.current) {
                  console.log("Failsafe Triggered: Auto-connecting cloud based on AI System Signal.");
                  setBuildState(null);
                  const lastUserMsg = [...project.messages].reverse().find(m => m.role === 'user');
                  if (lastUserMsg) {
                      const promptData = { 
                          content: lastUserMsg.content, 
                          images: (lastUserMsg.images || []).map(url => ({ url, base64: '' })) 
                      };
                      setPendingPrompt(promptData);
                      handleConnectCloud(project, promptData);
                  } else {
                      handleConnectCloud(project);
                  }
              }
          }
      }
  }, [project?.messages, isConnectingCloud]);

  const fetchProject = async () => {
      if (!projectId) return;
      try {
          const p = await cloudService.getProject(projectId);
          if (p) {
              setProject(p);
              setBuildState(p.buildState || null);
              
              if (p.rafieiCloudProject && p.rafieiCloudProject.status === 'CREATING') {
                  console.log("Resuming background provisioning monitor...");
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
  }, [projectId]);

  useEffect(() => {
      if (project && project.status === 'idle' && project.messages.length === 1 && project.messages[0].role === 'user' && !project.code.javascript) {
          if (!project.files || project.files.length === 0) {
              const prompt = project.messages[0].content;
              const images = project.messages[0].images?.map(url => ({ url, base64: '' })) || [];
              handleSendMessage(prompt, images, project, true); 
          } else {
              setViewMode('code');
          }
      }
  }, [project?.id]); 

  useEffect(() => {
    if (!projectId) return;
    const { unsubscribe } = cloudService.subscribeToProjectChanges(projectId, (updatedProject) => {
      setProject(updatedProject);
      setBuildState(updatedProject.buildState || null);
    });
    return () => unsubscribe();
  }, [projectId]);

  useEffect(() => {
      setRuntimeError(null);
  }, [project?.code]);

  useEffect(() => {
    if (project?.status === 'generating') {
      const timeSinceLastUpdate = Date.now() - project.updatedAt;
      if (timeSinceLastUpdate > 3600000) { 
        handleStopGeneration(true);
      }
    }
  }, [project, project?.updatedAt]);

  useEffect(() => {
    if (!project || project.status !== 'idle' || project.messages.length === 0) return;

    const lastMessage = project.messages[project.messages.length - 1];
    
    if (lastMessage.role === 'assistant' && !lastMessage.content.toLowerCase().includes('error')) {
        const attempts = failedSuggestionAttemptsRef.current[lastMessage.id] || 0;
        const isNewMessage = lastMessage.id !== lastSuggestionMessageIdRef.current;
        const shouldRetry = suggestions.length === 0 && attempts < 2;

        if ((isNewMessage || shouldRetry) && !isSuggestionsLoading) {
            if (isNewMessage) {
                 lastSuggestionMessageIdRef.current = lastMessage.id;
            }

            setIsSuggestionsLoading(true);
            if (isNewMessage) setSuggestions([]); 

            generateSuggestions(project.messages, project.code, project.id) 
                .then(newSuggestions => {
                    if (newSuggestions && newSuggestions.length > 0) {
                        setSuggestions(newSuggestions);
                    } else {
                        failedSuggestionAttemptsRef.current[lastMessage.id] = (failedSuggestionAttemptsRef.current[lastMessage.id] || 0) + 1;
                    }
                })
                .catch(err => {
                    failedSuggestionAttemptsRef.current[lastMessage.id] = (failedSuggestionAttemptsRef.current[lastMessage.id] || 0) + 1;
                })
                .finally(() => setIsSuggestionsLoading(false));
        }
    }
  }, [project?.status, project?.messages.length, suggestions.length, isSuggestionsLoading]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!desktopPublishRef.current?.contains(target) && !mobilePublishRef.current?.contains(target)) {
        setShowPublishDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleStop = async () => {
    isUserStoppedRef.current = true;

    if (isConnectingCloud && project?.rafieiCloudProject) {
        rafieiCloudService.cancelMonitoring(project.rafieiCloudProject.id);
        setPendingPrompt(null);
        connectingRef.current = false;
        
        const cancelMsg: Message = {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: "🛑 Cloud connection cancelled by user.",
            timestamp: Date.now()
        };
        
        const updated = {
            ...project,
            rafieiCloudProject: undefined,
            messages: [...project.messages, cancelMsg],
            updatedAt: Date.now()
        };
        
        setProject(updated);
        setBuildState(null);
        setLocalCloudError(null);
        await cloudService.saveProject(updated);
        return;
    }

    if (isBuilding) {
        if (project) cloudService.stopBuild(project.id);
        handleStopGeneration(false);
    }
  };

  const handleStopGeneration = (isAutoRecovery = false) => {
    if (project) {
        let updatedMessages = project.messages;
        let updatedBuildState = project.buildState ? { ...project.buildState } : null;

        if (isAutoRecovery) {
             const recoveryMsg: Message = {
                id: crypto.randomUUID(),
                role: 'assistant',
                content: "Error: The build process timed out. Please try again.",
                timestamp: Date.now()
            };
            updatedMessages = [...project.messages, recoveryMsg];
            
            if (updatedBuildState) {
                updatedBuildState.error = "Timeout: No activity detected";
            }
        }

        const stoppedProject = { 
            ...project, 
            status: 'idle' as const, 
            messages: updatedMessages,
            buildState: updatedBuildState,
            updatedAt: Date.now() 
        };
        setProject(stoppedProject);
        cloudService.saveProject(stoppedProject);
    }
  };

  const handleRetry = (prompt: string) => {
      if(project) {
          const updated = {
              ...project, 
              messages: project.messages.slice(0, -1),
              updatedAt: Date.now() 
          };
          setProject(updated); 
          cloudService.saveProject(updated).then(() => {
              handleSendMessage(prompt, []);
          });
      }
  };
  
  const handleAutoFix = () => {
      if (project) {
          const prompt = runtimeError 
            ? `I encountered a runtime error in the preview: "${runtimeError}". Please analyze the code and fix this error.`
            : "The current code has an error. Please find the root cause and provide a fix.";
          
          isAutoFixingRef.current = true;
          handleSendMessage(prompt, [], project, false, true);
          setRuntimeError(null);
      }
  };
  
  const handleClearBuildState = async () => {
      if (project) {
          const updated = { ...project, buildState: null };
          setProject(updated); 
          setBuildState(null);
          await cloudService.saveProject(updated);
      }
  };
  
  const handleUploadImage = async (file: File): Promise<string> => {
      if (!project) throw new Error("No project context");
      const tempId = crypto.randomUUID(); 
      return await cloudService.uploadChatImage(project.userId, tempId, file);
  };

  const handleClearCloudConnectionState = () => {
      setLocalCloudError(null);
      connectingRef.current = false;
  };

  const handleCloudConnectRetry = () => {
      connectingRef.current = false;
      if (pendingPrompt) {
          handleConnectCloud(project, pendingPrompt);
      } else {
          handleConnectCloud(project);
      }
  };
  
  const handleConnectCloud = async (startProject?: Project, resumePrompt?: { content: string; images: { url: string; base64: string }[] }) => {
    const currentProject = startProject || project;
    if (!currentProject) return;

    if (connectingRef.current) {
        console.log("Cloud connection already in progress. Ignoring duplicate request.");
        return;
    }
    
    connectingRef.current = true;
    setLocalCloudError(null);

    try {
        await rafieiCloudService.provisionProject(user, currentProject);
    } catch (error: any) {
        connectingRef.current = false;
        setLocalCloudError(error.message);
        
        const failMsg: Message = {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: `❌ Failed to connect Rafiei Cloud: ${error.message}`,
            timestamp: Date.now()
        };
        const projectWithError = { ...currentProject, messages: [...currentProject.messages, failMsg] };
        setProject(projectWithError);
        await cloudService.saveProject(projectWithError);
    }
  };

  const handleDisconnectCloud = async () => {
      if (!project || !window.confirm("Disconnecting will remove access to the database. Your data will persist on Supabase but the AI won't be able to access it.")) return;
      
      const updated = { ...project, rafieiCloudProject: undefined };
      setProject(updated);
      await cloudService.saveProject(updated);
      setShowCloudDetails(false);
      connectingRef.current = false;
  };

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
    } else {
        updatedProject = {
            ...currentProject,
            updatedAt: Date.now()
        };
        setProject(updatedProject);
    }

    setBuildState({
        plan: ["Analyzing project requirements...", "Verifying cloud dependencies..."],
        currentStep: 0,
        lastCompletedStep: -1,
        error: null
    });

    let { isArchitect, requiresDatabase: aiSaysDbRequired, response, meta } = await handleUserIntent(updatedProject, content);
    
    const heuristicArchitect = isAutoFix || /\b(create|build|generate|make|develop|code|app|website|page|dashboard|fix|change|update|add|remove|delete|insert|style|design|layout|form)\b/i.test(content);
    const dbRegex = /\b(database|db|store|saving|saved|save|persist|persistent|record|auth|login|signin|signup|user|profile|admin|dashboard|cms|crm|shop|ecommerce|cart|inventory|blog|post|comment|member|setting|preference|analytic|history|transaction|payment|order|product|service|booking|reservation|todo|task|list|collection|table|row|column|sql|data|form|submit|capture|collect|input|review|message|chat)\b/i;
    const heuristicDbRequired = dbRegex.test(content);
    
    let requiresDatabase = aiSaysDbRequired || heuristicDbRequired;

    if (isArchitect || heuristicArchitect || heuristicDbRequired) {
        const staticRegex = /\b(static|mock|landing page|brochure|portfolio|frontend only|ui only|no database|no db|html only|css only)\b/i; 
        const isExplicitlyStatic = staticRegex.test(content);
        
        if (isExplicitlyStatic && !heuristicDbRequired) {
            requiresDatabase = false;
        }
        
        if (requiresDatabase) {
            isArchitect = true;
        } else if (heuristicArchitect) {
            isArchitect = true;
        }
    }

    if (isArchitect && requiresDatabase) {
        const hasCloud = updatedProject.rafieiCloudProject && updatedProject.rafieiCloudProject.status === 'ACTIVE';
        const hasManual = updatedProject.supabaseConfig && updatedProject.supabaseConfig.url;

        if (!hasCloud && !hasManual && !isConnectingCloud && !connectingRef.current) {
            setBuildState(null);

            const connectMsg: Message = {
                id: crypto.randomUUID(),
                role: 'assistant',
                content: "This application requires a database. Automatically connecting to Rafiei Cloud to provision a secure backend...",
                timestamp: Date.now(),
            };
            const projectWithMsg = { ...updatedProject, messages: [...updatedProject.messages, connectMsg]};
            setProject(projectWithMsg);
            
            const promptData = { content, images };
            setPendingPrompt(promptData);
            await handleConnectCloud(projectWithMsg, promptData); 
            return; 
        }
    }

    if (!isArchitect && response) {
      setBuildState(null);
      const assistantMsg: Message = { 
          id: crypto.randomUUID(), 
          role: 'assistant', 
          content: response, 
          timestamp: Date.now(),
          executionTimeMs: meta?.timeMs,
          creditsUsed: meta?.credits
      };
      const finalProject = { 
          ...updatedProject, 
          messages: [...updatedProject.messages, assistantMsg],
          updatedAt: Date.now()
      };
      setProject(finalProject);
      await cloudService.saveProject(finalProject);
      return;
    }

    let projectToBuild = { ...updatedProject };

    if (projectToBuild.messages.filter(m => m.role === 'user').length === 1) {
      const title = await generateProjectTitle(content);
      projectToBuild.name = title;
    }

    projectToBuild.status = 'generating';
    projectToBuild.updatedAt = Date.now(); 
    setProject(projectToBuild); 

    const handleLocalStateUpdate = (updatedState: Project) => {
        setProject(prev => {
            if (!prev || prev.id !== updatedState.id) return prev;
            return updatedState;
        });
        setBuildState(updatedState.buildState || null);
    };

    await cloudService.triggerBuild(projectToBuild, content, images, handleLocalStateUpdate);
  };

  if (loading) return <div className="h-screen flex items-center justify-center bg-slate-50 dark:bg-[#0f172a] text-slate-800 dark:text-white"><Loader2 className="animate-spin" size={32} /></div>;
  if (project && project.deletedAt) { /* ... */ }
  if (!project) return null;

  const deviceSizeClass = deviceMode === 'desktop' ? 'w-full h-full' : deviceMode === 'tablet' ? 'w-[768px] h-full max-w-full mx-auto' : 'w-[375px] h-[667px] max-w-full mx-auto';
  const hasCloudProject = project.rafieiCloudProject != null && project.rafieiCloudProject.status === 'ACTIVE';
  const isPendingCloud = project.rafieiCloudProject != null && project.rafieiCloudProject.status === 'CREATING';
  
  return (
    <div className="flex flex-col h-screen bg-white dark:bg-[#0f172a] text-slate-900 dark:text-white overflow-hidden transition-colors duration-300" dir={dir}>
        {/* ... (Header) ... */}
        <div className="hidden md:flex h-14 bg-white dark:bg-[#0f172a] border-b border-slate-200 dark:border-gray-700 items-center justify-between px-4 z-20 shrink-0">
            {/* ... (Header Left) ... */}
            <div className="flex items-center gap-2">
                <button onClick={() => navigate('/dashboard')} className="p-2 hover:bg-slate-100 dark:hover:bg-gray-800 rounded-lg text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white transition-colors flex items-center gap-2">
                    <ArrowLeft size={18} /><span className="text-sm font-medium hidden sm:inline">Dashboard</span>
                </button>
                <div className="h-6 w-px bg-slate-200 dark:bg-gray-700 hidden sm:block"></div>
                <button 
                    onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                    className={`p-2 rounded-lg transition-colors ${isSidebarOpen ? 'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/20' : 'text-slate-500 dark:text-gray-400 hover:bg-slate-100 dark:hover:bg-gray-800'}`}
                    title={isSidebarOpen ? "Hide Sidebar" : "Show Sidebar"}
                >
                    <PanelLeft size={18} />
                </button>
                <h1 className="font-semibold text-slate-800 dark:text-gray-200 truncate max-w-[150px] md:max-w-md hidden sm:block">{project.name}</h1>
                {isAutoRepairing && (
                    <div className="ml-4 flex items-center gap-2 px-3 py-1 bg-yellow-500/10 border border-yellow-500/20 rounded-full text-yellow-600 dark:text-yellow-300 text-xs font-medium animate-pulse">
                        <Loader2 size={12} className="animate-spin" />
                        <span>Auto-Healing Mode (Attempt {autoRepairAttemptsRef.current})</span>
                    </div>
                )}
            </div>
            {/* ... (Header Center) ... */}
            <div className="flex-1 flex justify-center items-center gap-4">
                <div className="hidden md:flex bg-slate-100 dark:bg-slate-800 rounded-lg p-1 border border-slate-200 dark:border-slate-700">
                    <button onClick={() => setViewMode('preview')} className={`px-3 py-1.5 rounded-md text-xs font-medium ${viewMode === 'preview' ? 'bg-white dark:bg-indigo-600 shadow-sm dark:shadow-none' : 'text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white'}`}>{t('preview')}</button>
                    <button onClick={() => setViewMode('code')} className={`px-3 py-1.5 rounded-md text-xs font-medium ${viewMode === 'code' ? 'bg-white dark:bg-indigo-600 shadow-sm dark:shadow-none' : 'text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white'}`}>{t('code')}</button>
                </div>
                <div className="hidden md:flex items-center gap-1 bg-slate-100 dark:bg-slate-800 rounded-lg p-1 border border-slate-200 dark:border-slate-700">
                    <button onClick={() => setDeviceMode('desktop')} className={`p-1.5 rounded-md ${deviceMode === 'desktop' ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500 dark:text-gray-500 hover:text-slate-900 dark:hover:text-white'}`}><Monitor size={16}/></button>
                    <button onClick={() => setDeviceMode('tablet')} className={`p-1.5 rounded-md ${deviceMode === 'tablet' ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500 dark:text-gray-500 hover:text-slate-900 dark:hover:text-white'}`}><Tablet size={16}/></button>
                    <button onClick={() => setDeviceMode('mobile')} className={`p-1.5 rounded-md ${deviceMode === 'mobile' ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500 dark:text-gray-500 hover:text-slate-900 dark:hover:text-white'}`}><Smartphone size={16}/></button>
                </div>
            </div>
            {/* ... (Header Right) ... */}
            <div className="flex items-center gap-2 relative">
                 {hasCloudProject ? (
                    <button onClick={() => setShowCloudDetails(true)} className="px-3 py-1.5 rounded-lg text-xs font-medium border border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 transition-colors flex items-center gap-2 shadow-sm shadow-emerald-900/5 dark:shadow-emerald-900/20" title="View Cloud Details">
                        <Check size={14} className="text-emerald-600 dark:text-emerald-400" /> <span className="hidden sm:inline">Rafiei Cloud Connected</span><span className="sm:hidden">Connected</span>
                    </button>
                 ) : (
                    <button onClick={() => handleConnectCloud()} disabled={isConnectingCloud} className="px-3 py-1.5 rounded-lg text-xs font-medium border border-indigo-500/30 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 transition-colors flex items-center gap-2 disabled:opacity-50" title={isPendingCloud ? "Waiting for provisioning..." : "Connect to Rafiei Cloud"}>
                        {(isConnectingCloud) ? <Loader2 size={14} className="animate-spin" /> : <Cloud size={14} />}
                        {(isConnectingCloud) ? 'Provisioning...' : 'Connect to Rafiei Cloud'}
                    </button>
                 )}
                 <button onClick={() => setShowPublishDropdown(prev => !prev)} className="text-xs font-medium bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-slate-200 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-2 shadow-sm">
                    {t('publish')}
                 </button>
                 {showPublishDropdown && user && (<div ref={desktopPublishRef} className="absolute top-full right-0 mt-2 z-50"><PublishDropdown project={project} user={user} onManageDomains={() => { setShowManageDomains(true); setShowPublishDropdown(false); }} onClose={() => setShowPublishDropdown(false)} onUpdate={fetchProject} /></div>)}
            </div>
        </div>

        {/* ... (Main Content with Sidebar) ... */}
        <div className="flex-1 flex overflow-hidden relative">
            <div 
                className={`flex flex-col bg-slate-50 dark:bg-[#0f172a] z-10 border-r border-slate-200 dark:border-gray-700 md:flex-none ${!isSidebarOpen ? 'md:hidden' : ''} ${mobileTab === 'chat' ? 'flex w-full h-full absolute inset-0 pb-16 md:pb-0 md:static md:h-auto' : 'hidden md:flex'}`}
                style={{ width: mobileTab === 'chat' && window.innerWidth < 768 ? '100%' : sidebarWidth }}
            >
                <ChatInterface 
                    messages={project.messages} 
                    onSendMessage={handleSendMessage} 
                    onUploadImage={handleUploadImage} 
                    onStop={handleStop} 
                    onRetry={handleRetry} 
                    onAutoFix={handleAutoFix} 
                    onClearBuildState={handleClearBuildState} 
                    onConnectDatabase={hasCloudProject ? undefined : () => handleConnectCloud()} 
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
            </div>

            {/* Draggable Handle */}
            {isSidebarOpen && (
                <div
                    className="w-1 hover:w-1.5 cursor-col-resize bg-slate-200 dark:bg-slate-700 hover:bg-indigo-500 transition-colors hidden md:block z-20 flex-shrink-0"
                    onMouseDown={startResizing}
                />
            )}

            <div className={`bg-slate-200 dark:bg-gray-900 relative flex justify-center items-center overflow-auto ${isSidebarOpen ? 'md:flex-1 min-w-0' : 'md:w-full'} ${mobileTab === 'preview' ? 'flex w-full absolute top-0 left-0 right-0 bottom-16 md:static md:h-auto' : 'hidden md:flex'}`}>
                <div className={`hidden md:flex w-full h-full items-center justify-center ${viewMode === 'code' ? 'p-0' : 'p-4'}`}>
                    {viewMode === 'code' ? (
                        <div className="h-full w-full" dir="ltr">
                            <CodeEditor code={project.code} files={project.files} isThinking={isThinking} />
                        </div>
                    ) : (
                        <div className={`transition-all duration-300 ${deviceSizeClass}`}>
                            <PreviewCanvas code={project.code} isGenerating={isFirstGeneration} isUpdating={isUpdating} className="h-full w-full" onRuntimeError={setRuntimeError} projectId={projectId} />
                        </div>
                    )}
                </div>
                <div className="md:hidden h-full w-full"><PreviewCanvas code={project.code} isGenerating={isFirstGeneration} isUpdating={isUpdating} className="h-full w-full rounded-none border-0" onRuntimeError={setRuntimeError} projectId={projectId} /></div>
            </div>
        </div>
        
        {/* ... (Mobile Footer) ... */}
        <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white/80 dark:bg-[#152033]/80 backdrop-blur-xl border-t border-slate-200 dark:border-gray-800 flex justify-between items-center h-16 shrink-0 z-30 pb-safe px-4 sm:px-8">
            <button onClick={() => navigate('/dashboard')} className="flex flex-col items-center justify-center w-14 space-y-1 text-slate-500 dark:text-gray-500 hover:text-slate-900 dark:hover:text-white"><ArrowLeft size={20} /><span className="text-[10px] font-medium">Back</span></button>
            <button onClick={() => setMobileTab('chat')} className={`flex flex-col items-center justify-center w-14 space-y-1 ${mobileTab === 'chat' ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500 dark:text-gray-500'}`}><MessageSquare size={20} /><span className="text-[10px] font-medium">Chat</span></button>
            <button onClick={() => setMobileTab('preview')} className={`flex flex-col items-center justify-center w-14 space-y-1 ${mobileTab === 'preview' ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500 dark:text-gray-500'}`}><Eye size={20} /><span className="text-[10px] font-medium">Preview</span></button>
            <div className="relative">
                <button onClick={() => setShowPublishDropdown(prev => !prev)} className={`flex flex-col items-center justify-center w-14 space-y-1 ${showPublishDropdown ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500 dark:text-gray-500'}`}><Globe size={20} /><span className="text-[10px] font-medium">Publish</span></button>
                {showPublishDropdown && user && (<div ref={mobilePublishRef} className="absolute bottom-full right-0 mb-4 z-50 origin-bottom-right"><PublishDropdown project={project} user={user} onManageDomains={() => { setShowManageDomains(true); setShowPublishDropdown(false); }} onClose={() => setShowPublishDropdown(false)} onUpdate={fetchProject} /></div>)}
            </div>
        </div>
        {showManageDomains && user && (<ManageDomainsModal project={project} user={user} onClose={() => setShowManageDomains(false)} onUpdate={fetchProject} />)}
        
        {/* ... (Cloud Modal) ... */}
        {showCloudDetails && project.rafieiCloudProject && (
            <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                <div className="bg-white dark:bg-[#1e293b] border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl p-6 w-full max-w-md animate-in fade-in zoom-in-95">
                    <div className="flex justify-between items-center mb-6">
                         <h3 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2"><Cloud size={20} className="text-emerald-500 dark:text-emerald-400"/> Rafiei Cloud</h3>
                        <button onClick={() => setShowCloudDetails(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-white"><X size={20}/></button>
                    </div>
                    <div className="space-y-4">
                        <div className="bg-slate-50 dark:bg-slate-900/50 p-4 rounded-xl border border-slate-200 dark:border-slate-800">
                             <div className="flex justify-between items-center mb-2">
                                <span className="text-xs text-slate-500 font-medium uppercase">Status</span>
                                {project.rafieiCloudProject.status === 'ACTIVE' ? (<span className="text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-400/10 px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-400/20">Active</span>) : (<span className="text-xs text-yellow-600 dark:text-yellow-400 bg-yellow-100 dark:bg-yellow-400/10 px-2 py-0.5 rounded-full border border-yellow-200 dark:border-yellow-400/20">{project.rafieiCloudProject.status}</span>)}
                             </div>
                             <div className="space-y-2">
                                <div><div className="text-xs text-slate-500">Project Name</div><div className="text-sm font-mono text-slate-700 dark:text-slate-300">{project.rafieiCloudProject.projectName}</div></div>
                                <div><div className="text-xs text-slate-500">Project Ref</div><div className="text-sm font-mono text-slate-700 dark:text-slate-300">{project.rafieiCloudProject.projectRef}</div></div>
                                <div><div className="text-xs text-slate-500">Region</div><div className="text-sm font-mono text-slate-700 dark:text-slate-300 uppercase">{project.rafieiCloudProject.region}</div></div>
                             </div>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400">The AI agent has full access to this project to run migrations, manage auth, and store data.</p>
                    </div>
                    <div className="mt-8 flex flex-col gap-3">
                         <button onClick={() => navigate(`/cloud/${project.id}`)} className="w-full px-4 py-2.5 text-sm bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg flex items-center justify-center gap-2 shadow-lg shadow-indigo-900/20"><LayoutDashboard size={18} /> Open Cloud Management</button>
                        <a href={`https://supabase.com/dashboard/project/${project.rafieiCloudProject.projectRef}`} target="_blank" rel="noopener noreferrer" className="w-full px-4 py-2 text-sm bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-900 dark:text-white rounded-lg flex items-center justify-center gap-2"><ExternalLink size={16} /> Open Project Settings</a>
                        <button onClick={handleDisconnectCloud} className="w-full px-4 py-2 text-sm bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-400 border border-red-500/20 rounded-lg flex items-center justify-center gap-2"><Power size={16} /> Disconnect</button>
                    </div>
                </div>
            </div>
        )}
    </div>
  );
};

export default ProjectBuilder;
