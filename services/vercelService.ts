
import { Project, VercelConfig } from '../types';
import { constructFullDocument } from '../utils/codeGenerator';

// Vercel API Configuration
const VERCEL_TOKEN = 'NR3XD76b2MgSftyCNA7D6Ofk';
const PROXY_URL = 'https://corsproxy.io/?';
const BASE_URL = 'https://api.vercel.com';

// Helper for proxy requests
const api = async (path: string, method: string = 'GET', body?: any) => {
    const url = `${PROXY_URL}${encodeURIComponent(`${BASE_URL}${path}`)}`;
    
    const response = await fetch(url, {
        method,
        headers: {
            'Authorization': `Bearer ${VERCEL_TOKEN}`,
            'Content-Type': 'application/json'
        },
        body: body ? JSON.stringify(body) : undefined
    });

    if (!response.ok) {
        const text = await response.text();
        // Try parsing JSON error
        try {
            const json = JSON.parse(text);
            throw new Error(json.error?.message || `Vercel API Error: ${response.status}`);
        } catch (e: any) {
            if (e.message.includes('Vercel API')) throw e;
            throw new Error(`Vercel API Error: ${text}`);
        }
    }

    return response.json();
};

export const vercelService = {
    
    /**
     * Create or Get existing Vercel Project
     */
    async ensureProject(project: Project): Promise<{ id: string; name: string }> {
        if (project.vercelConfig?.projectId) {
            return { 
                id: project.vercelConfig.projectId, 
                name: project.vercelConfig.projectName 
            };
        }

        const slug = project.name
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '')
            .substring(0, 50);
            
        const uniqueName = `${slug}-${project.id.substring(0, 6)}`;

        try {
            const res = await api('/v10/projects', 'POST', {
                name: uniqueName,
                framework: null // Static site
            });
            return { id: res.id, name: res.name };
        } catch (e: any) {
            // Check if exists
            if (e.message.includes('already exists')) {
                // If we don't have the ID but name conflict exists, try fetching
                // For simplicity, let's append random string and retry once if needed in a real scenario
                throw new Error("Project name conflict on Vercel. Please rename your project locally.");
            }
            throw e;
        }
    },

    /**
     * Deploy the current project state to Vercel
     */
    async deploy(project: Project, vercelProjectId: string): Promise<{ deploymentId: string; url: string }> {
        // 1. Construct single-file content (Bundles multi-file structure into one HTML file)
        const htmlContent = constructFullDocument(project.code, project.id, project.files);
        
        // 2. Create Deployment
        // Vercel API v13 requires `files` array
        const res = await api('/v13/deployments', 'POST', {
            name: project.name.substring(0, 100),
            project: vercelProjectId,
            files: [
                {
                    file: 'index.html',
                    data: htmlContent
                }
            ],
            target: 'production' // Direct to production for this builder
        });

        return {
            deploymentId: res.id,
            url: `https://${res.url}` // Vercel returns host without protocol
        };
    },

    /**
     * Assign a domain to the project
     */
    async assignDomain(projectId: string, domain: string): Promise<any> {
        try {
            return await api(`/v10/projects/${projectId}/domains`, 'POST', { name: domain });
        } catch (e: any) {
            // Ignore if already exists
            if (!e.message.includes('already exists')) {
                console.warn(`Failed to assign domain ${domain}:`, e);
            }
        }
    },

    /**
     * High-level orchestration for Publish/Update
     */
    async publishProject(project: Project): Promise<VercelConfig> {
        // 1. Ensure Project
        const vProject = await this.ensureProject(project);
        
        // 2. Deploy
        const deployment = await this.deploy(project, vProject.id);
        
        // 3. Configure Domains
        // Standard Pattern: {slug}.built.bnets.co
        // Note: 'built.bnets.co' must be configured in the Vercel Team associated with the Token
        const stableSlug = vProject.name; // Use the Vercel project name as the unique slug
        const stableDomain = `${stableSlug}.built.bnets.co`;
        
        await this.assignDomain(vProject.id, stableDomain);
        
        // Custom Domain (if present in local project settings)
        if (project.customDomain) {
            await this.assignDomain(vProject.id, project.customDomain);
        }

        return {
            projectId: vProject.id,
            projectName: vProject.name,
            productionUrl: `https://${stableDomain}`,
            latestDeploymentId: deployment.deploymentId,
            latestDeploymentUrl: deployment.url,
            targetDomain: project.customDomain,
            lastDeployedAt: Date.now()
        };
    }
};
