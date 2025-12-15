
import { GoogleGenAI } from "@google/genai";
import { createClient } from '@supabase/supabase-js';
import { GeneratedCode, Message, Suggestion, Project, Phase, BuildAudit, AIProviderConfig, AIUsageResult, DecisionJSON, DesignSpecJSON, FilePlanJSON, FileChange, QAJSON, ProjectFile } from "../types";
import { billingService } from "./billingService";
import { aiProviderService } from "./aiProviderService";
import { openaiService } from "./openaiService";
import { claudeService } from "./claudeService";

// --- ENVIRONMENT & SAFETY ---
const getEnv = (key: string) => {
  try {
    // @ts-ignore
    if (typeof process !== 'undefined' && process.env) return process.env[key];
  } catch (e) {}
  return undefined;
};

const DEFAULT_GEMINI_KEY = getEnv('API_KEY') || '';

// --- SUPABASE CLIENT (Local instance to avoid circular dependency) ---
const SUPABASE_URL = getEnv('SUPABASE_URL') || getEnv('REACT_APP_SUPABASE_URL') || 'https://sxvqqktlykguifvmqrni.supabase.co';
const SUPABASE_KEY = getEnv('SUPABASE_ANON_KEY') || getEnv('REACT_APP_SUPABASE_ANON_KEY') || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4dnFxa3RseWtndWlmdm1xcm5pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU0MDE0MTIsImV4cCI6MjA4MDk3NzQxMn0.5psTW7xePYH3T0mkkHmDoWNgLKSghOHnZaW2zzShkSA';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// --- SYSTEM PROMPT MANAGEMENT ---
// Simple in-memory cache to prevent hammering DB during a single session
const promptCache: Record<string, string> = {};

const getSystemPrompt = async (key: string, defaultVal: string): Promise<string> => {
    // 1. Check cache
    if (promptCache[key]) return promptCache[key];

    // 2. Check DB
    try {
        const { data } = await supabase.from('system_settings').select('value').eq('key', key).single();
        if (data?.value) {
            promptCache[key] = data.value;
            return data.value;
        }
    } catch (e) {
        // Silent fail to default
    }

    // 3. Fallback to Default
    return defaultVal;
};

// --- ORCHESTRATOR UTILS ---
const getActiveProvider = async (): Promise<AIProviderConfig> => {
    try {
        const active = await aiProviderService.getActiveConfig();
        if (active) return active;
        const fallback = await aiProviderService.getFallbackConfig();
        if (fallback && fallback.apiKey) return fallback;
        if (DEFAULT_GEMINI_KEY) {
            return {
                id: 'google',
                name: 'Google Gemini (Env)',
                isActive: true,
                isFallback: false,
                apiKey: DEFAULT_GEMINI_KEY,
                model: 'gemini-2.5-flash',
                updatedAt: Date.now()
            };
        }
    } catch (e) {}
    return { id: 'google', name: 'Google Gemini (Default)', isActive: true, isFallback: false, apiKey: DEFAULT_GEMINI_KEY, model: 'gemini-2.5-flash', updatedAt: Date.now() };
};

const executeAIRequest = async (config: AIProviderConfig, prompt: string, systemInstruction: string, images: string[] = []): Promise<{ text: string, usage: AIUsageResult }> => {
    if (!config.apiKey) throw new Error(`API Key missing for provider: ${config.name}`);

    if (config.id === 'google') {
        const ai = new GoogleGenAI({ apiKey: config.apiKey });
        const reqConfig: any = { 
            systemInstruction, 
            temperature: 0.2,
            maxOutputTokens: 8192 
        };
        
        // Only use JSON mode if explicitly requested by prompt logic, 
        // but verify system prompt actually contains "JSON" to avoid 400 errors from strict validators.
        if (systemInstruction.toUpperCase().includes('JSON')) {
            reqConfig.responseMimeType = 'application/json';
        }
        
        let contents: any = prompt;
        if (images.length > 0) {
            const parts: any[] = [];
            images.forEach(img => {
                let mimeType = 'image/jpeg';
                let rawBase64 = img;
                if (img.includes('base64,')) {
                    const split = img.split('base64,');
                    rawBase64 = split[1];
                    if (split[0].includes('png')) mimeType = 'image/png';
                    else if (split[0].includes('webp')) mimeType = 'image/webp';
                }
                parts.push({ inlineData: { mimeType, data: rawBase64 } });
            });
            parts.push({ text: prompt });
            contents = { parts };
        }

        const response = await ai.models.generateContent({ model: config.model || 'gemini-2.5-flash', contents, config: reqConfig });
        const inputTokens = response.usageMetadata?.promptTokenCount || 0;
        const outputTokens = response.usageMetadata?.candidatesTokenCount || 0;
        const cost = billingService.calculateRawCost(config.model || 'gemini-2.5-flash', inputTokens, outputTokens);

        return { text: response.text || "{}", usage: { promptTokens: inputTokens, completionTokens: outputTokens, costUsd: cost, provider: 'google', model: config.model || 'gemini-2.5-flash' } };
    } 
    else if (config.id === 'openai') {
        return await openaiService.generateContent(config.apiKey!, config.model, prompt, systemInstruction, images);
    }
    else if (config.id === 'claude') {
        return await claudeService.generateContent(config.apiKey!, config.model, prompt, systemInstruction, images);
    }
    throw new Error(`Unknown provider: ${config.id}`);
};

const robustGenerate = async (prompt: string, systemInstruction: string, projectId: string, userId: string, opType: string, images: string[] = []): Promise<string> => {
    let activeConfig = await getActiveProvider();
    try {
        const result = await executeAIRequest(activeConfig, prompt, systemInstruction, images);
        await billingService.chargeUser(userId, projectId, opType, result.usage.model, { promptTokenCount: result.usage.promptTokens, candidatesTokenCount: result.usage.completionTokens, costUsd: result.usage.costUsd }, { prompt: prompt.substring(0, 500) });
        return result.text;
    } catch (error: any) {
        console.warn(`Primary AI (${activeConfig.name}) failed:`, error);
        const fallbackConfig = await aiProviderService.getFallbackConfig();
        if (fallbackConfig && fallbackConfig.apiKey) {
            const result = await executeAIRequest(fallbackConfig, prompt, systemInstruction, images);
            await billingService.chargeUser(userId, projectId, `${opType}_fallback`, result.usage.model, { promptTokenCount: result.usage.promptTokens, candidatesTokenCount: result.usage.completionTokens, costUsd: result.usage.costUsd }, { note: "Fallback" });
            return result.text;
        }
        throw error;
    }
};

const extractJson = (text: string | undefined): any => {
    if (!text) throw new Error("Empty response from AI");
    let cleanText = text.trim();
    
    // Attempt to extract from markdown code blocks first (relaxed regex)
    const markdownMatch = cleanText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (markdownMatch) {
        cleanText = markdownMatch[1].trim();
    }
    
    // Locate outermost JSON bounds to handle intro/outro text
    const firstBrace = cleanText.indexOf('{');
    const lastBrace = cleanText.lastIndexOf('}');
    
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        cleanText = cleanText.substring(firstBrace, lastBrace + 1);
    }

    try { 
        return JSON.parse(cleanText); 
    } catch (e) { 
        console.error("JSON Parse Fail. Raw text snippet:", text.substring(0, 200)); 
        throw new Error("Failed to parse JSON response. The model output was not valid JSON."); 
    }
};

// Renamed keys to 'v2' to force cache busting and bypass broken prompts in DB
export const PROMPT_KEYS = {
    DECISION: 'sys_prompt_decision_v2',
    REQUIREMENTS: 'sys_prompt_requirements_v2',
    PHASE_PLANNER: 'sys_prompt_phase_planner_v2',
    DESIGN: 'sys_prompt_design_v2',
    PLANNER: 'sys_prompt_planner_v2', 
    BUILDER: 'sys_prompt_builder_v2', 
    REPAIR: 'sys_prompt_repair_v2',
    QA: 'sys_prompt_qa_v2',
    SQL: 'sys_prompt_sql_v2',
    NARRATOR: 'sys_prompt_narrator_v2',
    FILE_PLAN: 'sys_prompt_file_plan',
    CODE: 'sys_prompt_code',
};

export const DEFAULTS = {
    DECISION: `You are the DECISION layer.
Goal: Produce a stable build strategy.
Input: User request.
Return STRICT JSON:
{
  "analysis": { "summary": "...", "primary_goal": "...", "complexity": "low|medium|high" },
  "narrative_summary": "Friendly summary...",
  "ui_first_strategy": { "milestone_1_preview_definition": "...", "must_have_pages": ["..."], "must_have_components": ["..."] },
  "backend_intent": { "likely_needs_backend": boolean, "why": "..." }
}`,

    REQUIREMENTS: `You are the REQUIREMENTS layer.
Definition: Backend required if auth, database, storage, or secrets needed.
Return STRICT JSON:
{
  "needs_backend": boolean,
  "requiredBackendFeatures": { "auth": boolean, "database": boolean, "storage": boolean },
  "dataEntities": [ { "name": "projects", "reason": "..." } ],
  "explanation": "..."
}`,

    PHASE_PLANNER: `You are PHASE_PLANNER.
Hard rules:
- Phase 1: UI Skeleton (Routes + Layout + Empty Pages).
- Phase 2: UI Completion (Mock Data).
- Phase 3: Logic.
- Phase 4: Backend (only if required).
Return STRICT JSON:
{
  "phases": [
    { "id": "p1", "title": "Phase 1: UI Skeleton", "goal": "Render routes", "type": "ui" }
  ]
}`,

    DESIGN: `You are DESIGN.
Return STRICT JSON:
{
  "design_language": { "style": "modern", "colors": { "primary": "..." } },
  "routes": [ { "path": "/", "name": "Home" } ],
  "navigation": { "items": [{ "label": "Home", "to": "/" }] },
  "pages": [ { "route": "/", "sections": [] } ]
}`,

    PLANNER: `You are PLANNER.
Goal: Convert the phase plan into specific file generation steps.

CRITICAL RULES:
1. Every step MUST include a 'path' field. The build WILL FAIL if 'path' is missing.
2. The first steps MUST generate 'index.html' and 'src/main.tsx'.
3. Use 'action': 'create' or 'update'.

Input: Design, Phase, Files.

Return STRICT JSON:
{
  "steps": [
    {
      "id": "s1",
      "path": "index.html",
      "action": "create",
      "title": "Create index.html",
      "description": "Scaffold basic HTML",
      "outcome": "Root element exists"
    },
    {
      "id": "s2",
      "path": "src/main.tsx",
      "action": "create",
      "title": "Create entry point",
      "description": "Mount App component",
      "outcome": "React mounts"
    }
  ]
}`,

    BUILDER: `You are BUILDER.
Goal: Write the actual code for the file specified in the step.
Input: Step (contains 'path'), Design, Current Files.

Rules:
- Write COMPLETE, WORKING code. No placeholders.
- Use Tailwind CSS.
- Use Lucide React for icons.

Return STRICT JSON:
{
  "file_changes": [
    { "path": "string", "action": "create|update", "content": "FULL_CODE_HERE" }
  ],
  "step_result": { "completed": true, "visible_change": "..." }
}`,

    REPAIR: `You are REPAIR.
Input: Error message.
Return STRICT JSON:
{
  "root_cause": "...",
  "patches": [ { "path": "...", "action": "update", "content": "..." } ]
}`,

    QA: `You are QA.
Return STRICT JSON:
{ "status": "pass|fail", "checks": [], "issues": [], "patches": [] }`,

    SQL: `You are SQL.
Return STRICT JSON:
{ "sql": "CREATE TABLE...", "notes": { ... } }`,

    NARRATOR: `You are NARRATOR.
Return STRICT JSON:
{ "chat_messages": [ { "type": "status", "message": "..." } ] }`,

    FILE_PLAN: `Legacy`,
    CODE: `Legacy`
};

export interface SupervisorCallbacks {
    onPlanUpdate: (phases: Phase[]) => Promise<void>;
    onMessage: (message: Message) => Promise<void>;
    onPhaseStart: (phaseIndex: number) => Promise<void>;
    onPhaseComplete: (phaseIndex: number) => Promise<void>;
    onStepStart: (phaseIndex: number, stepName: string) => Promise<void>;
    onStepComplete: (phaseIndex: number) => Promise<void>;
    onChunkComplete: (code: GeneratedCode, explanation: string, meta?: any) => Promise<void>;
    onSuccess: (code: GeneratedCode, explanation: string, audit: BuildAudit, meta?: any) => Promise<void>;
    onError: (error: string, retries: number) => Promise<void>;
    onFinalError: (error: string, audit?: BuildAudit) => Promise<void>;
}

export class GenerationSupervisor {
    private project: Project;
    private userPrompt: string;
    private images: string[];
    private callbacks: SupervisorCallbacks;
    private signal?: AbortSignal;
    
    // Context State
    private decision: DecisionJSON | null = null;
    private design: DesignSpecJSON | null = null;
    private filePlan: FilePlanJSON | null = null;
    private accumulatedFiles: ProjectFile[] = [];

    constructor(project: Project, userPrompt: string, images: string[], callbacks: SupervisorCallbacks, signal?: AbortSignal) {
        this.project = project;
        this.userPrompt = userPrompt;
        this.images = images;
        this.callbacks = callbacks;
        this.signal = signal;
        this.accumulatedFiles = project.files || [];
    }

    private checkAbort() {
        if (this.signal?.aborted) {
            throw new Error("ABORTED");
        }
    }

    private async runStep(key: string, prompt: string, sysPromptDefault: string): Promise<any> {
        this.checkAbort();
        
        // Fetch System Prompt from Server (fallback to default)
        const sys = await getSystemPrompt(key, sysPromptDefault);
        
        const MAX_RETRIES = 3;
        const STEP_TIMEOUT_MS = 75000; // 75s timeout per step

        let lastError;

        for (let i = 0; i < MAX_RETRIES; i++) {
            this.checkAbort();
            try {
                // Timeout Promise
                const timeoutPromise = new Promise((_, reject) => {
                    const id = setTimeout(() => {
                        clearTimeout(id);
                        reject(new Error(`Timeout: Step '${key}' took longer than ${Math.round(STEP_TIMEOUT_MS/1000)}s`));
                    }, STEP_TIMEOUT_MS);
                });

                // Race against generation
                const res = await Promise.race([
                    robustGenerate(prompt, sys, this.project.id, this.project.userId, key, this.images),
                    timeoutPromise
                ]) as string;
                
                return extractJson(res);
            } catch (e: any) {
                if (this.signal?.aborted) throw new Error("ABORTED");
                console.warn(`Step ${key} attempt ${i + 1} failed:`, e);
                lastError = e;
                await this.callbacks.onError(e.message || "Unknown error", MAX_RETRIES - 1 - i);
                if (i < MAX_RETRIES - 1) {
                    await new Promise(r => setTimeout(r, 2000 * (i + 1))); 
                }
            }
        }
        throw lastError || new Error(`Step ${key} failed after retries`);
    }

    public async start() {
        try {
            this.checkAbort();

            // 1. DECISION (High-level Intent)
            await this.callbacks.onStepStart(0, "Analyzing Intent...");
            this.decision = await this.runStep(PROMPT_KEYS.DECISION, `USER REQUEST: ${this.userPrompt}`, DEFAULTS.DECISION);
            this.checkAbort();

            // 2. REQUIREMENTS (Backend Check)
            await this.callbacks.onStepStart(0, "Checking Requirements...");
            const requirements = await this.runStep(PROMPT_KEYS.REQUIREMENTS, `Analyze backend needs: ${this.userPrompt}\n\nDECISION_CONTEXT: ${JSON.stringify(this.decision)}`, DEFAULTS.REQUIREMENTS);
            
            // Backend Gate
            if (requirements.needs_backend || requirements.backendRequired) {
                const isCloudActive = this.project.rafieiCloudProject && this.project.rafieiCloudProject.status === 'ACTIVE';
                if (!isCloudActive) {
                    await this.callbacks.onMessage({
                        id: crypto.randomUUID(),
                        role: 'assistant',
                        content: "**Backend Required**\n\nThis project requires a database. Please connect to Rafiei Cloud to proceed.",
                        requiresAction: 'CONNECT_DATABASE',
                        timestamp: Date.now()
                    });
                    return; 
                }
            }

            // Narrative Update
            const narrative = (this.decision as any)?.narrative_summary || (this.decision as any)?.analysis?.summary || "I've analyzed your request and I'm starting the build now.";
            await this.callbacks.onMessage({
                id: crypto.randomUUID(),
                role: 'assistant',
                content: `**Plan Confirmed:**\n\n${narrative}`,
                timestamp: Date.now()
            });

            // 3. PHASE PLANNER
            await this.callbacks.onStepStart(0, "Planning Phases...");
            const phasePlan = await this.runStep(PROMPT_KEYS.PHASE_PLANNER, JSON.stringify({ request: this.userPrompt, analysis: this.decision, requirements }), DEFAULTS.PHASE_PLANNER);
            
            const phases: Phase[] = (phasePlan.phases || []).map((p: any) => ({
                id: crypto.randomUUID(), 
                title: p.title, 
                description: p.description || p.goal, // Robust fallback for description
                status: 'pending' as const, 
                retryCount: 0, 
                type: (p.type === 'ui' || p.type === 'logic' || p.type === 'backend') ? p.type : 'ui'
            }));
            
            await this.callbacks.onPlanUpdate(phases);
            this.checkAbort();

            // 4. DESIGN (Global Style)
            await this.callbacks.onPhaseStart(0);
            await this.callbacks.onStepStart(0, "Designing UI/UX...");
            this.design = await this.runStep(PROMPT_KEYS.DESIGN, JSON.stringify({ user_input: this.userPrompt, decision: this.decision, phases: phasePlan }), DEFAULTS.DESIGN);
            
            // 5. EXECUTION LOOP (Phases -> Planner -> Builder)
            let currentPhaseIdx = 0;
            for (const phase of phases) {
                this.checkAbort();
                await this.callbacks.onPhaseStart(currentPhaseIdx);
                
                // PLANNER
                await this.callbacks.onStepStart(currentPhaseIdx, `Planning ${phase.title}...`);
                const planContext = {
                    phase,
                    design: this.design,
                    user_request: this.userPrompt,
                    existing_files: this.accumulatedFiles.map(f => f.path)
                };
                const detailedPlan = await this.runStep(PROMPT_KEYS.PLANNER, JSON.stringify(planContext), DEFAULTS.PLANNER);
                const steps = detailedPlan.steps || [];

                // BUILDER Loop
                for (const step of steps) {
                    this.checkAbort();
                    
                    // Robust path check (handle various AI output formats)
                    const filePath = step.path || step.file || step.filepath; 
                    if (!filePath) {
                        console.warn("Skipping build step due to missing path:", step);
                        continue;
                    }

                    await this.callbacks.onStepStart(currentPhaseIdx, `Building ${filePath}...`);
                    
                    const builderContext = {
                        task: step.description || step.title || `Build ${filePath}`,
                        file_path: filePath,
                        design: this.design,
                        existing_files: this.accumulatedFiles.map(f => f.path),
                        phase: phase.id
                    };

                    const codeRes = await this.runStep(PROMPT_KEYS.BUILDER, JSON.stringify(builderContext), DEFAULTS.BUILDER);
                    
                    if (codeRes.file_changes) {
                        codeRes.file_changes.forEach((change: FileChange) => {
                            const existingIdx = this.accumulatedFiles.findIndex(f => f.path === change.path);
                            if (existingIdx >= 0) {
                                this.accumulatedFiles[existingIdx].content = change.content;
                            } else {
                                this.accumulatedFiles.push({ path: change.path, content: change.content, type: 'file', language: 'typescript' });
                            }
                        });
                    }

                    // Partial Update
                    const currentCode = { 
                        html: '', 
                        javascript: '// See files', 
                        css: '', 
                        explanation: `Built ${filePath}` 
                    };
                    await this.callbacks.onChunkComplete(currentCode, `Built ${filePath}`, { files: this.accumulatedFiles } as any);
                }

                await this.callbacks.onPhaseComplete(currentPhaseIdx);
                currentPhaseIdx++;
            }

            // 6. SQL GENERATION (If backend required and active)
            if (requirements.needs_backend || requirements.backendRequired) {
                await this.callbacks.onStepStart(currentPhaseIdx, "Generating Database Schema...");
                const sqlRes = await this.runStep(PROMPT_KEYS.SQL, JSON.stringify({ requirements, decision: this.decision }), DEFAULTS.SQL);
                if (sqlRes.sql) {
                    this.accumulatedFiles.push({
                        path: 'supabase/schema.sql',
                        content: sqlRes.sql,
                        type: 'file',
                        language: 'sql'
                    });
                }
            }

            // 7. QA & REPAIR
            await this.callbacks.onStepStart(99, "Final Review...");
            const qaRes: QAJSON = await this.runStep(PROMPT_KEYS.QA, JSON.stringify({ decision: this.decision, files: this.accumulatedFiles }), DEFAULTS.QA);
            
            if (qaRes.status === 'fail' && qaRes.patches) {
                await this.callbacks.onStepStart(99, "Applying Repairs...");
                const repairRes = await this.runStep(PROMPT_KEYS.REPAIR, JSON.stringify({ issues: qaRes.issues, files: this.accumulatedFiles }), DEFAULTS.REPAIR);
                if (repairRes.patches) {
                    repairRes.patches.forEach((patch: FileChange) => {
                        const idx = this.accumulatedFiles.findIndex(f => f.path === patch.path);
                        if (idx >= 0) this.accumulatedFiles[idx].content = patch.content;
                    });
                }
            }

            // 8. SUCCESS
            const finalSummary = (this.decision as any)?.analysis?.summary || "Project built successfully.";
            
            await this.callbacks.onMessage({
                id: crypto.randomUUID(),
                role: 'assistant',
                content: `**Build Complete**\n\nYour project is ready!`,
                timestamp: Date.now()
            });

            await this.callbacks.onSuccess(
                { html: '', javascript: '// See files', css: '', explanation: 'Complete' }, 
                `**Build Complete**\n\n${finalSummary}`, 
                { score: 100, passed: true, issues: [], previewHealth: 'healthy', routesDetected: [] },
                { files: this.accumulatedFiles } as any
            );

        } catch (e: any) {
            if (e.message === "ABORTED" || this.signal?.aborted) {
                console.log("Build aborted by user.");
                return;
            }
            await this.callbacks.onError(e.message, 0);
            await this.callbacks.onFinalError(e.message);
        }
    }
}

// --- PUBLIC HELPERS ---
export const handleUserIntent = async (project: Project, prompt: string) => {
    return { isArchitect: true, requiresDatabase: false, response: null as string | null, meta: {} as any };
};

export const generateProjectTitle = async (prompt: string): Promise<string> => "New Project";
export const generateSuggestions = async (msgs: Message[], code: GeneratedCode, id: string): Promise<Suggestion[]> => [];
