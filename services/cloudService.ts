
import { Project, User, Domain, Message, RafieiCloudProject, BuildState, Phase, SystemLog, ProjectFile, CreditLedgerEntry, CreditTransaction, FinancialStats, WebhookLog } from '../types';
import { createClient, SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import { generateProjectTitle, GenerationSupervisor, SupervisorCallbacks, generatePhasePlan } from './geminiService';
import { webhookService } from './webhookService';

// Safe environment access
const getEnv = (key: string) => {
  try {
    // @ts-ignore
    if (typeof process !== 'undefined' && process.env) {
       // @ts-ignore
       return process.env[key];
    }
  } catch (e) {
    // Ignore errors
  }
  return undefined;
};

const SUPABASE_URL = getEnv('SUPABASE_URL') || getEnv('REACT_APP_SUPABASE_URL') || 'https://sxvqqktlykguifvmqrni.supabase.co';
const SUPABASE_KEY = getEnv('SUPABASE_ANON_KEY') || getEnv('REACT_APP_SUPABASE_ANON_KEY') || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4dnFxa3RseWtndWlmdm1xcm5pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU0MDE0MTIsImV4cCI6MjA4MDk3NzQxMn0.5psTW7xePYH3T0mkkHmDoWNgLKSghOHnZaW2zzShkSA';

let supabase: SupabaseClient | null = null;

if (SUPABASE_URL && SUPABASE_KEY) {
    try {
        supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
            auth: {
                autoRefreshToken: true,
                persistSession: true,
                detectSessionInUrl: true,
            },
        });
    } catch (e) {
        console.error("Failed to initialize main Supabase client", e);
    }
}

const buildAbortControllers = new Map<string, AbortController>();
const ADMIN_EMAILS = ['rezarafeie13@gmail.com'];

// --- HELPER to get full user profile ---
async function getFullUserFromSession(session: any): Promise<User | null> {
    if (!session?.user) return null;

    // OPTIMIZATION: We return -1 to indicate "loading" and allow the UI to render immediately.
    // The Dashboard will fetch the actual balance asynchronously.
    const credits_balance = -1;
    
    const name = session.user.user_metadata.name || session.user.email?.split('@')[0] || 'User';
    
    return {
        id: session.user.id,
        email: session.user.email!,
        name: name,
        avatar: session.user.user_metadata.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random`,
        credits_balance: credits_balance,
        isAdmin: ADMIN_EMAILS.includes(session.user.email!)
    };
}


export class DatabaseSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseSetupError';
  }
}

const wrapError = (error: any, context: string) => {
    console.error(`Error in ${context}:`, error);
    if (error instanceof TypeError && error.message.toLowerCase().includes('failed to fetch')) {
        return new DatabaseSetupError("NETWORK_ERROR");
    }
    let msg = "An unknown error occurred.";
    if (error) {
        if (typeof error === 'string') {
            msg = error;
        } else if (error.message) {
            msg = error.message;
        } else if (error.error_description) {
            msg = error.error_description;
        } else if (error.details) {
            msg = error.details;
        } else if (error.hint) {
            msg = `Error: ${error.hint}`;
        }
    }
    return new Error(msg);
};

const requireClient = () => {
    if (!supabase) throw new Error("Platform Supabase not configured. Please check environment variables.");
    return supabase;
};

const mapRowToProject = (row: any): Project => {
    let deletedAtTimestamp: number | undefined = undefined;
    if (row.deleted_at) {
        if (typeof row.deleted_at === 'number') {
            deletedAtTimestamp = row.deleted_at;
        } else if (typeof row.deleted_at === 'string') {
            const parsedDate = new Date(row.deleted_at);
            if (!isNaN(parsedDate.getTime())) {
                deletedAtTimestamp = parsedDate.getTime();
            }
        }
    }
    return {
        id: row.id,
        userId: row.user_id,
        name: row.name,
        createdAt: new Date(row.created_at).getTime(),
        updatedAt: new Date(row.updated_at).getTime(),
        deletedAt: deletedAtTimestamp,
        // Default to empty code if not fetched (Dashboard list view)
        code: row.code || { html: '', javascript: '', css: '', explanation: '' },
        files: row.files || undefined, 
        messages: row.messages || [],
        status: row.status || 'idle',
        buildState: row.build_state || null,
        publishedUrl: row.published_url,
        customDomain: row.custom_domain,
        supabaseConfig: row.supabase_config || undefined,
        rafieiCloudProject: row.rafiei_cloud_project || undefined
    };
};

// Mapper for the lightweight RPC response
const mapDashboardRowToProject = (row: any): Project => {
    return {
        id: row.id,
        userId: row.user_id,
        name: row.name,
        createdAt: new Date(row.created_at).getTime(),
        updatedAt: new Date(row.updated_at).getTime(),
        status: row.status || 'idle',
        publishedUrl: row.published_url,
        customDomain: row.custom_domain,
        buildState: {
            currentStep: row.current_step || 0,
            plan: new Array(row.total_steps || 0).fill(''), // Fake plan array to support progress bar length logic
            lastCompletedStep: -1,
            error: null
        },
        code: { html: '', javascript: '', css: '', explanation: '' },
        messages: [],
        files: undefined
    };
};

export const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = error => reject(error);
  });
};

// ... (runBuildOnServer, createCallbacks, etc... unchanged) ...
export async function runBuildOnServer(
    project: Project, 
    prompt: string, 
    images?: string[],
    onStateChange?: (project: Project) => void,
    onSaveProject?: (project: Project) => Promise<void>,
    abortSignal?: AbortSignal
) {
    const projectRef = { ...project };
    const save = async (p: Project) => { if (onSaveProject) await onSaveProject(p); };
    const updateState = (updated: Project) => { if (onStateChange) onStateChange(updated); };
    const hasPhases = projectRef.buildState?.phases && projectRef.buildState.phases.length > 0;
    
    // Webhook: Build Phase
    webhookService.send('build.started', { prompt, imageCount: images?.length || 0 }, { project_id: project.id }, { id: project.userId, email: '' });

    if (!hasPhases) {
        const callbacks = createCallbacks(projectRef, updateState, save);
        const supervisor = new GenerationSupervisor(projectRef, prompt, images, callbacks, abortSignal);
        await supervisor.start();
        
        if (projectRef.status !== 'idle') {
            projectRef.status = 'idle';
            updateState({ ...projectRef });
            await save(projectRef);
        }
        return;
    }

    if (projectRef.buildState && projectRef.buildState.phases) {
        let phaseIndex = projectRef.buildState.currentPhaseIndex || 0;
        const phases = projectRef.buildState.phases;
        const MAX_PHASE_RETRIES = 3;

        while (phaseIndex < phases.length) {
            if (abortSignal?.aborted) throw new Error("Build cancelled by user");
            const currentPhase = phases[phaseIndex];
            currentPhase.status = 'active';
            projectRef.buildState.currentPhaseIndex = phaseIndex;
            
            // Webhook: Phase Start
            webhookService.send('build.phase_started', { phaseIndex, phaseTitle: currentPhase.title }, { project_id: project.id });

            if ((currentPhase.retryCount || 0) === 0) {
                projectRef.buildState.currentStep = 0;
                projectRef.buildState.plan = []; 
                projectRef.buildState.error = null;
            } else {
                projectRef.buildState.error = `Retrying Phase (Attempt ${(currentPhase.retryCount || 0) + 1}/${MAX_PHASE_RETRIES})...`;
            }
            
            updateState({ ...projectRef });
            await save(projectRef);

            const phasePrompt = `Execute Phase ${phaseIndex + 1}: ${currentPhase.title}. ${currentPhase.description}`;
            const callbacks = createCallbacks(projectRef, updateState, save);
            const supervisor = new GenerationSupervisor(projectRef, prompt, images, callbacks, abortSignal, phasePrompt);

            try {
                await supervisor.start();
                currentPhase.status = 'completed';
                projectRef.buildState.phases[phaseIndex] = currentPhase;
                updateState({ ...projectRef });
                await save(projectRef);
                
                // Webhook: Phase Complete
                webhookService.send('build.phase_completed', { phaseIndex, phaseTitle: currentPhase.title }, { project_id: project.id });
                
                phaseIndex++; 
            } catch (error: any) {
                if (abortSignal?.aborted) throw error; 
                const retries = currentPhase.retryCount || 0;
                if (retries < MAX_PHASE_RETRIES) {
                    console.warn(`Phase ${phaseIndex + 1} failed. Retrying...`, error);
                    currentPhase.retryCount = retries + 1;
                    projectRef.buildState.phases[phaseIndex] = currentPhase;
                    projectRef.messages.push({
                        id: crypto.randomUUID(),
                        role: 'assistant',
                        content: `⚠️ Phase ${phaseIndex + 1} encountered an error: "${error.message}". Auto-fixing and retrying (Attempt ${currentPhase.retryCount}/${MAX_PHASE_RETRIES})...`,
                        timestamp: Date.now()
                    });
                    await new Promise(r => setTimeout(r, 5000));
                    continue; 
                } else {
                    currentPhase.status = 'failed';
                    projectRef.buildState.phases[phaseIndex] = currentPhase;
                    projectRef.buildState.error = `Phase failed after ${MAX_PHASE_RETRIES} attempts: ${error.message}`;
                    projectRef.status = 'idle';
                    updateState({ ...projectRef });
                    await save(projectRef);
                    // Webhook: Build Failed
                    webhookService.send('build.failed', { error: error.message, phase: currentPhase.title }, { project_id: project.id });
                    throw error; 
                }
            }
        }
        projectRef.status = 'idle';
        updateState({ ...projectRef });
        await save(projectRef);
        // Webhook: Build Complete
        webhookService.send('build.completed', { phasesCompleted: phases.length }, { project_id: project.id });
    }
}

function createCallbacks(projectRef: Project, updateState: (p: Project) => void, save: (p: Project) => Promise<void>): SupervisorCallbacks {
    const DB_CONNECT_MESSAGE = "This project requires a backend database. Starting Rafiei Cloud connection process...";
    return {
        onPlanUpdate: async (plan) => {
            if (projectRef.buildState) {
                projectRef.buildState.plan = plan;
                projectRef.buildState.currentStep = 0;
                projectRef.buildState.lastCompletedStep = -1;
                projectRef.buildState.error = null;
            }
            projectRef.status = 'generating';
            updateState({ ...projectRef });
            await save(projectRef);
        },
        onStepStart: async (stepIndex) => {
            if (projectRef.buildState) {
                projectRef.buildState.currentStep = stepIndex;
                projectRef.buildState.error = null;
                updateState({ ...projectRef });
                await save(projectRef);
            }
        },
        onStepComplete: async (stepIndex) => {
            if (projectRef.buildState) {
                projectRef.buildState.lastCompletedStep = stepIndex;
                updateState({ ...projectRef });
                await save(projectRef);
            }
        },
        onChunkComplete: async (code, explanation) => {
            projectRef.code = code;
            updateState({ ...projectRef });
            await save(projectRef);
        },
        onSuccess: async (finalCode, finalExplanation, plan, meta) => {
            const lastUserMsg = [...projectRef.messages].reverse().find(m => m.role === 'user');
            const jobTitle = lastUserMsg ? `Job: "${lastUserMsg.content.substring(0, 30)}..."` : "Build Job";

            const aiMsg: Message = {
                id: crypto.randomUUID(),
                role: 'assistant',
                content: finalExplanation,
                timestamp: Date.now(),
                type: 'job_summary',
                jobSummary: {
                    title: jobTitle,
                    plan: plan,
                    status: 'completed'
                },
                executionTimeMs: meta?.timeMs,
                creditsUsed: meta?.credits,
            };

            projectRef.code = finalCode;
            projectRef.messages.push(aiMsg);
            if (!projectRef.buildState?.phases || projectRef.buildState.phases.length === 0) {
                 projectRef.status = 'idle';
            }
            if (projectRef.buildState) {
                projectRef.buildState.currentStep = projectRef.buildState.plan.length;
                projectRef.buildState.lastCompletedStep = projectRef.buildState.plan.length - 1;
                projectRef.buildState.error = null;
            }
            updateState({ ...projectRef });
            await save(projectRef);
            
            if (!projectRef.buildState?.phases) {
                // If single phase, send complete here
                webhookService.send('build.completed', { steps: plan.length, timeMs: meta?.timeMs, credits: meta?.credits }, { project_id: projectRef.id });
            }
            
            requireClient().auth.refreshSession();
        },
        onError: async (error, retriesLeft) => {
             if (projectRef.buildState) {
                projectRef.buildState.error = error;
                updateState({ ...projectRef });
                await save(projectRef);
            }
            try {
                const client = requireClient();
                await client.from('system_logs').insert({
                    level: 'error',
                    source: 'BuildWorker',
                    message: error,
                    project_id: projectRef.id
                });
                webhookService.send('system.warning', { message: error, source: 'BuildWorker' }, { project_id: projectRef.id });
            } catch(e) {}
        },
        onFinalError: async (error, plan) => {
            const isSystemTrigger = error === DB_CONNECT_MESSAGE;
            if (isSystemTrigger) {
                const errorMsg: Message = { id: crypto.randomUUID(), role: 'assistant', content: error, timestamp: Date.now() };
                projectRef.messages.push(errorMsg);
                projectRef.status = 'idle';
                updateState({ ...projectRef });
                await save(projectRef);
            } else {
                 const lastUserMsg = [...projectRef.messages].reverse().find(m => m.role === 'user');
                const jobTitle = lastUserMsg ? `Job: "${lastUserMsg.content.substring(0, 30)}..."` : "Build Job";

                const errorMsg: Message = {
                    id: crypto.randomUUID(),
                    role: 'assistant',
                    content: `Build failed: ${error}`,
                    timestamp: Date.now(),
                    type: 'job_summary',
                    jobSummary: {
                        title: jobTitle,
                        plan: plan || ['Plan generation failed.'],
                        status: 'failed',
                    },
                };
                projectRef.messages.push(errorMsg);
                projectRef.status = 'idle';
                if (projectRef.buildState) {
                    projectRef.buildState.error = error;
                }
                updateState({ ...projectRef });
                await save(projectRef);

                try {
                    const client = requireClient();
                    await client.from('system_logs').insert({
                        level: 'critical',
                        source: 'AI',
                        message: error,
                        project_id: projectRef.id
                    });
                    webhookService.send('build.failed', { error, plan }, { project_id: projectRef.id });
                } catch(e) {}
            }
        }
    };
}

export const cloudService = {
  // ... existing methods (onAuthStateChange, getCurrentUser, login, register, etc.) ...
  onAuthStateChange(callback: (user: User | null) => void) {
    const client = requireClient();
    const { data: { subscription } } = client.auth.onAuthStateChange(async (event, session) => {
        const fullUser = await getFullUserFromSession(session);
        callback(fullUser);
    });
    return () => subscription.unsubscribe();
  },

  async getCurrentUser(): Promise<User | null> {
    if (!supabase) return null;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      return await getFullUserFromSession(session);
    } catch (e) { return null; }
  },
  
  async login(email: string, password: string): Promise<User> {
    const client = requireClient();
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw wrapError(error, 'login');
    const fullUser = await getFullUserFromSession(data);
    if (!fullUser) throw new Error("Login failed: User not found after session creation.");
    webhookService.send('user.logged_in', { method: 'email' }, {}, fullUser);
    return fullUser;
  },

  async register(email: string, password: string, name: string): Promise<User> {
    const client = requireClient();
    const avatar = `https://ui-avatars.com/api/?name=${name.split(' ').join('+')}&background=random`;
    const { data, error } = await client.auth.signUp({
        email,
        password,
        options: { data: { name: name, avatar_url: avatar } }
    });
    if (error) throw wrapError(error, 'register');
    const fullUser = await getFullUserFromSession(data);
    if (!fullUser) throw new Error("Registration failed: Could not create user profile.");
    webhookService.send('user.registered', { method: 'email', name }, {}, fullUser);
    return fullUser;
  },

  async signInWithGoogle(): Promise<void> {
    const client = requireClient();
    const { error } = await client.auth.signInWithOAuth({ provider: 'google' });
    if (error) throw wrapError(error, 'signInWithGoogle');
  },
  
  async signInWithGitHub(): Promise<void> {
    const client = requireClient();
    const { error } = await client.auth.signInWithOAuth({ provider: 'github' });
    if (error) throw wrapError(error, 'signInWithGitHub');
  },

  async logout(): Promise<void> {
    const client = requireClient();
    // Get user before logout for webhook
    const { data: { user } } = await client.auth.getUser();
    if (user) {
        webhookService.send('user.logged_out', {}, {}, { id: user.id, email: user.email || '' });
    }
    const { error } = await client.auth.signOut();
    if (error) throw wrapError(error, 'logout');
  },

  // ... (Other existing methods: saveRafieiCloudProject, createNewProjectAndInitiateBuild, createImportedProject, getProjects, etc.) ...
  async saveRafieiCloudProject(cloudProject: RafieiCloudProject): Promise<void> {
    const client = requireClient();
    const payload = {
        id: cloudProject.id,
        user_id: cloudProject.userId,
        project_ref: cloudProject.projectRef,
        project_name: cloudProject.projectName,
        status: cloudProject.status,
        region: cloudProject.region,
        db_pass: cloudProject.dbPassword,
        publishable_key: cloudProject.publishableKey,
        secret_key: cloudProject.secretKey,
        created_at: new Date(cloudProject.createdAt).toISOString()
    };
    const { error } = await client.from('rafiei_cloud_projects').upsert(payload, { onConflict: 'id' });
    if (error) {
        if (error.code === '42P01') throw new DatabaseSetupError("TABLE_MISSING");
        throw wrapError(error, 'saveRafieiCloudProject');
    }
    
    if (cloudProject.status === 'ACTIVE') {
        webhookService.send('cloud.connected', { projectRef: cloudProject.projectRef }, { project_id: cloudProject.id }, { id: cloudProject.userId, email: '' });
    } else if (cloudProject.status === 'FAILED') {
        webhookService.send('cloud.connection_failed', { projectRef: cloudProject.projectRef }, { project_id: cloudProject.id }, { id: cloudProject.userId, email: '' });
    }
  },

  async createNewProjectAndInitiateBuild(user: User, prompt: string, images: { url: string; base64: string }[]): Promise<string> {
    const name = await generateProjectTitle(prompt);
    const userMsg: Message = { id: crypto.randomUUID(), role: 'user', content: prompt, timestamp: Date.now(), images: images.map(i => i.url) };
    const newProject: Project = {
      id: crypto.randomUUID(),
      userId: user.id,
      name,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      code: { html: '', javascript: '', css: '', explanation: '' },
      messages: [userMsg],
      status: 'idle', 
      buildState: null,
      supabaseConfig: await this.getUserSettings(user.id) || undefined
    };
    await this.saveProject(newProject);
    
    webhookService.send('project.created', { name: newProject.name }, { project_id: newProject.id }, user);
    
    return newProject.id;
  },

  async createImportedProject(user: User, name: string, files: ProjectFile[]): Promise<string> {
      let html = '';
      let javascript = '';
      let css = '';

      const indexHtml = files.find(f => f.path.endsWith('index.html'));
      if (indexHtml) html = indexHtml.content;

      const mainJs = files.find(f => f.path.endsWith('src/main.tsx') || f.path.endsWith('src/main.jsx') || f.path.endsWith('src/index.tsx') || f.path.endsWith('src/index.js'));
      if (mainJs) javascript = mainJs.content;

      const indexCss = files.find(f => f.path.endsWith('src/index.css') || f.path.endsWith('src/App.css'));
      if (indexCss) css = indexCss.content;

      const newProject: Project = {
          id: crypto.randomUUID(),
          userId: user.id,
          name,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          code: { html, javascript, css, explanation: 'Imported from GitHub' },
          files: files,
          messages: [{
              id: crypto.randomUUID(),
              role: 'assistant',
              content: `Project imported successfully. \n\n**Detected Files:** ${files.length}\n**Entry Point:** ${mainJs ? mainJs.path : 'Not found (Preview might need adjustment)'}`,
              timestamp: Date.now()
          }],
          status: 'idle',
          buildState: null,
          supabaseConfig: await this.getUserSettings(user.id) || undefined
      };

      await this.saveProject(newProject);
      webhookService.send('project.imported_from_github', { name, fileCount: files.length }, { project_id: newProject.id }, user);
      return newProject.id;
  },

  async getProjects(userId: string): Promise<Project[]> {
    const client = requireClient();
    try {
        // NOTE: We bypass RPC 'get_dashboard_projects' because it returns a lightweight object without the 'code' column.
        // We MUST fetch the 'code' column to enable dashboard previews (ProjectCard uses srcDoc).
        /*
        try {
            const { data: rpcData, error: rpcError } = await client.rpc('get_dashboard_projects', { p_user_id: userId });
            
            if (!rpcError && rpcData) {
                return (rpcData as any[]).map(mapDashboardRowToProject);
            }
        } catch (rpcEx) {
            console.warn("RPC Optimization failed, falling back to SELECT.", rpcEx);
        }
        */

        const { data, error } = await client
            .from('projects')
            .select('id, user_id, name, created_at, updated_at, status, build_state, published_url, custom_domain, rafiei_cloud_project, deleted_at, code') // ADDED 'code'
            .eq('user_id', userId)
            .is('deleted_at', null)
            .order('updated_at', { ascending: false });
            
        if (error) throw error;
        return (data || []).map(mapRowToProject);
    } catch (error: any) {
        if (error.code === '42P01') throw new DatabaseSetupError("TABLE_MISSING");
        if (error.code === '42P17') throw new DatabaseSetupError("Infinite Recursion detected in DB Policies. Run SQL Setup.");
        
        if (error.code === '42703') {
            // Fallback for very old schema
            const { data: fallbackData, error: fallbackError } = await client.from('projects').select('id, user_id, name, created_at, updated_at, status').eq('user_id', userId).order('updated_at', { ascending: false });
            if (fallbackError) throw wrapError(fallbackError, 'getProjects_Fallback');
            return (fallbackData || []).map(mapRowToProject);
        }
        throw wrapError(error, 'getProjects');
    }
  },

  async getAdminProjects(): Promise<Project[]> {
    const client = requireClient();
    const { data, error } = await client
        .from('projects')
        .select('id, user_id, name, created_at, updated_at, status, build_state, published_url, custom_domain, rafiei_cloud_project, deleted_at, code') // ADDED 'code'
        .order('updated_at', { ascending: false });
        
    if (error) {
        if (error.code === '42501') throw new Error("Access Denied: Admin privileges required. Run SQL Setup.");
        if (error.code === '42703') {
             const { data: fallbackData, error: fallbackError } = await client.from('projects').select('id, user_id, name, created_at, updated_at, status').order('updated_at', { ascending: false });
             if (fallbackError) throw wrapError(fallbackError, 'getAdminProjects_Fallback');
             return (fallbackData || []).map(mapRowToProject);
        }
        throw wrapError(error, 'getAdminProjects');
    }
    return (data || []).map(mapRowToProject);
  },

  async getAdminUsers(): Promise<any[]> {
    const client = requireClient();
    const { data, error } = await client.rpc('get_all_users');
    if (error) {
        if (error.message?.includes('does not exist')) throw new Error("Missing 'get_all_users' function. Run SQL Setup.");
        console.warn("getAdminUsers RPC failed:", error);
        return [];
    }
    return data || [];
  },

  async getSystemLogs(): Promise<SystemLog[]> {
    const client = requireClient();
    const { data, error } = await client.from('system_logs').select('*').order('created_at', { ascending: false }).limit(100);
    if (error) {
        if (error.code === '42P01') return []; 
        throw wrapError(error, 'getSystemLogs');
    }
    return (data || []).map((row: any) => ({
        id: row.id,
        timestamp: new Date(row.created_at).getTime(),
        level: row.level,
        source: row.source,
        message: row.message,
        projectId: row.project_id,
        meta: row.meta
    }));
  },
  
  async getAiUsageStats(): Promise<any[]> {
      const client = requireClient();
      const { data, error } = await client.from('ai_usage').select('*').order('created_at', { ascending: false }).limit(500);
      if (error) {
          if (error.code === '42P01') return [];
          throw wrapError(error, 'getAiUsageStats');
      }
      return data || [];
  },

  async getFinancialStats(): Promise<FinancialStats> {
      const client = requireClient();
      
      const [ledgerRes, txRes, settingsRes] = await Promise.all([
          client.from('credit_ledger').select('*'),
          client.from('credit_transactions').select('*'),
          client.from('financial_settings').select('*').single()
      ]);

      const ledger = ledgerRes.data || [];
      const transactions = txRes.data || [];
      const settings = settingsRes.data;
      const error = ledgerRes.error || txRes.error;

      if (error?.code === '42P01') {
          return {
              totalRevenueCredits: 0,
              totalCostUsd: 0,
              netProfitUsd: 0,
              totalCreditsPurchased: 0,
              currentMargin: 0.5,
              totalInputTokens: 0,
              totalOutputTokens: 0,
              totalRequestCount: 0
          } as FinancialStats;
      }

      if (error) {
          console.warn("Financial stats access restricted or failed:", error.message);
          return {
              totalRevenueCredits: 0,
              totalCostUsd: 0,
              netProfitUsd: 0,
              totalCreditsPurchased: 0,
              currentMargin: 0.5,
              totalInputTokens: 0,
              totalOutputTokens: 0,
              totalRequestCount: 0
          } as FinancialStats;
      }

      let totalRevenue = 0;
      let totalCost = 0;
      let totalPurchased = 0;
      let totalInputTokens = 0;
      let totalOutputTokens = 0;

      ledger.forEach((entry: any) => {
          totalRevenue += Number(entry.credits_deducted || 0);
          totalCost += Number(entry.raw_cost_usd || 0);
          totalInputTokens += Number(entry.input_tokens || 0);
          totalOutputTokens += Number(entry.output_tokens || 0);
      });

      transactions.forEach((tx: any) => {
          if (tx.amount > 0) totalPurchased += Number(tx.amount);
      });

      return {
          totalRevenueCredits: totalRevenue || 0,
          totalCostUsd: totalCost || 0,
          netProfitUsd: (totalRevenue - totalCost) || 0,
          totalCreditsPurchased: totalPurchased || 0,
          currentMargin: settings?.profit_margin_percentage || 0.5,
          totalInputTokens: totalInputTokens || 0,
          totalOutputTokens: totalOutputTokens || 0,
          totalRequestCount: ledger.length || 0
      } as FinancialStats;
  },

  async getLedger(limit = 100): Promise<CreditLedgerEntry[]> {
      const client = requireClient();
      const { data, error } = await client.from('credit_ledger').select('*').order('created_at', { ascending: false }).limit(limit);
      if (error) {
          console.warn("Ledger fetch failed:", error.message);
          return [];
      }
      return data.map((row: any) => ({
          id: row.id,
          userId: row.user_id,
          projectId: row.project_id,
          operationType: row.operation_type,
          model: row.model,
          inputTokens: row.input_tokens,
          outputTokens: row.output_tokens,
          rawCostUsd: row.raw_cost_usd,
          profitMargin: row.profit_margin,
          creditsDeducted: row.credits_deducted,
          createdAt: new Date(row.created_at).getTime()
      }));
  },

  async getUserTransactions(userId: string): Promise<CreditTransaction[]> {
      const client = requireClient();
      const { data, error } = await client.from('credit_transactions').select('*').eq('user_id', userId).order('created_at', { ascending: false });
      if (error) {
          if (error.code === '42P01') return [];
          throw error;
      }
      return data.map((row: any) => ({
          id: row.id,
          userId: row.user_id,
          amount: Number(row.amount),
          type: row.type,
          currency: row.currency,
          exchangeRate: Number(row.exchange_rate),
          paymentId: row.payment_id,
          description: row.description,
          createdAt: new Date(row.created_at).getTime()
      }));
  },

  async adminAdjustCredit(targetUserId: string, amount: number, description: string, adminEmail: string): Promise<void> {
      const client = requireClient();
      const { error } = await client.rpc('admin_adjust_balance', {
          p_target_user_id: targetUserId,
          p_amount: amount,
          p_description: description,
          p_admin_email: adminEmail
      });
      if (error) throw new Error(`Adjustment Failed: ${error.message}`);
      
      webhookService.send('credit.added', { amount, reason: description, admin: adminEmail }, {}, { id: targetUserId, email: '' });
  },

  async getUserFinancialOverview(userId: string): Promise<any> {
      const client = requireClient();
      const { data: ledger } = await client.from('credit_ledger').select('credits_deducted, raw_cost_usd').eq('user_id', userId);
      const { data: transactions } = await client.from('credit_transactions').select('amount, type').eq('user_id', userId);
      
      let totalSpent = 0;
      let totalCost = 0;
      let totalPurchased = 0;

      ledger?.forEach((l: any) => {
          totalSpent += Number(l.credits_deducted);
          totalCost += Number(l.raw_cost_usd);
      });

      transactions?.forEach((t: any) => {
          if (t.type === 'purchase' || (t.type === 'admin_adjustment' && t.amount > 0)) {
              totalPurchased += Number(t.amount);
          }
      });

      return {
          totalPurchased,
          totalSpent,
          totalCost,
          profitGenerated: totalSpent - totalCost
      };
  },

  async getTrashedProjects(userId: string): Promise<Project[]> {
    const client = requireClient();
    try {
        const { data, error } = await client
            .from('projects')
            .select('id, user_id, name, created_at, updated_at, status, build_state, published_url, custom_domain, rafiei_cloud_project, deleted_at, code') // ADDED 'code'
            .eq('user_id', userId)
            .not('deleted_at', 'is', null)
            .order('deleted_at', { ascending: false });
            
        if (error) throw error;
        return (data || []).map(mapRowToProject);
    } catch (error: any) {
       if (error.code === '42703') {
           return []; 
       }
       throw wrapError(error, 'getTrashedProjects');
    }
  },

  async getTrashCount(userId: string): Promise<number> {
    const client = requireClient();
    try {
        const { count, error } = await client.from('projects').select('*', { count: 'exact', head: true }).eq('user_id', userId).not('deleted_at', 'is', null);
        if (error) { if (error.code === '42703' || error.code === '42P01') return 0; throw error; }
        return count || 0;
    } catch (e) { return 0; }
  },

  async getProject(projectId: string): Promise<Project | null> {
    const client = requireClient();
    const { data, error } = await client.from('projects').select('*').eq('id', projectId).single();
    if (error) { if (error.code === 'PGRST116') return null; throw wrapError(error, 'getProject'); }
    
    const project = mapRowToProject(data);
    webhookService.send('project.opened', { name: project.name }, { project_id: project.id }, { id: project.userId, email: '' });
    
    return project;
  },

  async saveProject(project: Project): Promise<void> {
    const client = requireClient();
    const payload = {
        id: project.id, user_id: project.userId, name: project.name,
        code: project.code, files: project.files, messages: project.messages,
        status: project.status, build_state: project.buildState, published_url: project.publishedUrl,
        custom_domain: project.customDomain,
        supabase_config: project.supabaseConfig,
        rafiei_cloud_project: project.rafieiCloudProject
    };
    const { error } = await client.from('projects').upsert(payload, { onConflict: 'id' });
    if (error) {
        if (error.code === '42P01') throw new DatabaseSetupError("TABLE_MISSING");
        if (error.code === '42703') throw new DatabaseSetupError("SCHEMA_MISMATCH");
        if (error.code === '42P17') throw new DatabaseSetupError("Infinite Recursion detected in DB Policies. Run SQL Setup.");
        throw wrapError(error, 'saveProject');
    }
  },

  async softDeleteProject(projectId: string): Promise<void> {
      const client = requireClient();
      const { error } = await client.from('projects').update({ deleted_at: new Date().toISOString() }).eq('id', projectId);
      if (error) {
          if (error.code === '42703' || error.message?.includes('deleted_at')) {
             return this.deleteProject(projectId);
          }
          throw wrapError(error, 'softDeleteProject');
      }
      webhookService.send('project.deleted', { method: 'soft' }, { project_id: projectId });
  },

  async restoreProject(projectId: string): Promise<void> {
      const client = requireClient();
      const { error } = await client.from('projects').update({ deleted_at: null }).eq('id', projectId);
      if (error) throw wrapError(error, 'restoreProject');
      webhookService.send('project.updated', { status: 'restored' }, { project_id: projectId });
  },
  
  async deleteProject(projectId: string): Promise<void> {
      const client = requireClient();
      const { error } = await client.from('projects').delete().eq('id', projectId);
      if (error) throw wrapError(error, 'deleteProject');
      webhookService.send('project.deleted', { method: 'permanent' }, { project_id: projectId });
  },

  // ... (subscribeToProjectChanges, subscribeToUserProjects, uploadChatImage, stopBuild, triggerBuild, getDomainsForProject, addDomain, deleteDomain, verifyDomain, getUserSettings, saveUserSettings, getUserLanguage, saveUserLanguage, checkTableExists, checkBucketExists, testConnection, rpc) ...
  subscribeToProjectChanges(projectId: string, callback: (project: Project) => void): { unsubscribe: () => void } {
    const client = requireClient();
    const channel: RealtimeChannel = client
      .channel(`project-${projectId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'projects', filter: `id=eq.${projectId}` }, (payload) => callback(mapRowToProject(payload.new)))
      .subscribe();
      return { unsubscribe: () => client.removeChannel(channel) };
  },

  subscribeToUserProjects(userId: string, callback: (payload: any) => void): { unsubscribe: () => void } {
    const client = requireClient();
    const channel: RealtimeChannel = client
        .channel(`user-projects-${userId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'projects', filter: `user_id=eq.${userId}` }, callback)
        .subscribe();
    return { unsubscribe: () => client.removeChannel(channel) };
  },

  async uploadChatImage(userId: string, messageId: string, file: File): Promise<string> {
    const client = requireClient();
    const filePath = `${userId}/${messageId}/${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
    const { error } = await client.storage.from('chat-images').upload(filePath, file, { upsert: true });
    if (error) throw wrapError(error, 'uploadChatImage');
    const { data } = client.storage.from('chat-images').getPublicUrl(filePath);
    return data.publicUrl;
  },

  stopBuild(projectId: string) {
      const controller = buildAbortControllers.get(projectId);
      if (controller) {
          controller.abort();
          buildAbortControllers.delete(projectId);
      }
  },

  async triggerBuild(
    project: Project, 
    prompt: string, 
    images?: { url: string, base64: string }[],
    onStateChange?: (project: Project) => void
  ): Promise<void> {
      const finalMessages = [...project.messages];
      const lastUserMsg = [...finalMessages].reverse().find(m => m.role === 'user');

      if (!lastUserMsg) {
          console.error("triggerBuild: No user message found");
          if (project.status === 'generating') await this.saveProject({ ...project, status: 'idle' });
          return;
      }

      if (images && images.length > 0) {
          const lastUserMsgIndex = finalMessages.findIndex(m => m.id === lastUserMsg.id);
          if (lastUserMsgIndex !== -1) {
              const imageUrls = images.map(img => img.url);
              const existingImages = finalMessages[lastUserMsgIndex].images || [];
              const allImages = [...new Set([...existingImages, ...imageUrls])];
              finalMessages[lastUserMsgIndex] = { ...finalMessages[lastUserMsgIndex], images: allImages };
          }
      }
      
      let phases: Phase[] = [];
      const isModification = /\b(change|update|fix|move|resize|color|font|text|remove|delete|add)\b/i.test(prompt);
      const isComplexKeywords = /\b(full app|platform|clone|dashboard|system|database|auth|social|commerce|store|complex)\b/i.test(prompt);
      const isShortAndSimple = prompt.length < 80 && !isComplexKeywords;
      const shouldSkipPlanning = isModification || isShortAndSimple;
      
      if (!shouldSkipPlanning) {
          try {
              phases = await generatePhasePlan(prompt, finalMessages);
          } catch (e) {}
      }
      
      const buildState: BuildState = { 
          plan: [], 
          currentStep: 0, 
          lastCompletedStep: -1, 
          error: null,
          phases: phases.length > 0 ? phases : undefined,
          currentPhaseIndex: 0
      };

      const updatedProject: Project = {
          ...project,
          messages: finalMessages,
          status: 'generating',
          buildState: buildState
      };
      
      if (onStateChange) onStateChange(updatedProject);
      await this.saveProject(updatedProject);
      
      this.stopBuild(project.id);
      
      const controller = new AbortController();
      buildAbortControllers.set(project.id, controller);
      
      setTimeout(() => {
          const imageDataForAI = images ? images.map(img => img.base64) : [];
          runBuildOnServer(updatedProject, prompt, imageDataForAI, onStateChange, (p) => this.saveProject(p), controller.signal)
            .catch(error => {
                if (error.message !== 'Build cancelled by user') {
                     requireClient().from('system_logs').insert({
                         level: 'critical', source: 'System', message: `Fatal Build Error: ${error.message}`, project_id: project.id
                     }).catch(console.error);
                }
            })
            .finally(() => {
                if (buildAbortControllers.get(updatedProject.id) === controller) {
                    buildAbortControllers.delete(updatedProject.id);
                }
            });
      }, 0);
  },

  async getDomainsForProject(projectId: string): Promise<Domain[]> { return []; },
  async addDomain(projectId: string, userId: string, domainName: string): Promise<void> {},
  async deleteDomain(domainId: string): Promise<void> {},
  async verifyDomain(domainId: string): Promise<Domain> { return {} as any; },

  async getUserSettings(userId: string): Promise<{url: string, key: string} | null> {
      const client = requireClient();
      try {
          const { data, error } = await client.from('user_settings').select('supabase_config').eq('user_id', userId).single();
          if (error) { if (error.code === 'PGRST116' || error.code === '42P01') return null; throw error; }
          return data?.supabase_config || null;
      } catch (e) { return null; }
  },

  async saveUserSettings(userId: string, config: {url: string, key: string} | null): Promise<void> {
      const client = requireClient();
      if (config === null) await client.from('user_settings').upsert({ user_id: userId, supabase_config: null });
      else await client.from('user_settings').upsert({ user_id: userId, supabase_config: config });
  },

  async getUserLanguage(userId: string): Promise<string | null> {
      const client = requireClient();
      try {
          const { data, error } = await client.from('user_settings').select('language').eq('user_id', userId).single();
          if (error) { if (error.code === 'PGRST116' || error.code === '42P01') return null; return null; }
          return data?.language || null;
      } catch (e) { return null; }
  },

  async saveUserLanguage(userId: string, language: string): Promise<void> {
      const client = requireClient();
      await client.from('user_settings').upsert({ user_id: userId, language: language }, { onConflict: 'user_id' });
  },

  async getUserCredits(userId: string): Promise<number> {
      const client = requireClient();
      const { data, error } = await client.from('user_settings').select('credits_balance').eq('user_id', userId).single();
      if (error) return 0;
      return data?.credits_balance ?? 0;
  },

  async checkTableExists(tableName: string): Promise<boolean> {
      const client = requireClient();
      const { error } = await client.from(tableName).select('id').limit(1);
      if (error && error.code === '42P01') return false;
      return true;
  },

  async checkBucketExists(bucketName: string): Promise<boolean> {
      const client = requireClient();
      const { data, error } = await client.storage.getBucket(bucketName);
      if (error || !data) return false;
      return true;
  },
  
  async testConnection(url: string, key: string): Promise<boolean> {
      if (!url || !key) return false;
      try {
          const tempClient = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
          const { error } = await tempClient.from('__check__').select('*').limit(1);
          if (error && error.code !== '42P01' && error.code !== 'PGRST205') return false; 
          return true; 
      } catch (e) { return false; }
  },

  async rpc(funcName: string, params: any) {
      const client = requireClient();
      return await client.rpc(funcName, params);
  },

  // --- NEW: Webhook Management Methods ---
  async getSystemSetting(key: string): Promise<string | null> {
      const client = requireClient();
      const { data, error } = await client.from('system_settings').select('value').eq('key', key).single();
      if (error || !data) return null;
      return data.value;
  },

  async setSystemSetting(key: string, value: string): Promise<void> {
      const client = requireClient();
      const { error } = await client.from('system_settings').upsert({ key, value });
      if (error) throw wrapError(error, 'setSystemSetting');
  },

  async getWebhookLogs(limit = 50): Promise<WebhookLog[]> {
      const client = requireClient();
      const { data, error } = await client.from('webhook_logs').select('*').order('created_at', { ascending: false }).limit(limit);
      if (error) {
          if (error.code === '42P01') return []; // Table missing
          throw wrapError(error, 'getWebhookLogs');
      }
      return data.map((row: any) => ({
          id: row.id,
          event_type: row.event_type,
          payload: row.payload,
          status_code: row.status_code,
          response_body: row.response_body,
          created_at: new Date(row.created_at).getTime()
      }));
  },

  async saveWebhookLog(log: Partial<WebhookLog>) {
      const client = requireClient();
      // Use client directly to avoid recursion or extra checks
      await client.from('webhook_logs').insert(log).catch(console.warn);
  }
};
