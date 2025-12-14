
import { createClient } from '@supabase/supabase-js';
import { webhookService } from './webhookService';

// Safe environment access
const getEnv = (key: string) => {
  try {
    // @ts-ignore
    if (typeof process !== 'undefined' && process.env) return process.env[key];
  } catch (e) {}
  return undefined;
};

const SUPABASE_URL = getEnv('SUPABASE_URL') || getEnv('REACT_APP_SUPABASE_URL') || 'https://sxvqqktlykguifvmqrni.supabase.co';
const SUPABASE_KEY = getEnv('SUPABASE_ANON_KEY') || getEnv('REACT_APP_SUPABASE_ANON_KEY') || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4dnFxa3RseWtndWlmdm1xcm5pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU0MDE0MTIsImV4cCI6MjA4MDk3NzQxMn0.5psTW7xePYH3T0mkkHmDoWNgLKSghOHnZaW2zzShkSA';

// Initialize for write operations (RPC). Read operations are now in cloudService.
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// --- PRICING CONSTANTS (Per 1 Million Tokens) ---
const MODEL_PRICING: Record<string, { input: number, output: number }> = {
    'gemini-2.5-flash': { input: 0.075, output: 0.30 }, // Very Cheap
    'gemini-flash-latest': { input: 0.075, output: 0.30 },
    'gemini-2.5-flash-lite-latest': { input: 0.05, output: 0.20 }, // Estimates
    'gemini-3-pro-preview': { input: 3.50, output: 10.50 }, // Expensive
    'default': { input: 0.10, output: 0.40 } // Safety Fallback
};

export const billingService = {
    
    calculateRawCost(model: string, inputTokens: number, outputTokens: number): number {
        const key = Object.keys(MODEL_PRICING).find(k => model.includes(k)) || 'default';
        const pricing = MODEL_PRICING[key];
        const inputCost = (inputTokens / 1_000_000) * pricing.input;
        const outputCost = (outputTokens / 1_000_000) * pricing.output;
        return inputCost + outputCost;
    },

    async checkBalance(userId: string, minRequired: number = 0.1): Promise<boolean> {
        const { data, error } = await supabase.from('user_settings').select('credits_balance').eq('user_id', userId).single();
        if (error) {
            // Default to true if user_settings row missing to allow bootstrapping, 
            // but in production this should be strict.
            if (error.code === 'PGRST116') return true; 
            return false;
        }
        return (data?.credits_balance || 0) > minRequired;
    },

    async chargeUser(
        userId: string, 
        projectId: string, 
        operationType: string, 
        model: string, 
        usage: { promptTokenCount: number, candidatesTokenCount: number }
    ): Promise<number> {
        const rawCost = this.calculateRawCost(model, usage.promptTokenCount, usage.candidatesTokenCount);
        const safeCost = Math.max(rawCost, 0.000001);

        const { data, error } = await supabase.rpc('process_ai_charge', {
            p_user_id: userId,
            p_project_id: projectId,
            p_model: model,
            p_operation_type: operationType,
            p_input_tokens: usage.promptTokenCount,
            p_output_tokens: usage.candidatesTokenCount,
            p_raw_cost_usd: safeCost
        });

        if (error) {
            console.error("Billing Charge Failed:", error);
            // Return 0 if charge failed so we don't break the UI stats, 
            // though in a real app we might want to handle this differently
            return 0;
        }
        
        // Webhook Trigger: Credit Usage
        const deducted = data?.deducted || 0;
        const remaining = data?.remaining || 0;
        
        webhookService.send('credit.used', {
            amount: deducted,
            model,
            tokens_in: usage.promptTokenCount,
            tokens_out: usage.candidatesTokenCount,
            remaining_balance: remaining
        }, { project_id: projectId }, { id: userId, email: '' });

        if (remaining < 2.0) {
            webhookService.send('credit.balance_low', { remaining_balance: remaining }, {}, { id: userId, email: '' });
        }
        
        return deducted;
    },

    async updateProfitMargin(percentage: number): Promise<void> {
        const { error } = await supabase.from('financial_settings').update({ profit_margin_percentage: percentage }).eq('id', 1);
        if (error) throw error;
    }
};
